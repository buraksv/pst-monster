import addressparser from 'nodemailer/lib/addressparser'
import mime from 'mime-types'
import type { PSTAttachment, PSTMessage } from 'pst-extractor'
import { buildEml, parseRawHeaders } from './eml-builder.js'
import {
  RECIPIENT_BCC,
  RECIPIENT_CC,
  RECIPIENT_TO,
  type ExtractedAttachment,
  type ExtractedMessage,
  type MailAddress,
} from './message.js'
import { decodeEncodedWords } from './rfc2047.js'
import { rtfToBody } from './rtf.js'

/**
 * Reads a message out of a PST into the format-neutral shape the .eml writer
 * consumes.
 *
 * Where the PST kept the original internet headers, those win: they carry the
 * addresses the message actually travelled with. Exchange-internal mail has no
 * such headers, and its MAPI properties hold X.500 directory names instead of
 * mail addresses, which is the awkward case handled below.
 */

/** How deep a chain of messages-attached-to-messages is followed. */
const MAX_EMBED_DEPTH = 10

/** Attachment methods defined by MAPI. */
const ATTACH_BY_VALUE = 1
const ATTACH_BY_REFERENCE = 2
const ATTACH_BY_REFERENCE_RESOLVE = 3
const ATTACH_BY_REFERENCE_ONLY = 4
const ATTACH_EMBEDDED = 5

/**
 * Decides whether an item is mail rather than a contact, appointment, task or
 * note. Delivery reports and posts count as mail: they have senders and bodies.
 */
export function isMailItem(messageClass: string): boolean {
  const value = (messageClass ?? '').trim()
  if (value.length === 0) return true
  return /^(ipm\.note|ipm\.post|ipm\.schedule\.meeting|report\.)/i.test(value)
}

/** Reads a PST string property that may be absent, a String object, or null. */
function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * True when an address is an Exchange directory name rather than something a
 * mail client can use, e.g. `/o=ORG/ou=.../cn=Recipients/cn=ali`.
 */
function isDirectoryName(address: string): boolean {
  return address.startsWith('/o=') || address.startsWith('/O=')
}

/**
 * Turns whatever the PST holds for one party into a usable address.
 *
 * An X.500 directory name is not routable, so the common name is lifted out of
 * it and given an unresolvable domain. That keeps the message parseable and
 * makes plain that the real address was not in the archive.
 */
function toAddress(name: string, address: string, addrType: string): MailAddress | null {
  const displayName = decodeEncodedWords(name.trim())
  const raw = address.trim()

  if (raw.length === 0) {
    if (displayName.length === 0) return null
    return { name: displayName, address: syntheticAddress(displayName) }
  }

  if (addrType.toUpperCase() === 'EX' || isDirectoryName(raw)) {
    const cn = /\/cn=([^/]+)$/i.exec(raw)?.[1] ?? displayName
    return { name: displayName || cn, address: syntheticAddress(cn) }
  }

  return { name: displayName, address: raw }
}

/**
 * Builds a placeholder address from a display name. The `.invalid` top-level
 * domain is reserved by RFC 2606 and can never resolve, so these are visibly
 * not real addresses.
 */
function syntheticAddress(source: string): string {
  const local = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return `${local.length > 0 ? local : 'unknown'}@x500.invalid`
}

/** Parses an address header into structured addresses, decoding display names. */
function addressesFromHeader(value: string): MailAddress[] {
  return addressparser(value)
    .filter((a): a is { address: string; name: string } => typeof a.address === 'string')
    .map((a) => ({ name: decodeEncodedWords(a.name ?? ''), address: a.address }))
    .filter((a) => a.address.length > 0)
}

interface HeaderIndex {
  get(key: string): string | null
}

function indexHeaders(raw: string | null): HeaderIndex {
  const map = new Map<string, string>()
  if (raw) {
    for (const h of parseRawHeaders(raw)) {
      const key = h.key.toLowerCase()
      // First occurrence wins; later ones are usually trace headers.
      if (!map.has(key)) map.set(key, h.value)
    }
  }
  return { get: (key) => map.get(key) ?? null }
}

