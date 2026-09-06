# PST Monster — Uygulama Planı

> **Durum: uygulandı ve yayına hazır.** Kullanım ve mimari için [README.md](README.md),
> İngilizcesi için [README.en.md](README.en.md). Aşağıdaki plan hayata geçirilirken bazı
> noktalarda değişti; farklar 13-15. bölümlerde listelendi.

Eski Outlook `.pst` dosyasındaki e-postaları, yeni Outlook'un içe aktarabildiği `.eml`
dosyalarına, PST içindeki klasör hiyerarşisini birebir koruyarak dönüştüren
cross-platform (Windows / macOS / Linux) Electron masaüstü uygulaması.

## 1. Gereksinimler

Zorunlu (kullanıcı isteği):
- **Export ekranı**: iki giriş — (1) `.pst` dosya seçici, (2) hedef klasör seçici; "Dönüştür" butonu.
- **Ayarlar ekranı**: `Ignore duplicate mails` seçeneği (opsiyonel, varsayılan kapalı).
- Çıktı klasör yapısı = PST içindeki klasör yapısı.

Türetilmiş (bir e-posta dönüştürücüden beklenen asgari davranış):
- İlerleme çubuğu, iptal, bitişte özet (dönüştürülen / atlanan / hatalı / duplicate).
- Ekler, gömülü mesajlar (`message/rfc822`), inline resimler (`cid:`) korunmalı.
- Orijinal başlıklar (Message-ID, Date, From, To, Received…) mümkünse aynen aktarılmalı.
- Dosya/klasör adları her işletim sisteminde geçerli olmalı (Windows yasak karakterleri, uzunluk).
- Uygulama UI'ı büyük PST'lerde (GB boyutunda, on binlerce mail) donmamalı.

## 2. Teknoloji seçimi

| Katman | Seçim | Neden |
|---|---|---|
| Masaüstü | Electron 44 + `electron-vite` + React + TypeScript | Kullanıcı isteği; electron-vite main/preload/renderer'ı tek yerde derler |
| PST okuma | `pst-extractor` 1.12 (MIT, saf JS, java-libpst portu) | Native bağımlılık yok → 3 platformda derleme derdi yok; ANSI (Outlook 97-2002) ve Unicode (2003+) PST destekler; klasör ağacı, mesaj, ek, alıcı, `transportMessageHeaders` erişimi var |
| EML üretimi | `nodemailer` içindeki `MailComposer` (`nodemailer/lib/mail-composer`) | RFC 5322 + MIME (multipart/alternative, ekler, cid inline, özel başlıklar) üretir; SMTP kullanılmaz, yalnızca `.build()` |
| Ayar saklama | `electron-store` | JSON, platform bağımsız userData |
| Paketleme | `electron-builder` | nsis (Win), dmg (mac), AppImage + deb (Linux) |
| Test | `vitest` | core katman saf Node olduğu için Electron'suz test edilir |

Doğrulanan `pst-extractor` API'si: `PSTFile → getRootFolder()`, `PSTFolder.getSubFolders() / getNextChild() / contentCount / displayName`,
`PSTMessage.transportMessageHeaders / body / bodyHTML / bodyRTF / subject / senderName / senderEmailAddress / displayTo / displayCC / displayBCC /
messageDeliveryTime / clientSubmitTime / internetMessageId / messageClass / numberOfAttachments / getAttachment(i)`,
`PSTAttachment.longFilename / mimeTag / contentId / attachMethod / embeddedPSTMessage / fileInputStream`,
`PSTRecipient.displayName / smtpAddress / emailAddress / recipientType`.

## 3. Mimari

