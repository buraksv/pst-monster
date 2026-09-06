/**
 * Builds the download table that goes at the top of a GitHub Release.
 *
 * The packages are named by electron-builder, so "macos-arm64" and "macos-x64"
 * are what a reader would otherwise have to decode for themselves. This turns
 * the file list into a table that says which file is for which machine, in the
 * order someone would look for them.
 *
 * Usage: node scripts/release-notes.mjs <dir> <version>
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Every package this project ships, most wanted first. `match` is tested
 * against the file name; the first rule that matches a file claims it.
 */
const ROWS = [
  { id: 'win-setup', match: /windows-setup\.exe$/i, os: 'Windows 10/11', note: 'Kurulum sihirbazı · Installer' },
  { id: 'win-portable', match: /windows-portable\.exe$/i, os: 'Windows 10/11', note: 'Kurulumsuz, çift tıkla · Portable' },
  { id: 'mac-arm', match: /macos-arm64\.dmg$/i, os: 'macOS · Apple Silicon', note: 'M1 ve sonrası · M1 and later' },
  { id: 'mac-intel', match: /macos-x64\.dmg$/i, os: 'macOS · Intel', note: '2020 ve öncesi · 2020 and earlier' },
  { id: 'mac-arm-zip', match: /macos-arm64\.zip$/i, os: 'macOS · Apple Silicon', note: '.zip olarak · as a zip' },
  { id: 'mac-intel-zip', match: /macos-x64\.zip$/i, os: 'macOS · Intel', note: '.zip olarak · as a zip' },
  { id: 'deb', match: /linux-amd64\.deb$/i, os: 'Ubuntu · Debian', note: 'Çift tıkla kurulur · Double-click to install' },
  { id: 'tgz', match: /linux-x64\.tar\.gz$/i, os: 'Diğer Linux · Other Linux', note: 'Çıkar ve çalıştır · Extract and run' },
  { id: 'appimage', match: /linux-x86_64\.AppImage$/i, os: 'Linux · AppImage', note: 'libfuse2 gerektirir · needs libfuse2' },
]

/**
 * @param {string[]} files  package file names, in any order
 * @param {string} version
 * @returns {string} markdown
 */
export function buildNotes(files, version) {
  const lines = [
    `## İndir · Download`,
    '',
    `İşletim sisteminize uygun dosyayı indirin. Kurulum, çalışma ortamı ve tüm bağımlılıklar`,
    `paketin içindedir; başka bir şey kurmanız gerekmez.`,
    '',
    `_Pick the file for your operating system. The runtime and every dependency ship inside the`,
    `package, so there is nothing else to install._`,
    '',
    '| İşletim sistemi · Operating system | Dosya · File | |',
    '| --- | --- | --- |',
  ]

  const claimed = new Set()
  for (const row of ROWS) {
    const file = files.find((name) => !claimed.has(name) && row.match.test(name))
    if (!file) continue
    claimed.add(file)
    lines.push(`| **${row.os}** | \`${file}\` | ${row.note} |`)
  }

  lines.push('')
  lines.push(
    'Paketler imzalanmamıştır, ilk açılışta işletim sistemi bir kez onay ister; nasıl geçileceği',
  )
  lines.push('[README](https://github.com/buraksv/pst-monster#i̇lk-açılışta-çıkan-uyarılar) içinde.')
  lines.push('')
  lines.push(
    '_The packages are unsigned, so each operating system asks once on first launch. The README explains how to get past it._',
  )

  if (files.includes('SHA256SUMS.txt')) {
    lines.push('')
    lines.push(
      `İndirdiğiniz dosyayı doğrulamak için \`SHA256SUMS.txt\`. · Verify a download against \`SHA256SUMS.txt\`.`,
    )
  }

  // Anything the table did not cover still deserves a mention, so a new target
  // added to electron-builder never disappears silently from the release.
  const rest = files.filter((name) => !claimed.has(name) && name !== 'SHA256SUMS.txt')
  if (rest.length > 0) {
    lines.push('')
    lines.push(`Diğer dosyalar · Other files: ${rest.map((n) => `\`${n}\``).join(', ')}`)
  }

  return lines.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, version] = process.argv.slice(2)
  if (!dir || !version) throw new Error('usage: release-notes.mjs <dir> <version>')
  const files = readdirSync(dir).sort()
  process.stdout.write(buildNotes(files, version) + '\n')
}
