/**
 * Shared types for the conversion core. This module is pure Node with no
 * Electron imports, so it can be unit tested and driven from the CLI.
 */

export interface ConvertOptions {
  /** Absolute path to the source .pst file. */
  pstPath: string
  /** Absolute path to the directory the folder tree is written into. */
  outputDir: string
  /** Write each message only once, keyed by Message-ID or a content hash. */
  ignoreDuplicates: boolean
  /** Skip contacts, appointments, tasks and notes; keep only mail items. */
  skipNonMailItems: boolean
  /** Nest the output under the PST root folder name instead of starting at Inbox. */
  includeRootFolderName: boolean
}

export const DEFAULT_OPTIONS: Omit<ConvertOptions, 'pstPath' | 'outputDir'> = {
  ignoreDuplicates: false,
  skipNonMailItems: true,
  includeRootFolderName: false,
}

/** Why a message produced no .eml file. */
export type SkipReason = 'duplicate' | 'not-a-mail-item' | 'error'

export interface ConvertIssue {
  /** Output-relative folder path the message lives in, e.g. "Inbox/2023". */
  folder: string
  subject: string
  reason: SkipReason
  detail: string
}

/** Non-fatal notes worth surfacing, e.g. a synthesised date or an X.500 sender. */
export interface ConvertWarning {
  folder: string
  subject: string
  detail: string
}

export interface ConvertSummary {
  pstPath: string
  outputDir: string
  /**
   * Messages the scan pass expected, from the folder counters. Folder counters
   * can overstate the truth, so this is an estimate used for the progress bar.
   */
  scanned: number
  /** Messages actually read from the file. */
  processed: number
  /** .eml files actually written. */
  written: number
  duplicates: number
  skipped: number
  failed: number
  startedAt: string
  finishedAt: string
  durationMs: number
  cancelled: boolean
  issues: ConvertIssue[]
  warnings: ConvertWarning[]
}

export type ProgressEvent =
  /** The scan pass finished; `total` is the message count to expect. */
  | { type: 'scan-complete'; total: number }
  /** Periodic throughput update during the write pass. */
  | { type: 'progress'; processed: number; total: number; written: number; folder: string }
  /** A human-readable line for the activity log. */
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  /** The run ended, successfully or by cancellation. */
  | { type: 'done'; summary: ConvertSummary; reportPath: string }
  /** The run could not start or aborted fatally. */
  | { type: 'failed'; message: string }

export type ProgressHandler = (event: ProgressEvent) => void

/** Cooperative cancellation: the converter checks this between messages. */
export interface CancelSignal {
  readonly cancelled: boolean
}

/* Archiving -------------------------------------------------------------- */

export interface ZipOptions {
  /** Directory whose contents go into the archive. */
  sourceDir: string
  /** Where the .zip is written. May sit inside sourceDir; it excludes itself. */
  zipPath: string
}

export interface ZipSummary {
  sourceDir: string
  zipPath: string
  /** Files written into the archive. Zero when the run was cancelled. */
  fileCount: number
  /** Size of the files before compression. */
  totalBytes: number
  /** Size of the finished archive. */
  zipBytes: number
  startedAt: string
  finishedAt: string
  durationMs: number
  cancelled: boolean
}

export type ZipProgressEvent =
  /** The directory listing finished; this is what the archive will contain. */
  | { type: 'zip-scan'; files: number; bytes: number }
  /** Periodic update while entries are written. */
  | { type: 'zip-progress'; processed: number; total: number; processedBytes: number; totalBytes: number }
  /** The archive was written, or the run was cancelled. */
  | { type: 'zip-done'; summary: ZipSummary }
  /** The archive could not be written. */
  | { type: 'zip-failed'; message: string }

export type ZipProgressHandler = (event: ZipProgressEvent) => void
