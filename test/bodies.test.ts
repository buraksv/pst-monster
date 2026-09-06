import { describe, expect, it } from 'vitest'
import { decodeEncodedWords } from '../src/core/rfc2047.js'
import { rtfToPlainText } from '../src/core/rtf-plain.js'
import { rtfToBody } from '../src/core/rtf.js'

describe('decodeEncodedWords', () => {
  it('decodes a quoted-printable word', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Ali_Y=C4=B1lmaz?=')).toBe('Ali Yılmaz')
  })

  it('decodes a base64 word', () => {
    expect(decodeEncodedWords('=?UTF-8?B?VMO8cmvDp2U=?=')).toBe('Türkçe')
  })

  it('decodes a legacy Windows code page', () => {
    // "Işık" as written by an older Outlook using the Turkish code page.
    expect(decodeEncodedWords('=?windows-1254?Q?I=FE=FDk?=')).toBe('Işık')
  })

  it('joins adjacent words without inserting a space', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?T=C3=BCrk?= =?UTF-8?Q?=C3=A7e?=')).toBe('Türkçe')
  })

  it('leaves plain text alone', () => {
    expect(decodeEncodedWords('Ali Yilmaz')).toBe('Ali Yilmaz')
  })

  it('keeps surrounding text around an encoded word', () => {
    expect(decodeEncodedWords('Re: =?UTF-8?Q?Teklif?= (acil)')).toBe('Re: Teklif (acil)')
  })

  it('returns a malformed word unchanged rather than losing it', () => {
    expect(decodeEncodedWords('=?NOSUCHSET?Q?abc?=')).toBe('abc')
    expect(decodeEncodedWords('=?UTF-8?')).toBe('=?UTF-8?')
  })
})

describe('rtfToBody', () => {
  it('recovers the HTML Outlook wrapped inside RTF', () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1254\\fromhtml1 {\\*\\htmltag84 <p>}Merhaba \\htmlrtf {\\b \\htmlrtf0 d\\'fcnya\\htmlrtf }\\htmlrtf0 {\\*\\htmltag92 </p>}}"
    const body = rtfToBody(rtf)
    expect(body?.html).toBe('<p>Merhaba dünya</p>')
    expect(body?.text).toBe('')
  })

  it('falls back to plain text for a body genuinely composed as rich text', () => {
    const rtf = "{\\rtf1\\ansi\\ansicpg1254\\deff0 Merhaba d\\'fcnya\\par ikinci sat\\'fdr\\par}"
    const body = rtfToBody(rtf)
    expect(body?.html).toBe('')
    expect(body?.text).toBe('Merhaba dünya\nikinci satır')
  })

  it('reports nothing for an empty property', () => {
    expect(rtfToBody('')).toBeNull()
    expect(rtfToBody('   ')).toBeNull()
  })
})

describe('rtfToPlainText', () => {
  it('decodes bytes using the code page the document declares', () => {
    // In code page 1254 these three bytes are the Turkish letters below.
    expect(rtfToPlainText("{\\rtf1\\ansi\\ansicpg1254 \\'d0\\'fd\\'fe}")).toBe('Ğış')
  })

  it('turns paragraph and tab controls into whitespace', () => {
    expect(rtfToPlainText('{\\rtf1\\ansi bir\\par iki\\tab uc}')).toBe('bir\niki\tuc')
  })

  it('drops font and colour tables rather than printing them', () => {
    const rtf =
      '{\\rtf1\\ansi{\\fonttbl{\\f0\\fswiss Arial;}}{\\colortbl;\\red0\\green0\\blue0;}Gerçek metin}'
    expect(rtfToPlainText(rtf)).toBe('Gerçek metin')
  })

  it('drops ignorable destinations such as the generator stamp', () => {
    expect(rtfToPlainText('{\\rtf1\\ansi{\\*\\generator Riched20 10.0;}Metin}')).toBe('Metin')
  })

  it('decodes escaped unicode and skips its ASCII fallback', () => {
    expect(rtfToPlainText('{\\rtf1\\ansi \\u351?ey}')).toBe('şey')
  })

  it('unescapes literal braces and backslashes', () => {
    expect(rtfToPlainText('{\\rtf1\\ansi a\\{b\\}c\\\\d}')).toBe('a{b}c\\d')
  })

  it('returns nothing for an empty document', () => {
    expect(rtfToPlainText('')).toBe('')
  })
})
