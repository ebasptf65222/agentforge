// AgentForge app_settings 表数据访问层（Repository）
// 实现 P1-09b: 应用设置 get/update
// 与 Spec v0.2 §6.6 表结构一致

import type Database from 'better-sqlite3'
import type { AppSettings, ApprovalMode, EngineType, ShortcutConfig, VoiceConfig, WorkspaceConfig } from '@shared/types'
import type { ReasoningEffort, WireApiMode } from '../../copilot/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'

/**
 * SQLite 行类型（数据库存储格式）。
 * - shortcuts: TEXT (JSON 字符串)
 * - window_bounds: TEXT (JSON 字符串，可为 NULL)
 * - voice: TEXT (JSON 字符串)
 * - default_model_id: TEXT (可为 NULL)
 */
interface AppSettingsRow {
  id: number
  theme: string
  default_approval_mode: string
  max_execution_steps: number
  default_model_id: string | null
  shortcuts: string
  approval_timeout_ms: number
  voice: string
  workspace: string
  engine_type: string
  copilot_reasoning_effort: string | null
  copilot_wire_api: string | null
  copilot_skill_directories: string | null
  copilot_enable_config_discovery: number
  window_bounds: string | null
  updated_at: number
}

/**
 * 默认快捷键配置（与 schema.sql 中的 DEFAULT 一致）。
 */
const DEFAULT_SHORTCUTS: ShortcutConfig = {
  newConversation: 'CmdOrCtrl+N',
  sendMessage: 'Enter',
  stopGeneration: 'CmdOrCtrl+.',
  toggleSidebar: 'CmdOrCtrl+B',
}

/**
 * 默认语音配置（与 schema.sql 中的 DEFAULT 一致）。
 */
const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  tts: {
    enabled: false,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1.0,
    format: 'mp3',
    autoPlay: false,
  },
  stt: {
    enabled: false,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    language: '',
    temperature: 0.0,
  },
  mode: {
    vadSilenceThreshold: 1.5,
    autoAwait: true,
  },
}

/**
 * 默认工作区配置（与 schema.sql 中的 DEFAULT 一致）。
 */
const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  path: null,
  recentPaths: [],
  autoRestore: true,
  excludePatterns: ['node_modules', '.git', 'dist', '.DS_Store'],
}

/**
 * 默认引擎类型（与 schema.sql 中的 DEFAULT 一致）。
 */
const DEFAULT_ENGINE_TYPE: EngineType = 'builtin'

/**
 * 默认 wire API 模式（'auto' 表示根据模型类型自动判断）。
 */
const DEFAULT_COPILOT_WIRE_API: WireApiMode = 'auto'

/**
 * 窗口边界类型（与 @shared/types AppSettings.windowBounds 一致）。
 */
interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

/**
 * updateSettings 支持的部分字段类型。
 * 字段名与 AppSettings 一致（camelCase），windowBounds 可传 undefined 表示清空。
 */
export interface UpdateSettingsParams {
  theme?: 'dark' | 'light' | 'system'
  defaultApprovalMode?: ApprovalMode
  maxExecutionSteps?: number
  defaultModelId?: string | null
  shortcuts?: Partial<ShortcutConfig>
  approvalTimeoutMs?: number
  voice?: Partial<VoiceConfig> | VoiceConfig
  workspace?: Partial<WorkspaceConfig> | WorkspaceConfig
  engineType?: EngineType
  copilotReasoningEffort?: ReasoningEffort | null
  copilotWireApi?: WireApiMode | null
  copilotSkillDirectories?: string[] | null
  copilotEnableConfigDiscovery?: boolean
  windowBounds?: WindowBounds | null
}

/**
 * 将数据库行转换为 AppSettings 实体。
 *
 * @param row - 数据库行
 * @returns AppSettings 实体
 */
