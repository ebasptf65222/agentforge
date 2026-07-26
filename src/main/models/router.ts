// AgentForge P1-07: 模型路由器
// 根据 modelId 从 DB 获取 ModelConfig，创建并缓存适配器实例

import type { ModelProvider } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getModelConfigById } from '../db/repos/model-config'
import type { ModelAdapter } from './adapter'
import { OpenAIAdapter } from './openai-adapter'
import { DeepSeekAdapter } from './deepseek-adapter'

/**
 * 适配器缓存：configId → ModelAdapter 实例。
 * 更新/删除模型配置时需清除对应缓存。
 */
const adapterCache = new Map<string, ModelAdapter>()

/**
 * 根据提供商类型创建对应的适配器实例。
 */
function createAdapter(
  provider: ModelProvider,
  config: {
    modelId: string
    apiKey: string
    baseUrl?: string
    temperature: number
    maxTokens: number
  },
): ModelAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAIAdapter(config)
    case 'deepseek':
      return new DeepSeekAdapter({
        modelId: config.modelId,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      })
    case 'anthropic':
      throw new AppError(ErrorCodes.MODEL_API_ERROR, `Provider "anthropic" is not yet supported.`, {
        provider,
      })
    case 'custom':
      // 自定义提供商假设兼容 OpenAI API
      return new OpenAIAdapter(config)
    default:
      throw new AppError(ErrorCodes.MODEL_API_ERROR, `Unknown provider: ${provider}`, { provider })
  }
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
