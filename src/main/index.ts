import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import {
  loadWindowState,
  createDebouncedSaver,
  DEFAULT_WINDOW_BOUNDS,
  type WindowBounds,
} from './utils/window-state'
import { initDatabase, closeDatabase } from './db/index'
import { registerIpcHandlers } from './ipc/index'

// ─── 资源清理注册表 ───────────────────────────────────────────────
// P1-03: db.close() 已注册
// P1-08: AbortController.abort()
// P2: MCP Server 子进程关闭
const cleanupTasks: Array<() => void> = []

/**
 * 注册资源清理函数，在 before-quit 时依次调用。
 * 供后续任务注册数据库关闭、AbortController 中断等清理逻辑。
 */
export function registerCleanup(fn: () => void): void {
  cleanupTasks.push(fn)
}

// 注册数据库关闭（P1-03）
registerCleanup(closeDatabase)

// ─── CSP 策略（生产环境注入） ──────────────────────────────────────
// 与 Spec v0.2 §2 CSP 配置一致
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.openai.com https://api.deepseek.com",
].join('; ')

/**
 * 通过 webRequest.onHeadersReceived 注入 CSP header。
 * 仅在生产环境注入，开发环境跳过以避免阻断 Vite HMR。
 */
function injectCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY],
      },
    })
  })
}

// ─── 窗口创建 ─────────────────────────────────────────────────────

/**
 * 获取窗口状态文件路径。
 * P1-03 完成后将迁移到 SQLite app_settings 表。
 */
function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * 创建主窗口。
 * 配置全部安全策略（Spec v0.2 §2），实现窗口状态持久化。
 */
function createWindow(): BrowserWindow {
  const statePath = getWindowStatePath()
  const savedBounds = loadWindowState(statePath)
  const bounds = savedBounds ?? DEFAULT_WINDOW_BOUNDS

  const preloadPath = join(import.meta.dirname, '../preload/index.cjs')
  console.log('[AgentForge Main] Preload path:', preloadPath)
  console.log('[AgentForge Main] Preload exists:', require('node:fs').existsSync(preloadPath))

  const mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: savedBounds ? bounds.x : undefined,
    y: savedBounds ? bounds.y : undefined,
    title: 'AgentForge',
    minWidth: 800,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  })

  // 窗口状态持久化（防抖 500ms，与 Spec v0.2 §2 一致）
  const debouncedSave = createDebouncedSaver(statePath, 500)
  const saveBounds = (): void => {
    if (mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    const [width, height] = mainWindow.getSize()
    const currentBounds: WindowBounds = {
      x,
      y,
      width,
      height,
      isMaximized: mainWindow.isMaximized(),
    }
    debouncedSave(currentBounds)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
  mainWindow.on('maximize', saveBounds)
  mainWindow.on('unmaximize', saveBounds)

  // 恢复最大化状态
  if (bounds.isMaximized) {
    mainWindow.maximize()
  }

  // 安全：外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发环境打开 DevTools
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }

  // 窗口内容就绪后显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 加载渲染进程页面
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// ─── 单实例锁 ─────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 第二个实例直接退出
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      const win = windows[0]
      if (win.isMinimized()) {
        win.restore()
      }
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // 初始化数据库（P1-03）
    initDatabase()

    // 注册所有 IPC handlers（P1-06 起）
    registerIpcHandlers()

    // 生产环境注入 CSP（开发环境跳过以支持 Vite HMR）
    if (app.isPackaged) {
      injectCsp()
    }

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // 资源清理（Spec v0.2 §2 应用生命周期与资源管理）
  app.on('before-quit', () => {
    for (const cleanup of cleanupTasks) {
      try {
        cleanup()
      } catch (error) {
        console.error('[AgentForge] Cleanup task failed:', error)
      }
    }
  })
}
