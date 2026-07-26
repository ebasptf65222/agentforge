// AgentForge app_settings 表数据访问层（Repository）
// 实现 P1-09b: 应用设置 get/update
// 与 Spec v0.2 §6.6 表结构一致

import type Database from 'better-sqlite3'
import type { AppSettings, ApprovalMode, ShortcutConfig, VoiceConfig } from '@shared/types'
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
    .prepare('SELECT id, shortcuts, voice FROM app_settings WHERE id = 1')
    .get() as
    { id: number; shortcuts: string; voice: string } | undefined

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

  if (params.windowBounds !== undefined) {
    setClauses.push('window_bounds = ?')
    values.push(params.windowBounds === null ? null : JSON.stringify(params.windowBounds))
  }

  db.prepare(`UPDATE app_settings SET ${setClauses.join(', ')} WHERE id = 1`).run(...values)
}
