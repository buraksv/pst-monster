import { join } from 'node:path'
import { BrowserWindow, app, dialog, shell } from 'electron'
import { conversionInProgress, disposeIpc, registerIpc } from './ipc.js'
import { installMenu } from './menu.js'

/**
 * Application entry point: one window, no menu-driven features, everything the
 * window can do goes through the channels registered in ipc.ts.
 */

let mainWindow: BrowserWindow | null = null
/** Set once the user has confirmed quitting mid-conversion. */
let allowCloseDuringRun = false

function createWindow(): void {
  const window = new BrowserWindow({
    width: 940,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'PST Monster',
    // Windows and macOS take the icon from the package. Linux desktops need it
    // on the window itself, or the taskbar shows a blank square when the app is
    // started from a terminal or the tar.gz rather than from the .desktop entry.
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../../resources/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The window renders local HTML and must never reach Node directly: the
      // content it displays comes from files the user chose.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window

  window.on('ready-to-show', () => window.show())

  window.on('close', (event) => {
    if (!conversionInProgress() || allowCloseDuringRun) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: ['Devam et', 'Durdur ve çık'],
      defaultId: 0,
      cancelId: 0,
      title: 'İşlem sürüyor',
      message: 'Bir dönüştürme veya arşivleme hâlâ çalışıyor.',
      detail: 'Şimdi çıkarsanız işlem yarım kalır. Halihazırda yazılan .eml dosyaları korunur.',
    })
    if (choice === 1) {
      allowCloseDuringRun = true
      disposeIpc()
      window.close()
    }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  // Anything that wants its own window is an external link; hand it to the
  // browser rather than opening a window with no address bar.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// One window is the whole app; a second instance should surface the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // Ties the window to the Start menu shortcut the installer creates, so the
  // taskbar groups and pins it under its own name rather than "electron".
  if (process.platform === 'win32') app.setAppUserModelId('com.buraksv.pstmonster')

  void app.whenReady().then(() => {
    installMenu()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    allowCloseDuringRun = true
    disposeIpc()
  })
}
