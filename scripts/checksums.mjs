/**
 * Maintains the SHA256SUMS.txt that covers a whole release.
 *
 * A release is built one operating system at a time, so this merges rather than
 * replaces: the lines for files this build did not produce are carried over from
 * the release's existing file, and the rest are recomputed.
 *
 * Doing it here rather than with sha256sum and awk keeps the build pipelines
 * identical on all three systems, including the Windows runner.
 *
 * Usage: node scripts/checksums.mjs <dir> [existing SHA256SUMS.txt]
 * Writes <dir>/SHA256SUMS.txt.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUMS_FILE = 'SHA256SUMS.txt'

/** The format sha256sum writes and `sha256sum -c` reads: hash, two spaces, name. */
const LINE = /^([0-9a-f]{64}) {2}(.+)$/

/** @param {string} text  contents of a SHA256SUMS.txt */
export function parseSums(text) {
  const entries = new Map()
  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim())
    if (match) entries.set(match[2], match[1])
  }
  return entries
}

/**
 * Merges freshly computed hashes over whatever the release already had.
 *
 * @param {Map<string,string>} existing  name -> hash, from the release
 * @param {Map<string,string>} fresh     name -> hash, from this build
 * @returns {string} the file to upload, sorted so it reads the same every time
 */
export function mergeSums(existing, fresh) {
  const merged = new Map(existing)
  for (const [name, hash] of fresh) merged.set(name, hash)
  merged.delete(SUMS_FILE)
  return (
    [...merged.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, hash]) => `${hash}  ${name}`)
      .join('\n') + '\n'
  )
}

/** @returns {Promise<string>} the file's SHA-256, hex, streamed so size does not matter. */
export function hashFile(path) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('error', fail)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, existingPath] = process.argv.slice(2)
  if (!dir) throw new Error('usage: checksums.mjs <dir> [existing SHA256SUMS.txt]')

  let existing = new Map()
  if (existingPath) {
    try {
      existing = parseSums(await readFile(existingPath, 'utf8'))
    } catch {
      // No previous file: this is the first build of the version.
    }
  }

  const fresh = new Map()
  for (const name of (await readdir(dir)).sort()) {
    if (name === SUMS_FILE) continue
    fresh.set(name, await hashFile(join(dir, name)))
  }

  await writeFile(join(dir, SUMS_FILE), mergeSums(existing, fresh))
  process.stdout.write(`${SUMS_FILE}: ${fresh.size} new, ${existing.size} carried over\n`)
}