```
src/
  core/                   # Saf Node, Electron'dan bağımsız, birim testli
    pst-walker.ts         # PST'yi gezer, {folderPath[], message} akışı üretir (generator)
    eml-builder.ts        # PSTMessage → EML Buffer (MailComposer)
    naming.ts             # Klasör/dosya adı sanitize + çakışma çözümü
    dedupe.ts             # Duplicate anahtarı (Message-ID veya içerik hash'i) + Set
    converter.ts          # Orkestrasyon: say → gez → yaz → rapor; progress/cancel callback'leri
    types.ts              # ConvertOptions, ProgressEvent, ConvertSummary
  main/
    index.ts              # BrowserWindow, app lifecycle
    ipc.ts                # dialog:openPst, dialog:openDir, convert:start/cancel, settings:get/set
    settings.ts           # electron-store şeması
    convert-host.ts       # utilityProcess ile worker'ı başlatır, mesajları renderer'a iletir
    workers/convert-worker.ts  # core/converter'ı ayrı process'te çalıştırır (UI donmasın)
  preload/index.ts        # contextBridge ile dar API: window.api.{pickPst, pickDir, startConvert, cancel, onProgress, getSettings, setSettings}
  renderer/
    App.tsx               # Sol menü: Export | Settings
    pages/ExportPage.tsx  # 2 input + buton + progress + log + özet
    pages/SettingsPage.tsx# Ignore duplicates (+ küçük ek seçenekler)
    components/…
scripts/convert-cli.ts    # Aynı core'u komut satırından çalıştırır (hızlı deneme ve CI testi)
```

Güvenlik: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; renderer dosya sistemine dokunmaz, her şey IPC üzerinden.

Dönüşüm ayrı bir `utilityProcess`'te koşar. `pst-extractor` senkron çalıştığı için main process'te koşarsa pencere donar; worker'dan main'e
`progress` mesajları belirli aralıklarla (her 50 mail veya 250 ms) gönderilir, `cancel` bayrağı worker'a iletilir ve döngü bir sonraki mailde durur.

## 4. Dönüşüm akışı (core/converter.ts)

1. **Doğrulama**: PST açılıyor mu (`new PSTFile(path)`), hedef klasör yazılabilir mi.
2. **Sayım geçişi**: Klasör ağacını gez, `contentCount` topla → toplam mail sayısı (progress yüzdesi için). Hızlıdır, mesajlar yüklenmez.
3. **Dönüştürme geçişi** (derinlik öncelikli):
   - Her klasör için `outDir/<sanitize(folder1)>/<sanitize(folder2)>/…` oluştur. Kök klasörün adı boş olduğundan atlanır; "Top of Personal Folders" üst düzey klasörü de atlanır (çıktı doğrudan `Inbox/`, `Sent Items/` … olarak başlar; ayarla açılabilir).
   - Her mesaj için:
     a. `messageClass` `IPM.Note*` değilse (kişi, takvim, görev, not) → "atlanan" sayacına ekle, geç.
     b. Duplicate anahtarı üret; ayar açıksa ve anahtar daha önce görüldüyse → "duplicate" sayacı, geç.
     c. EML üret (bkz. §5), dosya adını üret (bkz. §6), yaz.
     d. Hata olursa mesajı `errors[]`'e ekle (klasör, konu, hata), devam et — tek bozuk mail tüm işi durdurmaz.
4. **Rapor**: Hedef klasöre `_export-report.json` (özet + hatalar + duplicate listesi) yaz, UI'da özet göster.

## 5. EML üretim kuralları (core/eml-builder.ts)

- **Başlıklar**: `transportMessageHeaders` varsa (internetten gelen mailler) parse edilip aynen kullanılır; ancak `Content-Type`, `Content-Transfer-Encoding`,
  `MIME-Version`, `Content-Disposition` gibi gövdeye bağlı başlıklar **çıkarılır** (eski boundary yeni gövdeyle uyuşmaz). Yoksa (gönderilmiş / taslak mailler)
  `From`, `To`, `Cc`, `Bcc`, `Date`, `Subject`, `Message-ID` PST özelliklerinden üretilir.
