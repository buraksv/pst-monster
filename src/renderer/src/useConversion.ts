import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConvertSummary } from '../../core/types.js'

/**
 * Holds the state of a conversion run.
 *
 * It lives above the screens so a run keeps going, and keeps reporting, while
 * the user is looking at the settings tab.
 */

export type RunStatus = 'idle' | 'running' | 'done' | 'failed'

export interface LogLine {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
}

/** Enough history to see what happened, small enough to render cheaply. */
const MAX_LOG_LINES = 300

export interface Conversion {
  status: RunStatus
  /** Messages the scan expected. Folder counters can overstate this. */
  scanned: number
  processed: number
  written: number
  /** Folder currently being read, for the status line. */
  folder: string
  log: LogLine[]
  summary: ConvertSummary | null
  reportPath: string
  error: string
  start(pstPath: string, outputDir: string): Promise<void>
  cancel(): void
  reset(): void
}

export function useConversion(): Conversion {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [scanned, setScanned] = useState(0)
  const [processed, setProcessed] = useState(0)
  const [written, setWritten] = useState(0)
  const [folder, setFolder] = useState('')
  const [log, setLog] = useState<LogLine[]>([])
  const [summary, setSummary] = useState<ConvertSummary | null>(null)
  const [reportPath, setReportPath] = useState('')
  const [error, setError] = useState('')

  const nextLogId = useRef(0)

  const appendLog = useCallback((level: LogLine['level'], message: string) => {
    setLog((lines) => {
      const next = [...lines, { id: nextLogId.current++, level, message }]
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
    })
  }, [])

  useEffect(() => {
    return window.api.onProgress((event) => {
      switch (event.type) {
        case 'scan-complete':
          setScanned(event.total)
          appendLog('info', `${event.total} ileti bulundu.`)
          break
        case 'progress':
          setProcessed(event.processed)
          setWritten(event.written)
          setFolder(event.folder)
          break
        case 'log':
          appendLog(event.level, event.message)
          break
        case 'done':
          setSummary(event.summary)
          setReportPath(event.reportPath)
          setProcessed(event.summary.processed)
          setWritten(event.summary.written)
          setStatus('done')
          appendLog(
            'info',
            event.summary.cancelled
              ? 'Dönüştürme durduruldu.'
              : `Dönüştürme tamamlandı: ${event.summary.written} dosya yazıldı.`,
          )
          break
        case 'failed':
          setError(event.message)
          setStatus('failed')
          appendLog('error', event.message)
          break
      }
    })
  }, [appendLog])

  const reset = useCallback(() => {
    setStatus('idle')
    setScanned(0)
    setProcessed(0)
    setWritten(0)
    setFolder('')
    setLog([])
    setSummary(null)
    setReportPath('')
    setError('')
  }, [])

  const start = useCallback(
    async (pstPath: string, outputDir: string) => {
      reset()
      setStatus('running')
      const result = await window.api.startConvert({ pstPath, outputDir })
      if (!result.started) {
        setError(result.message ?? 'Dönüştürme başlatılamadı.')
        setStatus('failed')
      }
    },
    [reset],
  )

  const cancel = useCallback(() => {
    void window.api.cancelConvert()
    appendLog('warn', 'Durduruluyor, işlenmekte olan ileti bitince duracak...')
  }, [appendLog])

  return {
    status,
    scanned,
    processed,
    written,
    folder,
    log,
    summary,
    reportPath,
    error,
    start,
    cancel,
    reset,
  }
}
