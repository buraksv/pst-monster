import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashFile, mergeSums, parseSums } from '../scripts/checksums.mjs'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

describe('parseSums', () => {
  it('reads the sha256sum format', () => {
    const parsed = parseSums(`${HASH_A}  one.deb\n${HASH_B}  two.exe\n`)
    expect(parsed.get('one.deb')).toBe(HASH_A)
    expect(parsed.get('two.exe')).toBe(HASH_B)
  })

  it('ignores blank and malformed lines', () => {
    expect(parseSums(`\nnot a checksum line\n${HASH_A}  one.deb\n`).size).toBe(1)
  })
})

describe('mergeSums', () => {
  it('keeps the other systems and replaces this build', () => {
    // Windows and macOS are already in the release; Linux is rebuilt.
    const existing = parseSums(`${HASH_A}  app.exe\n${HASH_B}  app.dmg\n${HASH_C}  app.deb\n`)
    const fresh = new Map([['app.deb', 'd'.repeat(64)]])
    const merged = mergeSums(existing, fresh)
    expect(merged).toContain(`${HASH_A}  app.exe`)
    expect(merged).toContain(`${HASH_B}  app.dmg`)
    expect(merged).toContain(`${'d'.repeat(64)}  app.deb`)
    expect(merged).not.toContain(HASH_C)
  })

  it('lists each file exactly once', () => {
    const merged = mergeSums(
      parseSums(`${HASH_A}  app.deb\n`),
      new Map([['app.deb', HASH_B]]),
    )
    expect(merged.trim().split('\n')).toHaveLength(1)
  })

  it('never lists the sums file itself', () => {
    const merged = mergeSums(
      parseSums(`${HASH_A}  SHA256SUMS.txt\n${HASH_B}  app.deb\n`),
      new Map(),
    )
    expect(merged).not.toContain('SHA256SUMS.txt')
  })

  it('sorts by name, so the file reads the same every run', () => {
    const merged = mergeSums(
      new Map(),
      new Map([
        ['z.deb', HASH_A],
        ['a.exe', HASH_B],
      ]),
    )
    expect(merged.trim().split('\n')[0]).toContain('a.exe')
  })

  it('starts from nothing on the first build of a version', () => {
    expect(mergeSums(new Map(), new Map([['app.deb', HASH_A]]))).toBe(`${HASH_A}  app.deb\n`)
  })
})

describe('hashFile', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pst-monster-sums-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('matches the known SHA-256 of the contents', async () => {
    const file = join(dir, 'x.bin')
    await writeFile(file, 'abc')
    // The published SHA-256 of the string "abc".
    expect(await hashFile(file)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('round-trips through the sums format', async () => {
    const file = join(dir, 'y.bin')
    await writeFile(file, 'hello')
    const hash = await hashFile(file)
    expect(parseSums(mergeSums(new Map(), new Map([['y.bin', hash]]))).get('y.bin')).toBe(hash)
  })
})
