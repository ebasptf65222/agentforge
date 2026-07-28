// BYOK provider configuration builder
// Converts AgentForge's ModelConfig (from DB) to SDK's ProviderConfig format

import type { ModelConfig } from '@shared/types'
import type { SdkProviderConfig } from './types'
import { mapProviderType } from './types'
import { getModelConfigById } from '../db/repos/model-config'
import { AppError, ErrorCodes } from '../utils/error'

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
