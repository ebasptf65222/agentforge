// AgentForge Settings 域 IPC Handlers
// 实现 P1-09b: 应用设置读取/更新
// 通道命名: settings:get, settings:update

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { AppSettings, ApprovalMode, EngineType, ShortcutConfig, VideoProvider, VoiceConfig, WorkspaceConfig } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getSettings, updateSettings, type UpdateSettingsParams } from '../db/repos/app-settings'
import { setEmbeddingConfig } from '../knowledge-base/embedding'
import { encryptApiKey } from '../utils/encryption'
import {
  ensureParamsObject,
  validateOptionalEnum,
  validateOptionalNumber,
  validateOptionalStringOrNull,
} from '../utils/ipc-validator'

// ─── 常量 ─────────────────────────────────────────────────────────

const VALID_THEMES: readonly AppSettings['theme'][] = ['dark', 'light', 'system']
const VALID_APPROVAL_MODES: readonly ApprovalMode[] = ['suggest', 'auto-edit', 'full-auto']
const VALID_ENGINE_TYPES: readonly EngineType[] = ['code', 'work']
const VALID_VIDEO_PROVIDERS: readonly VideoProvider[] = ['seedance', 'kling', 'custom']
const VALID_VIDEO_PROTOCOLS: readonly NonNullable<
  UpdateSettingsParams['videoCustomProtocol']
>[] = ['ark', 'kling', 'openai']

/**
 * 视频厂商 API Key 落库前使用 safeStorage 加密（与模型 API Key 存储策略一致），
 * 引擎读取时经 decryptApiKey 解密。undefined/null 原样透传（null 表示清除）。
 */
function encryptOptionalVideoApiKey(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value
  return encryptApiKey(value)
}

