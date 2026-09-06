/**
 * The release body, and the check for whether a release is complete.
 *
 * A release is filled in one operating system at a time: each build pipeline
 * uploads its own packages to the release for the version in package.json. So
 * the notes are rebuilt from whatever the release holds at that moment, and the
 * release stays a draft until all three systems are represented.
 *
 * Usage, with the asset names on stdin, one per line:
 *   node scripts/release-notes.mjs notes <version>   writes the body
 *   node scripts/release-notes.mjs complete          exit 0 if nothing is missing
 */
import { fileURLToPath } from 'node:url'

/**
 * Every package this project ships, most wanted first. `match` is tested against
 * the file name; the first rule that matches a file claims it.
 */
const ROWS = [
  { match: /windows-setup\.exe$/i, platform: 'windows', os: 'Windows 10/11', note: 'Kurulum sihirbazı · Installer' },
  { match: /windows-portable\.exe$/i, platform: 'windows', os: 'Windows 10/11', note: 'Kurulumsuz, çift tıkla · Portable' },
  { match: /macos-arm64\.dmg$/i, platform: 'macos', os: 'macOS · Apple Silicon', note: 'M1 ve sonrası · M1 and later' },
  { match: /macos-x64\.dmg$/i, platform: 'macos', os: 'macOS · Intel', note: '2020 ve öncesi · 2020 and earlier' },
  { match: /macos-arm64\.zip$/i, platform: 'macos', os: 'macOS · Apple Silicon', note: '.zip olarak · as a zip' },
  { match: /macos-x64\.zip$/i, platform: 'macos', os: 'macOS · Intel', note: '.zip olarak · as a zip' },
  { match: /linux-amd64\.deb$/i, platform: 'linux', os: 'Ubuntu · Debian', note: 'Çift tıkla kurulur · Double-click to install' },
  { match: /linux-x64\.tar\.gz$/i, platform: 'linux', os: 'Diğer Linux · Other Linux', note: 'Çıkar ve çalıştır · Extract and run' },
  { match: /linux-x86_64\.AppImage$/i, platform: 'linux', os: 'Linux · AppImage', note: 'libfuse2 gerektirir · needs libfuse2' },
]

/** The three operating systems a finished release has to cover. */
export const PLATFORMS = ['windows', 'macos', 'linux']

const LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }

/**
 * Which operating systems have no package in the given file list.
 *
 * @param {Iterable<string>} files
 * @returns {string[]} platform ids, empty when the release is complete
 */
export function missingPlatforms(files) {
  const list = [...files]
  return PLATFORMS.filter(
    (platform) =>
      !ROWS.some((row) => row.platform === platform && list.some((name) => row.match.test(name))),
  )
}

/**
 * @param {Iterable<string>} files  asset names, in any order
 * @param {string} version
 * @returns {string} markdown for the release body
 */
export function buildNotes(files, version) {
  const list = [...files]
  const lines = [
    '## İndir · Download',
    '',
    'İşletim sisteminize uygun dosyayı indirin. Çalışma ortamı ve tüm bağımlılıklar paketin',
    'içindedir; başka bir şey kurmanız gerekmez.',
    '',
    '_Pick the file for your operating system. The runtime and every dependency ship inside the',
    'package, so there is nothing else to install._',
    '',
    '| İşletim sistemi · Operating system | Dosya · File | |',
    '| --- | --- | --- |',
  ]

  const claimed = new Set()
  for (const row of ROWS) {
    const file = list.find((name) => !claimed.has(name) && row.match.test(name))
    if (!file) continue
    claimed.add(file)
    lines.push(`| **${row.os}** | \`${file}\` | ${row.note} |`)
  }

  const missing = missingPlatforms(list)
  if (missing.length > 0) {
    lines.push('')
    lines.push(
      `> Bu sürümün ${missing.map((p) => LABELS[p]).join(', ')} paketleri henüz üretilmedi.` +
        ` · The ${missing.map((p) => LABELS[p]).join(', ')} packages for this version are not built yet.`,
    )
  }

  lines.push('')
  lines.push('Paketler imzalanmamıştır, ilk açılışta işletim sistemi bir kez onay ister.')
  lines.push(
    '_The packages are unsigned, so each operating system asks once on first launch. The README explains how to get past it._',
  )

  if (list.includes('SHA256SUMS.txt')) {
    lines.push('')
    lines.push(
      'İndirdiğiniz dosyayı doğrulamak için `SHA256SUMS.txt`. · Verify a download against `SHA256SUMS.txt`.',
    )
  }

  // Anything the table did not cover still deserves a mention, so a new target
  // added to electron-builder never disappears silently from the release.
  const rest = list.filter((name) => !claimed.has(name) && name !== 'SHA256SUMS.txt')
  if (rest.length > 0) {
    lines.push('')
    lines.push(`Diğer dosyalar · Other files: ${rest.map((n) => `\`${n}\``).join(', ')}`)
  }

  return lines.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, version] = process.argv.slice(2)
  const stdin = await new Promise((done) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => done(text))
  })
  const files = stdin
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (command === 'notes') {
    if (!version) throw new Error('usage: release-notes.mjs notes <version>  (names on stdin)')
    process.stdout.write(buildNotes(files, version) + '\n')
  } else if (command === 'complete') {
    const missing = missingPlatforms(files)
    if (missing.length > 0) {
      process.stdout.write(`missing: ${missing.join(' ')}\n`)
      process.exit(1)
    }
    process.stdout.write('complete\n')
  } else {
    throw new Error(`unknown command: ${command}`)
  }
}
