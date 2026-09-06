import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PSTFile } from 'pst-extractor'
import type { PSTMessage } from 'pst-extractor'
import { DuplicateTracker, duplicateKey } from './dedupe.js'
import { buildEml } from './eml-builder.js'
import { NameRegistry, buildMessageBaseName, fitPathLength, sanitizeFolderName } from './naming.js'
import { isMailItem, readMessage } from './pst-reader.js'
import { ROOT_ID, countMessages, walkFolders } from './pst-walker.js'
import type {
  CancelSignal,
  ConvertIssue,
  ConvertOptions,
  ConvertSummary,
  ConvertWarning,
  ProgressHandler,
} from './types.js'

/**
 * Drives a whole conversion: opens the PST, mirrors its folder tree into the
 * output directory, and writes one .eml per message.
 *
 * A single unreadable message never stops the run. Everything that goes wrong is
 * collected and written to a report alongside the exported mail.
 */

/** Name of the machine-readable run report left in the output directory. */
export const REPORT_FILENAME = '_export-report.json'

/** How often progress is reported, in messages and in milliseconds. */
const PROGRESS_EVERY_MESSAGES = 25
const PROGRESS_EVERY_MS = 250

/** Cap on issues and warnings kept in memory, so a bad PST cannot exhaust it. */
const MAX_RECORDED = 5000

class Recorder {
  readonly issues: ConvertIssue[] = []
  readonly warnings: ConvertWarning[] = []
  private issuesDropped = 0
  private warningsDropped = 0

  issue(entry: ConvertIssue): void {
    if (this.issues.length < MAX_RECORDED) this.issues.push(entry)
    else this.issuesDropped++
  }

  warn(entry: ConvertWarning): void {
    if (this.warnings.length < MAX_RECORDED) this.warnings.push(entry)
    else this.warningsDropped++
  }

