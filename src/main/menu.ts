import { Menu, app } from 'electron'

/**
 * The window has no menu-driven features, but the platforms differ in what a
 * missing menu costs.
 *
 * On macOS the application menu is where Cmd+Q, Cmd+C/V and Cmd+W come from:
 * without one, quitting and pasting into the path fields would not work. On
 * Windows and Linux there is nothing a menu would add, and Electron's default
 * one exposes developer tools, so it is removed outright.
 */
export function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        role: 'editMenu',
      },
      {
        role: 'windowMenu',
      },
    ]),
  )
}
