import iconv from 'iconv-lite'

/**
 * A minimal RTF-to-text reader for bodies that are genuinely rich text rather
 * than HTML wrapped in RTF.
 *
 * The de-encapsulating parser in `rtf.ts` handles the common case, where Outlook
 * stored the original HTML inside the RTF. It refuses anything else, which
 * leaves messages composed in Outlook's Rich Text format with no body at all.
 * This recovers their text: formatting is dropped, characters are not.
 */

/** Groups that hold document metadata rather than body text. */
const IGNORED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'rsidtable',
  'generator',
  'info',
  'pict',
  'object',
  'objdata',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'filetbl',
  'revtbl',
  'header',
  'footer',
  'footnote',
])

/** Control words that stand for literal characters. */
const LITERALS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n\n',
  page: '\n\n',
  tab: '\t',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  nbsp: ' ',
  emspace: ' ',
  enspace: ' ',
}

function codePageFor(rtf: string): string {
  const match = /\\ansicpg([0-9]+)/.exec(rtf)
  if (match) {
    const name = `cp${match[1]}`
    if (iconv.encodingExists(name)) return name
  }
  return 'cp1252'
}

/**
 * Extracts the readable text from an RTF document.
 *
 * @param rtf RTF source as decompressed from the PST.
 * @returns Plain text, or an empty string when nothing readable was found.
 */
export function rtfToPlainText(rtf: string): string {
  const source = String(rtf ?? '')
  if (source.trim().length === 0) return ''

  const encoding = codePageFor(source)
  const out: string[] = []
  /** Bytes pending decode, so a multi-byte character survives being split. */
  let pending: number[] = []
  /** Group depth at which output is suppressed, or null when emitting. */
  let skipDepth: number | null = null
  let depth = 0
  /** Characters to swallow after a Unicode escape supplied its fallback. */
  let skipChars = 0

  const flush = (): void => {
    if (pending.length === 0) return
    out.push(iconv.decode(Buffer.from(pending), encoding))
    pending = []
  }

  const emit = (text: string): void => {
    flush()
    out.push(text)
  }

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]

    if (ch === '{') {
      depth++
      continue
    }

    if (ch === '}') {
      flush()
      if (skipDepth !== null && depth <= skipDepth) skipDepth = null
      depth--
      continue
    }

    if (ch !== '\\') {
      if (ch === '\r' || ch === '\n') continue
      if (skipDepth !== null) continue
      if (skipChars > 0) {
        skipChars--
        continue
      }
      // Buffer the raw byte: characters above ASCII arrive as single bytes in
      // the document's code page and must be decoded as a run, not one by one.
      pending.push(source.charCodeAt(i) & 0xff)
      continue
    }

    // From here on we are looking at an escape or a control word.
    const next = source[i + 1]
    if (next === undefined) break

    if (next === '\\' || next === '{' || next === '}') {
      if (skipDepth === null) pending.push(next.charCodeAt(0))
      i++
      continue
    }

    if (next === "'") {
      // A hex-escaped byte in the document code page.
      const hex = source.slice(i + 2, i + 4)
      const value = Number.parseInt(hex, 16)
      i += 3
      if (Number.isNaN(value)) continue
      if (skipDepth !== null) continue
      if (skipChars > 0) {
        skipChars--
        continue
      }
      pending.push(value)
      continue
    }

    if (next === '*') {
      // `\*\destination` marks a group readers may ignore wholesale.
      if (skipDepth === null) skipDepth = depth
      i++
      continue
    }

    const word = /^\\([a-zA-Z]+)(-?[0-9]+)?[ ]?/.exec(source.slice(i))
    if (!word) {
      i++
      continue
    }

    const name = word[1]
    const param = word[2]
    i += word[0].length - 1

    if (name === 'u' && param !== undefined) {
      // A Unicode character, followed by a fallback the reader must skip.
      if (skipDepth === null) {
        flush()
        let code = Number.parseInt(param, 10)
        if (code < 0) code += 65536
        out.push(String.fromCharCode(code))
        skipChars = 1
      }
      continue
    }

    if (IGNORED_DESTINATIONS.has(name)) {
      if (skipDepth === null) skipDepth = depth
      continue
    }

    if (skipDepth !== null) continue

    const literal = LITERALS[name]
    if (literal !== undefined) emit(literal)
    // Every other control word is formatting, which this reader drops.
  }

  flush()

  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
