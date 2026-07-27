// OPT-14: 公共 Electron 辅助函数
// 提取自 agent.ts / chat.ts 等多处重复定义

import { BrowserWindow } from 'electron'

/**
 * 获取当前主窗口的 WebContents。
 * 如果没有窗口或窗口已销毁，返回 null。
 */
export function getMainWindowWebContents(): Electron.WebContents | null {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return null
  const win = windows[0]
  if (win.isDestroyed()) return null
  return win.webContents
}
