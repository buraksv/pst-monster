import type { AppSettings } from '../../../shared/settings.js'

interface Props {
  settings: AppSettings
  onPatchSettings(patch: Partial<AppSettings>): Promise<void>
  /** Settings are locked while a conversion is using them. */
  disabled: boolean
}

interface ToggleProps {
  id: keyof AppSettings
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange(value: boolean): void
}

function Toggle({ id, label, description, checked, disabled, onChange }: ToggleProps): React.JSX.Element {
  return (
    <div className="toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>
        <span className="toggle-label">{label}</span>
        <span className="toggle-description">{description}</span>
      </label>
    </div>
  )
}

export function SettingsPage({ settings, onPatchSettings, disabled }: Props): React.JSX.Element {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Ayarlar</h1>
        <p>Değişiklikler anında kaydedilir ve bir sonraki dönüştürmede geçerli olur.</p>
      </header>

      {disabled ? (
        <p className="hint warn">Dönüştürme sürerken ayarlar değiştirilemez.</p>
      ) : null}

      <section className="card">
        <Toggle
          id="ignoreDuplicates"
          label="Yinelenen iletileri atla"
          description="Aynı ileti arşivde birden fazla klasörde duruyorsa yalnızca ilk kopyası yazılır. Eşleştirme Message-ID üzerinden yapılır; ileti bu bilgiyi taşımıyorsa gönderen, tarih, konu ve gövdenin başından üretilen bir özet kullanılır."
          checked={settings.ignoreDuplicates}
          disabled={disabled}
          onChange={(value) => void onPatchSettings({ ignoreDuplicates: value })}
        />

        <Toggle
          id="skipNonMailItems"
          label="Yalnızca e-postaları aktar"
          description="Kişi, takvim, görev ve not öğeleri atlanır. Kapatılırsa bunlar da .eml olarak yazılır, ancak çoğu posta istemcisi bu dosyaları düzgün gösteremez."
          checked={settings.skipNonMailItems}
          disabled={disabled}
          onChange={(value) => void onPatchSettings({ skipNonMailItems: value })}
        />

        <Toggle
          id="includeRootFolderName"
          label="En üst klasör adını koru"
          description='Varsayılan olarak çıktı doğrudan Gelen Kutusu ve Gönderilmiş Öğeler ile başlar. Bu seçenek açıkken hepsi arşivin "Kişisel Klasörlerin Üstü" gibi kapsayıcı klasörünün altına yerleşir.'
          checked={settings.includeRootFolderName}
          disabled={disabled}
          onChange={(value) => void onPatchSettings({ includeRootFolderName: value })}
        />
      </section>

      <section className="card info">
        <h2>Yeni Outlook'a aktarma</h2>
        <ol>
          <li>Dönüştürme bitince hedef klasörü açın.</li>
          <li>Yeni Outlook'ta karşılık gelen klasörleri elle oluşturun.</li>
          <li>.eml dosyalarını ilgili klasöre sürükleyip bırakın.</li>
        </ol>
        <p>
          Yeni Outlook klasör yapısını .eml dosyalarından kendisi oluşturmaz. Bu uygulama klasörleri arşivdeki
          gibi hazırlar, böylece hangi dosyanın nereye gideceği bellidir.
        </p>
      </section>

      <section className="card info">
        <h2>Dönüştürme raporu</h2>
        <p>
          Her çalıştırmada hedef klasöre <code>_export-report.json</code> yazılır. Atlanan öğeler, yinelenen
          iletiler, okunamayan ekler ve adresi arşivde bulunmayan göndericiler bu dosyada listelenir.
        </p>
      </section>
    </div>
  )
}
