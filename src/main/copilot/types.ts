// Copilot SDK integration type definitions
// Provides types for the @github/copilot-sdk bridge layer

import type { ModelProvider } from '@shared/types'

/** BYOK provider configuration matching SDK's ProviderConfig */
export interface SdkProviderConfig {
  type: 'openai' | 'azure' | 'anthropic'
  baseUrl: string
  apiKey?: string
  wireApi?: 'completions' | 'responses'
  maxOutputTokens?: number
  azure?: { apiVersion: string }
}

/** SDK 推理强度级别 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

/**
 * SDK 会话额外配置（由 Skill 和工作区注入）。
 * 这些字段透传到 CopilotClient.createSession() 调用。
 */
export interface SessionExtras {
  /** Skill 系统提示词（注入为 SDK systemMessage） */
  systemMessageContent?: string
  /** Skill 允许的工具列表（SDK availableTools 过滤） */
  availableTools?: string[]
  /** 工作区路径（SDK workingDirectory） */
  workingDirectory?: string
  /** 推理强度（SDK reasoningEffort） */
  reasoningEffort?: ReasoningEffort
  /** 对话 ID（用于 SDK session 持久化复用） */
  conversationId?: string
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
