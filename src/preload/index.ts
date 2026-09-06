import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { CHANNELS } from '../shared/channels.js'
import type { Api, OutputDirInfo, StartResult, ZipRequest } from '../shared/channels.js'
import type { AppSettings } from '../shared/settings.js'
import type { ProgressEvent, ZipProgressEvent } from '../core/types.js'

/**
 * The bridge between the window and the main process.
 *
 * Only these functions cross the boundary. The renderer gets no ipcRenderer, no
 * require and no filesystem: it asks for a dialog, or for a conversion, and
 * receives plain data back.
 */

const api: Api = {
  pickPst: () => ipcRenderer.invoke(CHANNELS.pickPst) as Promise<string | null>,
  pickOutputDir: () => ipcRenderer.invoke(CHANNELS.pickOutputDir) as Promise<string | null>,
  inspectOutputDir: (dir) => ipcRenderer.invoke(CHANNELS.inspectOutputDir, dir) as Promise<OutputDirInfo>,
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings) as Promise<AppSettings>,
  setSettings: (patch) => ipcRenderer.invoke(CHANNELS.setSettings, patch) as Promise<AppSettings>,
  startConvert: (request) =>
    ipcRenderer.invoke(CHANNELS.startConvert, request) as Promise<StartResult>,
  cancelConvert: () => ipcRenderer.invoke(CHANNELS.cancelConvert) as Promise<void>,
  pickZipPath: (suggestedName, defaultDir) =>
    ipcRenderer.invoke(CHANNELS.pickZipPath, suggestedName, defaultDir) as Promise<string | null>,
  startZip: (request: ZipRequest) => ipcRenderer.invoke(CHANNELS.startZip, request) as Promise<StartResult>,
  cancelZip: () => ipcRenderer.invoke(CHANNELS.cancelZip) as Promise<void>,
  openPath: (target) => ipcRenderer.invoke(CHANNELS.openPath, target) as Promise<void>,
  revealPath: (target) => ipcRenderer.invoke(CHANNELS.revealPath, target) as Promise<void>,
  onProgress: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: ProgressEvent): void => handler(payload)
    ipcRenderer.on(CHANNELS.progress, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.progress, listener)
    }
  },
  onZipProgress: (handler) => {
    const listener = (_event: IpcRendererEvent, payload: ZipProgressEvent): void => handler(payload)
    ipcRenderer.on(CHANNELS.zipProgress, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.zipProgress, listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
