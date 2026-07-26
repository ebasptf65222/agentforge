// AgentForge Model 域 IPC Handlers
// 实现 P1-06: 模型配置 CRUD + 连接测试
// 通道命名: domain:action 格式 (model:list, model:create, ...)

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import OpenAI from 'openai'
import type { ModelConfig, ModelProvider } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  createModelConfig,
  getModelConfigMasked,
  getModelConfigById,
  listModelConfigs,
  updateModelConfig,
  deleteModelConfig,
  type CreateModelParams,
  type UpdateModelParams,
} from '../db/repos/model-config'
import { invalidateModelCache } from '../models/router'

/**
 * 清除 ModelRouter 缓存。
 * P1-07 已实现：委托给 router.ts 的 invalidateModelCache。
 *
 * @param modelId - 变更的模型 ID
 */
function invalidateModelRouterCache(modelId: string): void {
  invalidateModelCache(modelId)
}

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

const VALID_PROVIDERS: readonly ModelProvider[] = ['openai', 'deepseek', 'anthropic', 'custom']

function assertProvider(value: unknown): asserts value is ModelProvider {
  if (typeof value !== 'string' || !VALID_PROVIDERS.includes(value as ModelProvider)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid provider: ${String(value)}. Must be one of: ${VALID_PROVIDERS.join(', ')}.`,
      { provider: value },
    )
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      {
        field,
        value,
      },
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

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * model:list - 查询所有模型配置（apiKey 掩码为 '***'）
 */
function handleList(): ModelConfig[] {
  return listModelConfigs()
}

/**
 * model:create - 创建模型配置
 * API Key 通过 safeStorage 加密后存储
 * 返回的 apiKey 字段为 '***'
 */
function handleCreate(params: unknown): ModelConfig {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Create model params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['name'], 'name')
  assertProvider(p['provider'])
  assertNonEmptyString(p['modelId'], 'modelId')
  assertNonEmptyString(p['apiKey'], 'apiKey')
  assertOptionalString(p['baseUrl'], 'baseUrl')
  assertOptionalNumber(p['temperature'], 'temperature')
  assertOptionalNumber(p['maxTokens'], 'maxTokens')

  const createParams: CreateModelParams = {
    name: p['name'],
    provider: p['provider'],
    modelId: p['modelId'],
    apiKey: p['apiKey'],
    baseUrl: p['baseUrl'],
    temperature: p['temperature'],
    maxTokens: p['maxTokens'],
    capabilities: p['capabilities'] as CreateModelParams['capabilities'],
  }

  const created = createModelConfig(createParams)
  // 创建后返回掩码版本
  return { ...created, apiKey: '***' }
}

/**
 * model:update - 更新模型配置
 * 清除 ModelRouter 缓存（目前仅日志）
 */
function handleUpdate(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Update model params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')
  assertOptionalString(p['name'], 'name')
  assertOptionalString(p['apiKey'], 'apiKey')
  assertOptionalString(p['baseUrl'], 'baseUrl')
  assertOptionalNumber(p['temperature'], 'temperature')
  assertOptionalNumber(p['maxTokens'], 'maxTokens')

  if (p['isDefault'] !== undefined && typeof p['isDefault'] !== 'boolean') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "isDefault" must be a boolean.', {
      isDefault: p['isDefault'],
    })
  }

  const updateParams: UpdateModelParams = {
    id: p['id'],
    name: p['name'],
    apiKey: p['apiKey'],
    baseUrl: p['baseUrl'],
    temperature: p['temperature'],
    maxTokens: p['maxTokens'],
    isDefault: p['isDefault'],
    capabilities: p['capabilities'] as UpdateModelParams['capabilities'],
  }

  updateModelConfig(updateParams)
  invalidateModelRouterCache(p['id'])
}

/**
 * model:delete - 删除模型配置
 * 删除默认模型时抛出 MODEL_DELETE_DEFAULT
 * 清除 ModelRouter 缓存（目前仅日志）
 */
function handleDelete(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Delete model params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  deleteModelConfig(p['id'])
  invalidateModelRouterCache(p['id'])
}

/**
 * model:get - 查询单个模型配置（apiKey 掩码为 '***'）
 */
function handleGet(params: unknown): ModelConfig {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get model params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  return getModelConfigMasked(p['id'])
}

/**
 * model:test - 测试模型连接
 * 向 API 发送 "Hi" 消息，返回 { success, latency, error? }
 * 使用 openai SDK（兼容 OpenAI/DeepSeek/Custom 等 OpenAI 兼容 API）
 */
async function handleTest(
  params: unknown,
): Promise<{ success: boolean; latency: number; error?: string }> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Test model params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  // 获取解密后的模型配置
  const config = getModelConfigById(p['id'])

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey: config.apiKey,
    timeout: 30_000,
    maxRetries: 0,
  }

  if (config.baseUrl) {
    clientOptions.baseURL = config.baseUrl
  }

  const client = new OpenAI(clientOptions)

  const startTime = Date.now()
  try {
    await client.chat.completions.create({
      model: config.modelId,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
      stream: false,
    })
    const latency = Date.now() - startTime
    return { success: true, latency }
  } catch (error) {
    const latency = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, latency, error: errorMessage }
  }
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'model:list', handler: () => handleList() },
  { channel: 'model:create', handler: (_event, params: unknown) => handleCreate(params) },
  { channel: 'model:update', handler: (_event, params: unknown) => handleUpdate(params) },
  { channel: 'model:delete', handler: (_event, params: unknown) => handleDelete(params) },
  { channel: 'model:test', handler: (_event, params: unknown) => handleTest(params) },
  { channel: 'model:get', handler: (_event, params: unknown) => handleGet(params) },
]

/**
 * 注册 Model 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerModelHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