- **Adresler**: Alıcılar `PSTRecipient` listesinden `"Ad" <smtp>` biçiminde; `smtpAddress` boşsa `emailAddress` (EX/X.500 adresi olabilir; olduğu gibi yazılır), o da yoksa `displayTo` string'i.
- **Date**: `clientSubmitTime` ?? `messageDeliveryTime` ?? PST'de yoksa şimdi (raporda işaretlenir).
- **Message-ID**: `internetMessageId` yoksa deterministik üret: `<sha1(subject+date+from)@pst-export.local>` (dedupe ile tutarlı).
- **Gövde**: `bodyHTML` varsa `html` + `body` varsa `text` → multipart/alternative. Yalnızca `bodyRTF` varsa: RTF compressed'ı aç (`@kenjiuno/decompressrtf`), içinde
  gömülü HTML varsa (`\fromhtml`) HTML'i çıkar, yoksa `text` olarak düz metin gövdesini kullan. (Faz 6'da; Faz 2'de RTF-only mail düz `body` ile yazılır.)
- **Ekler**: `attachMethod`
  - 1 (by value): `fileInputStream`'den Buffer'a oku; `filename = longFilename ?? filename ?? attachment-N`, `contentType = mimeTag ?? mime-types.lookup(name)`.
  - 5 (embedded message): `embeddedPSTMessage` → aynı builder ile özyinelemeli EML üret, `message/rfc822` eki olarak `<subject>.eml` adıyla ekle.
  - 2/3/4 (referans): dosya PST'de yok → `errors[]`'e "referans ek atlandı" notu.
  - `contentId` doluysa ve HTML gövdede `cid:` geçiyorsa → `cid` alanı set edilir (inline resim).
- **Karakter seti**: MailComposer UTF-8 üretir; `pst-extractor` iconv-lite ile PST kod sayfasını çözer (Türkçe cp1254 mailler dahil).
- Çıktı: `mailComposer.compile().build()` → Buffer, satır sonları CRLF.

## 6. Adlandırma (core/naming.ts)

