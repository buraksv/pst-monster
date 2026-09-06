import iconv from 'iconv-lite'

/**
 * Decodes the RFC 2047 "encoded words" that carry non-ASCII text in mail
 * headers, e.g. `=?UTF-8?Q?Ali_Y=C4=B1lmaz?=`.
 *
 * Display names pulled out of original headers arrive still encoded. They have
 * to be decoded before being handed back to the composer, which encodes them
 * again on the way out.
 */

const ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g

function decodeQ(text: string, charset: string): string {
  // In the Q encoding an underscore stands for a space.
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '_') {
      bytes.push(0x20)
    } else if (ch === '=' && i + 2 < text.length) {
      const hex = text.slice(i + 1, i + 3)
      const value = Number.parseInt(hex, 16)
      if (Number.isNaN(value)) {
        bytes.push(ch.charCodeAt(0))
      } else {
        bytes.push(value)
        i += 2
      }
    } else {
      bytes.push(ch.charCodeAt(0))
    }
  }
  return decodeBytes(Buffer.from(bytes), charset)
}

function decodeBytes(buffer: Buffer, charset: string): string {
  const name = charset.toLowerCase().split('*')[0] ?? 'utf-8'
  if (iconv.encodingExists(name)) {
    return iconv.decode(buffer, name)
  }
  return buffer.toString('utf8')
}

/**
 * Replaces every encoded word in a header value with its decoded text. Values
 * with no encoded words are returned unchanged.
 */
export function decodeEncodedWords(value: string): string {
  if (!value || !value.includes('=?')) return value

  // Whitespace between two adjacent encoded words is not part of the text and
  // must be dropped, or "T=C3=BCrk" + "=C3=A7e" would gain a stray space.
  const joined = value.replace(/\?=[ \t]+=\?/g, '?==?')

  return joined.replace(ENCODED_WORD, (match, charset: string, encoding: string, text: string) => {
    try {
      return encoding.toUpperCase() === 'B'
        ? decodeBytes(Buffer.from(text, 'base64'), charset)
        : decodeQ(text, charset)
    } catch {
      // A malformed word is better left as-is than dropped.
      return match
    }
  })
}
