import { createZip } from '../../core/archive.js'
import type { ZipCommand, ZipWorkerMessage } from '../../shared/protocol.js'

/**
 * Builds one zip archive in its own process.
 *
 * Compression is CPU-bound and an export can be many gigabytes, so this keeps
 * the window responsive and lets the user cancel partway through.
 */

const send = (message: ZipWorkerMessage): void => {
  process.parentPort.postMessage(message)
}

const signal = { cancelled: false }
let running = false

process.parentPort.on('message', (event) => {
  const command = event.data as ZipCommand

  if (command.type === 'cancel') {
    signal.cancelled = true
    return
  }

  if (command.type !== 'start') return
  if (running) return
  running = true

  void createZip(command.options, send, signal)
    .then((summary) => {
      send({ type: 'zip-done', summary })
    })
    .catch((err: unknown) => {
      send({ type: 'zip-failed', message: err instanceof Error ? err.message : String(err) })
    })
})

send({ type: 'ready' })
