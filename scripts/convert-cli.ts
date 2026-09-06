/**
 * Runs a conversion from the terminal against the same core the app uses.
 *
 * Useful for trying a real PST without launching Electron, and for checking that
 * a change to the core still produces the same tree.
 *
 * Usage: npm run cli -- <file.pst> <output-dir> [--ignore-duplicates] [--keep-all-items] [--keep-root]
 */
import { convert } from '../src/core/converter.js'
import { DEFAULT_OPTIONS } from '../src/core/types.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const positional = args.filter((a) => !a.startsWith('--'))
  const flags = new Set(args.filter((a) => a.startsWith('--')))

  const [pstPath, outputDir] = positional
  if (!pstPath || !outputDir) {
    console.error(
      'Usage: npm run cli -- <file.pst> <output-dir> [--ignore-duplicates] [--keep-all-items] [--keep-root]',
    )
    process.exitCode = 1
    return
  }

  const options = {
    ...DEFAULT_OPTIONS,
    pstPath,
    outputDir,
    ignoreDuplicates: flags.has('--ignore-duplicates'),
    skipNonMailItems: !flags.has('--keep-all-items'),
    includeRootFolderName: flags.has('--keep-root'),
  }

  const signal = { cancelled: false }
  process.on('SIGINT', () => {
    console.log('\nStopping after the current message...')
    signal.cancelled = true
  })

  let lastLine = 0
  const { summary, reportPath } = await convert(
    options,
    (event) => {
      if (event.type === 'scan-complete') {
        console.log(`Found ${event.total} message(s).`)
      } else if (event.type === 'log' && event.level !== 'info') {
        console.log(`  ${event.level}: ${event.message}`)
      } else if (event.type === 'progress') {
        const now = Date.now()
        if (now - lastLine < 500) return
        lastLine = now
        const percent = event.total > 0 ? Math.round((event.processed / event.total) * 100) : 0
        process.stdout.write(`\r${percent}%  ${event.processed}/${event.total}  ${event.folder}`.padEnd(90))
      }
    },
    signal,
  )

  process.stdout.write('\r'.padEnd(92) + '\r')
  console.log(
    [
      `${summary.cancelled ? 'Cancelled' : 'Done'} in ${(summary.durationMs / 1000).toFixed(1)}s`,
      `processed:  ${summary.processed}`,
      `written:    ${summary.written}`,
      `duplicates: ${summary.duplicates}`,
      `skipped:    ${summary.skipped}`,
      `failed:     ${summary.failed}`,
      `warnings:   ${summary.warnings.length}`,
      `report:     ${reportPath}`,
    ].join('\n  '),
  )
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
