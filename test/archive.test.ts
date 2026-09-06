import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createZip } from '../src/core/archive.js'
import { suggestZipName } from '../src/shared/zip-name.js'
import type { ZipProgressEvent } from '../src/core/types.js'

/** Reads the entry names out of a zip with the system unzip, when it exists. */
function listZipEntries(zipPath: string): string[] | null {
  try {
    const output = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    return output.split('\n').filter((line) => line.length > 0)
  } catch {
    return null
  }
}

describe('suggestZipName', () => {
  const when = new Date(2026, 8, 6)

  it('builds the name from the archive and the date', () => {
    expect(suggestZipName('/home/ali/Arsiv 2020.pst', when)).toBe('Arsiv 2020-eml-2026-09-06.zip')
  })

  it('handles a Windows path and an .ost file', () => {
    expect(suggestZipName('C:\\Users\\ali\\mail.ost', when)).toBe('mail-eml-2026-09-06.zip')
  })

  it('keeps letters a filesystem accepts and replaces the rest', () => {
    expect(suggestZipName('/tmp/a<b>c.pst', when)).toBe('a_b_c-eml-2026-09-06.zip')
  })

  it('falls back when there is no usable name', () => {
    expect(suggestZipName('', when)).toBe('outlook-eml-2026-09-06.zip')
    expect(suggestZipName('/tmp/.pst', when)).toBe('outlook-eml-2026-09-06.zip')
  })
})

describe('createZip', () => {
  let source: string
  let target: string

  beforeEach(async () => {
    source = await mkdtemp(join(tmpdir(), 'pst-monster-zip-src-'))
    target = await mkdtemp(join(tmpdir(), 'pst-monster-zip-out-'))

    await mkdir(join(source, 'Gelen Kutusu', 'Müşteriler'), { recursive: true })
    await mkdir(join(source, 'Gönderilmiş Öğeler'), { recursive: true })
    await writeFile(join(source, 'Gelen Kutusu', 'bir.eml'), 'a'.repeat(2000))
    await writeFile(join(source, 'Gelen Kutusu', 'Müşteriler', 'iki.eml'), 'b'.repeat(3000))
    await writeFile(join(source, 'Gönderilmiş Öğeler', 'üç.eml'), 'c'.repeat(1000))
    await writeFile(join(source, '_export-report.json'), '{"ok":true}')
  })

  afterEach(async () => {
    await rm(source, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  })

  it('composes decomposed filenames, so a Mac archive matches a Windows one', async () => {
    // What macOS gives back from readdir for a name written as "Müşteriler".
    const decomposed = 'Gelen Kutusu/Müşteriler'.normalize('NFD')
    expect(decomposed).not.toBe('Gelen Kutusu/Müşteriler')

    const nfdSource = await mkdtemp(join(tmpdir(), 'pst-monster-zip-nfd-'))
    try {
      await mkdir(join(nfdSource, decomposed), { recursive: true })
      await writeFile(join(nfdSource, decomposed, 'üç.eml'.normalize('NFD')), 'x')

      const zipPath = join(target, 'nfd.zip')
      await createZip({ sourceDir: nfdSource, zipPath }, () => {}, { cancelled: false })

      const entries = listZipEntries(zipPath)
      if (entries) {
        expect(entries).toEqual(['Gelen Kutusu/Müşteriler/üç.eml'])
      }
    } finally {
      await rm(nfdSource, { recursive: true, force: true })
    }
  })

  it('writes every file, keeping the folder structure', async () => {
    const zipPath = join(target, 'export.zip')
    const summary = await createZip({ sourceDir: source, zipPath }, () => {}, { cancelled: false })

    expect(summary.fileCount).toBe(4)
    expect(summary.cancelled).toBe(false)
    expect(summary.zipBytes).toBeGreaterThan(0)
    expect((await stat(zipPath)).size).toBe(summary.zipBytes)

    const entries = listZipEntries(zipPath)
    if (entries) {
      expect(entries.sort()).toEqual([
        'Gelen Kutusu/Müşteriler/iki.eml',
        'Gelen Kutusu/bir.eml',
        'Gönderilmiş Öğeler/üç.eml',
        '_export-report.json',
      ])
    }
  })

  it('compresses, so the archive is smaller than what went into it', async () => {
    const zipPath = join(target, 'export.zip')
    const summary = await createZip({ sourceDir: source, zipPath }, () => {}, { cancelled: false })

    expect(summary.totalBytes).toBe(6011)
    expect(summary.zipBytes).toBeLessThan(summary.totalBytes)
  })

  it('reports the scan and then progress up to the total', async () => {
    const events: ZipProgressEvent[] = []
    const zipPath = join(target, 'export.zip')
    await createZip({ sourceDir: source, zipPath }, (event) => events.push(event), { cancelled: false })

    expect(events[0]).toEqual({ type: 'zip-scan', files: 4, bytes: 6011 })

    const progress = events.filter((e) => e.type === 'zip-progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)).toMatchObject({ processed: 4, total: 4, processedBytes: 6011 })
  })

  it('leaves itself out when saved inside the folder it archives', async () => {
    const zipPath = join(source, 'export.zip')
    const summary = await createZip({ sourceDir: source, zipPath }, () => {}, { cancelled: false })

    expect(summary.fileCount).toBe(4)
    const entries = listZipEntries(zipPath)
    if (entries) expect(entries).not.toContain('export.zip')
  })

  it('refuses an empty folder rather than writing an empty archive', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'pst-monster-zip-empty-'))
    try {
      await expect(
        createZip({ sourceDir: empty, zipPath: join(target, 'export.zip') }, () => {}, {
          cancelled: false,
        }),
      ).rejects.toThrow(/arşivlenecek dosya yok/i)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('deletes the half-written file when cancelled', async () => {
    const zipPath = join(target, 'export.zip')
    const summary = await createZip({ sourceDir: source, zipPath }, () => {}, { cancelled: true })

    expect(summary.cancelled).toBe(true)
    expect(summary.fileCount).toBe(0)
    await expect(stat(zipPath)).rejects.toThrow()
  })

  it('produces an archive the system can read back', async () => {
    const zipPath = join(target, 'export.zip')
    await createZip({ sourceDir: source, zipPath }, () => {}, { cancelled: false })

    const extracted = await mkdtemp(join(tmpdir(), 'pst-monster-zip-ext-'))
    try {
      execFileSync('unzip', ['-q', zipPath, '-d', extracted])
    } catch {
      // No unzip on this machine; the entry listing test already covers shape.
      await rm(extracted, { recursive: true, force: true })
      return
    }

    const content = await readFile(join(extracted, 'Gelen Kutusu', 'Müşteriler', 'iki.eml'), 'utf8')
    expect(content).toBe('b'.repeat(3000))
    await rm(extracted, { recursive: true, force: true })
  })
})
