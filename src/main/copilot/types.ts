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

/** SDK 推理摘要模式 */
export type ReasoningSummary = 'none' | 'auto' | 'detailed'

/** SDK 上下文窗口层级 */
export type ContextTier = 'default' | 'long_context'

/**
 * SDK wire API 模式。
 * - 'completions'：使用 Chat Completions API（默认）
 * - 'responses'：使用 Responses API（支持多轮状态、工具命名空间、推理）
 * - 'auto'：根据模型类型自动判断（GPT-4o/o 系列使用 responses）
 */
export type WireApiMode = 'completions' | 'responses' | 'auto'

/** 系统提示词定制模式 */
export type SystemMessageMode = 'append' | 'replace' | 'customize'

/** 系统提示词分区配置 */
export interface SystemMessageSectionConfig {
  /** 动作类型 */
  action: 'replace' | 'remove' | 'append' | 'prepend' | 'transform'
  /** 内容（replace/append/prepend 时使用） */
  content?: string
  /** transform 回调（仅 action 为 transform 时使用，这里用描述字符串代替） */
  transformDescription?: string
}

/** 自定义代理配置（映射 SDK CustomAgentConfig） */
export interface CustomAgentConfig {
  /** 唯一标识 */
  name: string
  /** 人类可读名称 */
  displayName?: string
  /** 描述（帮助运行时选择代理） */
  description?: string
  /** 可用工具名列表（null/省略 = 所有工具） */
  tools?: string[] | null
  /** 代理系统提示 */
  prompt: string
  /** 运行时是否可自动选择（默认 true） */
  infer?: boolean
}

/** 斜杠命令配置 */
export interface SlashCommandConfig {
  /** 命令名（不含 /） */
  name: string
  /** 描述 */
  description?: string
}

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
  /** SDK 分配的 sessionId（从数据库读取，用于 resume 已有会话） */
  sdkSessionId?: string
  /** 系统提示词模式（append/customize），默认 append */
  systemMessageMode?: SystemMessageMode
  /** 系统提示词分区配置（仅 customize 模式时使用） */
  systemMessageSections?: Record<string, SystemMessageSectionConfig>
  /** 自定义代理配置列表 */
  customAgents?: CustomAgentConfig[]
  /** 预选激活的代理名称 */
  activeAgent?: string
  /** 是否启用 ask_user 工具（AI 可主动向用户提问） */
  enableAskUser?: boolean
  /** 是否启用 elicitation 表单交互 */
  enableElicitation?: boolean
  /** 自定义斜杠命令列表 */
  commands?: SlashCommandConfig[]
  /** 技能目录路径列表（SDK skillDirectories） */
  skillDirectories?: string[]
  /** 是否启用 SDK 技能加载（含内置技能和目录发现），默认 true */
  enableSkills?: boolean
  /** 禁用的技能名称列表 */
  disabledSkills?: string[]
  /** 是否启用配置自动发现（.mcp.json、skill 目录等），默认 false */
  enableConfigDiscovery?: boolean
  /** 客户端名称（SDK clientName，传入 User-Agent） */
  clientName?: string
  /** 上下文窗口层级（SDK contextTier） */
  contextTier?: ContextTier
  /** 推理摘要模式（SDK reasoningSummary） */
  reasoningSummary?: ReasoningSummary
  /** 排除的工具列表（SDK excludedTools） */
  excludedTools?: string[]
  /** 是否启用主机 Git 操作（SDK enableHostGitOperations） */
  enableHostGitOperations?: boolean
  /** 工具搜索配置（SDK toolSearch） */
  toolSearch?: { enabled?: boolean; deferThreshold?: number }
  /** 默认代理排除的工具列表（SDK defaultAgent.excludedTools） */
  defaultAgentExcludedTools?: string[]
  /** Open Plugins 目录路径列表（SDK pluginDirectories） */
  pluginDirectories?: string[]
  /** 自定义指令文件目录列表（SDK instructionDirectories） */
  instructionDirectories?: string[]
  /** 是否启用记忆功能（SDK memory.enabled） */
  enableMemory?: boolean
  /** 是否跳过自定义指令文件（SDK skipCustomInstructions） */
  skipCustomInstructions?: boolean
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
