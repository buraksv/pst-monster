/**
 * Builds the file name the save dialog starts with.
 *
 * Lives here rather than beside the archiving code so the window can call it
 * without pulling a compression library into the browser bundle.
 */

/** Characters Windows forbids in a file name, plus control characters. */
const ILLEGAL = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]', 'g')

/**
 * Suggests a name for the archive of an export, from the source file and the
 * date, e.g. `arsiv-eml-2026-09-06.zip`.
 */
export function suggestZipName(pstPath: string, when = new Date()): string {
  const base = pstPath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(pst|ost)$/i, '')
    .trim()

  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
  const name = base && base.length > 0 ? base : 'outlook'

  // The dialog writes this to disk, so it has to survive the same filesystem
  // rules the exported messages do.
  const safe = name.replace(ILLEGAL, '_').replace(/[. ]+$/, '').slice(0, 80)
  return `${safe.length > 0 ? safe : 'outlook'}-eml-${stamp}.zip`
}
