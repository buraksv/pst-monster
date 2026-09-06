import { useCallback, useEffect, useState } from 'react'
import { ExportPage } from './pages/ExportPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { useArchive } from './useArchive.js'
import { useConversion } from './useConversion.js'
import type { AppSettings } from '../../shared/settings.js'
import monster from './assets/monster.png'

type Tab = 'export' | 'settings'

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('export')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const conversion = useConversion()
  const archive = useArchive()

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
  }, [])

  const patchSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const updated = await window.api.setSettings(patch)
    setSettings(updated)
  }, [])

  const running = conversion.status === 'running' || archive.status === 'running'

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={monster} alt="" width="36" height="36" />
          <span className="brand-text">
            PST Monster
            <small>Outlook .pst → .eml</small>
          </span>
        </div>

        <button
          type="button"
          className={tab === 'export' ? 'nav-item active' : 'nav-item'}
          onClick={() => setTab('export')}
        >
          Dışa aktar
          {running ? <span className="nav-badge" title="Bir işlem sürüyor" /> : null}
        </button>
        <button
          type="button"
          className={tab === 'settings' ? 'nav-item active' : 'nav-item'}
          onClick={() => setTab('settings')}
        >
          Ayarlar
        </button>

        <p className="sidebar-note">
          Dönüştürme ve arşivleme ayrı işlemlerde çalışır. Sekmeler arasında geçiş yapmak bunları
          durdurmaz.
        </p>
      </nav>

      <main className="content">
        {settings === null ? (
          <p className="loading">Ayarlar yükleniyor...</p>
        ) : tab === 'export' ? (
          <ExportPage
            settings={settings}
            conversion={conversion}
            archive={archive}
            onPatchSettings={patchSettings}
          />
        ) : (
          <SettingsPage settings={settings} onPatchSettings={patchSettings} disabled={running} />
        )}
      </main>
    </div>
  )
}
