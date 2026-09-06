/**
 * Boots Electron without showing a window and runs a real conversion, then a
 * real zip of its output, through the built worker processes.
 *
 * This exercises the part unit tests cannot reach: utilityProcess.fork on the
 * bundled workers and the message protocol. Run it after a build.
 *
 * Usage: npx electron scripts/smoke-worker.cjs [file.pst] [outDir]
 */
const { app, utilityProcess } = require('electron')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

// Electron keeps its own switches in argv and the script path moves with them,
// so take the arguments that follow this file rather than fixed positions.
const selfIndex = process.argv.findIndex((a) => a.endsWith('smoke-worker.cjs'))
const args = process.argv.slice(selfIndex + 1).filter((a) => !a.startsWith('-'))

const pstPath = args[0] ?? 'node_modules/pst-extractor/example/testdata/enron.pst'
const outputDir = args[1] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pst-monster-smoke-'))
// Point PST2EML_WORKER_DIR at a packaged build's unpacked out/main to check that
// the packaged workers can still resolve their dependencies.
const workerDir = process.env.PST2EML_WORKER_DIR ?? path.join(__dirname, '..', 'out', 'main')
const workerPath = path.join(workerDir, 'convert-worker.js')
const zipWorkerPath = path.join(workerDir, 'zip-worker.js')

let failed = false
const fail = (message) => {
  console.error('FAIL:', message)
  failed = true
}

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  if (!fs.existsSync(workerPath)) {
    fail(`worker not built at ${workerPath}; run npm run build first`)
    app.exit(1)
    return
  }

  const child = utilityProcess.fork(workerPath, [], { serviceName: 'smoke' })
  const seen = new Set()
  let progressEvents = 0
  const started = Date.now()

  const timeout = setTimeout(() => {
    fail('the worker did not finish within 60 seconds')
    child.kill()
    app.exit(1)
  }, 60_000)

  child.on('message', (message) => {
    seen.add(message.type)

    if (message.type === 'ready') {
      console.log('worker ready, starting conversion')
      child.postMessage({
        type: 'start',
        options: {
          pstPath,
          outputDir,
          ignoreDuplicates: false,
          skipNonMailItems: true,
          includeRootFolderName: false,
        },
      })
      return
    }

    if (message.type === 'scan-complete') console.log(`scan: ${message.total} messages`)
    if (message.type === 'progress') progressEvents++

    if (message.type === 'failed') {
      fail(`worker reported failure: ${message.message}`)
      clearTimeout(timeout)
      child.kill()
      app.exit(1)
      return
    }

    if (message.type === 'done') {
      clearTimeout(timeout)
      const s = message.summary
      console.log(
        `done in ${Date.now() - started}ms: written=${s.written} processed=${s.processed} ` +
          `failed=${s.failed} duplicates=${s.duplicates} skipped=${s.skipped}`,
      )

      if (!seen.has('ready')) fail('never received the ready handshake')
      if (!seen.has('scan-complete')) fail('never received a scan result')
      if (progressEvents === 0) fail('no progress events arrived')
      if (s.written === 0) fail('nothing was written')
      if (s.failed > 0) fail(`${s.failed} messages failed`)
      if (!fs.existsSync(message.reportPath)) fail('the run report was not written')

      const emlCount = countEml(outputDir)
      if (emlCount !== s.written) fail(`summary says ${s.written} files, found ${emlCount} on disk`)
      console.log(`verified ${emlCount} .eml files under ${outputDir}`)

      child.kill()
      runZip(emlCount)
    }
  })

  child.on('exit', (code) => {
    if (!seen.has('done')) {
      fail(`worker exited early with code ${code}`)
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})

/** Second phase: archive what the conversion just wrote. */
function runZip(expectedEml) {
  if (!fs.existsSync(zipWorkerPath)) {
    fail(`zip worker not built at ${zipWorkerPath}`)
    finish()
    return
  }

  const zipPath = path.join(outputDir, 'export.zip')
  const child = utilityProcess.fork(zipWorkerPath, [], { serviceName: 'smoke-zip' })
  const seen = new Set()
  let progressEvents = 0

  const timeout = setTimeout(() => {
    fail('the zip worker did not finish within 60 seconds')
    child.kill()
    finish()
  }, 60_000)

  child.on('message', (message) => {
    seen.add(message.type)

    if (message.type === 'ready') {
      console.log('zip worker ready, archiving')
      child.postMessage({ type: 'start', options: { sourceDir: outputDir, zipPath } })
      return
    }
    if (message.type === 'zip-scan') console.log(`zip scan: ${message.files} files, ${message.bytes} bytes`)
    if (message.type === 'zip-progress') progressEvents++

    if (message.type === 'zip-failed') {
      fail(`zip worker reported failure: ${message.message}`)
      clearTimeout(timeout)
      child.kill()
      finish()
      return
    }

    if (message.type === 'zip-done') {
      clearTimeout(timeout)
      const s = message.summary
      console.log(`zip done: files=${s.fileCount} in=${s.totalBytes} out=${s.zipBytes} in ${s.durationMs}ms`)

      if (progressEvents === 0) fail('no zip progress events arrived')
      if (s.cancelled) fail('the zip reported itself cancelled')
      // The report file rides along with the messages, and the archive leaves
      // itself out even though it is written inside the folder.
      if (s.fileCount !== expectedEml + 1) {
        fail(`expected ${expectedEml + 1} entries in the archive, got ${s.fileCount}`)
      }
      if (!fs.existsSync(zipPath)) fail('the archive was not written')
      else if (fs.statSync(zipPath).size !== s.zipBytes) fail('the archive size does not match the summary')

      child.kill()
      finish()
    }
  })

  child.on('exit', (code) => {
    if (!seen.has('zip-done')) {
      fail(`zip worker exited early with code ${code}`)
      clearTimeout(timeout)
      finish()
    }
  })
}

function finish() {
  console.log(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED')
  app.exit(failed ? 1 : 0)
}

function countEml(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += countEml(full)
    else if (entry.name.endsWith('.eml')) total++
  }
  return total
}
