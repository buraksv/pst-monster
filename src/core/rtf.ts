import iconv from 'iconv-lite'
import { deEncapsulateSync } from 'rtf-stream-parser'
import { rtfToPlainText } from './rtf-plain.js'

/**
 * Recovers a readable body from the RTF that Outlook stores when a message has
 * no plain-text or HTML property of its own.
 *
 * Outlook encapsulates the original HTML inside the RTF for mail it composed
 * itself, so de-encapsulation usually gives back the real HTML body rather than
 * a lossy plain-text rendering.
 */

export interface RtfBody {
  html: string
  text: string
}

/**
 * The RTF parser decodes bytes with Node's own Buffer encodings, which do not
 * include the Windows code pages Outlook writes, such as cp1254 for Turkish.
 * Routing both directions through iconv-lite fixes those characters.
 */
const decode = (buf: Buffer, enc: string): string =>
  iconv.encodingExists(enc) ? iconv.decode(buf, enc) : buf.toString('latin1')

const encode = (str: string, enc: string): Buffer =>
  iconv.encodingExists(enc) ? iconv.encode(str, enc) : Buffer.from(str, 'latin1')

/**
 * Converts an RTF body into HTML or plain text.
 *
 * @param rtf Decompressed RTF source as read from the PST.
 * @returns The recovered body, or null when the RTF cannot be parsed.
 */
export function rtfToBody(rtf: string): RtfBody | null {
  const source = String(rtf ?? '')
  if (source.trim().length === 0) return null

  try {
    const result = deEncapsulateSync(Buffer.from(source, 'utf8'), {
      decode,
      encode,
      mode: 'either',
      warn: () => {
        // The parser warns about unknown control words on ordinary Outlook RTF;
        // they are not actionable, so they stay out of the run log.
      },
    })

    const text = typeof result.text === 'string' ? result.text : result.text.toString('utf8')
    if (result.mode === 'html') return { html: text, text: '' }
    return { html: '', text }
  } catch {
    // Not encapsulated content: a body genuinely composed as rich text. Strip
    // the formatting and keep the words.
    const text = rtfToPlainText(source)
    return text.length > 0 ? { html: '', text } : null
  }
}