  finish(): void {
    if (this.issuesDropped > 0) {
      this.issues.push({
        folder: '',
        subject: '',
        reason: 'error',
        detail: `${this.issuesDropped} sorun daha kaydedilmedi.`,
      })
    }
    if (this.warningsDropped > 0) {
      this.warnings.push({
        folder: '',
        subject: '',
        detail: `${this.warningsDropped} not daha kaydedilmedi.`,
      })
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Turns a folder id into its output directory, creating names as it descends. */
class DirectoryResolver {
  private readonly dirs = new Map<number, string>()
  private readonly names = new NameRegistry()
  /** Path relative to the output root, for display and reporting. */
  private readonly relative = new Map<number, string>()

  constructor(outputDir: string) {
    this.dirs.set(ROOT_ID, outputDir)
    this.relative.set(ROOT_ID, '')
  }

  /** Registers a folder and returns its absolute directory and display path. */
  register(id: number, parentId: number, name: string | null): { dir: string; label: string } {
    const parentDir = this.dirs.get(parentId)
    const parentLabel = this.relative.get(parentId)

    if (parentDir === undefined || parentLabel === undefined) {
      // The walk always yields parents first, so this cannot happen; falling
      // back to the root keeps a malformed tree from losing messages.
      this.dirs.set(id, this.dirs.get(ROOT_ID)!)
      this.relative.set(id, '')
      return { dir: this.dirs.get(ROOT_ID)!, label: '' }
    }

    if (name === null) {
      this.dirs.set(id, parentDir)
      this.relative.set(id, parentLabel)
      return { dir: parentDir, label: parentLabel }
    }

    const segment = this.names.claim(parentDir, sanitizeFolderName(name))
    const dir = join(parentDir, segment)
    const label = parentLabel.length > 0 ? `${parentLabel}/${segment}` : segment
    this.dirs.set(id, dir)
    this.relative.set(id, label)
    return { dir, label }
  }
}

/**
 * Converts a PST file into a tree of .eml files.
 *
 * @param options   What to convert and how.
 * @param onProgress Called with scan, progress and log events as the run goes.
 * @param signal    Checked between messages so the user can stop the run.
 */
export async function convert(
  options: ConvertOptions,
  onProgress: ProgressHandler,
  signal: CancelSignal,
): Promise<{ summary: ConvertSummary; reportPath: string }> {
  const startedAt = new Date()
  const recorder = new Recorder()
  const walkOptions = { includeRootFolderName: options.includeRootFolderName }

  await mkdir(options.outputDir, { recursive: true })

  let pst: PSTFile
  try {
    pst = new PSTFile(options.pstPath)
  } catch (err) {
    throw new Error(
      `Dosya bir Outlook veri dosyası olarak açılamadı: ${errorText(err)}. ` +
        'Outlook dosyayı bozuk olarak gösteriyorsa önce scanpst.exe ile onarın.',
    )
  }

  try {
    const total = countMessages(pst.getRootFolder(), walkOptions)
    onProgress({ type: 'scan-complete', total })

    const duplicates = new DuplicateTracker()
    const resolver = new DirectoryResolver(options.outputDir)
    const fileNames = new NameRegistry()

    let processed = 0
    let written = 0
    let duplicateCount = 0
    let skipped = 0
    let failed = 0
    let cancelled = false
    let lastReport = 0
    let currentLabel = ''

    const reportProgress = (force = false): void => {
      const now = Date.now()
      if (!force && processed % PROGRESS_EVERY_MESSAGES !== 0 && now - lastReport < PROGRESS_EVERY_MS) {
        return
      }
      lastReport = now
      onProgress({ type: 'progress', processed, total, written, folder: currentLabel })
    }

    // A second walk: the first one only counted, this one reads and writes.
    outer: for (const entry of walkFolders(pst.getRootFolder(), walkOptions)) {
      const { dir, label } = resolver.register(entry.id, entry.parentId, entry.name)
      currentLabel = label
      if (entry.messageCount === 0) continue

      // Folders are created only when they hold mail, so the export has no
      // thicket of empty directories from search folders and the like.
      await mkdir(dir, { recursive: true })
      onProgress({
        type: 'log',
        level: 'info',
        message: `${label || '(kök)'}: ${entry.messageCount} ileti`,
      })

      // getNextChild advances an internal cursor; reset it so a folder visited
      // during the counting pass starts from the beginning here.
      try {
        entry.folder.moveChildCursorTo(0)
      } catch {
        // Older folder tables have no cursor to reset.
      }

      for (;;) {
        if (signal.cancelled) {
          cancelled = true
          break outer
        }

        let item: unknown
        try {
          item = entry.folder.getNextChild()
        } catch (err) {
          recorder.issue({
            folder: label,
            subject: '',
            reason: 'error',
            detail: `Bir ileti okunamadı ve atlandı: ${errorText(err)}`,
          })
          failed++
          processed++
          break
        }
        if (item === null || item === undefined) break

        processed++
        const message = item as PSTMessage
        let subject = ''

        try {
          subject = String(message.subject ?? '')

          if (options.skipNonMailItems && !isMailItem(String(message.messageClass ?? ''))) {
            skipped++
            recorder.issue({
              folder: label,
              subject,
              reason: 'not-a-mail-item',
              detail: `${String(message.messageClass ?? 'bilinmeyen')} türü bir e-posta değil.`,
            })
            reportProgress()
            continue
          }

          const extracted = await readMessage(message)

          for (const warning of extracted.warnings) {
            recorder.warn({ folder: label, subject, detail: warning })
          }

          if (options.ignoreDuplicates) {
            const key = duplicateKey({
              internetMessageId: extracted.messageId,
              from: extracted.from?.address ?? '',
              subject: extracted.subject,
              date: extracted.date,
              body: extracted.text || extracted.html,
            })
            const hit = duplicates.check(key, label, subject)
            if (hit) {
              duplicateCount++
              recorder.issue({
                folder: label,
                subject,
                reason: 'duplicate',
                detail: `Aynı ileti ${hit.firstFolder || '(kök)'} klasöründen zaten aktarıldı.`,
              })
              reportProgress()
              continue
            }
          }

          const eml = await buildEml(extracted)
          const base = buildMessageBaseName(extracted.subject, extracted.date)
          const claimed = fileNames.claim(dir, base, '.eml')
          const fitted = fitPathLength(dir, claimed)

          if (!fitted) {
            failed++
            recorder.issue({
              folder: label,
              subject,
              reason: 'error',
              detail: 'Hedef yol bu dosya sistemi için fazla uzun.',
            })
            reportProgress()
            continue
          }

          await writeFile(join(dir, fitted.fileName), eml)
          written++
        } catch (err) {
          failed++
          recorder.issue({
            folder: label,
            subject,
            reason: 'error',
            detail: errorText(err),
          })
          onProgress({
            type: 'log',
            level: 'error',
            message: `${label || '(kök)'}: "${subject}" başarısız: ${errorText(err)}`,
          })
        }

        reportProgress()
      }
    }

    reportProgress(true)
    recorder.finish()

    const finishedAt = new Date()
    const summary: ConvertSummary = {
      pstPath: options.pstPath,
      outputDir: options.outputDir,
      scanned: total,
      processed,
      written,
      duplicates: duplicateCount,
      skipped,
      failed,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      cancelled,
      issues: recorder.issues,
      warnings: recorder.warnings,
    }

    const reportPath = join(options.outputDir, REPORT_FILENAME)
    await writeFile(reportPath, JSON.stringify({ options, summary }, null, 2), 'utf8')

    return { summary, reportPath }
  } finally {
    try {
      pst.close()
    } catch {
      // Closing a file we are done with is best-effort.
    }
  }
}
