import { describe, expect, it } from 'vitest'
import { DuplicateTracker, duplicateKey } from '../src/core/dedupe.js'

const base = {
  internetMessageId: null,
  from: 'ali@ornek.com',
  subject: 'Teklif',
  date: new Date('2023-05-04T10:20:30.000Z'),
  body: 'Merhaba, ekte teklifimiz var.',
}

describe('duplicateKey', () => {
  it('uses the Message-ID when the archive kept one', () => {
    expect(duplicateKey({ ...base, internetMessageId: '<abc@ornek.com>' })).toBe('mid:abc@ornek.com')
  })

  it('ignores angle brackets and case in a Message-ID', () => {
    const a = duplicateKey({ ...base, internetMessageId: '<ABC@Ornek.com>' })
    const b = duplicateKey({ ...base, internetMessageId: 'abc@ornek.com ' })
    expect(a).toBe(b)
  })

  it('hashes the content when there is no Message-ID', () => {
    expect(duplicateKey(base)).toMatch(/^sha:[0-9a-f]{64}$/)
  })

  it('matches two copies that differ only by milliseconds and whitespace', () => {
    const a = duplicateKey(base)
    const b = duplicateKey({
      ...base,
      date: new Date('2023-05-04T10:20:30.750Z'),
      body: 'Merhaba,  ekte   teklifimiz var.',
      subject: ' teklif ',
    })
    expect(a).toBe(b)
  })

  it('separates messages that differ in substance', () => {
    expect(duplicateKey(base)).not.toBe(duplicateKey({ ...base, subject: 'Baska konu' }))
    expect(duplicateKey(base)).not.toBe(duplicateKey({ ...base, from: 'veli@ornek.com' }))
    expect(duplicateKey(base)).not.toBe(duplicateKey({ ...base, body: 'Farkli govde' }))
  })

  it('does not fall over when the message has no date', () => {
    expect(duplicateKey({ ...base, date: null })).toMatch(/^sha:/)
  })
})

describe('DuplicateTracker', () => {
  it('reports nothing for the first sighting', () => {
    const tracker = new DuplicateTracker()
    expect(tracker.check('mid:a', 'Inbox', 'Teklif')).toBeNull()
  })

  it('reports where the first copy went', () => {
    const tracker = new DuplicateTracker()
    tracker.check('mid:a', 'Inbox', 'Teklif')
    const hit = tracker.check('mid:a', 'Arsiv/2023', 'Teklif')
    expect(hit).toEqual({ key: 'mid:a', firstFolder: 'Inbox', firstSubject: 'Teklif' })
  })

  it('keeps distinct messages apart', () => {
    const tracker = new DuplicateTracker()
    tracker.check('mid:a', 'Inbox', 'A')
    expect(tracker.check('mid:b', 'Inbox', 'B')).toBeNull()
    expect(tracker.size).toBe(2)
  })
})
