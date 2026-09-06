/**
 * Drives the built app through a real conversion and saves screenshots of it.
 *
 * The pictures in the README come from here rather than from a mockup, so they
 * always show what the app actually does. Re-run after changing the interface.
 *
 * Usage: node scripts/capture-screens.cjs [outDir]
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const PORT = 9444
const electron = require('electron')

const outDir = process.argv[2] ?? path.join(__dirname, '..', 'docs')
const samplePst = path.resolve('node_modules/pst-extractor/example/testdata/enron.pst')
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pst-monster-shots-'))

// Some Wayland compositors crash Chromium when it starts without a user session.
const extraFlags = process.platform === 'linux' ? ['--ozone-platform=x11', '--disable-gpu'] : []

const child = spawn(electron, ['--no-sandbox', ...extraFlags, `--remote-debugging-port=${PORT}`, '.'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_NO_ATTACH_CONSOLE: undefined },
  stdio: ['ignore', 'ignore', 'pipe'],
})

const getJson = (urlPath) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
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

async function waitForPage(deadline) {
  for (;;) {
    try {
      const targets = await getJson('/json/list')
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('the window never opened a debugging target')
    await sleep(250)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let nextId = 1
function send(ws, method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.id !== id) return
      ws.off('message', onMessage)
      const details = message.result?.exceptionDetails
      if (details) {
        reject(new Error(details.exception?.description ?? details.text ?? 'evaluation failed'))
        return
      }
      resolve(message.result)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const evaluate = (ws, expression) =>
  send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then(
    (result) => result?.result?.value,
  )

/**
 * Resizes the viewport so a whole screen fits in one picture, at 2x for a
 * readable image on a high-density display.
 */
async function setViewport(ws, width, height) {
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await sleep(300)
}

/**
 * Sizes the viewport to the content, so a screenshot has no dead space under
 * the last card.
 */
async function fitToContent(ws, width) {
  const height = await evaluate(
    ws,
    'Math.ceil(document.querySelector(".page").getBoundingClientRect().height) + 76',
  )
  await setViewport(ws, width, Math.min(Math.max(height, 420), 2000))
}

async function shoot(ws, name) {
  const result = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, name)
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
  console.log('saved', path.relative(process.cwd(), file))
}

async function main() {
  const page = await waitForPage(Date.now() + 30_000)
  const { WebSocket } = require('ws')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  await send(ws, 'Page.enable', {})
  await sleep(1200)

  // Remember what the settings were, so this script does not leave the paths it
  // made up behind in the real application settings.
  savedSettings = JSON.parse(await evaluate(ws, '(async () => JSON.stringify(await window.api.getSettings()))()'))
  restoreWith = ws

  // Fill the two fields the way the picker would, then reload so the export
  // screen starts from them.
  await evaluate(
    ws,
    `window.api.setSettings(${JSON.stringify({ lastPstPath: samplePst, lastOutputDir: exportDir })})`,
  )
  await send(ws, 'Page.reload', {})
  await sleep(1800)
  await setViewport(ws, 1000, 700)
  await fitToContent(ws, 1000)
  await shoot(ws, 'screenshot-export.png')

  // Run a real conversion so the summary and the archive panel show real numbers.
  await evaluate(ws, '[...document.querySelectorAll("button")].find(b=>b.textContent==="Dönüştür")?.click()')

  const deadline = Date.now() + 90_000
  for (;;) {
    const written = await evaluate(
      ws,
      '[...document.querySelectorAll(".summary dd")].map(e=>e.textContent).join(",")',
    )
    if (written && written.length > 0) break
    if (Date.now() > deadline) throw new Error('the conversion did not finish in time')
    await sleep(500)
  }
  // Let the log settle, then take a viewport tall enough for the whole screen.
  await sleep(800)
  await setViewport(ws, 1000, 1400)
  await evaluate(ws, 'document.querySelector(".content").scrollTop = 0')
  await sleep(400)
  await fitToContent(ws, 1000)
  await shoot(ws, 'screenshot-result.png')

  await evaluate(ws, '[...document.querySelectorAll("button")].find(b=>b.textContent==="Ayarlar")?.click()')
  await sleep(600)
  await setViewport(ws, 1000, 1200)
  await evaluate(ws, 'document.querySelector(".content").scrollTop = 0')
  await sleep(300)
  await fitToContent(ws, 1000)
  await shoot(ws, 'screenshot-settings.png')

  await restoreSettings()
  ws.close()
}

let savedSettings = null
let restoreWith = null

/** Puts back the settings this script overwrote. */
async function restoreSettings() {
  if (!savedSettings || !restoreWith) return
  const { lastPstPath, lastOutputDir, ...rest } = savedSettings
  await evaluate(
    restoreWith,
    `window.api.setSettings(${JSON.stringify({ ...rest, lastPstPath, lastOutputDir })})`,
  )
  savedSettings = null
}

main()
  .then(async () => {
    child.kill()
    fs.rmSync(exportDir, { recursive: true, force: true })
    console.log('done')
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('capture failed:', err.message)
    await restoreSettings().catch(() => {})
    child.kill()
    fs.rmSync(exportDir, { recursive: true, force: true })
    process.exit(1)
  })
