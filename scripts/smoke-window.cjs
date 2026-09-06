/**
 * Launches the built app and checks, over the DevTools protocol, that the window
 * actually rendered and that the bridge to the main process works.
 *
 * Unit tests cover the conversion core; this covers the wiring the user sees:
 * preload exposure, React mounting, and a real settings round trip over IPC.
 *
 * Usage: node scripts/smoke-window.cjs
 */
const { spawn } = require('node:child_process')
const http = require('node:http')

const PORT = 9333
const electron = require('electron')

// Extra switches for running unattended. Some Wayland compositors crash Chromium
// when it starts without a user session, so the test pins the X11 backend.
const extraFlags = process.platform === 'linux' ? ['--ozone-platform=x11', '--disable-gpu'] : []

const child = spawn(electron, ['--no-sandbox', ...extraFlags, `--remote-debugging-port=${PORT}`, '.'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_NO_ATTACH_CONSOLE: undefined },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

const getJson = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })

/** Waits for the debugging endpoint to come up. */
async function waitForTargets(deadline) {
  for (;;) {
    try {
      const targets = await getJson('/json/list')
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('the window never opened a debugging target')
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** Evaluates an expression in the page and returns its value. */
function evaluate(ws, id, expression) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.id !== id) return
      ws.off('message', onMessage)
      const details = message.result?.exceptionDetails
      if (details) {
        const description =
          details.exception?.description ?? details.exception?.value ?? details.text ?? 'unknown error'
        reject(new Error(`${description} -- while evaluating: ${expression}`))
        return
      }
      resolve(message.result?.result?.value)
    }
    ws.on('message', onMessage)
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })
}

async function main() {
  const page = await waitForTargets(Date.now() + 30_000)
  const { WebSocket } = require('ws')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  // Give React a moment to mount and the settings request to come back.
  await new Promise((r) => setTimeout(r, 1500))

  const api = await evaluate(ws, 1, 'Object.keys(window.api ?? {}).sort().join(",")')
  check(
    api ===
      'cancelConvert,cancelZip,getSettings,inspectOutputDir,onProgress,onZipProgress,openPath,pickOutputDir,' +
        'pickPst,pickZipPath,revealPath,setSettings,startConvert,startZip',
    `window.api is missing functions, got: ${api}`,
  )

  const heading = await evaluate(ws, 2, 'document.querySelector("h1")?.textContent ?? ""')
  check(heading === 'Dışa aktar', `export screen did not render, heading was: ${heading}`)

  const buttons = await evaluate(ws, 3, '[...document.querySelectorAll("button")].map(b=>b.textContent).join("|")')
  check(buttons.includes('Dönüştür'), `convert button missing, buttons were: ${buttons}`)
  check(buttons.includes('Ayarlar'), 'settings tab missing')

  // The convert button must stay disabled until both paths are chosen.
  const convertDisabled = await evaluate(
    ws,
    4,
    '[...document.querySelectorAll("button")].find(b=>b.textContent==="Dönüştür")?.disabled ?? null',
  )
  check(convertDisabled === true, 'convert button should be disabled with no file chosen')

  // A real IPC round trip: read settings, flip a value, read it back.
  const settings = await evaluate(ws, 5, '(async () => JSON.stringify(await window.api.getSettings()))()')
  check(typeof settings === 'string' && settings.includes('ignoreDuplicates'), `settings did not load: ${settings}`)
  const original = JSON.parse(settings).ignoreDuplicates

  const flipped = await evaluate(
    ws,
    6,
    `(async () => (await window.api.setSettings({ ignoreDuplicates: ${!original} })).ignoreDuplicates)()`,
  )
  check(flipped === !original, 'setting did not round trip through the main process')
  await evaluate(ws, 7, `window.api.setSettings({ ignoreDuplicates: ${original} })`)

  // Switching to the settings screen must show the option the user asked for.
  await evaluate(
    ws,
    8,
    '[...document.querySelectorAll("button")].find(b=>b.textContent==="Ayarlar")?.click()',
  )
  await new Promise((r) => setTimeout(r, 300))
  const toggleLabels = await evaluate(ws, 9, '[...document.querySelectorAll(".toggle-label")].map(e=>e.textContent).join("|")')
  check(
    toggleLabels.includes('Yinelenen iletileri atla'),
    `duplicate option missing from settings, found: ${toggleLabels}`,
  )

  ws.close()
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error('WINDOW SMOKE TEST FAILED')
      for (const failure of failures) console.error(' -', failure)
    } else {
      console.log('WINDOW SMOKE TEST PASSED')
    }
    child.kill()
    process.exit(failures.length > 0 ? 1 : 0)
  })
  .catch((err) => {
    console.error('WINDOW SMOKE TEST FAILED:', err.message)
    if (stderr) console.error(stderr.split('\n').slice(-15).join('\n'))
    child.kill()
    process.exit(1)
  })
