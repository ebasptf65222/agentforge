import { app, BrowserWindow, shell, session, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import {
  loadWindowState,
  createDebouncedSaver,
  DEFAULT_WINDOW_BOUNDS,
  type WindowBounds,
} from './utils/window-state'
import { initDatabase, closeDatabase } from './db/index'
import { registerIpcHandlers } from './ipc/index'
import { initBuiltinTools } from './tools/registry-init'
import { getSettings } from './db/repos/app-settings'
import { setEmbeddingConfig } from './knowledge-base/embedding'

// ─── 全局未捕获错误处理 ───────────────────────────────────────────────
// 防止应用崩溃后静默退出，至少记录错误日志
process.on('uncaughtException', (error: Error) => {
  console.error('[AgentForge] Uncaught Exception:', error)
  console.error('[AgentForge] Stack:', error.stack)
})

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[AgentForge] Unhandled Rejection at:', promise)
  console.error('[AgentForge] Reason:', reason)
  if (reason instanceof Error) {
    console.error('[AgentForge] Stack:', reason.stack)
  }
})

// ─── 资源清理注册表 ───────────────────────────────────────────────
// P1-03: db.close() 已注册
// P1-08: AbortController.abort()
// P2: MCP Server 子进程关闭
const cleanupTasks: Array<() => void | Promise<void>> = []

/**
 * 注册资源清理函数，在 before-quit 时依次调用。
 * OPT-13: 支持异步清理函数（返回 Promise），退出时会 await。
 * 供后续任务注册数据库关闭、AbortController 中断、MCP Server 关闭等清理逻辑。
 */
export function registerCleanup(fn: () => void | Promise<void>): void {
  cleanupTasks.push(fn)
}

// 注册数据库关闭（P1-03）
registerCleanup(closeDatabase)

// OPT-13: 注册 MCP Server 异步清理（关闭所有子进程）
registerCleanup(async () => {
  const { getMcpServerManager } = await import('./mcp/manager')
  await getMcpServerManager().closeAll()
})

// P2-01: 注册浏览器会话清理（关闭所有隐藏 BrowserWindow）
registerCleanup(async () => {
  const { closeAllSessions } = await import('./browser')
  closeAllSessions()
})

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

// ─── 原生菜单 ─────────────────────────────────────────────────────

/**
 * 设置应用菜单。
 * - macOS: 保留最小化菜单（编辑/窗口），确保 Cmd+C/V/A/Q 等系统快捷键可用
 * - Windows/Linux: 完全移除菜单栏
 */
function setupMenu(): void {
  if (process.platform === 'darwin') {
    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about', label: `关于 ${app.name}` },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏' },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'close', label: '关闭' },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows/Linux: 完全移除原生菜单栏
    Menu.setApplicationMenu(null)
  }
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
    // macOS: 隐藏标题栏但保留交通灯按钮
    // Windows/Linux: 无边框窗口，完全自定义标题栏
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform === 'darwin',
    autoHideMenuBar: true,
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

    // 从应用设置初始化嵌入模型配置（RAG-FIX-01）
    try {
      const settings = getSettings()
      setEmbeddingConfig({
        provider: settings.embeddingProvider ?? 'ollama',
        baseUrl: settings.embeddingBaseUrl ?? 'http://localhost:11434',
        model: settings.embeddingModel ?? 'nomic-embed-text',
        apiKey: settings.embeddingApiKey,
        dimensions: settings.embeddingDimensions ?? 768,
      })
    } catch {
      // 设置读取失败时使用默认配置
    }

    // 注册所有 IPC handlers（P1-06 起）
    registerIpcHandlers()

    // 注册所有内置工具到全局 ToolRegistry（Agent 依赖此注册表获取工具）
    initBuiltinTools()

    // 设置原生菜单（隐藏菜单栏 / macOS 最小化菜单）
    setupMenu()

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
  // OPT-13: 支持异步清理（如 MCP Server 关闭需要 await closeAll）
  app.on('before-quit', async () => {
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup()
      } catch (error) {
        console.error('[AgentForge] Cleanup task failed:', error)
      }
    }
  })
}