// ─── 复杂嵌套校验（保留为本地函数） ──────────────────────────────

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
  const p = ensureParamsObject(params, 'settings:update')

  validateOptionalEnum(p['theme'], 'theme', VALID_THEMES)
  validateOptionalEnum(p['defaultApprovalMode'], 'defaultApprovalMode', VALID_APPROVAL_MODES)
  validateOptionalNumber(p['maxExecutionSteps'], 'maxExecutionSteps')
  validateOptionalStringOrNull(p['defaultModelId'], 'defaultModelId')
  assertOptionalShortcuts(p['shortcuts'])
  validateOptionalNumber(p['approvalTimeoutMs'], 'approvalTimeoutMs')
  assertOptionalVoice(p['voice'])
  assertOptionalWorkspace(p['workspace'])
  assertOptionalWindowBounds(p['windowBounds'])
  validateOptionalEnum(p['engineType'], 'engineType', VALID_ENGINE_TYPES)

  // 视频生成配置（M4 多厂商）
  validateOptionalEnum(p['videoProvider'], 'videoProvider', VALID_VIDEO_PROVIDERS)
  validateOptionalStringOrNull(p['videoApiKey'], 'videoApiKey')
  validateOptionalStringOrNull(p['videoBaseUrl'], 'videoBaseUrl')
  validateOptionalStringOrNull(p['videoModel'], 'videoModel')
  validateOptionalNumber(p['videoMaxDuration'], 'videoMaxDuration', 4, 15)
  validateOptionalStringOrNull(p['videoKlingApiKey'], 'videoKlingApiKey')
  validateOptionalStringOrNull(p['videoKlingBaseUrl'], 'videoKlingBaseUrl')
  validateOptionalStringOrNull(p['videoKlingModel'], 'videoKlingModel')
  validateOptionalStringOrNull(p['videoCustomApiKey'], 'videoCustomApiKey')
  validateOptionalStringOrNull(p['videoCustomBaseUrl'], 'videoCustomBaseUrl')
  validateOptionalStringOrNull(p['videoCustomModel'], 'videoCustomModel')
  validateOptionalEnum(p['videoCustomProtocol'], 'videoCustomProtocol', VALID_VIDEO_PROTOCOLS)

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
    // Copilot SDK 配置
    copilotReasoningEffort: p['copilotReasoningEffort'] as UpdateSettingsParams['copilotReasoningEffort'],
    copilotWireApi: p['copilotWireApi'] as UpdateSettingsParams['copilotWireApi'],
    copilotSkillDirectories: p['copilotSkillDirectories'] as UpdateSettingsParams['copilotSkillDirectories'],
    copilotEnableConfigDiscovery: p['copilotEnableConfigDiscovery'] as UpdateSettingsParams['copilotEnableConfigDiscovery'],
    copilotContextTier: p['copilotContextTier'] as UpdateSettingsParams['copilotContextTier'],
    copilotReasoningSummary: p['copilotReasoningSummary'] as UpdateSettingsParams['copilotReasoningSummary'],
    copilotExcludedTools: p['copilotExcludedTools'] as UpdateSettingsParams['copilotExcludedTools'],
    copilotEnableHostGitOperations: p['copilotEnableHostGitOperations'] as UpdateSettingsParams['copilotEnableHostGitOperations'],
    copilotToolSearchDeferThreshold: p['copilotToolSearchDeferThreshold'] as UpdateSettingsParams['copilotToolSearchDeferThreshold'],
    copilotDefaultAgentExcludedTools: p['copilotDefaultAgentExcludedTools'] as UpdateSettingsParams['copilotDefaultAgentExcludedTools'],
    copilotPluginDirectories: p['copilotPluginDirectories'] as UpdateSettingsParams['copilotPluginDirectories'],
    copilotInstructionDirectories: p['copilotInstructionDirectories'] as UpdateSettingsParams['copilotInstructionDirectories'],
    copilotEnableMemory: p['copilotEnableMemory'] as UpdateSettingsParams['copilotEnableMemory'],
    copilotSkipCustomInstructions: p['copilotSkipCustomInstructions'] as UpdateSettingsParams['copilotSkipCustomInstructions'],
    copilotEnableAskUser: p['copilotEnableAskUser'] as UpdateSettingsParams['copilotEnableAskUser'],
    copilotEnableElicitation: p['copilotEnableElicitation'] as UpdateSettingsParams['copilotEnableElicitation'],
    copilotAgentMode: p['copilotAgentMode'] as UpdateSettingsParams['copilotAgentMode'],
    copilotMaxPromptTokens: p['copilotMaxPromptTokens'] as UpdateSettingsParams['copilotMaxPromptTokens'],
    copilotExcludedBuiltinAgents: p['copilotExcludedBuiltinAgents'] as UpdateSettingsParams['copilotExcludedBuiltinAgents'],
    copilotEnableSkills: p['copilotEnableSkills'] as UpdateSettingsParams['copilotEnableSkills'],
    copilotDisabledSkills: p['copilotDisabledSkills'] as UpdateSettingsParams['copilotDisabledSkills'],
    copilotInfiniteSessionThreshold: p['copilotInfiniteSessionThreshold'] as UpdateSettingsParams['copilotInfiniteSessionThreshold'],
    copilotLargeOutputMaxSize: p['copilotLargeOutputMaxSize'] as UpdateSettingsParams['copilotLargeOutputMaxSize'],
    // 视频生成配置（API Key 落库前加密）
    videoProvider: p['videoProvider'] as UpdateSettingsParams['videoProvider'],
    videoApiKey: encryptOptionalVideoApiKey(
      p['videoApiKey'] as UpdateSettingsParams['videoApiKey'],
    ),
    videoBaseUrl: p['videoBaseUrl'] as UpdateSettingsParams['videoBaseUrl'],
    videoModel: p['videoModel'] as UpdateSettingsParams['videoModel'],
    videoMaxDuration: p['videoMaxDuration'] as UpdateSettingsParams['videoMaxDuration'],
    videoKlingApiKey: encryptOptionalVideoApiKey(
      p['videoKlingApiKey'] as UpdateSettingsParams['videoKlingApiKey'],
    ),
    videoKlingBaseUrl: p['videoKlingBaseUrl'] as UpdateSettingsParams['videoKlingBaseUrl'],
    videoKlingModel: p['videoKlingModel'] as UpdateSettingsParams['videoKlingModel'],
    videoCustomApiKey: encryptOptionalVideoApiKey(
      p['videoCustomApiKey'] as UpdateSettingsParams['videoCustomApiKey'],
    ),
    videoCustomBaseUrl: p['videoCustomBaseUrl'] as UpdateSettingsParams['videoCustomBaseUrl'],
    videoCustomModel: p['videoCustomModel'] as UpdateSettingsParams['videoCustomModel'],
    videoCustomProtocol: p['videoCustomProtocol'] as UpdateSettingsParams['videoCustomProtocol'],
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
