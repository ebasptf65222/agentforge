// AgentForge System 域 IPC Handlers
// 实现 P1-09b: 应用版本信息 + 外部链接打开
// 通道命名: system:get-version, system:open-external

import { ipcMain, app, shell, type IpcMainInvokeHandler } from 'electron'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 类型 ─────────────────────────────────────────────────────────

/** 版本信息（与 @renderer/types VersionInfo 一致） */
interface VersionInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
}

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

/**
 * system:open-external 允许的 URL 协议白名单。
 * 显式声明 https: 与 http: 为允许的协议，防止 file://、javascript: 等危险协议。
 */
const ALLOWED_URL_PROTOCOLS: readonly string[] = ['http:', 'https:']

/**
 * 校验 URL 是否为合法的 http/https 链接。
 * - 必须是 string
 * - 必须能被 URL 解析
 * - protocol 必须在白名单（http: / https:）中
 *
 * @param url - 待校验的 URL
 * @throws {AppError} INVALID_URL - URL 为空或协议不在白名单中
 */
function assertHttpUrl(url: unknown): asserts url is string {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new AppError(ErrorCodes.INVALID_URL, 'URL must be a non-empty string.', { url })
  }

  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new AppError(ErrorCodes.INVALID_URL, `URL is not valid: "${url}".`, { url })
  }

  if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
    throw new AppError(
      ErrorCodes.INVALID_URL,
      `URL protocol must be one of [${ALLOWED_URL_PROTOCOLS.join(', ')}], got "${parsed.protocol}".`,
      { url, protocol: parsed.protocol, allowedProtocols: [...ALLOWED_URL_PROTOCOLS] },
    )
  }
}

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * system:get-version - 返回应用及运行时版本信息。
 *
 * @returns { appVersion, electronVersion, nodeVersion, platform }
 */
export function handleGetVersion(): VersionInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
  }
}

/**
 * system:open-external - 用系统默认浏览器打开外部链接。
 * 仅允许 http/https 协议，防止 file://、javascript: 等危险协议。
 *
 * @param params - { url }
 * @throws {AppError} INVALID_URL - URL 为空或非 http/https
 */
export async function handleOpenExternal(params: unknown): Promise<void> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Open external params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertHttpUrl(p['url'])

  await shell.openExternal(p['url'].trim())
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'system:get-version', handler: () => handleGetVersion() },
  {
    channel: 'system:open-external',
    handler: (_event, params: unknown) => handleOpenExternal(params),
  },
]

/**
 * 注册 System 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerSystemHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}

// 仅为类型导出，便于测试与外部引用
export type { VersionInfo }
