import { useCallback, useEffect, useRef, useState } from 'react'
import type { OutputDirInfo } from '../../../shared/channels.js'
import type { AppSettings } from '../../../shared/settings.js'
import { suggestZipName } from '../../../shared/zip-name.js'
import type { Archive } from '../useArchive.js'
import type { Conversion } from '../useConversion.js'

interface Props {
  settings: AppSettings
  conversion: Conversion
  archive: Archive
  onPatchSettings(patch: Partial<AppSettings>): Promise<void>
}

/** Formats a byte count for a progress line, e.g. "1,4 GB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} ${units[unit]}`
}

/** Formats a duration the way someone watching a progress bar reads it. */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} saniye`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} dakika` : `${minutes} dk ${rest} sn`
}

export function ExportPage({
  settings,
  conversion,
  archive,
  onPatchSettings,
}: Props): React.JSX.Element {
  const [pstPath, setPstPath] = useState(settings.lastPstPath)
  const [outputDir, setOutputDir] = useState(settings.lastOutputDir)
  const [outputInfo, setOutputInfo] = useState<OutputDirInfo | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const running = conversion.status === 'running'
  const archiving = archive.status === 'running'
  const ready = pstPath.length > 0 && outputDir.length > 0 && !running && !archiving

  // Archiving is offered once an export exists on disk to archive.
  const exported = conversion.summary !== null && conversion.summary.written > 0

  // Warn before mixing a new export into a folder that already has content.
  useEffect(() => {
    if (outputDir.length === 0) {
      setOutputInfo(null)
      return
    }
    let current = true
    void window.api.inspectOutputDir(outputDir).then((info) => {
      if (current) setOutputInfo(info)
    })
    return () => {
      current = false
    }
  }, [outputDir])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [conversion.log])

  const choosePst = useCallback(async () => {
    const picked = await window.api.pickPst()
    if (picked) {
      setPstPath(picked)
      void onPatchSettings({ lastPstPath: picked })
    }
  }, [onPatchSettings])

  const chooseOutputDir = useCallback(async () => {
    const picked = await window.api.pickOutputDir()
    if (picked) {
      setOutputDir(picked)
      void onPatchSettings({ lastOutputDir: picked })
    }
  }, [onPatchSettings])

  const percent =
    conversion.scanned > 0 ? Math.min(99, Math.round((conversion.processed / conversion.scanned) * 100)) : 0
  const displayPercent = conversion.status === 'done' ? 100 : percent

  // Bytes track compression progress far better than file counts, because one
  // large attachment can take longer than a thousand small messages.
  const zipPercent =
    archive.totalBytes > 0 ? Math.min(100, Math.round((archive.processedBytes / archive.totalBytes) * 100)) : 0

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dışa aktar</h1>
        <p>
          Outlook veri dosyasındaki iletiler, dosyadaki klasör yapısının aynısı korunarak .eml dosyaları olarak
          yazılır.
        </p>
      </header>

      <section className="card">
        <div className="field">
          <label htmlFor="pst-path">PST dosyası</label>
          <div className="field-row">
            <input
              id="pst-path"
              type="text"
              value={pstPath}
              placeholder="Henüz dosya seçilmedi"
              readOnly
              disabled={running}
              onClick={() => {
                if (!running) void choosePst()
              }}
            />
            <button type="button" className="secondary" onClick={choosePst} disabled={running}>
              Seç
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="output-dir">Hedef klasör</label>
          <div className="field-row">
            <input
              id="output-dir"
              type="text"
              value={outputDir}
              placeholder="Henüz klasör seçilmedi"
              readOnly
              disabled={running}
              onClick={() => {
                if (!running) void chooseOutputDir()
              }}
            />
            <button type="button" className="secondary" onClick={chooseOutputDir} disabled={running}>
              Seç
            </button>
          </div>
          {outputInfo && !outputInfo.writable && outputDir.length > 0 ? (
            <p className="hint error">Bu klasöre yazılamıyor. Başka bir klasör seçin.</p>
          ) : outputInfo && outputInfo.entryCount > 0 ? (
            <p className="hint warn">
              Klasör boş değil ({outputInfo.entryCount} öğe). Mevcut dosyalar silinmez; aynı adlı dosyalar için
              sona numara eklenir.
            </p>
          ) : null}
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              // A new export invalidates the previous archive result; leaving it
              // on screen would describe a zip of files that no longer match.
              archive.reset()
              void conversion.start(pstPath, outputDir)
            }}
            disabled={!ready}
          >
            Dönüştür
          </button>
          <button type="button" className="secondary" onClick={conversion.cancel} disabled={!running}>
            İptal
          </button>
          {settings.ignoreDuplicates ? (
            <span className="chip">Yinelenen iletiler atlanıyor</span>
          ) : null}
        </div>
      </section>

      {conversion.status !== 'idle' ? (
        <section className="card">
          <div className="progress-head">
            <strong>
              {conversion.status === 'running'
                ? 'Dönüştürülüyor'
                : conversion.status === 'failed'
                  ? 'Dönüştürme başarısız'
                  : conversion.summary?.cancelled
                    ? 'Durduruldu'
                    : 'Tamamlandı'}
            </strong>
            <span className="progress-count">
              {conversion.processed} / {conversion.scanned || '?'} ileti
            </span>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={displayPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={conversion.status === 'failed' ? 'progress-bar failed' : 'progress-bar'}
              style={{ width: `${displayPercent}%` }}
            />
          </div>

          {running ? <p className="progress-folder">{conversion.folder || 'Dosya taranıyor...'}</p> : null}

          {conversion.error ? <p className="hint error">{conversion.error}</p> : null}

          {conversion.summary ? (
            <>
              <dl className="summary">
                <div>
                  <dt>Yazılan</dt>
                  <dd>{conversion.summary.written}</dd>
                </div>
                <div>
                  <dt>Yinelenen</dt>
                  <dd>{conversion.summary.duplicates}</dd>
                </div>
                <div>
                  <dt>Atlanan</dt>
                  <dd>{conversion.summary.skipped}</dd>
                </div>
                <div>
                  <dt>Hatalı</dt>
                  <dd>{conversion.summary.failed}</dd>
                </div>
                <div>
                  <dt>Süre</dt>
                  <dd>{formatDuration(conversion.summary.durationMs)}</dd>
                </div>
              </dl>

              {conversion.summary.scanned !== conversion.summary.processed ? (
                <p className="hint">
                  Tarama {conversion.summary.scanned} ileti bekliyordu, dosyadan {conversion.summary.processed}{' '}
                  ileti okundu. Outlook klasör sayaçları her zaman gerçek ileti sayısını vermez.
                </p>
              ) : null}

              <div className="actions">
                <button type="button" className="secondary" onClick={() => void window.api.openPath(outputDir)}>
                  Klasörü aç
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void window.api.openPath(conversion.reportPath)}
                  disabled={conversion.reportPath.length === 0}
                >
                  Raporu aç
                </button>
              </div>
            </>
          ) : null}

          <div className="log" aria-label="İşlem günlüğü">
            {conversion.log.map((line) => (
              <div key={line.id} className={`log-line ${line.level}`}>
                {line.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      ) : null}

      {exported ? (
        <section className="card">
          <div className="progress-head">
            <strong>ZIP arşivi</strong>
            <span className="progress-count">isteğe bağlı</span>
          </div>

          <p className="hint">
            Dosyalar hedef klasörde klasör yapısıyla duruyor. İsterseniz tamamını tek bir .zip
            dosyasına alıp saklayabilir veya paylaşabilirsiniz. Arşivin içindeki klasör yapısı aynı
            kalır.
          </p>

          {archiving ? (
            <>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={zipPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="progress-bar" style={{ width: `${zipPercent}%` }} />
              </div>
              <p className="progress-folder">
                {archive.total > 0
                  ? `${archive.processed} / ${archive.total} dosya · ${formatBytes(archive.processedBytes)} / ${formatBytes(archive.totalBytes)}`
                  : 'Klasör taranıyor...'}
              </p>
            </>
          ) : null}

          {archive.error ? <p className="hint error">{archive.error}</p> : null}

          {archive.summary && archive.status === 'done' ? (
            archive.summary.cancelled ? (
              <p className="hint warn">
                Arşivleme durduruldu. Yarım kalan dosya silindi, .eml dosyaları olduğu gibi duruyor.
              </p>
            ) : (
              <p className="hint">
                {archive.summary.fileCount} dosya arşivlendi.{' '}
                {formatBytes(archive.summary.totalBytes)} sıkıştırılarak{' '}
                {formatBytes(archive.summary.zipBytes)} oldu.
              </p>
            )
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => void archive.start(outputDir, suggestZipName(pstPath))}
              disabled={archiving || running}
            >
              {archive.status === 'done' && !archive.summary?.cancelled
                ? 'Yeniden ZIP oluştur'
                : 'ZIP olarak kaydet'}
            </button>
            <button type="button" className="secondary" onClick={archive.cancel} disabled={!archiving}>
              İptal
            </button>
            {archive.summary && archive.status === 'done' && !archive.summary.cancelled ? (
              <button
                type="button"
                className="secondary"
                onClick={() => void window.api.revealPath(archive.summary!.zipPath)}
              >
                ZIP'i klasörde göster
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