function rowToSettings(row: AppSettingsRow): AppSettings {
  let shortcuts: ShortcutConfig
  try {
    const parsed = JSON.parse(row.shortcuts) as Partial<ShortcutConfig>
    shortcuts = { ...DEFAULT_SHORTCUTS, ...parsed }
  } catch {
    shortcuts = { ...DEFAULT_SHORTCUTS }
  }

  let voice: VoiceConfig
  try {
    const parsed = JSON.parse(row.voice) as Partial<VoiceConfig>
    voice = deepMergeVoiceConfig(DEFAULT_VOICE_CONFIG, parsed)
  } catch {
    voice = { ...DEFAULT_VOICE_CONFIG }
  }

  let workspace: WorkspaceConfig
  try {
    const parsed = JSON.parse(row.workspace) as Partial<WorkspaceConfig>
    workspace = mergeWorkspaceConfig(DEFAULT_WORKSPACE_CONFIG, parsed)
  } catch {
    workspace = { ...DEFAULT_WORKSPACE_CONFIG }
  }

  let windowBounds: WindowBounds | undefined
  if (row.window_bounds !== null) {
    try {
      windowBounds = JSON.parse(row.window_bounds) as WindowBounds
    } catch {
      windowBounds = undefined
    }
  }

  return {
    theme: row.theme as AppSettings['theme'],
    defaultApprovalMode: row.default_approval_mode as ApprovalMode,
    maxExecutionSteps: row.max_execution_steps,
    defaultModelId: row.default_model_id,
    shortcuts,
    approvalTimeoutMs: row.approval_timeout_ms,
    voice,
    workspace,
    engineType: (row.engine_type || DEFAULT_ENGINE_TYPE) as EngineType,
    copilotReasoningEffort: (row.copilot_reasoning_effort ?? undefined) as ReasoningEffort | undefined,
    copilotWireApi: (row.copilot_wire_api ?? DEFAULT_COPILOT_WIRE_API) as WireApiMode,
    copilotSkillDirectories: row.copilot_skill_directories
      ? (JSON.parse(row.copilot_skill_directories) as string[])
      : undefined,
    copilotEnableConfigDiscovery: row.copilot_enable_config_discovery === 1,
    windowBounds,
    updatedAt: row.updated_at,
  }
}

/**
 * 深度合并语音配置（只合并存在的字段，保留默认值的结构）。
 */
function deepMergeVoiceConfig(
  base: VoiceConfig,
  partial: Partial<VoiceConfig>,
): VoiceConfig {
  const result: VoiceConfig = JSON.parse(JSON.stringify(base))
  if (partial.tts) {
    result.tts = { ...result.tts, ...partial.tts }
  }
  if (partial.stt) {
    result.stt = { ...result.stt, ...partial.stt }
  }
  if (partial.mode) {
    result.mode = { ...result.mode, ...partial.mode }
  }
  return result
}

/**
 * 合并工作区配置。
 * - 当 path 变更为新的非 null 值时，自动将新路径加入 recentPaths（去重、截断到 10 条）
 * - 允许显式传入 recentPaths 覆盖自动管理的结果
 */
function mergeWorkspaceConfig(
  base: WorkspaceConfig,
  partial: Partial<WorkspaceConfig>,
): WorkspaceConfig {
  const result: WorkspaceConfig = { ...base }

  // 处理 path 变更
  if (partial.path !== undefined) {
    const newPath = partial.path
    // path 变更为新的非 null 值时，自动维护 recentPaths
    if (newPath !== null && newPath !== base.path) {
      result.recentPaths = [
        newPath,
        ...base.recentPaths.filter((p) => p !== newPath),
      ].slice(0, 10)
    }
    result.path = newPath
  }

  // 允许显式传入 recentPaths 覆盖（极少使用）
  if (partial.recentPaths !== undefined) {
    result.recentPaths = partial.recentPaths
  }

  if (partial.autoRestore !== undefined) {
    result.autoRestore = partial.autoRestore
  }

  if (partial.excludePatterns !== undefined) {
    result.excludePatterns = partial.excludePatterns
  }

  return result
}

/**
 * 读取应用设置（id=1 的单行）。
 *
 * @returns AppSettings 实体
 * @throws {AppError} SETTINGS_NOT_FOUND - app_settings 表中未找到 id=1 的行
 */
export function getSettings(): AppSettings {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as
    AppSettingsRow | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.SETTINGS_NOT_FOUND,
      'App settings row (id=1) not found. Database may be corrupted.',
      { id: 1 },
    )
  }

  return rowToSettings(row)
}

/**
 * 更新应用设置（仅更新提供的字段）。
 *
 * - 仅 UPDATE 提供的字段
 * - shortcuts 为对象时与现有值合并后 JSON.stringify
 * - windowBounds 为对象时 JSON.stringify；为 null 时写 NULL；为 undefined 时不更新
 * - defaultModelId 为 string 时写入；为 null 时写 NULL；为 undefined 时不更新
 * - 始终更新 updated_at = Date.now()
 *
 * @param params - 部分字段
 * @throws {AppError} SETTINGS_NOT_FOUND - app_settings 表中未找到 id=1 的行
 */
