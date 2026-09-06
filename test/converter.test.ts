import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REPORT_FILENAME, convert } from '../src/core/converter.js'
import { DEFAULT_OPTIONS } from '../src/core/types.js'
import type { ConvertSummary, ProgressEvent } from '../src/core/types.js'

/**
 * End-to-end conversion against the sample archive shipped with pst-extractor.
 * It is a real Outlook file with a nested folder tree, attachments and messages
 * whose headers were already mangled by whatever produced it, which is exactly
 * the kind of input this tool has to survive.
 */
const SAMPLE_PST = 'node_modules/pst-extractor/example/testdata/enron.pst'

/** Lists every .eml under a directory, as paths relative to it. */
async function listEml(dir: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.eml')) found.push(relative(dir, full).split(sep).join('/'))
    }
  }
  await walk(dir)
  return found.sort()
}

describe('convert', () => {
  let outputDir: string
  let summary: ConvertSummary
  let events: ProgressEvent[]

  beforeAll(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'pst-monster-test-'))
    events = []
    const result = await convert(
      { ...DEFAULT_OPTIONS, pstPath: SAMPLE_PST, outputDir },
      (event) => events.push(event),
      { cancelled: false },
    )
    summary = result.summary
  }, 120_000)

  afterAll(async () => {
    await rm(outputDir, { recursive: true, force: true })
  })

  it('converts every message in the archive without failures', () => {
    expect(summary.written).toBe(71)
    expect(summary.processed).toBe(71)
    expect(summary.failed).toBe(0)
    expect(summary.cancelled).toBe(false)
  })

  it('mirrors the folder tree of the archive', async () => {
    const files = await listEml(outputDir)
    const folders = new Set(files.map((f) => f.slice(0, f.lastIndexOf('/'))))
    expect([...folders].sort()).toEqual([
      'lokay-m/MLOKAY (Non-Privileged)',
      'lokay-m/MLOKAY (Non-Privileged)/Personal',
      'lokay-m/MLOKAY (Non-Privileged)/Sent Items',
      'lokay-m/MLOKAY (Non-Privileged)/Systems',
      'lokay-m/MLOKAY (Non-Privileged)/TW-Commercial Group',
    ])
  })

  it('names files by date and subject so they sort chronologically', async () => {
    const files = await listEml(outputDir)
    for (const file of files) {
      expect(file.slice(file.lastIndexOf('/') + 1)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_.+\.eml$/)
    }
  })

  it('writes messages a mail client can parse', async () => {
    const files = await listEml(outputDir)
    const sample = await readFile(join(outputDir, files[0]!), 'utf8')
    expect(sample).toMatch(/^[A-Za-z][A-Za-z0-9_-]*:/)
    expect(sample).toContain('\r\n')
    expect(sample).toMatch(/^Subject: .+$/m)
    expect(sample).toMatch(/^Date: .+$/m)
    expect(sample).toMatch(/^Message-ID: <.+>$/m)
  })

  it('drops the header fragments the archive left behind', async () => {
    for (const file of await listEml(outputDir)) {
      const content = await readFile(join(outputDir, file), 'utf8')
      const headerBlock = content.split('\r\n\r\n')[0] ?? ''
      for (const line of headerBlock.split('\r\n')) {
        if (line.startsWith(' ') || line.startsWith('\t')) continue
        expect(line).toMatch(/^[A-Za-z][A-Za-z0-9_-]*:/)
      }
    }
  })

  it('preserves attachment bytes', async () => {
    const files = await listEml(outputDir)
    const sizes = await Promise.all(
      files.map(async (f) => ({ f, size: (await stat(join(outputDir, f))).size })),
    )
    const largest = sizes.sort((a, b) => b.size - a.size)[0]!
    const content = await readFile(join(outputDir, largest.f), 'utf8')

    const parts = content.split(/\r\n--[^\r\n]+\r\n/).slice(1)
    const jpegs = parts.filter((p) => /Content-Type: image\/jpeg/i.test(p))
    expect(jpegs.length).toBeGreaterThan(0)

    for (const part of jpegs) {
      const body = part.split('\r\n\r\n').slice(1).join('\r\n\r\n')
      const bytes = Buffer.from(body.replace(/\r\n--.*$/s, ''), 'base64')
      // Every JPEG starts with this marker; a truncated or shifted read breaks it.
      expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff')
    }
  })

  it('leaves a report describing the run', async () => {
    const report = JSON.parse(await readFile(join(outputDir, REPORT_FILENAME), 'utf8')) as {
      options: { pstPath: string }
      summary: ConvertSummary
    }
    expect(report.options.pstPath).toBe(SAMPLE_PST)
    expect(report.summary.written).toBe(71)
  })

  it('reports progress and a final total', () => {
    const scan = events.find((e) => e.type === 'scan-complete')
    expect(scan).toEqual({ type: 'scan-complete', total: 71 })

    const progress = events.filter((e) => e.type === 'progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)).toMatchObject({ processed: 71, written: 71 })
  })
})

describe('convert with duplicates ignored', () => {
  it('keeps every message when the archive holds no duplicates', async () => {
    // Each of the 71 messages here has its own Message-ID, including the two
    // that share a sender and subject. Turning the option on must therefore
    // change nothing: the risk it guards against is discarding real mail.
    const first = await mkdtemp(join(tmpdir(), 'pst-monster-dup-a-'))
    const second = await mkdtemp(join(tmpdir(), 'pst-monster-dup-b-'))
    try {
      const plain = await convert(
        { ...DEFAULT_OPTIONS, pstPath: SAMPLE_PST, outputDir: first, ignoreDuplicates: false },
        () => {},
        { cancelled: false },
      )
      const deduped = await convert(
        { ...DEFAULT_OPTIONS, pstPath: SAMPLE_PST, outputDir: second, ignoreDuplicates: true },
        () => {},
        { cancelled: false },
      )

      expect(deduped.summary.duplicates).toBe(0)
      expect(deduped.summary.written).toBe(plain.summary.written)
      expect(await listEml(second)).toEqual(await listEml(first))
    } finally {
      await rm(first, { recursive: true, force: true })
      await rm(second, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('convert when cancelled', () => {
  it('stops early and says so, leaving what it already wrote', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'pst-monster-cancel-'))
    try {
      // Cancels as soon as the first messages have gone through.
      const signal = { cancelled: false }
      const { summary } = await convert(
        { ...DEFAULT_OPTIONS, pstPath: SAMPLE_PST, outputDir },
        (event) => {
          if (event.type === 'progress' && event.processed > 0) signal.cancelled = true
        },
        signal,
      )

      expect(summary.cancelled).toBe(true)
      expect(summary.written).toBeLessThan(71)
      expect((await listEml(outputDir)).length).toBe(summary.written)
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('convert when the file cannot be read', () => {
  it('explains what to do rather than throwing a low-level error', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'pst-monster-bad-'))
    try {
      await expect(
        convert({ ...DEFAULT_OPTIONS, pstPath: 'package.json', outputDir }, () => {}, {
          cancelled: false,
        }),
      ).rejects.toThrow(/Outlook veri dosyası olarak açılamadı/)
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})
