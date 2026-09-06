import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS } from '../shared/settings.js'
import type { AppSettings } from '../shared/settings.js'

/**
 * Persists the user's preferences in the per-user application data directory.
 *
 * This is a handful of booleans and two paths, so a single JSON file is enough
 * and avoids pulling a settings library into the main process.
 */

let cached: AppSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Keeps only known keys with the right types, so a hand-edited file cannot break startup. */
function coerce(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const input = raw as Record<string, unknown>
  const bool = (key: keyof AppSettings): boolean =>
    typeof input[key] === 'boolean' ? (input[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean)
  const text = (key: keyof AppSettings): string =>
    typeof input[key] === 'string' ? (input[key] as string) : (DEFAULT_SETTINGS[key] as string)

  return {
    ignoreDuplicates: bool('ignoreDuplicates'),
    skipNonMailItems: bool('skipNonMailItems'),
    includeRootFolderName: bool('includeRootFolderName'),
    lastPstPath: text('lastPstPath'),
    lastOutputDir: text('lastOutputDir'),
  }
}

export type { AppSettings }

export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    cached = coerce(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    // No file yet, or one we cannot read: start from the defaults.
    cached = { ...DEFAULT_SETTINGS }
  }
  return cached
}

/** Merges a partial update into the stored settings and returns the result. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = coerce({ ...getSettings(), ...patch })
  cached = next
  try {
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    // Losing a preference is not worth interrupting the user over; the app
    // keeps working with the in-memory copy.
    console.error('Settings could not be saved:', err)
  }
  return next
}
