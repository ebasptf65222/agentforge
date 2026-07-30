// AgentForge P1-07: 模型路由器
// 根据 modelId 从 DB 获取 ModelConfig，创建并缓存适配器实例
//
// 采用注册表（Registry）模式：新增提供商只需调用 registerAdapter() 注册工厂函数，
// 无需修改本文件的核心路由逻辑。

import type { ModelProvider } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getModelConfigById } from '../db/repos/model-config'
import type { ModelAdapter } from './adapter'
import { OpenAIAdapter } from './openai-adapter'
import { DeepSeekAdapter } from './deepseek-adapter'
import { AnthropicAdapter } from './anthropic-adapter'

// ─── 类型定义 ─────────────────────────────────────────────────────

/**
 * 适配器工厂接收的配置。
 * 由 ModelConfig 中的关键字段构造，传给各 provider 的适配器构造函数。
 */
export interface ModelAdapterConfig {
  modelId: string
  apiKey: string
  baseUrl?: string
  temperature: number
  maxTokens: number
}

/**
 * 适配器工厂函数类型。
 * 接收 ModelAdapterConfig，返回一个 ModelAdapter 实例。
 */
export type AdapterFactory = (config: ModelAdapterConfig) => ModelAdapter

// ─── 适配器注册表 ─────────────────────────────────────────────────

/**
 * 提供商 → 适配器工厂 的注册表。
 * 默认注册 openai/deepseek/anthropic/custom 四个 provider。
 * 第三方或自定义 provider 可通过 registerAdapter() 动态注册。
 */
const adapterRegistry = new Map<string, AdapterFactory>()

/**
 * 注册（或覆盖）一个 provider 的适配器工厂。
 *
 * 新增模型提供商时，调用此函数注册工厂即可，无需修改 router 核心代码：
 *
 * ```ts
 * registerAdapter('mistral', (config) => new MistralAdapter(config))
 * ```
 *
 * @param provider - 提供商名称（与 ModelConfig.provider 对应）
 * @param factory - 适配器工厂函数
 */
export function registerAdapter(provider: string, factory: AdapterFactory): void {
  adapterRegistry.set(provider, factory)
}

/**
 * 获取当前已注册的所有 provider 名称。
 *
 * @returns 已注册 provider 名称数组
 */
export function getRegisteredProviders(): string[] {
  return Array.from(adapterRegistry.keys())
}

// ─── 默认 provider 注册 ──────────────────────────────────────────
// 内置四个 provider 的工厂函数，行为与原 switch-case 完全一致。

registerAdapter('openai', (config) => new OpenAIAdapter(config))

registerAdapter('deepseek', (config) =>
  new DeepSeekAdapter({
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  }),
)

registerAdapter('anthropic', (config) =>
  new AnthropicAdapter({
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  }),
)

// 自定义提供商假设兼容 OpenAI API
registerAdapter('custom', (config) => new OpenAIAdapter(config))

// ─── 适配器缓存 ───────────────────────────────────────────────────

/**
 * 适配器缓存：configId → ModelAdapter 实例。
 * 更新/删除模型配置时需清除对应缓存。
 */
const adapterCache = new Map<string, ModelAdapter>()

/**
 * 根据提供商类型创建对应的适配器实例。
 * 通过注册表查找工厂函数；未注册的 provider 抛出 MODEL_API_ERROR。
 */
function createAdapter(provider: ModelProvider, config: ModelAdapterConfig): ModelAdapter {
  const factory = adapterRegistry.get(provider)
  if (!factory) {
    throw new AppError(ErrorCodes.MODEL_API_ERROR, `Unknown provider: ${provider}`, { provider })
  }
  return factory(config)
}

/**
 * 获取模型适配器实例。
 * 优先从缓存获取，缓存未命中时从 DB 读取配置并创建。
 *
 * @param configId - model_configs 表中的主键 id
 * @returns 对应的 ModelAdapter 实例
 * @throws {AppError} MODEL_NOT_FOUND - 模型不存在
 * @throws {AppError} MODEL_API_ERROR - 提供商不支持
 */
export function getModelAdapter(configId: string): ModelAdapter {
  const cached = adapterCache.get(configId)
  if (cached !== undefined) {
    return cached
  }

  const config = getModelConfigById(configId)
  const adapter = createAdapter(config.provider, {
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  adapterCache.set(configId, adapter)
  return adapter
}

/**
 * 清除适配器缓存。
 * P1-06 的 model:update / model:delete 后调用。
 *
 * @param modelId - 变更的模型 ID（不传则清除全部缓存）
 */
export function invalidateModelCache(modelId?: string): void {
  if (modelId !== undefined) {
    adapterCache.delete(modelId)
  } else {
    adapterCache.clear()
  }
}

/**
 * 获取当前缓存大小（仅供测试使用）。
 */
export function getCacheSize(): number {
  return adapterCache.size
}
