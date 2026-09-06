/**
 * The format-neutral shape a PST message is read into before it is written out
 * as .eml. Keeping this separate from both pst-extractor and nodemailer means
 * the reader and the writer can be tested independently.
 */

export interface MailAddress {
  name: string
  address: string
}

export interface ExtractedAttachment {
  filename: string
  /** MIME type from the PST, or one guessed from the extension. */
  contentType: string
  /** Set when the HTML body references this part with a `cid:` URL. */
  contentId: string | null
  /** Render inside the message body rather than as a separate file. */
  inline: boolean
  content: Buffer
}

export interface ExtractedMessage {
  subject: string
  from: MailAddress | null
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  /** Sent time, falling back to delivery time. */
  date: Date | null
  messageId: string | null
  inReplyTo: string | null
  /** Plain-text body, empty when the message only had HTML. */
  text: string
  /** HTML body, empty when the message was plain text only. */
  html: string
  /** The original internet headers, when the PST kept them. */
  rawHeaders: string | null
  attachments: ExtractedAttachment[]
  /** Non-fatal notes collected while reading, surfaced in the run report. */
  warnings: string[]
}

/** MAPI recipient types. */
export const RECIPIENT_TO = 1
export const RECIPIENT_CC = 2
export const RECIPIENT_BCC = 3
