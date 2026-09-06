/**
 * Prints the raw internet headers of the first message in a PST, byte for byte.
 * Kept as a debugging aid for header-parsing problems.
 *
 * Usage: npx tsx scripts/dump-headers.ts <file.pst> [messageIndex]
 */
import { PSTFile } from 'pst-extractor'
import type { PSTFolder, PSTMessage } from 'pst-extractor'

function firstFolderWithMail(folder: PSTFolder): PSTFolder | null {
  if (folder.contentCount > 0) return folder
  if (!folder.hasSubfolders) return null
  for (const child of folder.getSubFolders()) {
    const found = firstFolderWithMail(child)
    if (found) return found
  }
  return null
}

const [path, indexArg] = process.argv.slice(2)
if (!path) {
  console.error('Usage: npx tsx scripts/dump-headers.ts <file.pst> [messageIndex]')
  process.exit(1)
}

const pst = new PSTFile(path)
const folder = firstFolderWithMail(pst.getRootFolder())
if (!folder) {
  console.error('No folder with messages found.')
  process.exit(1)
}

const wanted = Number.parseInt(indexArg ?? '0', 10)
folder.moveChildCursorTo(0)
let message: PSTMessage | null = null
for (let i = 0; i <= wanted; i++) {
  message = folder.getNextChild() as PSTMessage | null
  if (!message) break
}

if (!message) {
  console.error('No message at that index.')
  process.exit(1)
}

const raw = String(message.transportMessageHeaders ?? '')
console.log('subject:', message.subject)
console.log('length:', raw.length)
console.log('--- first 900 bytes, escaped ---')
console.log(JSON.stringify(raw.slice(0, 900)))
