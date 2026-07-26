// AgentForge Settings 域 IPC Handlers
// 实现 P1-09b: 应用设置读取/更新
// 通道命名: settings:get, settings:update

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { AppSettings, ApprovalMode, ShortcutConfig } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getSettings, updateSettings, type UpdateSettingsParams } from '../db/repos/app-settings'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

const VALID_THEMES: readonly AppSettings['theme'][] = ['dark', 'light', 'system']
const VALID_APPROVAL_MODES: readonly ApprovalMode[] = ['suggest', 'auto-edit', 'full-auto']

function assertOptionalTheme(value: unknown): asserts value is AppSettings['theme'] | undefined {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !VALID_THEMES.includes(value as AppSettings['theme']))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid theme: ${String(value)}. Must be one of: ${VALID_THEMES.join(', ')}.`,
      { theme: value },
    )
  }
}

function assertOptionalApprovalMode(value: unknown): asserts value is ApprovalMode | undefined {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !VALID_APPROVAL_MODES.includes(value as ApprovalMode))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid defaultApprovalMode: ${String(value)}. Must be one of: ${VALID_APPROVAL_MODES.join(', ')}.`,
      { defaultApprovalMode: value },
    )
  }
}

function assertOptionalNumber(value: unknown, field: string): asserts value is number | undefined {
  if (value !== undefined && typeof value !== 'number') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `Field "${field}" must be a number.`, {
      field,
      value,
    })
  }
}

function assertOptionalStringOrNull(
  value: unknown,
  field: string,
): asserts value is string | null | undefined {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim() === '')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string or null.`,
      { field, value },
    )
  }
}

function assertOptionalShortcuts(
  value: unknown,
): asserts value is Partial<ShortcutConfig> | undefined {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "shortcuts" must be an object.', {
      shortcuts: value,
    })
  }
  const obj = value as Record<string, unknown>
  const allowedKeys: ReadonlyArray<keyof ShortcutConfig> = [
    'newConversation',
    'sendMessage',
    'stopGeneration',
    'toggleSidebar',
  ]
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key as keyof ShortcutConfig)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Unknown shortcut key: "${key}". Allowed: ${allowedKeys.join(', ')}.`,
        { shortcuts: value, key },
      )
    }
    const v = obj[key]
    if (typeof v !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Shortcut "${key}" must be a string.`, {
        shortcuts: value,
        key,
        value: v,
      })
    }
  }
}

function assertOptionalWindowBounds(
  value: unknown,
): asserts value is
  { x: number; y: number; width: number; height: number; isMaximized: boolean } | null | undefined {
  if (value === undefined || value === null) return
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "windowBounds" must be an object.', {
      windowBounds: value,
    })
  }
  const obj = value as Record<string, unknown>
  const requiredKeys = ['x', 'y', 'width', 'height', 'isMaximized'] as const
  for (const key of requiredKeys) {
    if (!(key in obj)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Field "windowBounds.${key}" is required.`, {
        windowBounds: value,
        missing: key,
      })
    }
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof obj[key] !== 'number') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Field "windowBounds.${key}" must be a number.`,
        { windowBounds: value, key, value: obj[key] },
      )
    }
  }
  if (typeof obj['isMaximized'] !== 'boolean') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "windowBounds.isMaximized" must be a boolean.',
      { windowBounds: value, value: obj['isMaximized'] },
    )
  }
}

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * settings:get - 读取应用设置。
 *
 * @returns AppSettings 实体
 */
export function handleGetSettings(): AppSettings {
  return getSettings()
}

/**
 * settings:update - 更新应用设置（仅更新提供的字段）。
 *
 * @param params - 部分字段（与 AppSettings 字段名一致，排除 updatedAt）
 */
export function handleUpdateSettings(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Update settings params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertOptionalTheme(p['theme'])
  assertOptionalApprovalMode(p['defaultApprovalMode'])
  assertOptionalNumber(p['maxExecutionSteps'], 'maxExecutionSteps')
  assertOptionalStringOrNull(p['defaultModelId'], 'defaultModelId')
  assertOptionalShortcuts(p['shortcuts'])
  assertOptionalNumber(p['approvalTimeoutMs'], 'approvalTimeoutMs')
  assertOptionalWindowBounds(p['windowBounds'])

  // updatedAt 字段不允许外部覆盖
  if (p['updatedAt'] !== undefined) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "updatedAt" is managed internally and cannot be set.',
      { updatedAt: p['updatedAt'] },
    )
  }

  const updateParams: UpdateSettingsParams = {
    theme: p['theme'] as UpdateSettingsParams['theme'],
    defaultApprovalMode: p['defaultApprovalMode'] as UpdateSettingsParams['defaultApprovalMode'],
    maxExecutionSteps: p['maxExecutionSteps'] as UpdateSettingsParams['maxExecutionSteps'],
    defaultModelId: p['defaultModelId'] as UpdateSettingsParams['defaultModelId'],
    shortcuts: p['shortcuts'] as UpdateSettingsParams['shortcuts'],
    approvalTimeoutMs: p['approvalTimeoutMs'] as UpdateSettingsParams['approvalTimeoutMs'],
    windowBounds: p['windowBounds'] as UpdateSettingsParams['windowBounds'],
  }

  updateSettings(updateParams)
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'settings:get', handler: () => handleGetSettings() },
  {
    channel: 'settings:update',
    handler: (_event, params: unknown) => handleUpdateSettings(params),
  },
]

/**
 * 注册 Settings 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerSettingsHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
