// AgentForge Settings 域 IPC Handlers
// 实现 P1-09b: 应用设置读取/更新
// 通道命名: settings:get, settings:update

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { AppSettings, ApprovalMode, EngineType, ShortcutConfig, VoiceConfig, WorkspaceConfig } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getSettings, updateSettings, type UpdateSettingsParams } from '../db/repos/app-settings'
import { setEmbeddingConfig } from '../knowledge-base/embedding'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

const VALID_THEMES: readonly AppSettings['theme'][] = ['dark', 'light', 'system']
const VALID_APPROVAL_MODES: readonly ApprovalMode[] = ['suggest', 'auto-edit', 'full-auto']
const VALID_ENGINE_TYPES: readonly EngineType[] = ['builtin', 'copilot-sdk']

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

function assertOptionalEngineType(value: unknown): asserts value is EngineType | undefined {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !VALID_ENGINE_TYPES.includes(value as EngineType))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid engineType: ${String(value)}. Must be one of: ${VALID_ENGINE_TYPES.join(', ')}.`,
      { engineType: value },
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

function assertOptionalVoice(value: unknown): asserts value is Partial<VoiceConfig> | undefined {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "voice" must be an object.', {
      voice: value,
    })
  }
  const obj = value as Record<string, unknown>
  const allowedKeys: ReadonlyArray<keyof VoiceConfig> = ['tts', 'stt', 'mode']
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key as keyof VoiceConfig)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Unknown voice key: "${key}". Allowed: ${allowedKeys.join(', ')}.`,
        { voice: value, key },
      )
    }
    const v = obj[key]
    if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v))) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Field "voice.${key}" must be an object.`,
        { voice: value, key, value: v },
      )
    }
  }
}

function assertOptionalWorkspace(
  value: unknown,
): asserts value is Partial<WorkspaceConfig> | undefined {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "workspace" must be an object.', {
      workspace: value,
    })
  }
  const obj = value as Record<string, unknown>
  const allowedKeys: ReadonlyArray<keyof WorkspaceConfig> = [
    'path',
    'recentPaths',
    'autoRestore',
    'excludePatterns',
  ]
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key as keyof WorkspaceConfig)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Unknown workspace key: "${key}". Allowed: ${allowedKeys.join(', ')}.`,
        { workspace: value, key },
      )
    }
  }
  // path: string | null
  if (obj['path'] !== undefined && obj['path'] !== null && typeof obj['path'] !== 'string') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "workspace.path" must be a string or null.',
      { workspace: value, key: 'path', value: obj['path'] },
    )
  }
  // recentPaths: string[]
  if (
    obj['recentPaths'] !== undefined &&
    (!Array.isArray(obj['recentPaths']) || !obj['recentPaths'].every((p) => typeof p === 'string'))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "workspace.recentPaths" must be an array of strings.',
      { workspace: value, key: 'recentPaths', value: obj['recentPaths'] },
    )
  }
  // autoRestore: boolean
  if (obj['autoRestore'] !== undefined && typeof obj['autoRestore'] !== 'boolean') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "workspace.autoRestore" must be a boolean.',
      { workspace: value, key: 'autoRestore', value: obj['autoRestore'] },
    )
  }
  // excludePatterns: string[]
  if (
    obj['excludePatterns'] !== undefined &&
    (!Array.isArray(obj['excludePatterns']) ||
      !obj['excludePatterns'].every((p) => typeof p === 'string'))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "workspace.excludePatterns" must be an array of strings.',
      { workspace: value, key: 'excludePatterns', value: obj['excludePatterns'] },
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
  assertOptionalVoice(p['voice'])
  assertOptionalWorkspace(p['workspace'])
  assertOptionalWindowBounds(p['windowBounds'])
  assertOptionalEngineType(p['engineType'])

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
    voice: p['voice'] as UpdateSettingsParams['voice'],
    workspace: p['workspace'] as UpdateSettingsParams['workspace'],
    windowBounds: p['windowBounds'] as UpdateSettingsParams['windowBounds'],
    engineType: p['engineType'] as UpdateSettingsParams['engineType'],
    // 嵌入模型配置
    embeddingProvider: p['embeddingProvider'] as UpdateSettingsParams['embeddingProvider'],
    embeddingBaseUrl: p['embeddingBaseUrl'] as UpdateSettingsParams['embeddingBaseUrl'],
    embeddingModel: p['embeddingModel'] as UpdateSettingsParams['embeddingModel'],
    embeddingApiKey: p['embeddingApiKey'] as UpdateSettingsParams['embeddingApiKey'],
    embeddingDimensions: p['embeddingDimensions'] as UpdateSettingsParams['embeddingDimensions'],
  }

  updateSettings(updateParams)

  // 如果嵌入配置有变更，实时更新运行时配置
  const embeddingChanged =
    p['embeddingProvider'] !== undefined ||
    p['embeddingBaseUrl'] !== undefined ||
    p['embeddingModel'] !== undefined ||
    p['embeddingApiKey'] !== undefined ||
    p['embeddingDimensions'] !== undefined

  if (embeddingChanged) {
    const freshSettings = getSettings()
    setEmbeddingConfig({
      provider: freshSettings.embeddingProvider ?? 'ollama',
      baseUrl: freshSettings.embeddingBaseUrl ?? 'http://localhost:11434',
      model: freshSettings.embeddingModel ?? 'nomic-embed-text',
      apiKey: freshSettings.embeddingApiKey,
      dimensions: freshSettings.embeddingDimensions ?? 768,
    })
  }
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
