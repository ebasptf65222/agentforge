// AgentForge model_configs 表的数据访问层（Repository）
// 实现 P1-06: 模型配置 CRUD
// 与 Spec v0.2 §6.5 表结构一致

import type Database from 'better-sqlite3'
import type { ModelConfig, ModelCapabilities, ModelProvider } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'
import { encryptApiKey, decryptApiKey } from '../../utils/encryption'

/**
 * SQLite 行类型（数据库存储格式）。
 * - is_default: INTEGER (0/1)
 * - capabilities: TEXT (JSON 字符串)
 * - api_key: TEXT (加密后的 Base64 字符串)
 */
interface ModelConfigRow {
  id: string
  name: string
  provider: string
  model_id: string
  api_key: string
  base_url: string | null
  temperature: number
  max_tokens: number
  is_default: number
  capabilities: string
  created_at: number
  updated_at: number
}

/** 默认模型能力 */
export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  streaming: true,
  toolUse: false,
  vision: false,
  maxContextLength: 4096,
}

/** 创建模型参数 */
export interface CreateModelParams {
  name: string
  provider: ModelProvider
  modelId: string
  apiKey: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  capabilities?: Partial<ModelCapabilities>
}

/** 更新模型参数 */
export interface UpdateModelParams {
  id: string
  name?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  isDefault?: boolean
  capabilities?: Partial<ModelCapabilities>
}

/**
 * 将数据库行转换为 ModelConfig 实体（解密 API Key）。
 *
 * @param row - 数据库行
 * @param decrypt - 是否解密 API Key（默认 true）
 * @returns ModelConfig 实体
 */
function rowToModelConfig(row: ModelConfigRow, decrypt = true): ModelConfig {
  let capabilities: ModelCapabilities
  try {
    capabilities = JSON.parse(row.capabilities) as ModelCapabilities
  } catch {
    capabilities = { ...DEFAULT_CAPABILITIES }
  }

  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ModelProvider,
    modelId: row.model_id,
    apiKey: decrypt ? decryptApiKey(row.api_key) : row.api_key,
    baseUrl: row.base_url ?? undefined,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    isDefault: row.is_default === 1,
    capabilities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 合并模型能力（覆盖默认值）。
 */
function mergeCapabilities(
  base: ModelCapabilities,
  override?: Partial<ModelCapabilities>,
): ModelCapabilities {
  if (!override) {
    return { ...base }
  }
  return {
    streaming: override.streaming ?? base.streaming,
    toolUse: override.toolUse ?? base.toolUse,
    vision: override.vision ?? base.vision,
    maxContextLength: override.maxContextLength ?? base.maxContextLength,
  }
}

/**
 * 创建模型配置。
 * - 加密 API Key 后存储
 * - provider + modelId 重复时抛出 MODEL_DUPLICATE
 * - 返回带 id 和时间戳的完整 ModelConfig
 *
 * @param params - 创建参数
 * @returns 新建的 ModelConfig
 * @throws {AppError} MODEL_DUPLICATE - provider + modelId 已存在
 */
export function createModelConfig(params: CreateModelParams): ModelConfig {
  const db: Database.Database = getDatabase()

  // 检查 provider + modelId 是否重复
  const existing = db
    .prepare('SELECT id FROM model_configs WHERE provider = ? AND model_id = ?')
    .get(params.provider, params.modelId) as { id: string } | undefined

  if (existing !== undefined) {
    throw new AppError(
      ErrorCodes.MODEL_DUPLICATE,
      `Model with provider "${params.provider}" and modelId "${params.modelId}" already exists.`,
      { provider: params.provider, modelId: params.modelId },
    )
  }

  const now = Date.now()
  const id = generateId()
  const encryptedApiKey = encryptApiKey(params.apiKey)
  const capabilities = mergeCapabilities(DEFAULT_CAPABILITIES, params.capabilities)
  const capabilitiesJson = JSON.stringify(capabilities)

  db.prepare(
    `INSERT INTO model_configs
      (id, name, provider, model_id, api_key, base_url, temperature, max_tokens, is_default, capabilities, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.provider,
    params.modelId,
    encryptedApiKey,
    params.baseUrl ?? null,
    params.temperature ?? 0.7,
    params.maxTokens ?? 4096,
    0,
    capabilitiesJson,
    now,
    now,
  )

  return getModelConfigById(id)
}

/**
 * 查询单个模型配置（解密 API Key）。
 *
 * @param id - 模型 ID
 * @returns ModelConfig
 * @throws {AppError} MODEL_NOT_FOUND - 模型不存在
 */
export function getModelConfigById(id: string): ModelConfig {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as
    ModelConfigRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model with id "${id}" not found.`, { id })
  }

  return rowToModelConfig(row, true)
}