- Klasör adı: `<>:"/\|?*` ve kontrol karakterleri `_` ile değiştirilir; baştaki/sondaki nokta ve boşluk kırpılır; Windows ayrılmış adlar (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) sonuna `_` alır; 100 karakterde kesilir. Sanitize sonrası aynı üst klasörde çakışan iki PST klasörü → `Ad (2)`.
- Dosya adı: `YYYY-MM-DD_HHMMSS_<sanitize(subject, 80 kar.)>.eml`; konu boşsa `(no subject)`. Aynı klasörde çakışırsa `_2`, `_3` … eklenir.
- Tam yol Windows'ta 260 karakteri aşarsa konu daha da kısaltılır; yine aşarsa `_report`'a uyarı yazılır (electron-builder'lı Node'da `\\?\` uzun yol desteği de açılır).

## 7. Duplicate tespiti (core/dedupe.ts)

- Anahtar: `internetMessageId` (normalize: trim, küçük harf, `<>` soyulmuş) varsa bu.
- Yoksa `sha256(normalize(from) | date(epoch sn) | normalize(subject) | ilk 4 KB normalize(body))`.
- Kapsam: **tüm export boyunca** tek Set (aynı mail Inbox ve bir alt klasörde varsa ikincisi atlanır). Ayar kapalıysa her şey yazılır. Atlananlar raporda `{key, folder, subject, firstSeenAt}` olarak listelenir.

## 8. Ayarlar (electron-store)

| Anahtar | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `ignoreDuplicates` | boolean | `false` | **İstenen seçenek.** Aynı maili bir kez yaz |
| `skipNonMailItems` | boolean | `true` | Kişi / takvim / görev öğelerini atla |
| `includeRootFolderName` | boolean | `false` | Çıktıyı `Top of Personal Folders/` altında başlat |
| `lastPstPath`, `lastOutputDir` | string | — | Export ekranını son değerlerle doldur |

Ayarlar ekranı ilk sürümde yalnızca ilk üçünü gösterir; son ikisi arka planda tutulur.

## 9. Ekranlar

**Export**
```
┌──────────────────────────────────────────────────────┐
│ PST dosyası     [ /home/.../archive.pst      ] [Seç] │
│ Hedef klasör    [ /home/.../eml-out          ] [Seç] │
│                                                      │
│ [ Dönüştür ]  [ İptal ]                              │
│ ████████████░░░░░░░░  61%   4.120 / 6.750   Inbox/2023│
│ Log: …                                               │
│ Özet: 6.700 yazıldı · 32 duplicate · 15 atlandı · 3 hata  [Klasörü aç] [Raporu aç] │
└──────────────────────────────────────────────────────┘
```
- Dönüştür butonu iki alan dolmadan pasif; PST seçici `*.pst` filtresi; hedef klasör boş değilse uyarı (dosyalar üstüne yazılmaz, `_2` eklenir).
- Çalışırken alanlar kilitli, sekme değişimi serbest, pencere kapatılırsa "dönüşüm sürüyor" onayı.

**Settings**: yukarıdaki toggle'lar, açıklama satırlarıyla; değişiklik anında kaydedilir.

## 10. Uygulama fazları

| Faz | Kapsam | Çıktı |
|---|---|---|
| 0 | `npm create @quick-start/electron` (react-ts), electron-builder konfigü, eslint/prettier, vitest | Boş pencere 3 platformda açılır |
| 1 | `core/pst-walker` + `scripts/convert-cli.ts`: PST'yi gez, klasör ağacını ve mail sayılarını yazdır | CLI ile gerçek PST'de ağaç doğrulanır |
| 2 | `core/eml-builder` (başlık + text/html + by-value ekler) + `naming` + `converter` | CLI ile tam dönüşüm; çıktı Thunderbird / yeni Outlook'ta açılır |
| 3 | `core/dedupe` + `ConvertOptions.ignoreDuplicates` | Birim test: aynı Message-ID iki kez → tek dosya |
| 4 | Worker + IPC + preload API + progress/cancel | Main ↔ worker sözleşmesi tamam |
| 5 | Renderer: Export sayfası, ayar sayfası, electron-store | Uygulama uçtan uca çalışır |
| 6 | Kenar durumlar: gömülü mesaj, inline cid, RTF-only gövde, referans ekler, non-mail öğeler, uzun yol, hata raporu | `_export-report.json` |
| 7 | Paketleme: nsis / dmg / AppImage+deb; (ops.) GitHub Actions matrix build | Kurulabilir paketler |
| 8 | Testler: naming/dedupe/eml-builder birim; `pst-extractor` paketindeki örnek PST'lerle entegrasyon | `npm test` yeşil |

## 11. Riskler ve kararlar

- **Büyük PST'ler**: `pst-extractor` dosyayı tamamen belleğe almaz, descriptor bazlı okur; ancak tek bir mail için tüm ekler Buffer'a alınır. 100 MB+ ekli mailler için ek başına akış yazımı (ek geçici dosyaya, sonra EML'e stream) Faz 6'da değerlendirilir.
- **Şifreli / bozuk PST**: `pst-extractor` şifreli PST'leri (Outlook "compressible encryption") destekler; "high encryption" veya bozuk dosyada açılış hatası kullanıcıya net mesajla gösterilir; PST önce Outlook'ta `scanpst` ile onarılmalı.
- **Orijinal başlık yeniden kullanımı**: Bazı PST'lerde `transportMessageHeaders` kesik olabilir; parse hatasında sentezlenmiş başlıklara düşülür.
- **X.500 (EX) adresleri**: Exchange içi mailler için SMTP adresi PST'de olmayabilir; `"Ad" <EX:/o=…>` yerine `"Ad" <ad@unknown.invalid>` yazılıp raporda işaretlenir (EML okuyucular geçersiz adresle sorun çıkarabilir).
- **Yeni Outlook'ta içe aktarma**: Yeni Outlook `.eml` içe aktarmayı sürükle-bırak ile yapar; klasör ağacı elle oluşturulmalı. Bu uygulamanın sorumluluğu dışında; README'de adımlar anlatılır.
- **Performans hedefi**: 10.000 mail / < 2 dk (SSD, ekler ortalama). Worker sayesinde UI hep akıcı.

## 12. Bağımlılık listesi

Runtime: `pst-extractor`, `nodemailer` (yalnızca `lib/mail-composer`), `electron-store`, `mime-types`, `@kenjiuno/decompressrtf` (Faz 6), `react`, `react-dom`.
Dev: `electron`, `electron-vite`, `electron-builder`, `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `eslint`, `prettier`.


## 13. Plandan sapmalar

Uygulama sırasında ortaya çıkan ve planı değiştiren kararlar:

- **Ayar saklama.** `electron-store` yerine `src/main/settings.ts` içinde ~70 satırlık bir
  JSON dosyası kullanıldı. Kütüphanenin ESM-only olması ana sürecin CommonJS derlemesiyle
  sürtüşme yaratıyordu ve saklanan veri beş alandan ibaret.

- **Katman ayrımı.** Plandaki `pst-walker.ts` ikiye bölündü: ağaç gezme `pst-walker.ts`'te,
  `PSTMessage`'ı biçimden bağımsız yapıya çevirme `pst-reader.ts`'te. Araya `message.ts`
  girdi. Böylece EML üretici PST kütüphanesini hiç tanımıyor ve tek başına test edilebiliyor.

- **Paylaşılan sözleşme.** Pencerenin ana süreçten tip alması yanlıştı. Kanallar, ayar tipi
  ve köprü arayüzü `src/shared/` altına taşındı.

- **RTF.** Plan bunu 6. faza bırakıyordu; başından yapıldı çünkü Outlook'un kendi yazdığı
  iletilerde gövde çoğu zaman yalnızca RTF içinde. `rtf-stream-parser` gömülü HTML'i
  çıkarıyor, `rtf-plain.ts` gerçekten zengin metin olan gövdeleri metne indiriyor. Kütüphane
  Node'un tanımadığı Windows kod sayfalarında çöktüğü için çözücü olarak `iconv-lite`
  veriliyor; Türkçe karakterler bu sayede korunuyor.

- **Bozuk başlık ayıklama.** Gerçek arşivlerde, katlanmış başlık satırlarını daha önce
  düzleştirmiş bir aracın bıraktığı `17: 04:44 -0500` gibi parçalar var. Bunlar sözdizimsel
  olarak geçerli başlık sayıldığından çıktıya sızıyordu. Başlık adının harfle başlaması
  koşulu eklendi.

- **Bcc.** nodemailer gönderim sırasında Bcc'yi düşürüyor. Arşiv için tam tersi gerekli,
  bu yüzden derlenmiş düğüm üzerinde `keepBcc` açılıyor.

- **Kapsayıcı klasör seçimi.** Plan "kökün ilk alt klasörünü ez" diyordu. `.ost`
  dosyalarında kökün altında birden fazla kapsayıcı var ve ilki posta ağacı olmayabiliyor.
  Artık en çok ileti barındıran kapsayıcı eziliyor; bu dile de bağlı değil.

- **İlerleme sayacı.** Klasör sayaçları gerçek ileti sayısını her zaman vermiyor, özellikle
  `.ost` dosyalarında. Özet artık taranan tahmini ile gerçekten işlenen sayıyı ayrı ayrı
  bildiriyor.

- **Paketleme.** `utilityProcess.fork` asar arşivi içinden dosya çalıştıramıyor; worker'ı
  arşiv dışına almak yetmedi, çünkü modül çözümlemesi gerçek dizinlerde yukarı yürüyor ve
  arşivin içine bakmıyor. `node_modules` da arşiv dışına alındı. Bu hata yalnızca paket
  üretildikten sonra görülüyordu, bu yüzden `scripts/smoke-worker.cjs` paketlenmiş worker'ı
  da sınayabiliyor.

- **Doğrulama.** Plandaki testlere ek olarak iki duman testi yazıldı: biri gerçek worker
  sürecinde tam bir dönüştürme yapıyor, diğeri pencereyi açıp DevTools üzerinden köprüyü,
  React'in bağlandığını ve bir IPC gidiş-dönüşünü doğruluyor.

- **Arayüz dili.** Arayüz ve kullanıcıya görünen mesajlar Türkçe. Kod, yorumlar ve rapor
  alan adları İngilizce kaldı.


## 14. Sonradan eklenen: ZIP arşivi

Dönüştürme bittikten sonra çıktı klasörünün tamamını tek bir `.zip` dosyasına alma özelliği
eklendi. `.eml` dosyaları klasör yapısıyla yerinde kalır; arşiv isteğe bağlı, ek bir adımdır.

- **Kütüphane.** `archiver` 7. Sürüm 8 yalnızca ESM ve ana süreç CommonJS derliyor. Sürüm 7
  ayrıca giriş sayısı ve bayt cinsinden ilerleme olayları yayıyor, bu da ilerleme çubuğunu
  tahmine dayanmaktan kurtarıyor. Dosyalar diskten akıtılıyor, bellek çıktı boyutundan
  bağımsız kalıyor.

- **Ayrı worker.** Sıkıştırma da CPU yoğun, bu yüzden `zip-worker.ts` ayrı bir işlemde
  çalışıyor. İki iş için tek bir `WorkerHost` sınıfı yazıldı; eski `ConversionHost` bunun
  içinde eridi.

- **Kendini dışlama.** Arşiv çıktı klasörünün içine kaydedilebiliyor, bu yüzden dosya
  listesi kendi hedef yolunu atlıyor. Aksi halde arşiv kendini içine almaya çalışırdı.

- **İptal.** Durdurulduğunda yarım kalan `.zip` siliniyor; `.eml` dosyalarına dokunulmuyor.

- **Kapsam kararı.** Buton yalnızca bu oturumda tamamlanmış bir dönüştürmeden sonra çıkıyor.
  Herhangi bir klasörü arşivlemeye açmak, kullanıcının kastetmediği bir klasörü sıkıştırma
  riski taşırdı.


## 15. Sonradan eklenen: dağıtım

Uygulama GitHub'da public olarak yayımlanacağı için üç işletim sistemine de kurulabilir çıktılar
üretildi.

- **Çapraz derleme yapılamıyor.** Windows kurulumu için Windows, macOS disk imajı için macOS
  gerekiyor. Bu makinede wine de yok. Doğru çözüm `.github/workflows/release.yml`: paketleri her
  işletim sisteminin kendi runner'ında üretip bir sürüm etiketinde taslak Release açıyor.

- **AppImage tek başına yetmiyor.** Ubuntu 22.04'ten beri `libfuse2` kurulu gelmiyor ve AppImage
  "Cannot mount AppImage" diyerek açılmıyor; bu makinede de öyle oldu. Kullanıcının hiçbir şey
  kurmaması gerektiği için `.deb` birincil seçenek yapıldı, yanına FUSE istemeyen bir `.tar.gz`
  eklendi. Çıkarılmış derlemenin çalıştığı doğrulandı.

- **İmzalama yok.** Sertifika alınmadığı için Windows'ta SmartScreen, macOS'ta Gatekeeper ilk
  açılışta bir kez soruyor. İkisinin de nasıl geçileceği README'de anlatıldı. macOS derlemesinin
  imza aramaya kalkıp CI'da patlamaması için `identity: null` ve `CSC_IDENTITY_AUTO_DISCOVERY=false`
  ayarlandı.

- **Ekran görüntüleri gerçek.** `scripts/capture-screens.cjs` uygulamayı açıp gerçek bir
  dönüştürme çalıştırıyor ve DevTools protokolüyle ekranı yakalıyor. Böylece README'deki resimler
  maket değil, uygulamanın kendisi; arayüz değişince `npm run capture` ile tazeleniyor.

- **README.** Türkçe ana sayfa ve İngilizce ikinci sayfa, karşılıklı bağlantılı. İşletim sistemine
  göre indirme tablosu, ilk açılış uyarılarının çözümü ve ekran görüntüleri eklendi.
