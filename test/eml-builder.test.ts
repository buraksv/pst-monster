import { describe, expect, it } from 'vitest'
import { buildEml, parseRawHeaders, preservableHeaders } from '../src/core/eml-builder.js'
import type { ExtractedMessage } from '../src/core/message.js'

function message(overrides: Partial<ExtractedMessage> = {}): ExtractedMessage {
  return {
    subject: 'Teklif',
    from: { name: 'Ali Yılmaz', address: 'ali@ornek.com' },
    to: [{ name: 'Ayşe Demir', address: 'ayse@ornek.com' }],
    cc: [],
    bcc: [],
    date: new Date('2023-05-04T10:20:30.000Z'),
    messageId: '<abc@ornek.com>',
    inReplyTo: null,
    text: 'Merhaba',
    html: '',
    rawHeaders: null,
    attachments: [],
    warnings: [],
    ...overrides,
  }
}

/** Returns just the header block of a built message. */
function headersOf(eml: Buffer): string {
  return eml.toString('utf8').split('\r\n\r\n')[0] ?? ''
}

describe('parseRawHeaders', () => {
  it('splits a header block into names and values', () => {
    const parsed = parseRawHeaders('Subject: hi\r\nX-Test: 1\r\n')
    expect(parsed).toEqual([
      { key: 'Subject', value: 'hi' },
      { key: 'X-Test', value: '1' },
    ])
  })

  it('rejoins a value folded across lines', () => {
    const parsed = parseRawHeaders('Received: from a\r\n\tby b\r\n by c\r\n')
    expect(parsed).toEqual([{ key: 'Received', value: 'from a by b by c' }])
  })

  it('stops at the blank line that ends the block', () => {
    const parsed = parseRawHeaders('Subject: hi\r\n\r\nSubject: body text\r\n')
    expect(parsed).toEqual([{ key: 'Subject', value: 'hi' }])
  })

  it('drops fragments left by an archive that already unfolded the headers', () => {
    // Real archives contain lines like this, where a folded date became its own
    // line and now parses as a header named "17".
    const parsed = parseRawHeaders('Received: from a\r\n17: 04:44 -0500\r\n2.0: Microsoft Mail\r\n')
    expect(parsed).toEqual([{ key: 'Received', value: 'from a' }])
  })
})

describe('preservableHeaders', () => {
  it('keeps routing history and extensions', () => {
    const kept = preservableHeaders('Received: from a\r\nX-Spam-Score: 0.1\r\n')
    expect(kept.map((h) => h.key)).toEqual(['Received', 'X-Spam-Score'])
  })

  it('drops headers describing the old MIME body', () => {
    const kept = preservableHeaders(
      'Content-Type: multipart/mixed; boundary="old"\r\nMIME-Version: 1.0\r\nContent-Transfer-Encoding: base64\r\nX-Keep: yes\r\n',
    )
    expect(kept.map((h) => h.key)).toEqual(['X-Keep'])
  })

  it('drops headers that are rebuilt from message properties', () => {
    const kept = preservableHeaders('From: a@b.c\r\nTo: d@e.f\r\nSubject: x\r\nDate: now\r\nX-Keep: yes\r\n')
    expect(kept.map((h) => h.key)).toEqual(['X-Keep'])
  })

  it('returns nothing when the archive kept no headers', () => {
    expect(preservableHeaders(null)).toEqual([])
  })
})

describe('buildEml', () => {
  it('writes the core headers', async () => {
    const headers = headersOf(await buildEml(message()))
    expect(headers).toContain('Subject: Teklif')
    expect(headers).toContain('Message-ID: <abc@ornek.com>')
    expect(headers).toContain('Date: Thu, 04 May 2023 10:20:30 +0000')
  })

  it('encodes non-ASCII display names and subjects', async () => {
    const eml = await buildEml(message({ subject: 'Türkçe konu' }))
    const headers = headersOf(eml)
    expect(headers).toContain('=?UTF-8?Q?')
    // The bytes must survive the round trip even though the header is encoded.
    expect(headers).not.toContain('Türkçe konu')
  })

  it('keeps Bcc, which matters for an archive and not for sending', async () => {
    const eml = await buildEml(message({ bcc: [{ name: 'Gizli', address: 'gizli@ornek.com' }] }))
    expect(headersOf(eml)).toContain('Bcc: Gizli <gizli@ornek.com>')
  })

  it('emits both bodies as multipart/alternative', async () => {
    const eml = (await buildEml(message({ html: '<p>Merhaba</p>' }))).toString('utf8')
    expect(eml).toContain('multipart/alternative')
    expect(eml).toContain('<p>Merhaba</p>')
    expect(eml).toContain('Merhaba')
  })

  it('still produces a body part when the message had none', async () => {
    const eml = (await buildEml(message({ text: '', html: '' }))).toString('utf8')
    expect(eml).toContain('Content-Type: text/plain')
  })

  it('attaches files with their own type and name', async () => {
    const eml = (
      await buildEml(
        message({
          attachments: [
            {
              filename: 'rapor.pdf',
              contentType: 'application/pdf',
              contentId: null,
              inline: false,
              content: Buffer.from('%PDF-1.4'),
            },
          ],
        }),
      )
    ).toString('utf8')
    expect(eml).toContain('Content-Type: application/pdf; name=rapor.pdf')
    expect(eml).toContain('Content-Disposition: attachment; filename=rapor.pdf')
    expect(eml).toContain(Buffer.from('%PDF-1.4').toString('base64'))
  })

  it('links an inline image to the body that references it', async () => {
    const eml = (
      await buildEml(
        message({
          html: '<p><img src="cid:logo123"></p>',
          attachments: [
            {
              filename: 'logo.png',
              contentType: 'image/png',
              contentId: 'logo123',
              inline: true,
              content: Buffer.from([137, 80, 78, 71]),
            },
          ],
        }),
      )
    ).toString('utf8')
    expect(eml).toContain('multipart/related')
    expect(eml).toContain('Content-ID: <logo123>')
    expect(eml).toContain('Content-Disposition: inline')
  })

  it('carries the original headers through without duplicating rebuilt ones', async () => {
    const headers = headersOf(
      await buildEml(
        message({
          rawHeaders:
            'Received: from mail.ornek.com\r\nFrom: eski@ornek.com\r\nContent-Type: text/plain; boundary="old"\r\nX-Mailer: Outlook\r\n',
        }),
      ),
    )
    expect(headers).toContain('Received: from mail.ornek.com')
    expect(headers).toContain('X-Mailer: Outlook')
    expect(headers).toContain('From: =?UTF-8?Q?Ali_Y=C4=B1lmaz?= <ali@ornek.com>')
    expect(headers).not.toContain('eski@ornek.com')
    expect(headers).not.toContain('boundary="old"')
  })

  it('sets the reply chain when the message answered another', async () => {
    const headers = headersOf(await buildEml(message({ inReplyTo: 'parent@ornek.com' })))
    expect(headers).toContain('In-Reply-To: <parent@ornek.com>')
    expect(headers).toContain('References: <parent@ornek.com>')
  })
})
