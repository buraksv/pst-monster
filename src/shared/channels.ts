import type { ProgressEvent, ZipProgressEvent } from '../core/types.js'
import type { AppSettings } from './settings.js'

/**
 * The contract between the window and the main process.
 *
 * Both ends import this, so a channel cannot be renamed on one side only, and
 * the window never has to reach into main-process code for a type.
 */

export const CHANNELS = {
  pickPst: 'dialog:pick-pst',
  pickOutputDir: 'dialog:pick-output-dir',
  inspectOutputDir: 'fs:inspect-output-dir',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  startConvert: 'convert:start',
  cancelConvert: 'convert:cancel',
  openPath: 'shell:open-path',
  revealPath: 'shell:reveal-path',
  pickZipPath: 'dialog:pick-zip-path',
  startZip: 'zip:start',
  cancelZip: 'zip:cancel',
  /** Main to window: conversion events. */
  progress: 'convert:progress',
  /** Main to window: archiving events. */
  zipProgress: 'zip:progress',
} as const

export interface OutputDirInfo {
  exists: boolean
  writable: boolean
  /** Entries already there, so the user can be warned before mixing exports. */
  entryCount: number
}

export interface ConvertRequest {
  pstPath: string
  outputDir: string
}

export interface ZipRequest {
  /** Directory to archive, normally the folder the export was written to. */
  sourceDir: string
  /** Where to write the .zip, as chosen in the save dialog. */
  zipPath: string
}

export interface StartResult {
  started: boolean
  /** Why it did not start, when it did not. */
  message?: string
}

/** Everything the preload script publishes on `window.api`. */
export interface Api {
  /** Opens the file picker and returns the chosen file, or null if dismissed. */
  pickPst(): Promise<string | null>
  /** Opens the folder picker and returns the chosen directory, or null. */
  pickOutputDir(): Promise<string | null>
  /** Reports whether a directory exists, is writable, and already has content. */
  inspectOutputDir(dir: string): Promise<OutputDirInfo>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  startConvert(request: ConvertRequest): Promise<StartResult>
  cancelConvert(): Promise<void>
  /**
   * Opens the save dialog for the archive.
   *
   * @param suggestedName Pre-filled file name.
   * @param defaultDir    Directory the dialog opens in.
   * @returns The chosen path, or null if dismissed.
   */
  pickZipPath(suggestedName: string, defaultDir: string): Promise<string | null>
  startZip(request: ZipRequest): Promise<StartResult>
  cancelZip(): Promise<void>
  /** Opens a file or folder in the system's file manager. */
  openPath(target: string): Promise<void>
  /** Opens the containing folder with the file selected. */
  revealPath(target: string): Promise<void>
  /** Subscribes to conversion events. Returns a function that unsubscribes. */
  onProgress(handler: (event: ProgressEvent) => void): () => void
  /** Subscribes to archiving events. Returns a function that unsubscribes. */
  onZipProgress(handler: (event: ZipProgressEvent) => void): () => void
}