/**
 * 查询单个模型配置（API Key 掩码为 '***'）。
 * 用于 model:list 和 model:get 返回给渲染进程。
 *
 * @param id - 模型 ID
 * @returns apiKey 字段为 '***' 的 ModelConfig
 * @throws {AppError} MODEL_NOT_FOUND - 模型不存在
 */
export function getModelConfigMasked(id: string): ModelConfig {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as
    ModelConfigRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model with id "${id}" not found.`, { id })
  }

  const config = rowToModelConfig(row, false)
  return { ...config, apiKey: '***' }
}

/**
 * 查询所有模型配置（API Key 掩码为 '***'）。
 *
 * @returns ModelConfig 数组，apiKey 字段为 '***'
 */
export function listModelConfigs(): ModelConfig[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM model_configs ORDER BY created_at ASC')
    .all() as ModelConfigRow[]

  return rows.map((row) => {
    const config = rowToModelConfig(row, false)
    return { ...config, apiKey: '***' }
  })
}

/**
 * 更新模型配置。
 * - 仅更新提供的字段
 * - 若提供 apiKey 则重新加密
 * - 若设置 isDefault=true，则取消其他模型的默认状态
 * - 更新 updated_at 时间戳
 *
 * @param params - 更新参数
 * @throws {AppError} MODEL_NOT_FOUND - 模型不存在
 */
export function updateModelConfig(params: UpdateModelParams): void {
  const db: Database.Database = getDatabase()

  // 确认模型存在
  const existing = db.prepare('SELECT id FROM model_configs WHERE id = ?').get(params.id) as
    { id: string } | undefined

  if (existing === undefined) {
    throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model with id "${params.id}" not found.`, {
      id: params.id,
    })
  }

  const now = Date.now()

  // 动态构建 UPDATE 语句（仅更新提供的字段）
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (params.name !== undefined) {
    setClauses.push('name = ?')
    values.push(params.name)
  }

  if (params.apiKey !== undefined) {
    setClauses.push('api_key = ?')
    values.push(encryptApiKey(params.apiKey))
  }

  if (params.baseUrl !== undefined) {
    setClauses.push('base_url = ?')
    values.push(params.baseUrl ?? null)
  }

  if (params.temperature !== undefined) {
    setClauses.push('temperature = ?')
    values.push(params.temperature)
  }

  if (params.maxTokens !== undefined) {
    setClauses.push('max_tokens = ?')
    values.push(params.maxTokens)
  }

  if (params.capabilities !== undefined) {
    // 合并现有 capabilities 与新提供的部分
    const currentRow = db
      .prepare('SELECT capabilities FROM model_configs WHERE id = ?')
      .get(params.id) as { capabilities: string } | undefined
    let currentCapabilities: ModelCapabilities = { ...DEFAULT_CAPABILITIES }
    if (currentRow !== undefined) {
      try {
        currentCapabilities = JSON.parse(currentRow.capabilities) as ModelCapabilities
      } catch {
        // 使用默认值
      }
    }
    const merged = mergeCapabilities(currentCapabilities, params.capabilities)
    setClauses.push('capabilities = ?')
    values.push(JSON.stringify(merged))
  }

  if (params.isDefault !== undefined) {
    if (params.isDefault) {
      // 取消其他模型的默认状态
      db.prepare('UPDATE model_configs SET is_default = 0, updated_at = ?').run(now)
    }
    setClauses.push('is_default = ?')
    values.push(params.isDefault ? 1 : 0)
  }

  values.push(params.id)

  db.prepare(`UPDATE model_configs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 删除模型配置。
 * - 删除默认模型时抛出 MODEL_DELETE_DEFAULT
 *
 * @param id - 模型 ID
 * @throws {AppError} MODEL_NOT_FOUND - 模型不存在
 * @throws {AppError} MODEL_DELETE_DEFAULT - 试图删除默认模型
 */
export function deleteModelConfig(id: string): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id, is_default FROM model_configs WHERE id = ?').get(id) as
    { id: string; is_default: number } | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model with id "${id}" not found.`, { id })
  }

  if (row.is_default === 1) {
    throw new AppError(
      ErrorCodes.MODEL_DELETE_DEFAULT,
      `Cannot delete the default model (id="${id}"). Set another model as default first.`,
      { id },
    )
  }

  db.prepare('DELETE FROM model_configs WHERE id = ?').run(id)
}

/**
 * 检查模型是否存在。
 *
 * @param id - 模型 ID
 * @returns 是否存在
 */
export function modelConfigExists(id: string): boolean {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT 1 FROM model_configs WHERE id = ?').get(id) as
    { '1': number } | undefined
  return row !== undefined
}