export function updateSettings(params: UpdateSettingsParams): void {
  const db: Database.Database = getDatabase()

  // 确认 id=1 的行存在
  const existing = db
    .prepare('SELECT id, shortcuts, voice, workspace FROM app_settings WHERE id = 1')
    .get() as
    { id: number; shortcuts: string; voice: string; workspace: string } | undefined

  if (existing === undefined) {
    throw new AppError(
      ErrorCodes.SETTINGS_NOT_FOUND,
      'App settings row (id=1) not found. Database may be corrupted.',
      { id: 1 },
    )
  }

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: Array<string | number | null> = [now]

  if (params.theme !== undefined) {
    setClauses.push('theme = ?')
    values.push(params.theme)
  }

  if (params.defaultApprovalMode !== undefined) {
    setClauses.push('default_approval_mode = ?')
    values.push(params.defaultApprovalMode)
  }

  if (params.maxExecutionSteps !== undefined) {
    setClauses.push('max_execution_steps = ?')
    values.push(params.maxExecutionSteps)
  }

  if (params.defaultModelId !== undefined) {
    setClauses.push('default_model_id = ?')
    values.push(params.defaultModelId)
  }

  if (params.shortcuts !== undefined) {
    // 合并现有 shortcuts 与新提供的部分
    let currentShortcuts: ShortcutConfig = { ...DEFAULT_SHORTCUTS }
    try {
      const parsed = JSON.parse(existing.shortcuts) as Partial<ShortcutConfig>
      currentShortcuts = { ...DEFAULT_SHORTCUTS, ...parsed }
    } catch {
      // 使用默认值
    }
    const merged: ShortcutConfig = { ...currentShortcuts, ...params.shortcuts }
    setClauses.push('shortcuts = ?')
    values.push(JSON.stringify(merged))
  }

  if (params.approvalTimeoutMs !== undefined) {
    setClauses.push('approval_timeout_ms = ?')
    values.push(params.approvalTimeoutMs)
  }

  if (params.voice !== undefined) {
    // 合并现有 voice 配置与新提供的部分
    let currentVoice: VoiceConfig = { ...DEFAULT_VOICE_CONFIG }
    try {
      const parsed = JSON.parse(existing.voice) as Partial<VoiceConfig>
      currentVoice = deepMergeVoiceConfig(DEFAULT_VOICE_CONFIG, parsed)
    } catch {
      // 使用默认值
    }
    const merged: VoiceConfig = deepMergeVoiceConfig(currentVoice, params.voice)
    setClauses.push('voice = ?')
    values.push(JSON.stringify(merged))
  }

  if (params.workspace !== undefined) {
    // 合并现有 workspace 配置与新提供的部分
    let currentWorkspace: WorkspaceConfig = { ...DEFAULT_WORKSPACE_CONFIG }
    try {
      const parsed = JSON.parse(existing.workspace) as Partial<WorkspaceConfig>
      currentWorkspace = mergeWorkspaceConfig(DEFAULT_WORKSPACE_CONFIG, parsed)
    } catch {
      // 使用默认值
    }
    const merged: WorkspaceConfig = mergeWorkspaceConfig(currentWorkspace, params.workspace)
    setClauses.push('workspace = ?')
    values.push(JSON.stringify(merged))
  }

  if (params.windowBounds !== undefined) {
    setClauses.push('window_bounds = ?')
    values.push(params.windowBounds === null ? null : JSON.stringify(params.windowBounds))
  }

  if (params.engineType !== undefined) {
    setClauses.push('engine_type = ?')
    values.push(params.engineType)
  }

  if (params.copilotReasoningEffort !== undefined) {
    setClauses.push('copilot_reasoning_effort = ?')
    // null 表示清除设置（使用 SDK 默认）
    values.push(params.copilotReasoningEffort === null ? null : params.copilotReasoningEffort)
  }

  if (params.copilotWireApi !== undefined) {
    setClauses.push('copilot_wire_api = ?')
    // null 表示清除设置（回退到 'auto' 自动判断）
    values.push(params.copilotWireApi === null ? null : params.copilotWireApi)
  }

  if (params.copilotSkillDirectories !== undefined) {
    setClauses.push('copilot_skill_directories = ?')
    // null 表示清除配置；数组序列化为 JSON
    values.push(
      params.copilotSkillDirectories === null
        ? null
        : JSON.stringify(params.copilotSkillDirectories),
    )
  }

  if (params.copilotEnableConfigDiscovery !== undefined) {
    setClauses.push('copilot_enable_config_discovery = ?')
    values.push(params.copilotEnableConfigDiscovery ? 1 : 0)
  }

  db.prepare(`UPDATE app_settings SET ${setClauses.join(', ')} WHERE id = 1`).run(...values)
}
