import { convert } from '../../core/converter.js'
import type { ConvertCommand, ConvertWorkerMessage } from '../../shared/protocol.js'

/**
 * Runs one conversion in its own process.
 *
 * Reading a PST is synchronous and CPU-bound: done on the main process it would
 * freeze the window for the whole run. Here it blocks nothing, and the user can
 * still cancel, because the cancel message is delivered between messages while
 * this process is between synchronous reads.
 */

const send = (message: ConvertWorkerMessage): void => {
  process.parentPort.postMessage(message)
}

const signal = { cancelled: false }
let running = false

process.parentPort.on('message', (event) => {
  const command = event.data as ConvertCommand

  if (command.type === 'cancel') {
    signal.cancelled = true
    return
  }

  if (command.type !== 'start') return
  if (running) return
  running = true

  void convert(command.options, send, signal)
    .then(({ summary, reportPath }) => {
      send({ type: 'done', summary, reportPath })
    })
    .catch((err: unknown) => {
      send({ type: 'failed', message: err instanceof Error ? err.message : String(err) })
    })
})

send({ type: 'ready' })
