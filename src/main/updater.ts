// AgentForge 自动更新模块（electron-updater + GitHub Releases）
// - 生产环境（app.isPackaged）：启动时自动检查更新，发现新版本后台自动下载
// - 下载完成后广播状态，用户可在「通用设置 → 软件更新」中一键安装重启
// - 状态通过 system:update-state 通道广播给渲染进程

import { autoUpdater } from 'electron-updater'
import { BrowserWindow, app } from 'electron'

// ─── 类型 ─────────────────────────────────────────────────────────

/** 更新状态（与 @renderer/types UpdateState 一致） */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes: string }
  | { status: 'not-available'; version: string }
  | {
      status: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

/** electron-updater 的 UpdateInfo 中用到的最小字段（releaseNotes 可能是 string 或分段数组） */
interface UpdateInfoLike {
  version?: string
  releaseNotes?: unknown
}

/** ProgressInfo 最小字段 */
interface ProgressInfoLike {
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
}

// ─── 内部状态 ─────────────────────────────────────────────────────

let currentState: UpdateState = { status: 'idle' }
let initialized = false

/** 获取当前更新状态（供 system:get-update-state 查询） */
export function getUpdateState(): UpdateState {
  return currentState
}

/** 规范化 releaseNotes（GitHub Provider 可能返回 string 或 [{note}] 数组） */
function normalizeReleaseNotes(notes: unknown): string {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((item) => {
        if (item && typeof item === 'object' && 'note' in item) {
          const note = (item as { note?: unknown }).note
          return typeof note === 'string' ? note : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 将状态缓存并广播到所有窗口 */
function setState(state: UpdateState): void {
  currentState = state
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('system:update-state', state)
    }
  }
}

/** 将未知错误转换为可读消息 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// ─── 初始化 ───────────────────────────────────────────────────────

/**
 * 初始化自动更新。
 * 仅在生产环境生效；开发环境下 checkForUpdates 需要 dev-app-update.yml，
 * 因此开发环境不挂载自动检查（手动检查会返回明确的错误提示）。
 * 应在 app.whenReady() 之后调用。
 */
export function initUpdater(): void {
  if (!app.isPackaged || initialized) return
  initialized = true

  // 发现新版本后自动后台下载，下载完成后由用户确认安装
  autoUpdater.autoDownload = true
  // 用户跳过安装时，退出应用时自动安装
  autoUpdater.autoInstallOnAppQuit = true
  // 不消费预发布版本（prerelease tag 的 Release）
  autoUpdater.allowPrerelease = false
  // 禁用降级：服务器版本号不高于本地时视为无更新
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const updateInfo = info as UpdateInfoLike
    setState({
      status: 'available',
      version: updateInfo.version ?? 'unknown',
      releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes),
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    const updateInfo = info as UpdateInfoLike
    setState({
      status: 'not-available',
      version: updateInfo.version ?? app.getVersion(),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const p = progress as ProgressInfoLike
    setState({
      status: 'downloading',
      percent: Math.min(100, Math.max(0, p.percent ?? 0)),
      bytesPerSecond: p.bytesPerSecond ?? 0,
      transferred: p.transferred ?? 0,
      total: p.total ?? 0,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const updateInfo = info as UpdateInfoLike
    setState({
      status: 'downloaded',
      version: updateInfo.version ?? 'unknown',
    })
  })

  autoUpdater.on('error', (error) => {
    setState({ status: 'error', message: toErrorMessage(error) })
  })

  // 启动时静默检查一次（失败不影响应用启动）
  void autoUpdater.checkForUpdates().catch((error) => {
    console.warn('[AgentForge Updater] Startup update check failed:', toErrorMessage(error))
  })
}

// ─── 手动操作（IPC 调用） ─────────────────────────────────────────

/**
 * 手动检查更新。开发环境直接返回错误状态，不发网络请求。
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    const state: UpdateState = {
      status: 'error',
      message: '开发环境不支持检查更新（仅打包后可用）',
    }
    setState(state)
    return state
  }
  if (!initialized) initUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // error 事件已广播状态，这里兜底返回
    setState({ status: 'error', message: toErrorMessage(error) })
  }
  return currentState
}

/**
 * 手动触发下载（autoDownload 开启时通常不会用到，作为兜底入口）。
 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) {
    const state: UpdateState = {
      status: 'error',
      message: '开发环境不支持下载更新（仅打包后可用）',
    }
    setState(state)
    return state
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setState({ status: 'error', message: toErrorMessage(error) })
  }
  return currentState
}

/**
 * 退出并安装已下载的更新。
 */
export function installUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall(false, true)
}
