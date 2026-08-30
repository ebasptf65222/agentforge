// AgentForge Model 域 IPC Handlers
// 实现 P1-06: 模型配置 CRUD + 连接测试
// 通道命名: domain:action 格式 (model:list, model:create, ...)

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type OpenAI from 'openai'
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
import {
  ensureParamsObject,
  validateEnum,
  validateNonEmptyString,
  validateOptionalBoolean,
  validateOptionalNumber,
  validateOptionalString,
} from '../utils/ipc-validator'

/**
 * 清除 ModelRouter 缓存。
 * P1-07 已实现：委托给 router.ts 的 invalidateModelCache。
 *
 * @param modelId - 变更的模型 ID
 */
function invalidateModelRouterCache(modelId: string): void {
  invalidateModelCache(modelId)
}

// ─── 常量 ─────────────────────────────────────────────────────────

const VALID_PROVIDERS: readonly ModelProvider[] = ['openai', 'deepseek', 'anthropic', 'custom']

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
  const p = ensureParamsObject(params, 'model:create')

  const name = validateNonEmptyString(p['name'], 'name')
  const provider = validateEnum(p['provider'], 'provider', VALID_PROVIDERS)
  const modelId = validateNonEmptyString(p['modelId'], 'modelId')
  const apiKey = validateNonEmptyString(p['apiKey'], 'apiKey')
  const baseUrl = validateOptionalString(p['baseUrl'], 'baseUrl')
  const temperature = validateOptionalNumber(p['temperature'], 'temperature')
  const maxTokens = validateOptionalNumber(p['maxTokens'], 'maxTokens')

  const createParams: CreateModelParams = {
    name,
    provider,
    modelId,
    apiKey,
    baseUrl,
    temperature,
    maxTokens,
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
  const p = ensureParamsObject(params, 'model:update')

  const id = validateNonEmptyString(p['id'], 'id')
  const name = validateOptionalString(p['name'], 'name')
  const apiKey = validateOptionalString(p['apiKey'], 'apiKey')
  const baseUrl = validateOptionalString(p['baseUrl'], 'baseUrl')
  const temperature = validateOptionalNumber(p['temperature'], 'temperature')
  const maxTokens = validateOptionalNumber(p['maxTokens'], 'maxTokens')
  const isDefault = validateOptionalBoolean(p['isDefault'], 'isDefault')

  const updateParams: UpdateModelParams = {
    id,
    name,
    apiKey,
    baseUrl,
    temperature,
    maxTokens,
    isDefault,
    capabilities: p['capabilities'] as UpdateModelParams['capabilities'],
  }

  updateModelConfig(updateParams)
  invalidateModelRouterCache(id)
}

/**
 * model:delete - 删除模型配置
 * 删除默认模型时抛出 MODEL_DELETE_DEFAULT
 * 清除 ModelRouter 缓存（目前仅日志）
 */
function handleDelete(params: unknown): void {
  const p = ensureParamsObject(params, 'model:delete')

  const id = validateNonEmptyString(p['id'], 'id')

  deleteModelConfig(id)
  invalidateModelRouterCache(id)
}

/**
 * model:get - 查询单个模型配置（apiKey 掩码为 '***'）
 */
function handleGet(params: unknown): ModelConfig {
  const p = ensureParamsObject(params, 'model:get')

  const id = validateNonEmptyString(p['id'], 'id')

  return getModelConfigMasked(id)
}

/**
 * model:test - 测试模型连接
 * 向 API 发送 "Hi" 消息，返回 { success, latency, error? }
 * 使用 openai SDK（兼容 OpenAI/DeepSeek/Custom 等 OpenAI 兼容 API）
 */
async function handleTest(
  params: unknown,
): Promise<{ success: boolean; latency: number; error?: string }> {
  const p = ensureParamsObject(params, 'model:test')

  const id = validateNonEmptyString(p['id'], 'id')

  // 获取解密后的模型配置
  const config = getModelConfigById(id)

  // openai SDK 体积较大，仅在测试连接时动态加载
  const { default: OpenAI } = await import('openai')

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
