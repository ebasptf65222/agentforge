// BYOK provider configuration builder
// Converts AgentForge's ModelConfig (from DB) to SDK's ProviderConfig format

import type { ModelConfig } from '@shared/types'
import type { SdkProviderConfig, WireApiMode } from './types'
import { mapProviderType } from './types'
import { getModelConfigById } from '../db/repos/model-config'
import { getSettings } from '../db/repos/app-settings'
import { AppError, ErrorCodes } from '../utils/error'

/**
 * 判断模型是否应使用 Responses API。
 * OpenAI 的 o1/o3/o4 系列和 GPT-4o 支持 Responses API（多轮状态、工具命名空间、推理）。
 */
function shouldUseResponsesApi(modelId: string): boolean {
  const id = modelId.toLowerCase()
  // OpenAI o 系列（推理模型）
  if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return true
  // GPT-4o 系列
  if (id.includes('gpt-4o')) return true
  // 其他模型默认使用 completions
  return false
}

/**
 * 解析 wireApi 模式：优先使用用户手动配置，'auto' 时根据模型类型自动判断。
 */
function resolveWireApi(
  modelId: string,
  setting: WireApiMode | undefined,
): 'completions' | 'responses' {
  if (setting && setting !== 'auto') {
    return setting
  }
  return shouldUseResponsesApi(modelId) ? 'responses' : 'completions'
}

/**
 * Build SDK ProviderConfig from AgentForge's ModelConfig.
 */
export function buildProviderConfig(model: ModelConfig): SdkProviderConfig {
  const config: SdkProviderConfig = {
    type: mapProviderType(model.provider),
    baseUrl: model.baseUrl || getDefaultBaseUrl(model.provider),
    apiKey: model.apiKey,
  }

  // DeepSeek uses OpenAI-compatible API but different default base URL
  if (model.provider === 'deepseek' && !model.baseUrl) {
    config.baseUrl = 'https://api.deepseek.com/v1'
  }

  // Pass maxTokens to SDK's maxOutputTokens
  if (model.maxTokens) {
    config.maxOutputTokens = model.maxTokens
  }

  // B5: 设置 wire API 模式（Responses API 支持多轮状态、工具命名空间、推理）
  // 优先使用用户在设置中手动指定的模式；'auto' 时根据模型类型自动判断
  config.wireApi = resolveWireApi(model.modelId, getSettings().copilotWireApi)

  return config
}

/**
 * Build ProviderConfig from a model config ID stored in the database.
 * Returns both the model name and provider config for session creation.
 */
export function buildProviderConfigById(
  modelConfigId: string,
): { model: string; provider: SdkProviderConfig } {
  const modelConfig = getModelConfigById(modelConfigId)
  if (!modelConfig.apiKey && modelConfig.provider !== 'custom') {
    throw new AppError(
      ErrorCodes.MODEL_API_ERROR,
      `Model "${modelConfig.name}" has no API key configured. BYOK mode requires an API key.`,
      { modelId: modelConfigId },
    )
  }
  return {
    model: modelConfig.modelId,
    provider: buildProviderConfig(modelConfig),
  }
}

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'https://api.anthropic.com'
    case 'deepseek':
      return 'https://api.deepseek.com/v1'
    case 'openai':
      return 'https://api.openai.com/v1'
    default:
      return 'https://api.openai.com/v1'
  }
}
