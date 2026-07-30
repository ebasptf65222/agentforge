// AgentForge File 域 IPC Handlers
// 实现 P1-09b: 目录/文件选择对话框
// 通道命名: file:select-dir, file:select-file

import {
  ipcMain,
  dialog,
  BrowserWindow,
  type IpcMainInvokeHandler,
  type OpenDialogOptions,
  type FileFilter,
} from 'electron'
import { AppError, ErrorCodes } from '../utils/error'
import { validateOptionalString } from '../utils/ipc-validator'

// ─── 参数类型 ─────────────────────────────────────────────────────

interface SelectDirParams {
  title?: string
  defaultPath?: string
}

interface SelectFileParams {
  title?: string
  defaultPath?: string
  filters?: FileFilter[]
}

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

function validateOptionalFilters(value: unknown): FileFilter[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "filters" must be an array.', {
      filters: value,
    })
  }
  for (const f of value) {
    if (
      f === null ||
      typeof f !== 'object' ||
      typeof f['name'] !== 'string' ||
      !Array.isArray(f['extensions']) ||
      !f['extensions'].every((e: unknown) => typeof e === 'string')
    ) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Each filter must be { name: string, extensions: string[] }.',
        { filters: value },
      )
    }
  }
  return value as FileFilter[]
}

// ─── 主窗口辅助 ───────────────────────────────────────────────────

/**
 * 获取主窗口，用于作为 dialog 的 parent。
 * 若无窗口则返回 undefined（dialog 将以无 parent 模式打开）。
 */
function getMainWindow(): BrowserWindow | undefined {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return undefined
  const win = windows[0]
  if (win.isDestroyed()) return undefined
  return win
}

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * file:select-dir - 弹出目录选择对话框。
 *
 * @param params - { title?, defaultPath? }
 * @returns 选中的目录路径，或 null（取消选择）
 */
export async function handleSelectDir(params: unknown): Promise<string | null> {
  // params can be undefined for file:select-dir (no required fields)
  const p = (params ?? {}) as Record<string, unknown>
  if (
    params !== undefined &&
    (params === null || typeof params !== 'object' || Array.isArray(params))
  ) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Select dir params must be an object.')
  }

  const title = validateOptionalString(p['title'], 'title')
  const defaultPath = validateOptionalString(p['defaultPath'], 'defaultPath')

  const opts: OpenDialogOptions = {
    properties: ['openDirectory'],
  }
  if (title) opts.title = title
  if (defaultPath) opts.defaultPath = defaultPath

  const parentWindow = getMainWindow()
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, opts)
    : await dialog.showOpenDialog(opts)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0] ?? null
}

/**
 * file:select-file - 弹出文件选择对话框。
 *
 * @param params - { title?, defaultPath?, filters? }
 * @returns 选中的文件路径，或 null（取消选择）
 */
export async function handleSelectFile(params: unknown): Promise<string | null> {
  // params can be undefined for file:select-file (no required fields)
  const p = (params ?? {}) as Record<string, unknown>
  if (
    params !== undefined &&
    (params === null || typeof params !== 'object' || Array.isArray(params))
  ) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Select file params must be an object.')
  }

  const title = validateOptionalString(p['title'], 'title')
  const defaultPath = validateOptionalString(p['defaultPath'], 'defaultPath')
  const filters = validateOptionalFilters(p['filters'])

  const opts: OpenDialogOptions = {
    properties: ['openFile'],
  }
  if (title) opts.title = title
  if (defaultPath) opts.defaultPath = defaultPath
  if (filters) opts.filters = filters

  const parentWindow = getMainWindow()
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, opts)
    : await dialog.showOpenDialog(opts)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0] ?? null
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'file:select-dir',
    handler: (_event, params: unknown) => handleSelectDir(params),
  },
  {
    channel: 'file:select-file',
    handler: (_event, params: unknown) => handleSelectFile(params),
  },
]

/**
 * 注册 File 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerFileHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}

// 仅为类型导出，便于测试构造参数
export type { SelectDirParams, SelectFileParams }
