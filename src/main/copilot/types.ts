// Copilot SDK integration type definitions
// Provides types for the @github/copilot-sdk bridge layer

import type { ModelProvider } from '@shared/types'

/** BYOK provider configuration matching SDK's ProviderConfig */
export interface SdkProviderConfig {
  type: 'openai' | 'azure' | 'anthropic'
  baseUrl: string
  apiKey?: string
  wireApi?: 'completions' | 'responses'
  azure?: { apiVersion: string }
}

/**
 * Maps AgentForge ModelProvider to SDK provider type.
 * - anthropic -> anthropic
 * - openai/deepseek/custom -> openai (OpenAI-compatible API)
 */
export function mapProviderType(provider: ModelProvider): SdkProviderConfig['type'] {
  switch (provider) {
    case 'anthropic':
      return 'anthropic'
    case 'openai':
    case 'deepseek':
    case 'custom':
    default:
      return 'openai'
  }
}
