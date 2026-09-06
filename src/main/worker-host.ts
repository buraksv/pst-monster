import { join } from 'node:path'
import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'

/**
 * Runs one long job at a time in its own process.
 *
 * Both jobs this app has, reading a PST and building a zip, are synchronous and
 * CPU-bound. Run on the main process either would freeze the window, so each
 * gets a worker, and this class owns its lifecycle: start it, forward what it
 * says, and make sure a crash is reported rather than leaving the window
 * waiting forever.
 */

/**
 * Resolves a worker script next to the built main process.
 *
 * Node cannot execute a file from inside an asar archive, so the packaged build
 * keeps the workers, and the modules they load, unpacked beside it.
 */
export function workerPath(fileName: string): string {
  // The separator differs by platform, so match either one.
  return join(__dirname, fileName).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

/** What every worker sends once it is listening for commands. */
interface ReadyMessage {
  type: 'ready'
}

export interface WorkerHostConfig<Start, Event> {
  /** File name of the built worker, e.g. `convert-worker.js`. */
  script: string
  /** Shown in the OS process list. */
  serviceName: string
  /** Builds the command sent once the worker reports it is ready. */
  startCommand(payload: Start): unknown
  /** True for the last event of a run, after which the worker is stopped. */
  isTerminal(event: Event): boolean
  /** Builds the event reported when the worker dies without finishing. */
  crashEvent(code: number): Event
  /** Rejected when start is called while a run is already going. */
  busyMessage: string
}

export class WorkerHost<Start, Event> {
  private child: UtilityProcess | null = null
  private finished = false

  constructor(private readonly config: WorkerHostConfig<Start, Event>) {}

  /** True while a job is running. */
  get busy(): boolean {
    return this.child !== null
  }

  /**
   * Starts a job.
   *
   * @param payload What the worker should do.
   * @param onEvent Receives every event, ending with a terminal one.
   */
  start(payload: Start, onEvent: (event: Event) => void): void {
    if (this.child) throw new Error(this.config.busyMessage)

    this.finished = false
    const child = utilityProcess.fork(workerPath(this.config.script), [], {
      serviceName: this.config.serviceName,
      stdio: 'ignore',
    })
    this.child = child

    const finish = (event: Event): void => {
      if (this.finished) return
      this.finished = true
      this.child = null
      onEvent(event)
      // A worker can be holding a whole PST index or a compression buffer; a
      // fresh process per run keeps that from accumulating.
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }

    child.on('message', (raw: unknown) => {
      const message = raw as ReadyMessage | Event
      if ((message as ReadyMessage).type === 'ready') {
        child.postMessage(this.config.startCommand(payload))
        return
      }
      const event = message as Event
      if (this.config.isTerminal(event)) {
        finish(event)
        return
      }
      if (!this.finished) onEvent(event)
    })

    child.on('exit', (code) => {
      finish(this.config.crashEvent(code))
    })
  }

  /** Asks the worker to stop at the next point it checks. */
  cancel(): void {
    if (this.child) this.child.postMessage({ type: 'cancel' })
  }

  /** Stops any running job, used when the app is quitting. */
  dispose(): void {
    const child = this.child
    this.child = null
    this.finished = true
    if (child) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
  }
}
