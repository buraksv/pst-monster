import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ConvertOptions, ProgressEvent, ZipOptions, ZipProgressEvent } from '../core/types.js'
import { CHANNELS } from '../shared/channels.js'
import type { OutputDirInfo, StartResult } from '../shared/channels.js'
import type { AppSettings } from '../shared/settings.js'
import { anyJobRunning, archiveHost, conversionHost, disposeHosts } from './hosts.js'
import { getSettings, updateSettings } from './settings.js'

/**
 * The only surface the window can reach. Every channel is a named request the
 * renderer makes; the renderer never touches the filesystem itself.
 */

function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.pickPst, async (event): Promise<string | null> => {
    const parent = windowFor(event)
    const result = await dialog.showOpenDialog(parent ?? undefined!, {
      title: 'Outlook veri dosyasını seçin',
      properties: ['openFile'],
      filters: [
        { name: 'Outlook veri dosyası', extensions: ['pst', 'ost'] },
        { name: 'Tüm dosyalar', extensions: ['*'] },
      ],
      defaultPath: getSettings().lastPstPath || undefined,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]!
    updateSettings({ lastPstPath: picked })
    return picked
  })

  ipcMain.handle(CHANNELS.pickOutputDir, async (event): Promise<string | null> => {
    const parent = windowFor(event)
    const result = await dialog.showOpenDialog(parent ?? undefined!, {
      title: '.eml dosyalarının yazılacağı klasörü seçin',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getSettings().lastOutputDir || undefined,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]!
    updateSettings({ lastOutputDir: picked })
    return picked
  })

  ipcMain.handle(CHANNELS.inspectOutputDir, async (_event, dir: unknown): Promise<OutputDirInfo> => {
    if (typeof dir !== 'string' || dir.length === 0) {
      return { exists: false, writable: false, entryCount: 0 }
    }
    try {
      await access(dir, constants.W_OK)
    } catch {
      return { exists: false, writable: false, entryCount: 0 }
    }
    try {
      const entries = await readdir(dir)
      return { exists: true, writable: true, entryCount: entries.length }
    } catch {
      return { exists: true, writable: false, entryCount: 0 }
    }
  })

  ipcMain.handle(CHANNELS.getSettings, (): AppSettings => getSettings())

  ipcMain.handle(CHANNELS.setSettings, (_event, patch: unknown): AppSettings => {
    if (typeof patch !== 'object' || patch === null) return getSettings()
    return updateSettings(patch as Partial<AppSettings>)
  })

  ipcMain.handle(CHANNELS.startConvert, (event, request: unknown): StartResult => {
    if (conversionHost.busy) return { started: false, message: 'Zaten bir dönüştürme çalışıyor.' }

    const parsed = parseConvertRequest(request)
    if ('error' in parsed) return { started: false, message: parsed.error }

    const sender = event.sender
    conversionHost.start(parsed.options, (progress: ProgressEvent) => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.progress, progress)
    })
    return { started: true }
  })

  ipcMain.handle(CHANNELS.cancelConvert, (): void => {
    conversionHost.cancel()
  })

  ipcMain.handle(
    CHANNELS.pickZipPath,
    async (event, suggestedName: unknown, defaultDir: unknown): Promise<string | null> => {
      const parent = windowFor(event)
      const name = typeof suggestedName === 'string' && suggestedName.length > 0 ? suggestedName : 'export.zip'
      const dir = typeof defaultDir === 'string' && defaultDir.length > 0 ? defaultDir : undefined

      const result = await dialog.showSaveDialog(parent ?? undefined!, {
        title: 'ZIP dosyasını kaydet',
        defaultPath: dir ? resolve(dir, name) : name,
        filters: [{ name: 'ZIP arşivi', extensions: ['zip'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      if (result.canceled || !result.filePath) return null
      // Some platforms let the user delete the extension; the archive is a zip
      // either way, so make the name say so.
      return result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`
    },
  )

  ipcMain.handle(CHANNELS.startZip, (event, request: unknown): StartResult => {
    if (archiveHost.busy) return { started: false, message: 'Zaten bir arşivleme çalışıyor.' }

    const parsed = parseZipRequest(request)
    if ('error' in parsed) return { started: false, message: parsed.error }

    const sender = event.sender
    archiveHost.start(parsed.options, (progress: ZipProgressEvent) => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.zipProgress, progress)
    })
    return { started: true }
  })

  ipcMain.handle(CHANNELS.cancelZip, (): void => {
    archiveHost.cancel()
  })

  ipcMain.handle(CHANNELS.openPath, async (_event, target: unknown): Promise<void> => {
    if (typeof target !== 'string' || target.length === 0) return
    await shell.openPath(target)
  })

  ipcMain.handle(CHANNELS.revealPath, (_event, target: unknown): void => {
    if (typeof target !== 'string' || target.length === 0) return
    shell.showItemInFolder(target)
  })
}

/** Validates an archive request before it reaches the worker. */
function parseZipRequest(request: unknown): { options: ZipOptions } | { error: string } {
  if (typeof request !== 'object' || request === null) return { error: 'Arşivlenecek bir şey yok.' }
  const input = request as Record<string, unknown>

  const sourceDir = typeof input.sourceDir === 'string' ? input.sourceDir.trim() : ''
  const zipPath = typeof input.zipPath === 'string' ? input.zipPath.trim() : ''
  if (sourceDir.length === 0) return { error: 'Arşivlenecek klasör belli değil.' }
  if (zipPath.length === 0) return { error: 'Kaydedilecek dosya seçilmedi.' }
  // Both come from dialogs in normal use; a relative path here would resolve
  // against the app's working directory rather than anywhere the user meant.
  if (!isAbsolute(sourceDir) || !isAbsolute(zipPath)) return { error: 'Geçersiz dosya yolu.' }
  if (resolve(sourceDir) === resolve(zipPath)) return { error: 'Geçersiz dosya yolu.' }

  return { options: { sourceDir: resolve(sourceDir), zipPath: resolve(zipPath) } }
}

/** The folder the archive will be written into, used by the caller for checks. */
export function zipTargetDirectory(zipPath: string): string {
  return dirname(resolve(zipPath))
}

/** Validates what the window sent before it reaches the worker. */
function parseConvertRequest(request: unknown): { options: ConvertOptions } | { error: string } {
  if (typeof request !== 'object' || request === null) return { error: 'Dönüştürülecek bir şey yok.' }
  const input = request as Record<string, unknown>

  const pstPath = typeof input.pstPath === 'string' ? input.pstPath.trim() : ''
  const outputDir = typeof input.outputDir === 'string' ? input.outputDir.trim() : ''
  if (pstPath.length === 0) return { error: 'Önce bir .pst dosyası seçin.' }
  if (outputDir.length === 0) return { error: 'Önce bir hedef klasör seçin.' }

  const settings = getSettings()
  return {
    options: {
      pstPath,
      outputDir,
      ignoreDuplicates: settings.ignoreDuplicates,
      skipNonMailItems: settings.skipNonMailItems,
      includeRootFolderName: settings.includeRootFolderName,
    },
  }
}

/** Stops running jobs when the app is shutting down. */
export function disposeIpc(): void {
  disposeHosts()
}

/** True while a job is running, so the window can confirm before closing. */
export function conversionInProgress(): boolean {
  return anyJobRunning()
}
