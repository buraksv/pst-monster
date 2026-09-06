/**
 * Turns PST folder names and message subjects into path segments that are legal
 * on Windows, macOS and Linux alike, and keeps them unique within a directory.
 */

/**
 * Characters Windows forbids in a path segment, plus C0 control characters and
 * DEL, which some filesystems accept but no user wants in a filename.
 */
const ILLEGAL = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f\\u007f]', 'g')

/** Device names Windows reserves regardless of extension. */
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

export const MAX_FOLDER_SEGMENT = 100
export const MAX_SUBJECT_SEGMENT = 80

/**
 * Strips characters no filesystem will take, collapses whitespace, and trims the
 * trailing dots and spaces Windows silently drops.
 */
export function sanitizeSegment(raw: string, maxLength: number, fallback: string): string {
  let name = (raw ?? '')
    // Compose first, so an accented letter is one character everywhere. A PST can
    // hold either form, and macOS decomposes what it writes: without this, the
    // same subject in two forms would look like two different names to the
    // registry below, yet be one file to the filesystem, and the second message
    // would silently overwrite the first.
    .normalize('NFC')
    .replace(ILLEGAL, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows strips trailing dots and spaces from names, which would turn
    // "report." into "report" and quietly create a collision.
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')

  if (name.length > maxLength) {
    name = name
      .slice(0, maxLength)
      .trim()
      .replace(/[. ]+$/, '')
  }
  if (name.length === 0) return fallback
  if (RESERVED.has(name.toUpperCase())) name = `${name}_`
  return name
}

export function sanitizeFolderName(raw: string): string {
  return sanitizeSegment(raw, MAX_FOLDER_SEGMENT, 'Unnamed Folder')
}

/** Formats a message date as the sortable `YYYY-MM-DD_HHMMSS` filename prefix. */
export function formatDatePrefix(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '0000-00-00_000000'
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${p(date.getFullYear(), 4)}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}

/**
 * Builds the base filename (without extension) for a message: a sortable date
 * prefix followed by the sanitized subject.
 */
export function buildMessageBaseName(subject: string, date: Date | null): string {
  const subjectPart = sanitizeSegment(subject ?? '', MAX_SUBJECT_SEGMENT, '(no subject)')
  return `${formatDatePrefix(date)}_${subjectPart}`
}

/**
 * Tracks names already handed out per directory so two messages with the same
 * subject and timestamp do not overwrite each other.
 */
export class NameRegistry {
  private readonly used = new Map<string, Set<string>>()

  /**
   * @param dirKey Identifier for the directory, e.g. its absolute path.
   * @param base   Desired name without extension.
   * @param ext    Extension including the dot, or '' for folders.
   * @returns The name to use, suffixed if the desired one was taken.
   */
  claim(dirKey: string, base: string, ext = ''): string {
    let taken = this.used.get(dirKey)
    if (!taken) {
      taken = new Set()
      this.used.set(dirKey, taken)
    }

    // Compare case-insensitively: Windows and default macOS treat "A" and "a"
    // as the same file, so a case-only difference is still a collision.
    const isFree = (candidate: string): boolean => !taken.has(candidate.toLowerCase())

    let candidate = `${base}${ext}`
    if (isFree(candidate)) {
      taken.add(candidate.toLowerCase())
      return candidate
    }

    for (let n = 2; ; n++) {
      const suffix = ext === '' ? ` (${n})` : `_${n}`
      candidate = `${base}${suffix}${ext}`
      if (isFree(candidate)) {
        taken.add(candidate.toLowerCase())
        return candidate
      }
    }
  }
}

/**
 * Windows refuses paths longer than 260 characters unless long-path support is
 * on, so shorten the filename until the whole path fits.
 *
 * @returns The filename to use, or null when even a minimal name will not fit.
 */
export function fitPathLength(
  dir: string,
  fileName: string,
  limit = 255,
): { fileName: string; truncated: boolean } | null {
  const budget = limit - dir.length - 1
  if (budget >= fileName.length) return { fileName, truncated: false }
  // Keep the extension; the subject is what gets cut.
  const ext = fileName.endsWith('.eml') ? '.eml' : ''
  const stem = ext ? fileName.slice(0, -ext.length) : fileName
  const keep = budget - ext.length
  if (keep < 20) return null
  return {
    fileName: `${stem.slice(0, keep).replace(/[. ]+$/, '')}${ext}`,
    truncated: true,
  }
}
