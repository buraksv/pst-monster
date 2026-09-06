/**
 * Sanity-checks an exported .eml: parses the MIME tree, writes each attachment
 * to a temp directory and reports its real type via the file signature.
 *
 * Usage: node scripts/verify-eml.cjs <file.eml> [outDir]
 */
const fs = require('node:fs')
const path = require('node:path')

const [, , emlPath, outDir] = process.argv
if (!emlPath) {
  console.error('Usage: node scripts/verify-eml.cjs <file.eml> [outDir]')
  process.exit(1)
}

const raw = fs.readFileSync(emlPath)
const text = raw.toString('binary')

const headerEnd = text.indexOf('\r\n\r\n')
const headers = text.slice(0, headerEnd)
const boundaryMatch = /boundary="([^"]+)"/.exec(headers)
if (!boundaryMatch) {
  console.log('no multipart boundary; single-part message')
  process.exit(0)
}

function partsOf(body, boundary) {
  return body.split('--' + boundary).slice(1, -1)
}

const parts = partsOf(text.slice(headerEnd + 4), boundaryMatch[1])
console.log('top-level parts:', parts.length)

let n = 0
for (const part of parts) {
  const end = part.indexOf('\r\n\r\n')
  const partHeaders = part.slice(0, end)
  const body = part.slice(end + 4)
  const type = /Content-Type:\s*([^;\r\n]+)/i.exec(partHeaders)?.[1] ?? '?'
  const filename = /filename=([^\r\n;]+)/i.exec(partHeaders)?.[1]
  const encoding = /Content-Transfer-Encoding:\s*(\S+)/i.exec(partHeaders)?.[1] ?? '7bit'

  if (!filename) {
    console.log(`part ${++n}: ${type} (${encoding}) ${body.trim().length} chars`)
    continue
  }

  const bytes = encoding.toLowerCase() === 'base64' ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary')
  const magic = bytes.subarray(0, 4).toString('hex')
  let sniffed = 'unknown'
  if (magic.startsWith('ffd8ff')) sniffed = 'jpeg'
  else if (magic.startsWith('89504e47')) sniffed = 'png'
  else if (magic.startsWith('25504446')) sniffed = 'pdf'
  else if (magic.startsWith('504b0304')) sniffed = 'zip/office'
  else if (magic.startsWith('d0cf11e0')) sniffed = 'ole/doc'

  console.log(`part ${++n}: ${type} name=${filename} bytes=${bytes.length} magic=${magic} looks-like=${sniffed}`)

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, path.basename(filename)), bytes)
  }
}
