/**
 * Decides which version the next release gets.
 *
 * The rule the release workflow follows:
 *   - If the version in package.json has no tag yet, it is released as is.
 *     That is how a developer cuts a major (or any hand-picked) version: edit
 *     package.json, push, done.
 *   - Otherwise the minor version is bumped: 1.4.0 -> 1.5.0. Every push to
 *     main produces a new release, so the version moves on its own.
 *   - An explicit bump (major, minor, patch) always moves from package.json.
 *
 * Usage: node scripts/next-version.mjs [auto|major|minor|patch]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) throw new Error(`not a plain semver version: ${version}`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

const format = ({ major, minor, patch }) => `${major}.${minor}.${patch}`

function bump(version, kind) {
  const v = parseVersion(version)
  switch (kind) {
    case 'major':
      return format({ major: v.major + 1, minor: 0, patch: 0 })
    case 'minor':
      return format({ major: v.major, minor: v.minor + 1, patch: 0 })
    case 'patch':
      return format({ major: v.major, minor: v.minor, patch: v.patch + 1 })
    default:
      throw new Error(`unknown bump kind: ${kind}`)
  }
}

/**
 * @param {string} current  version from package.json
 * @param {Iterable<string>} tags  existing git tags, with or without the v prefix
 * @param {'auto'|'major'|'minor'|'patch'} kind
 */
export function nextVersion(current, tags, kind = 'auto') {
  const taken = new Set()
  for (const tag of tags) {
    try {
      taken.add(format(parseVersion(tag)))
    } catch {
      // Not a version tag; ignore.
    }
  }
  const base = format(parseVersion(current))

  let candidate
  if (kind === 'auto') {
    if (!taken.has(base)) return base
    candidate = bump(base, 'minor')
  } else {
    candidate = bump(base, kind)
  }
  // A tag can exist without a matching package.json commit, for example when a
  // release run failed after tagging. Keep moving until the number is free.
  while (taken.has(candidate)) candidate = bump(candidate, 'minor')
  return candidate
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const kind = process.argv[2] ?? 'auto'
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).split('\n')
  process.stdout.write(nextVersion(pkg.version, tags, kind) + '\n')
}
