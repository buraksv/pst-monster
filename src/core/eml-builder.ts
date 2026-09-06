import MailComposer from 'nodemailer/lib/mail-composer'
import type { ExtractedMessage, MailAddress } from './message.js'

/**
 * Renders an extracted PST message as an RFC 5322 message suitable for import
 * into a mail client.
 */

/**
 * Headers that describe the MIME structure of the old message. The body is
 * re-encoded here with fresh boundaries, so carrying these over would produce a
 * message whose declared structure does not match its content.
 */
const BODY_BOUND_HEADERS = new Set([
  'content-type',
  'content-transfer-encoding',
  'content-disposition',
  'content-id',
  'content-description',
  'content-location',
  'mime-version',
])

/**
 * Headers built from dedicated fields below. Copying them from the original
 * would emit each one twice.
 */
const REBUILT_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'date',
  'message-id',
  'in-reply-to',
])

export interface RawHeader {
  key: string
  value: string
}

/**
 * Splits a raw header block into key/value pairs, joining the continuation
 * lines that RFC 5322 allows a long header to be folded across.
 */
export function parseRawHeaders(raw: string): RawHeader[] {
  const headers: RawHeader[] = []
  if (!raw) return headers

  // A blank line ends the header block; anything after it is body text that a
  // truncated PST property may have left attached.
  const block = raw.replace(/\r\n/g, '\n').split(/\n\n/)[0] ?? ''

  let current: string | null = null
  for (const line of block.split('\n')) {
    if (line.length === 0) continue
    if (/^[ \t]/.test(line) && current !== null) {
      // Folded continuation of the previous header.
      current += ' ' + line.trim()
      continue
    }
    if (current !== null) pushHeader(headers, current)
    current = line
  }
  if (current !== null) pushHeader(headers, current)

  return headers
}

/**
 * A plausible header name: starts with a letter, then letters, digits, hyphens
 * or underscores.
 *
 * RFC 5322 allows almost any printable character, but archives contain header
 * blocks whose folded lines were already flattened by whatever produced them,
 * leaving fragments like `17: 04:44 -0500` that parse as a header named "17".
 * Requiring a name-shaped key drops those without touching real headers.
 */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/

function pushHeader(headers: RawHeader[], line: string): void {
  const colon = line.indexOf(':')
  if (colon <= 0) return
  const key = line.slice(0, colon).trim()
  const value = line.slice(colon + 1).trim()
  if (!HEADER_NAME.test(key)) return
  headers.push({ key, value })
}

/**
 * Keeps the original headers worth preserving: routing history, spam verdicts
 * and X-* extensions. Drops the ones that describe the old MIME body or that we
 * regenerate from message properties.
 */
export function preservableHeaders(raw: string | null): RawHeader[] {
  if (!raw) return []
  return parseRawHeaders(raw).filter((h) => {
    const key = h.key.toLowerCase()
    return !BODY_BOUND_HEADERS.has(key) && !REBUILT_HEADERS.has(key)
  })
}

/** Formats an address for nodemailer, which encodes the display name itself. */
function toComposerAddress(a: MailAddress): { name: string; address: string } {
  return { name: a.name ?? '', address: a.address }
}

function normalizeMessageId(id: string): string {
  const trimmed = id.trim()
  if (trimmed.length === 0) return trimmed
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`
}

/**
 * Builds the .eml bytes for one message.
 *
 * Attachment content is supplied as buffers, so nodemailer never reads a path or
 * fetches a URL on behalf of the PST being converted.
 */
export function buildEml(message: ExtractedMessage): Promise<Buffer> {
  const headers = preservableHeaders(message.rawHeaders)

  const options: Record<string, unknown> = {
    subject: message.subject || '',
    date: message.date ?? new Date(0),
  }

  if (headers.length > 0) options.headers = headers
  if (message.from) options.from = toComposerAddress(message.from)
  if (message.to.length > 0) options.to = message.to.map(toComposerAddress)
  if (message.cc.length > 0) options.cc = message.cc.map(toComposerAddress)
  if (message.bcc.length > 0) options.bcc = message.bcc.map(toComposerAddress)
  if (message.messageId) options.messageId = normalizeMessageId(message.messageId)
  if (message.inReplyTo) {
    const ref = normalizeMessageId(message.inReplyTo)
    options.inReplyTo = ref
    options.references = ref
  }

  // A message with neither body part still needs one, or the result has no
  // content type at all and some clients refuse to open it.
  if (message.html) options.html = message.html
  if (message.text || !message.html) options.text = message.text || ''

  if (message.attachments.length > 0) {
    options.attachments = message.attachments.map((a) => {
      const part: Record<string, unknown> = {
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }
      if (a.contentId) {
        part.cid = a.contentId
        part.contentDisposition = a.inline ? 'inline' : 'attachment'
      } else if (a.inline) {
        part.contentDisposition = 'inline'
      }
      return part
    })
  }

  return new Promise<Buffer>((resolve, reject) => {
    const node = new MailComposer(options).compile()
    // nodemailer drops Bcc by default because it would leak recipients when
    // sending. This is an archive, so the original Bcc list is kept.
    node.keepBcc = true
    node.build((err: Error | null, result: Buffer) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}
