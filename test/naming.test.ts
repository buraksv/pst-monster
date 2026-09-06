import { describe, expect, it } from 'vitest'
import {
  NameRegistry,
  buildMessageBaseName,
  fitPathLength,
  formatDatePrefix,
  sanitizeFolderName,
  sanitizeSegment,
} from '../src/core/naming.js'

describe('sanitizeFolderName', () => {
  it('replaces characters Windows forbids', () => {
    expect(sanitizeFolderName('Re: budget <2024>')).toBe('Re_ budget _2024_')
    expect(sanitizeFolderName('a/b\\c|d?e*f"g')).toBe('a_b_c_d_e_f_g')
  })

  it('keeps spaces and ordinary punctuation', () => {
    expect(sanitizeFolderName('Sent Items')).toBe('Sent Items')
    expect(sanitizeFolderName('Müşteriler (2023)')).toBe('Müşteriler (2023)')
  })

  it('strips the trailing dots and spaces Windows drops silently', () => {
    expect(sanitizeFolderName('report.')).toBe('report')
    expect(sanitizeFolderName('report  ')).toBe('report')
  })

  it('escapes reserved device names', () => {
    expect(sanitizeFolderName('CON')).toBe('CON_')
    expect(sanitizeFolderName('com1')).toBe('com1_')
    expect(sanitizeFolderName('CONTRACTS')).toBe('CONTRACTS')
  })

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFolderName('')).toBe('Unnamed Folder')
    expect(sanitizeFolderName('...')).toBe('Unnamed Folder')
  })

  it('caps the length', () => {
    expect(sanitizeFolderName('x'.repeat(300))).toHaveLength(100)
  })
})

describe('formatDatePrefix', () => {
  it('formats a date so filenames sort chronologically', () => {
    expect(formatDatePrefix(new Date(2023, 4, 4, 9, 8, 7))).toBe('2023-05-04_090807')
  })

  it('marks messages that carried no date', () => {
    expect(formatDatePrefix(null)).toBe('0000-00-00_000000')
    expect(formatDatePrefix(new Date('nonsense'))).toBe('0000-00-00_000000')
  })
})

describe('buildMessageBaseName', () => {
  it('joins the date prefix and the subject', () => {
    expect(buildMessageBaseName('Teklif', new Date(2023, 0, 2, 3, 4, 5))).toBe('2023-01-02_030405_Teklif')
  })

  it('names messages that have no subject', () => {
    expect(buildMessageBaseName('', new Date(2023, 0, 2, 3, 4, 5))).toBe('2023-01-02_030405_(no subject)')
  })
})

describe('NameRegistry', () => {
  it('hands out a fresh name the first time', () => {
    const registry = new NameRegistry()
    expect(registry.claim('/out', 'mail', '.eml')).toBe('mail.eml')
  })

  it('suffixes repeats within one directory', () => {
    const registry = new NameRegistry()
    registry.claim('/out', 'mail', '.eml')
    expect(registry.claim('/out', 'mail', '.eml')).toBe('mail_2.eml')
    expect(registry.claim('/out', 'mail', '.eml')).toBe('mail_3.eml')
  })

  it('treats names differing only in case as taken, as Windows does', () => {
    const registry = new NameRegistry()
    registry.claim('/out', 'Mail', '.eml')
    expect(registry.claim('/out', 'mail', '.eml')).toBe('mail_2.eml')
  })

  it('keeps directories independent', () => {
    const registry = new NameRegistry()
    registry.claim('/a', 'mail', '.eml')
    expect(registry.claim('/b', 'mail', '.eml')).toBe('mail.eml')
  })

  it('numbers folders in parentheses instead', () => {
    const registry = new NameRegistry()
    registry.claim('/out', 'Inbox')
    expect(registry.claim('/out', 'Inbox')).toBe('Inbox (2)')
  })
})

describe('fitPathLength', () => {
  it('leaves a short path alone', () => {
    expect(fitPathLength('/out', 'mail.eml')).toEqual({ fileName: 'mail.eml', truncated: false })
  })

  it('shortens the name but keeps the extension', () => {
    const result = fitPathLength('/out', `${'x'.repeat(300)}.eml`, 100)
    expect(result?.truncated).toBe(true)
    expect(result?.fileName.endsWith('.eml')).toBe(true)
    expect(`/out/${result?.fileName}`.length).toBeLessThanOrEqual(100)
  })

  it('gives up when the directory alone is too deep', () => {
    expect(fitPathLength('/'.padEnd(99, 'd'), 'mail.eml', 100)).toBeNull()
  })
})

describe('sanitizeSegment normalization', () => {
  it('composes a decomposed subject', () => {
    expect(sanitizeFolderName('Müşteriler'.normalize('NFD'))).toBe('Müşteriler')
  })

  it('treats the two forms of one name as a single name', () => {
    // On macOS both land on the same file, so the registry has to see a
    // collision and suffix the second rather than let it overwrite the first.
    const registry = new NameRegistry()
    const composed = sanitizeFolderName('Müşteriler')
    const decomposed = sanitizeFolderName('Müşteriler'.normalize('NFD'))
    expect(registry.claim('/out', composed, '.eml')).toBe('Müşteriler.eml')
    expect(registry.claim('/out', decomposed, '.eml')).toBe('Müşteriler_2.eml')
  })

  it('counts a composed character once against the length limit', () => {
    const long = 'ü'.normalize('NFD').repeat(60)
    expect(sanitizeSegment(long, 50, 'x')).toBe('ü'.repeat(50))
  })
})
