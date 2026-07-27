// 窗口控制 IPC handlers
// 提供最小化、最大化/还原、关闭、开发者工具等窗口操作

import { ipcMain, app, BrowserWindow } from 'electron'

// OPT2-29: 移除 registered 标志位，统一使用 removeHandler + handle 幂等模式
const WINDOW_CHANNELS = [
  'window:minimize',
  'window:maximize-toggle',
  'window:close',
  'window:is-maximized',
  'window:toggle-devtools',
  'app:quit',
] as const

export function registerWindowHandlers(): void {
  // 幂等：先移除再注册
  for (const channel of WINDOW_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  // 最小化窗口
  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  // 最大化/还原切换
  ipcMain.handle('window:maximize-toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  // 关闭窗口
  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  // 查询当前是否最大化
  ipcMain.handle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })

  // 切换开发者工具
  ipcMain.handle('window:toggle-devtools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.toggleDevTools()
  })

  // 退出应用
  ipcMain.handle('app:quit', () => {
    app.quit()
  })

  // 为每个窗口注册最大化状态变化监听，通知渲染进程
  // 注意: app 事件监听器本身是幂等的（重复监听同一事件不会重复触发）
  app.on('browser-window-created', (_event, win) => {
    win.on('maximize', () => {
      win.webContents.send('window:maximize-state-changed', { maximized: true })
    })
    win.on('unmaximize', () => {
      win.webContents.send('window:maximize-state-changed', { maximized: false })
    })
  })
}
