import type { ConvertOptions, ProgressEvent, ZipOptions, ZipProgressEvent } from '../core/types.js'
import { WorkerHost } from './worker-host.js'

/**
 * The two background jobs the app runs, each in its own process.
 *
 * They are independent: a zip of an earlier export can be built while nothing
 * else is happening, and neither blocks the window.
 */

export const conversionHost = new WorkerHost<ConvertOptions, ProgressEvent>({
  script: 'convert-worker.js',
  serviceName: 'pst-conversion',
  startCommand: (options) => ({ type: 'start', options }),
  isTerminal: (event) => event.type === 'done' || event.type === 'failed',
  crashEvent: (code) => ({
    type: 'failed',
    message:
      code === 0
        ? 'Dönüştürme tamamlanmadan durdu.'
        : `Dönüştürme işlemi beklenmedik şekilde sonlandı (çıkış kodu ${code}). ` +
          'Çok büyük bir dosyada bellek yetmediğinde bu olabilir.',
  }),
  busyMessage: 'Zaten bir dönüştürme çalışıyor.',
})

export const archiveHost = new WorkerHost<ZipOptions, ZipProgressEvent>({
  script: 'zip-worker.js',
  serviceName: 'pst-archive',
  startCommand: (options) => ({ type: 'start', options }),
  isTerminal: (event) => event.type === 'zip-done' || event.type === 'zip-failed',
  crashEvent: (code) => ({
    type: 'zip-failed',
    message:
      code === 0
        ? 'Arşivleme tamamlanmadan durdu.'
        : `Arşivleme işlemi beklenmedik şekilde sonlandı (çıkış kodu ${code}).`,
  }),
  busyMessage: 'Zaten bir arşivleme çalışıyor.',
})

/** True while either job is running, so the window can confirm before closing. */
export function anyJobRunning(): boolean {
  return conversionHost.busy || archiveHost.busy
}

/** Stops both jobs when the app is shutting down. */
export function disposeHosts(): void {
  conversionHost.dispose()
  archiveHost.dispose()
}
