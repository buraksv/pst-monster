import { useCallback, useEffect, useState } from 'react'
import type { ZipSummary } from '../../core/types.js'

/**
 * Holds the state of building a .zip from an export folder.
 *
 * Separate from the conversion state: archiving is something the user asks for
 * afterwards, on a folder that already exists.
 */

export type ArchiveStatus = 'idle' | 'running' | 'done' | 'failed'

export interface Archive {
  status: ArchiveStatus
  /** Files the scan found, so the progress bar has a total. */
  total: number
  processed: number
  processedBytes: number
  totalBytes: number
  summary: ZipSummary | null
  error: string
  /** Archives a folder into the file the user picks. Does nothing if dismissed. */
  start(sourceDir: string, suggestedName: string): Promise<void>
  cancel(): void
  reset(): void
}

export function useArchive(): Archive {
  const [status, setStatus] = useState<ArchiveStatus>('idle')
  const [total, setTotal] = useState(0)
  const [processed, setProcessed] = useState(0)
  const [processedBytes, setProcessedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [summary, setSummary] = useState<ZipSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    return window.api.onZipProgress((event) => {
      switch (event.type) {
        case 'zip-scan':
          setTotal(event.files)
          setTotalBytes(event.bytes)
          break
        case 'zip-progress':
          setProcessed(event.processed)
          setTotal(event.total)
          setProcessedBytes(event.processedBytes)
          setTotalBytes(event.totalBytes)
          break
        case 'zip-done':
          setSummary(event.summary)
          setStatus('done')
          break
        case 'zip-failed':
          setError(event.message)
          setStatus('failed')
          break
      }
    })
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setTotal(0)
    setProcessed(0)
    setProcessedBytes(0)
    setTotalBytes(0)
    setSummary(null)
    setError('')
  }, [])

  const start = useCallback(
    async (sourceDir: string, suggestedName: string) => {
      const zipPath = await window.api.pickZipPath(suggestedName, sourceDir)
      // The user dismissed the save dialog; leave any previous result on screen.
      if (!zipPath) return

      reset()
      setStatus('running')
      const result = await window.api.startZip({ sourceDir, zipPath })
      if (!result.started) {
        setError(result.message ?? 'Arşivleme başlatılamadı.')
        setStatus('failed')
      }
    },
    [reset],
  )

  const cancel = useCallback(() => {
    void window.api.cancelZip()
  }, [])

  return {
    status,
    total,
    processed,
    processedBytes,
    totalBytes,
    summary,
    error,
    start,
    cancel,
    reset,
  }
}
