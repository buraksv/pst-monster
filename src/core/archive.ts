import { createWriteStream } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import archiver from 'archiver'
import type { CancelSignal, ZipOptions, ZipProgressHandler, ZipSummary } from './types.js'

/**
 * Packs an export directory into a single .zip.
 *
 * Files are streamed from disk into the archive one at a time, so an export of
 * many gigabytes costs no more memory than a small one.
 */

/** How often progress is reported, in entries and in milliseconds. */
const PROGRESS_EVERY_ENTRIES = 20
const PROGRESS_EVERY_MS = 200

/** Deflate level: noticeably smaller than level 1, far faster than level 9. */
const COMPRESSION_LEVEL = 6

interface FoundFile {
  /** Absolute path on disk. */
  path: string
  /** Path inside the archive, always with forward slashes. */
  name: string
  size: number
}

/**
 * Lists every file under a directory.
 *
 * @param exclude Absolute path to leave out, used to keep the archive from
 *                trying to include itself when it is saved inside the export.
 */
async function collectFiles(root: string, exclude: string): Promise<FoundFile[]> {
  const found: FoundFile[] = []

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (resolve(full) === exclude) continue

      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      // Symlinks are not followed: an export written by this app contains none,
      // and following one could pull in the whole filesystem.
      if (!entry.isFile()) continue

      const info = await stat(full)
      found.push({
        path: full,
        name: relative(root, full).split(sep).join('/'),
        size: info.size,
      })
    }
  }

  await walk(root)
  // A stable order makes two archives of the same export byte-comparable.
  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Writes every file under `sourceDir` into a zip at `zipPath`.
 *
 * @param onProgress Receives scan and progress events as the archive is built.
 * @param signal     Checked as entries are added, so the user can stop.
 */
export async function createZip(
  options: ZipOptions,
  onProgress: ZipProgressHandler,
  signal: CancelSignal,
): Promise<ZipSummary> {
  const startedAt = new Date()
  const sourceDir = resolve(options.sourceDir)
  const zipPath = resolve(options.zipPath)

  const files = await collectFiles(sourceDir, zipPath)
  if (files.length === 0) {
    throw new Error('Bu klasörde arşivlenecek dosya yok.')
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  onProgress({ type: 'zip-scan', files: files.length, bytes: totalBytes })

  const output = createWriteStream(zipPath)
  const archive = archiver('zip', { zlib: { level: COMPRESSION_LEVEL } })

  let cancelled = false
  let lastReport = 0

  const finished = new Promise<void>((resolveDone, rejectDone) => {
    output.on('close', () => resolveDone())
    output.on('error', (err) => rejectDone(err))
    archive.on('error', (err) => rejectDone(err))
    archive.on('warning', (err) => {
      // A vanished or unreadable file should not lose the whole archive.
      if (err.code === 'ENOENT') return
      rejectDone(err)
    })
  })

  archive.on('progress', (data) => {
    const processed = data.entries.processed
    const now = Date.now()
    if (processed % PROGRESS_EVERY_ENTRIES !== 0 && now - lastReport < PROGRESS_EVERY_MS) return
    lastReport = now
    onProgress({
      type: 'zip-progress',
      processed,
      total: files.length,
      processedBytes: data.fs.processedBytes,
      totalBytes,
    })
  })

  archive.pipe(output)

  for (const file of files) {
    if (signal.cancelled) {
      cancelled = true
      break
    }
    archive.file(file.path, { name: file.name })
  }

  if (cancelled) {
    archive.abort()
  } else {
    void archive.finalize()
  }

  try {
    await finished
  } catch (err) {
    // Never leave a half-written archive behind for the user to find.
    await rm(zipPath, { force: true }).catch(() => {})
    throw new Error(`Arşiv oluşturulamadı: ${errorText(err)}`)
  }

  if (cancelled) {
    await rm(zipPath, { force: true }).catch(() => {})
  } else {
    onProgress({
      type: 'zip-progress',
      processed: files.length,
      total: files.length,
      processedBytes: totalBytes,
      totalBytes,
    })
  }

  const finishedAt = new Date()
  return {
    sourceDir,
    zipPath,
    fileCount: cancelled ? 0 : files.length,
    totalBytes,
    zipBytes: cancelled ? 0 : archive.pointer(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    cancelled,
  }
}
