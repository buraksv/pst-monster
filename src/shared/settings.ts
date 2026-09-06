import { DEFAULT_OPTIONS } from '../core/types.js'

/**
 * The user's stored preferences.
 *
 * Defined here rather than beside the store that writes them, because the window
 * needs the shape too and must not import anything from the main process.
 */
export interface AppSettings {
  /** Write each message only once. This is the option on the settings screen. */
  ignoreDuplicates: boolean
  /** Leave contacts, appointments and tasks out of the export. */
  skipNonMailItems: boolean
  /** Keep the archive's outermost container as a folder in the output. */
  includeRootFolderName: boolean
  /** Last used paths, so the export screen opens where the user left off. */
  lastPstPath: string
  lastOutputDir: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_OPTIONS,
  lastPstPath: '',
  lastOutputDir: '',
}
