<div align="center">

<img src="resources/icon.png" alt="PST Monster" width="128" height="128">

# PST Monster

**Devours Outlook `.pst` archives and spits out the `.eml` files new Outlook can import,**
keeping the original folder structure.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/buraksv/pst-monster/actions/workflows/ci.yml/badge.svg)](https://github.com/buraksv/pst-monster/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/buraksv/pst-monster?include_prereleases&label=release)](https://github.com/buraksv/pst-monster/releases)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)

[Download](#download) · [Usage](#usage) · [How it works](#conversion-rules) · [Development](#development) · [Türkçe](README.md)

<img src="docs/screenshot-result.png" alt="The app after a finished conversion" width="820">

</div>

> **Note:** the application interface is in Turkish. This page describes it in English.

---

New Outlook will not import a `.pst` file; it wants individual `.eml` files. PST Monster converts
the messages in your archive into `.eml` files and rebuilds the folder tree around them. Free,
open source and fully offline.

- **The folder structure is preserved.** Inbox, Sent Items and every subfolder appear in the output.
- **Nothing is lost.** Attachments, embedded messages, inline images and the original internet headers all carry over.
- **Legacy encodings are decoded.** Old Windows code pages are handled, so accented characters survive.
- **Duplicates can be skipped.** Optional, keyed on `Message-ID` or a content hash.
- **One-click zip.** The whole output can be packed into a single archive, folder structure intact.
- **Everything stays local.** The app never touches the network.

## Download

Grab the file for your operating system from the
[releases page](https://github.com/buraksv/pst-monster/releases/latest). **Nothing else to
install**: the runtime, the app and every dependency ship inside the package.

> Every release also shows **Source code (zip)** and **Source code (tar.gz)** links that GitHub
> attaches by itself. Those are the repository source, not the application: download one and you
> get `src/`, `package.json` and the rest. The files to install are the ones named in the table
> below, such as the `.exe` for Windows.

| Operating system | File | What it does |
| --- | --- | --- |
| **Windows 10/11** | `pst-monster-*-windows-setup.exe` | Installer, adds a Start menu entry |
| Windows, no install | `pst-monster-*-windows-portable.exe` | Double-click to run |
| **macOS, Apple Silicon** | `pst-monster-*-macos-arm64.dmg` | M1 and later |
| **macOS, Intel** | `pst-monster-*-macos-x64.dmg` | 2020 and earlier |
| **Ubuntu, Debian** | `pst-monster-*-linux-amd64.deb` | Double-click to install |
| Other Linux | `pst-monster-*-linux-x64.tar.gz` | Extract, run `pst-monster` |
| Linux, AppImage | `pst-monster-*-linux-x86_64.AppImage` | Needs FUSE, see the note below |

### First-launch warnings

The packages are not code-signed. Certificates cost money and this project has none. The app is
safe and its source is in this repository, but operating systems ask once about unsigned apps.

<details>
<summary><b>Windows:</b> "Windows protected your PC"</summary>

<br>

SmartScreen shows a blue dialog. Click **More info**, then **Run anyway**. This happens only on
the first launch.

</details>

<details>
<summary><b>macOS:</b> "cannot be opened because the developer cannot be verified"</summary>

<br>

Open the DMG and drag the app into **Applications**, then:

1. **Right-click** the app (or Control-click) and choose **Open**.
2. Click **Open** again in the dialog that appears.

If the warning persists, run this in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/PST Monster.app"
```

</details>

<details>
<summary><b>Ubuntu:</b> the AppImage says "Cannot mount AppImage"</summary>

<br>

Ubuntu has not shipped `libfuse2` by default since 22.04, and AppImage needs it. Two options:

- **Recommended:** download the `.deb` instead. It needs nothing extra.
- Or download the `.tar.gz`, extract it, and run `pst-monster` inside.

To keep using the AppImage, `sudo apt install libfuse2t64` is enough.

</details>

## Usage

<img src="docs/screenshot-export.png" alt="The export screen" width="760">

The export screen has two fields: the source `.pst` file and the folder the `.eml` files go into.
Choosing both enables the convert button.

Progress, the folder being read and a log appear while it runs. Cancelling stops after the
message in flight; whatever was written stays on disk.

When it finishes you get a summary: files written, duplicates skipped, items skipped, failures.
Buttons open the output folder and the detailed report.

### Zip archive

Once a conversion finishes, an archive panel appears. The `.eml` files stay where they are in the
output folder; the zip does not replace them, it is an optional extra step. The button opens a
save dialog, then shows progress and can be cancelled. Cancelling deletes the half-written
archive and leaves the `.eml` files alone.

The folder structure inside the archive matches the output folder. Saving the archive inside the
folder it is archiving leaves itself out.

### Settings

<img src="docs/screenshot-settings.png" alt="The settings screen" width="760">

| Option | Default | What it does |
| --- | --- | --- |
| Skip duplicate messages | Off | Writes only the first copy when a message sits in several folders |
| Export mail items only | On | Leaves out contacts, appointments, tasks and notes |
| Keep the top folder name | Off | Nests the output under the archive's container folder |

### Importing into new Outlook

New Outlook does not rebuild a folder tree from `.eml` files. Look at the tree in the output
folder, create matching folders in Outlook, then drag the files in.

## Output layout

```text
output/
├── Inbox/
│   ├── 2023-05-04_102030_About the quote.eml
│   ├── 2023-05-06_081500_(no subject).eml
│   └── Customers/
│       └── 2023-06-01_143012_Order confirmation.eml
├── Sent Items/
└── _export-report.json
```

File names are `YYYY-MM-DD_HHMMSS_subject.eml`, so a folder sorts chronologically. Names are
sanitised to be legal on all three operating systems: characters Windows forbids, reserved device
names (`CON`, `COM1`) and trailing dots and spaces are all handled. Two messages with the same
name do not collide; the second gets `_2`.

Only folders that contain messages are created. Empty folders in the archive are left out.

## Conversion rules

<details>
<summary><b>Headers</b></summary>

<br>

For mail that arrived over the internet, the archive usually kept the original headers, and those
carry over. Headers that describe the old MIME body, such as `Content-Type`,
`Content-Transfer-Encoding` and `MIME-Version`, are dropped, because the body is re-encoded with
fresh boundaries. `From`, `To` and `Date` are rebuilt from message properties. `Bcc` is kept: this
is an archive, not a message about to be sent.

Real archives contain fragments like `17: 04:44 -0500`, left behind by whatever already flattened
the folded header lines. A header name that does not start with a letter is discarded.

</details>

<details>
<summary><b>Addresses</b></summary>

<br>

Addresses come from the original headers where they exist. Exchange-internal mail has no such
headers, and the archive stores an X.500 directory name instead of a mail address. Those become
`name@x500.invalid` and the report says so. The `.invalid` top-level domain is reserved by
RFC 2606 and can never resolve, so it is visibly not a real address.

</details>

<details>
<summary><b>Bodies and legacy encodings</b></summary>

<br>

With both plain text and HTML present, the result is `multipart/alternative`. With neither, the
rich-text body is decoded: Outlook embeds the original HTML inside the RTF for mail it composed
itself, so the real HTML usually comes back. For bodies that are genuinely rich text, formatting
is dropped and the words are kept.

Older Outlook versions store text in Windows code pages such as `cp1254`. Those are decoded, so
accented characters survive.

</details>

<details>
<summary><b>Attachments</b></summary>

<br>

Attachments stored by value are copied byte for byte. Embedded messages are converted recursively
and attached as `message/rfc822`. Images the body references with `cid:` stay inline. Attachments
stored only as a link to an external file are not in the archive; the report lists them. When the
archive declares a generic MIME type, the type is taken from the extension instead, so images and
PDFs preview in a mail client.

</details>

<details>
<summary><b>Duplicate detection and archiving</b></summary>

<br>

The duplicate key is the `Message-ID`. Without one, a hash of sender, second-resolution
timestamp, subject and the first 4 KB of the body is used. The scope is the whole run: a message
in two folders is written to whichever is walked first.

When archiving, files are streamed from disk into the zip one at a time, so an export of many
gigabytes costs no more memory than a small one. Compression level 6.

</details>

## The report

`_export-report.json` in the output folder holds:

- Counts: scanned, processed, written, duplicates, skipped, failed.
- Every skipped item and why.
- Every warning: unreadable attachments, undated messages, X.500 senders.

The scanned and processed counts sometimes differ. Outlook folder counters do not always give the
real message count, especially in `.ost` files. The report shows both.

## Development

Requires Node.js 22 and npm.

```bash
git clone https://github.com/buraksv/pst-monster.git
cd pst-monster
npm install
npm run dev          # run in development mode
npm run build        # typecheck and build
npm test             # 100 unit and end-to-end tests
npm run verify       # build, tests, window smoke test
```

To produce installers, each on its own operating system:

```bash
npm run pack:linux   # .deb, .tar.gz, AppImage
npm run pack:win     # installer and portable .exe
npm run pack:mac     # dmg and zip
```

Artifacts land in `release/`. You cannot build a Windows installer on Linux or a macOS disk image
on Windows; GitHub Actions does that.

To try the conversion from a terminal, without the interface:

```bash
npm run cli -- archive.pst ./output --ignore-duplicates
```

### Releases and pipelines

Every push to `main` becomes a release. The flow lives in
[`release.yml`](.github/workflows/release.yml):

1. **A version is worked out.** If the version in `package.json` is not tagged yet, it is used as
   is; otherwise the minor version is bumped (`1.4.0 → 1.5.0`). This step writes nothing to the
   repository, it only computes the number.
2. **Three pipelines run in parallel.** [`build-linux.yml`](.github/workflows/build-linux.yml),
   [`build-windows.yml`](.github/workflows/build-windows.yml) and
   [`build-macos.yml`](.github/workflows/build-macos.yml) each run the tests and produce the
   packages on their own operating system. They can also be started by hand from the Actions tab,
   which produces workflow artifacts without cutting a release.
3. **The release is published.** This runs only once all three builds have succeeded. It checks
   that every operating system's packages arrived, writes `SHA256SUMS.txt`, commits the version
   to `package.json` on `main`, and creates the release together with its tag. Every package is
   attached to the release's **Assets**, and the notes carry a table saying which file is for
   which machine, built by [`release-notes.mjs`](scripts/release-notes.mjs).

Tagging happens **after** the builds, not before. A failed build therefore leaves no trace in the
repository: no orphaned tag, no version number consumed, nothing half-finished on the Releases
page. Earlier releases are never touched.

Moving to a new major version is the developer's call. Two ways:

```bash
# 1) Set the version in package.json to 2.0.0 by hand and push; that number ships as is.
npm version major --no-git-tag-version && git commit -am "2.0.0" && git push

# 2) Or open Actions > Release > "Run workflow" and pick "major".
```

Pushes that only touch `.md` files, `docs/` or `LICENSE` do not produce a release. To see the
number the next release would get, run `npm run version:next`.

[`ci.yml`](.github/workflows/ci.yml) runs the type check, unit tests, build and smoke tests on
all three operating systems for every pull request.

> For the workflow to commit back to `main`, the repository setting **Settings → Actions →
> General → Workflow permissions** must be **Read and write**. If `main` has branch protection,
> also add an admin bypass or use a personal access token instead of `GITHUB_TOKEN`.

### Architecture

```text
src/
├── core/        Electron-free conversion core, unit tested
│   ├── converter.ts     Drives a run: scan, walk, write, report
│   ├── pst-walker.ts    Walks the folder tree
│   ├── pst-reader.ts    PSTMessage → format-neutral message
│   ├── eml-builder.ts   Message → .eml bytes
│   ├── naming.ts        Makes file and folder names safe
│   ├── dedupe.ts        Duplicate key and tracking
│   ├── rtf.ts           HTML or text out of an RTF body
│   └── archive.ts       Streams the output folder into a .zip
├── shared/      The contract between window and main process
├── main/        Electron main process, IPC, settings, workers
├── preload/     The contextBridge
└── renderer/    React interface
```

Conversion and archiving each run in their own `utilityProcess`. Both are synchronous and
CPU-bound; on the main process either would freeze the window. The window never touches the
filesystem: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, every request over IPC.

### Dependencies

| Package | Why |
| --- | --- |
| [`pst-extractor`](https://github.com/prof3ssorSt3v3/pst-extractor) | Reads PST files. Pure JavaScript, so no native build on any platform |
| [`nodemailer`](https://nodemailer.com) | `MailComposer` only, for RFC 5322 output. No SMTP |
| [`rtf-stream-parser`](https://github.com/mazira/rtf-stream-parser) | Recovers HTML encapsulated in RTF |
| [`iconv-lite`](https://github.com/ashtuchkin/iconv-lite) | Decodes legacy Windows code pages |
| [`archiver`](https://github.com/archiverjs/node-archiver) | Builds the zip |

### Tests

```bash
npm test              # unit and end-to-end
npm run smoke:worker  # conversion and archiving in the real worker processes
npm run smoke:window  # window, bridge and IPC
```

The end-to-end test uses a real Outlook archive that ships with `pst-extractor`. Its headers are
already mangled, which is exactly the kind of input this tool has to survive.

Screenshots in this repository come from `npm run capture`, which drives the real app. The app
icon is authored in [`resources/icon.svg`](resources/icon.svg); `icon.png` is rendered from it at
1024×1024.

## Known limits

- Of encrypted PST files, only Outlook's compressible encryption is supported. Repair a damaged
  file with `scanpst.exe` first.
- Very large attachments are held in memory in full. A single attachment of several hundred
  megabytes may cause trouble. Archiving is unaffected; it streams.
- Packages are unsigned, so each operating system asks once on first launch.
- The interface is Turkish only.

## Contributing

Bug reports and ideas go to [Issues](https://github.com/buraksv/pst-monster/issues). When
reporting a conversion problem, the warnings in `_export-report.json` usually point at the cause;
you do not need to share the message itself.

## License

[MIT](LICENSE) · © 2026 Burak Savaşkan