/** Collects recipients of one MAPI type from the message. */
function recipientsOfType(message: PSTMessage, type: number, warnings: string[]): MailAddress[] {
  const result: MailAddress[] = []
  let count = 0
  try {
    count = message.numberOfRecipients
  } catch {
    return result
  }

  for (let i = 0; i < count; i++) {
    try {
      const recipient = message.getRecipient(i)
      if (!recipient || recipient.recipientType !== type) continue

      const smtp = str(recipient.smtpAddress)
      const email = str(recipient.emailAddress)
      const address = toAddress(
        str(recipient.displayName),
        smtp.length > 0 ? smtp : email,
        smtp.length > 0 ? 'SMTP' : str(recipient.addrType),
      )
      if (address) result.push(address)
    } catch (err) {
      warnings.push(`${i + 1}. alıcı okunamadı: ${errorText(err)}`)
    }
  }
  return result
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads one attachment's bytes out of the PST. */
function readAttachmentContent(attachment: PSTAttachment): Buffer {
  const stream = attachment.fileInputStream
  if (!stream) return Buffer.alloc(0)

  const size = stream.length.toNumber()
  if (size <= 0) return Buffer.alloc(0)

  const buffer = Buffer.alloc(size)
  stream.readCompletely(buffer)
  return buffer
}

async function readAttachments(
  message: PSTMessage,
  html: string,
  depth: number,
  warnings: string[],
): Promise<ExtractedAttachment[]> {
  const attachments: ExtractedAttachment[] = []
  let count = 0
  try {
    count = message.numberOfAttachments
  } catch {
    return attachments
  }

  for (let i = 0; i < count; i++) {
    try {
      const attachment = message.getAttachment(i)
      if (!attachment) continue

      const method = attachment.attachMethod

      if (method === ATTACH_EMBEDDED) {
        const embedded = attachment.embeddedPSTMessage
        if (!embedded) {
          warnings.push(`${i + 1}. ek, açılamayan gömülü bir ileti.`)
          continue
        }
        if (depth >= MAX_EMBED_DEPTH) {
          warnings.push(
            `${i + 1}. ek ${MAX_EMBED_DEPTH} kattan daha derin ileti içeriyor ve atlandı.`,
          )
          continue
        }
        const inner = await readMessage(embedded, depth + 1)
        warnings.push(...inner.warnings.map((w) => `Gömülü iletide: ${w}`))
        attachments.push({
          filename: embeddedFileName(attachment, inner.subject),
          contentType: 'message/rfc822',
          contentId: null,
          inline: false,
          content: await buildEml(inner),
        })
        continue
      }

      if (
        method === ATTACH_BY_REFERENCE ||
        method === ATTACH_BY_REFERENCE_RESOLVE ||
        method === ATTACH_BY_REFERENCE_ONLY
      ) {
        // The PST holds only a path to a file that lived on the original
        // machine, so there is nothing here to write out.
        const name = attachmentName(attachment, i)
        warnings.push(`"${name}" eki dış bir dosyaya bağlantı olarak saklanmış, arşivde yok.`)
        continue
      }

      if (method !== ATTACH_BY_VALUE && method !== 0) {
        warnings.push(`${i + 1}. ek desteklenmeyen bir yöntemle (${method}) saklanmış ve atlandı.`)
        continue
      }

      const content = readAttachmentContent(attachment)
      if (content.length === 0) {
        warnings.push(`"${attachmentName(attachment, i)}" eki boştu.`)
        continue
      }

      const filename = attachmentName(attachment, i)
      const contentId = str(attachment.contentId).replace(/^</, '').replace(/>$/, '')
      // Only treat a part as inline when the body actually points at it.
      const referenced = contentId.length > 0 && html.includes(contentId)

      attachments.push({
        filename,
        contentType: contentTypeFor(attachment, filename),
        contentId: referenced ? contentId : null,
        inline: referenced && !attachment.isAttachmentInvisibleInHtml,
        content,
      })
    } catch (err) {
      warnings.push(`${i + 1}. ek okunamadı: ${errorText(err)}`)
    }
  }

  return attachments
}

function attachmentName(attachment: PSTAttachment, index: number): string {
  const long = str(attachment.longFilename).trim()
  if (long.length > 0) return long
  const short = str(attachment.filename).trim()
  if (short.length > 0) return short
  return `attachment-${index + 1}`
}

function embeddedFileName(attachment: PSTAttachment, subject: string): string {
  const explicit = str(attachment.longFilename).trim() || str(attachment.filename).trim()
  if (explicit.length > 0) {
    return explicit.toLowerCase().endsWith('.eml') ? explicit : `${explicit}.eml`
  }
  const base = subject.trim().length > 0 ? subject.trim() : 'embedded-message'
  return `${base.slice(0, 60)}.eml`
}

/** The type Outlook falls back to when it did not record a real one. */
const GENERIC_TYPE = 'application/octet-stream'

function contentTypeFor(attachment: PSTAttachment, filename: string): string {
  const declared = str(attachment.mimeTag).trim().toLowerCase()
  const guessed = mime.lookup(filename)

  // Outlook stores the generic type for most attachments it did not receive
  // over the internet. Taking it literally would leave photos and PDFs as
  // unpreviewable blobs, so the extension wins in that one case.
  if (declared.length > 0 && declared.includes('/') && declared !== GENERIC_TYPE) {
    return declared
  }
  return guessed || GENERIC_TYPE
}

/**
 * Converts a PST message into the shape the .eml writer takes.
 *
 * @param message The message as read by pst-extractor.
 * @param depth   Recursion depth, used to bound messages attached to messages.
 */
export async function readMessage(message: PSTMessage, depth = 0): Promise<ExtractedMessage> {
  const warnings: string[] = []

  const rawHeaders = str(message.transportMessageHeaders).trim() || null
  const headers = indexHeaders(rawHeaders)

  // Bodies. HTML is preferred when both are present; the RTF property is the
  // last resort and often contains the original HTML.
  let text = str(message.body)
  let html = str(message.bodyHTML)

  if (html.length === 0 && text.length === 0) {
    let rtf = ''
    try {
      rtf = str(message.bodyRTF)
    } catch (err) {
      warnings.push(`Zengin metin gövdesi açılamadı: ${errorText(err)}`)
    }
    const recovered = rtf.length > 0 ? rtfToBody(rtf) : null
    if (recovered) {
      html = recovered.html
      text = recovered.text
    } else if (rtf.length > 0) {
      warnings.push('İleti gövdesi dönüştürülemeyen zengin metindi; aktarımda boş kaldı.')
    }
  }

  // Addresses. Header values are used when present because they hold real
  // internet addresses rather than Exchange directory names.
  const fromHeader = headers.get('from')
  const from = fromHeader
    ? (addressesFromHeader(fromHeader)[0] ?? null)
    : toAddress(
        str(message.sentRepresentingName) || str(message.senderName),
        str(message.sentRepresentingEmailAddress) || str(message.senderEmailAddress),
        str(message.sentRepresentingAddressType) || str(message.senderAddrtype),
      )

  const toHeader = headers.get('to')
  const ccHeader = headers.get('cc')
  const bccHeader = headers.get('bcc')

  const to = toHeader ? addressesFromHeader(toHeader) : recipientsOfType(message, RECIPIENT_TO, warnings)
  const cc = ccHeader ? addressesFromHeader(ccHeader) : recipientsOfType(message, RECIPIENT_CC, warnings)
  const bcc = bccHeader ? addressesFromHeader(bccHeader) : recipientsOfType(message, RECIPIENT_BCC, warnings)

  if (from && from.address.endsWith('@x500.invalid')) {
    warnings.push(
      `Gönderen, posta adresi olmayan bir Exchange dizin kaydı olarak saklanmış; yerine "${from.address}" yazıldı.`,
    )
  }

  // Dates. Sent time is what a reader expects to see; delivery time is the
  // fallback for messages this mailbox received.
  let date = message.clientSubmitTime ?? message.messageDeliveryTime ?? null
  if (!date) {
    const headerDate = headers.get('date')
    const parsed = headerDate ? new Date(headerDate) : null
    if (parsed && !Number.isNaN(parsed.getTime())) {
      date = parsed
    } else {
      warnings.push('İletinin tarihi yoktu; 0000-00-00 altında dosyalandı.')
    }
  }

  const messageId = str(message.internetMessageId).trim() || headers.get('message-id') || null
  const inReplyTo = str(message.inReplyToId).trim() || headers.get('in-reply-to') || null

  const attachments = await readAttachments(message, html, depth, warnings)

  return {
    subject: str(message.subject),
    from,
    to,
    cc,
    bcc,
    date,
    messageId,
    inReplyTo,
    text,
    html,
    rawHeaders,
    attachments,
    warnings,
  }
}
