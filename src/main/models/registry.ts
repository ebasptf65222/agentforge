// AgentForge 架构优化批次C-3: ModelAdapterRegistry
//
// 将 router.ts 中的模块级注册表重构为正式的 ModelAdapterRegistry 类。
//
// 改进：
// 1. 封装注册表和缓存为类实例，支持依赖注入和测试隔离
// 2. 新增 isProviderRegistered() 检查方法
// 3. 新增 unregisterAdapter() 注销方法
// 4. 新增 clearRegistry() 清空注册表方法（测试用）
// 5. 单例模式保持向后兼容

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

// ─── ModelAdapterRegistry ────────────────────────────────────────

/**
 * 模型适配器注册表。
 *
 * 管理提供商 → 适配器工厂的映射，以及适配器实例的缓存。
 * 新增提供商只需调用 registerAdapter() 注册工厂函数。
 *
 * 设计模式：Registry + Factory
 */
export class ModelAdapterRegistry {
  /** 提供商 → 适配器工厂 的注册表 */
  private readonly registry = new Map<string, AdapterFactory>()

  /** 适配器缓存：configId → ModelAdapter 实例 */
  private readonly cache = new Map<string, ModelAdapter>()

  /**
   * 注册（或覆盖）一个 provider 的适配器工厂。
   *
   * @param provider - 提供商名称（与 ModelConfig.provider 对应）
   * @param factory - 适配器工厂函数
   */
  registerAdapter(provider: string, factory: AdapterFactory): void {
    this.registry.set(provider, factory)
  }

  /**
   * 注销一个 provider 的适配器工厂。
   *
   * @param provider - 提供商名称
   */
  unregisterAdapter(provider: string): void {
    this.registry.delete(provider)
  }

  /**
   * 检查指定 provider 是否已注册。
   *
   * @param provider - 提供商名称
   * @returns 是否已注册
   */
  isProviderRegistered(provider: string): boolean {
    return this.registry.has(provider)
  }

  /**
   * 获取当前已注册的所有 provider 名称。
   *
   * @returns 已注册 provider 名称数组
   */
  getRegisteredProviders(): string[] {
    return Array.from(this.registry.keys())
  }

  /**
   * 清空注册表和缓存（仅供测试使用）。
   */
  clearRegistry(): void {
    this.registry.clear()
    this.cache.clear()
  }

  /**
   * 根据提供商类型创建对应的适配器实例。
   * 通过注册表查找工厂函数；未注册的 provider 抛出 MODEL_API_ERROR。
   *
   * @param provider - 提供商类型
   * @param config - 适配器配置
   * @returns ModelAdapter 实例
   * @throws {AppError} MODEL_API_ERROR - 提供商未注册
   */
  createAdapter(provider: ModelProvider, config: ModelAdapterConfig): ModelAdapter {
    const factory = this.registry.get(provider)
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
  getModelAdapter(configId: string): ModelAdapter {
    const cached = this.cache.get(configId)
    if (cached !== undefined) {
      return cached
    }

    const config = getModelConfigById(configId)
    const adapter = this.createAdapter(config.provider, {
      modelId: config.modelId,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    })

    this.cache.set(configId, adapter)
    return adapter
  }

  /**
   * 清除适配器缓存。
   * model:update / model:delete 后调用。
   *
   * @param modelId - 变更的模型 ID（不传则清除全部缓存）
   */
  invalidateCache(modelId?: string): void {
    if (modelId !== undefined) {
      this.cache.delete(modelId)
    } else {
      this.cache.clear()
    }
  }

  /**
   * 获取当前缓存大小（仅供测试使用）。
   */
  getCacheSize(): number {
    return this.cache.size
  }
}

// ─── 单例 ──────────────────────────────────────────────────────

/** 全局 ModelAdapterRegistry 单例 */
let registryInstance: ModelAdapterRegistry | null = null

/**
 * 获取 ModelAdapterRegistry 单例。
 * 首次调用时创建实例并注册内置 provider。
 */
export function getModelAdapterRegistry(): ModelAdapterRegistry {
  if (!registryInstance) {
    registryInstance = new ModelAdapterRegistry()

    // 注册内置 provider
    registryInstance.registerAdapter('openai', (config) => new OpenAIAdapter(config))

    registryInstance.registerAdapter('deepseek', (config) =>
      new DeepSeekAdapter({
        modelId: config.modelId,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    )

    registryInstance.registerAdapter('anthropic', (config) =>
      new AnthropicAdapter({
        modelId: config.modelId,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    )

    // 自定义提供商假设兼容 OpenAI API
    registryInstance.registerAdapter('custom', (config) => new OpenAIAdapter(config))
  }
  return registryInstance
}

/**
 * 重置注册表单例（仅供测试使用）。
 */
export function resetModelAdapterRegistry(): void {
  registryInstance = null
}
