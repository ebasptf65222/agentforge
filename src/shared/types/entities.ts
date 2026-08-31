// AgentForge 共享类型定义 - 核心实体接口
// 与 Spec v0.2 §5.2 一致

import type { ApprovalMode, MessageRole, ModelProvider, EngineType } from './enums'
import type { VoiceConfig } from './voice'

// ─── 5.2 核心实体接口 ────────────────────────────────────────────

/** 时间戳统一为 Unix 毫秒 (number) */

/** 会话 */
export interface Conversation {
  id: string
  title: string
  modelId: string
  approvalMode: ApprovalMode
  messageCount: number
  lastMessageAt: number | null
  createdAt: number
  updatedAt: number
  /** SDK 分配的 sessionId（用于 resume，应用重启后恢复会话） */
  sdkSessionId?: string
  /** P3-01: 父会话 ID（fork 来源，null 表示根会话） */
  parentId?: string | null
  /** P3-01: 在同层级中的顺序索引 */
  forkIndex?: number
  /** P3-01: 是否为 fork 出的会话 */
  isForked?: boolean
}

/** 消息 */
export interface ChatMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  thinking?: string
  toolCalls?: ToolCallRecord[]
  metadata?: MessageMetadata
  createdAt: number
  updatedAt: number
}

/** 工具调用记录（消息内嵌） */
export interface ToolCallRecord {
  toolName: string
  arguments: Record<string, unknown>
  result?: string
  isError: boolean
  executedAt: number
}

/** 消息元信息 */
export interface MessageMetadata {
  modelId?: string
  tokensUsed?: number
  duration?: number
  stopped?: boolean
  [key: string]: unknown
}

/** 模型配置 */
export interface ModelConfig {
  id: string
  name: string
  provider: ModelProvider
  modelId: string
  apiKey: string
  baseUrl?: string
  temperature: number
  maxTokens: number
  isDefault: boolean
  capabilities: ModelCapabilities
  createdAt: number
  updatedAt: number
}

/** 模型能力 */
export interface ModelCapabilities {
  streaming: boolean
  toolUse: boolean
  vision: boolean
  maxContextLength: number
}

/** 应用设置 */
export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  defaultApprovalMode: ApprovalMode
  maxExecutionSteps: number
  defaultModelId: string | null
  shortcuts: ShortcutConfig
  approvalTimeoutMs: number
  voice: VoiceConfig
  workspace: WorkspaceConfig
  engineType: EngineType
  /** Code 引擎（Copilot SDK）推理强度（仅 code 引擎生效） */
  copilotReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  /** SDK wire API 模式：'auto' 表示根据模型自动判断（GPT-4o/o 系列用 responses） */
  copilotWireApi?: 'completions' | 'responses' | 'auto'
  /** SDK 技能目录路径列表（SDK skillDirectories，加载 .md 技能文件） */
  copilotSkillDirectories?: string[]
  /** 是否启用配置自动发现（.mcp.json、skill 目录等） */
  copilotEnableConfigDiscovery?: boolean
  /** SDK 上下文窗口层级：'long_context' 固定使用长上下文模型 */
  copilotContextTier?: 'default' | 'long_context'
  /** SDK 推理摘要模式：'none' 可抑制摘要输出 */
  copilotReasoningSummary?: 'none' | 'auto' | 'detailed'
  /** SDK 排除的工具列表（与 availableTools 互补） */
  copilotExcludedTools?: string[]
  /** SDK 是否启用主机 Git 操作（分支、状态等上下文） */
  copilotEnableHostGitOperations?: boolean
  /** SDK 工具搜索延迟加载阈值（0 表示使用 SDK 默认 30） */
  copilotToolSearchDeferThreshold?: number
  /** SDK 默认代理排除的工具列表 */
  copilotDefaultAgentExcludedTools?: string[]
  /** SDK Open Plugins 目录路径列表 */
  copilotPluginDirectories?: string[]
  /** SDK 自定义指令文件目录列表 */
  copilotInstructionDirectories?: string[]
  /** SDK 是否启用记忆功能 */
  copilotEnableMemory?: boolean
  /** SDK 是否跳过自定义指令文件（.github/copilot-instructions.md 等） */
  copilotSkipCustomInstructions?: boolean
  /** SDK 是否启用 ask_user 工具（AI 可主动向用户提问） */
  copilotEnableAskUser?: boolean
  /** SDK 是否启用 elicitation 表单交互 */
  copilotEnableElicitation?: boolean
  /** SDK Agent 执行模式（interactive/plan/autopilot/shell） */
  copilotAgentMode?: 'interactive' | 'plan' | 'autopilot' | 'shell'
  /** SDK 最大提示词 token 数（触发压缩阈值，null = 使用 SDK 默认） */
  copilotMaxPromptTokens?: number
  /** SDK 排除的内置代理列表 */
  copilotExcludedBuiltinAgents?: string[]
  /** SDK 是否启用技能加载（含内置技能和目录发现） */
  copilotEnableSkills?: boolean
  /** SDK 禁用的技能名称列表 */
  copilotDisabledSkills?: string[]
  /** SDK 上下文压缩阈值（0-1，默认 0.80） */
  copilotInfiniteSessionThreshold?: number
  /** SDK 大输出最大字节数（默认 51200） */
  copilotLargeOutputMaxSize?: number
  /** 嵌入模型提供商（'ollama' | 'openai'，用于知识库向量化） */
  embeddingProvider?: 'ollama' | 'openai'
  /** 嵌入 API 基础 URL */
  embeddingBaseUrl?: string
  /** 嵌入模型名称 */
  embeddingModel?: string
  /** 嵌入 API 密钥（OpenAI 必需） */
  embeddingApiKey?: string
  /** 嵌入向量维度（用于校验） */
  embeddingDimensions?: number
  windowBounds?: { x: number; y: number; width: number; height: number; isMaximized: boolean }
  updatedAt: number
}

/** 活跃 SDK 会话信息（B7 会话列表查询） */
export interface ActiveSessionInfo {
  conversationId: string
  sdkSessionId?: string
  lastUsedAt: number
  isCompacting: boolean
}

/** 快捷键配置 */
export interface ShortcutConfig {
  newConversation: string
  sendMessage: string
  stopGeneration: string
  toggleSidebar: string
}

// ─── 5.7 工作区类型 ──────────────────────────────────────────────

/** 工作区配置 */
export interface WorkspaceConfig {
  /** 当前工作区绝对路径，null 表示未设置 */
  path: string | null
  /** 最近使用的工作区路径列表（最多 10 个） */
  recentPaths: string[]
  /** 启动时是否自动恢复上次工作区 */
  autoRestore: boolean
  /** 文件树排除的 glob 模式 */
  excludePatterns: string[]
}

/** 文件树节点 */
export interface FileTreeNode {
  /** 节点 ID（相对路径） */
  id: string
  /** 显示名称 */
  name: string
  /** 相对于工作区根的路径 */
  relativePath: string
  /** 是否目录 */
  isDirectory: boolean
  /** 文件大小（字节，目录为 0） */
  size: number
  /** 修改时间 */
  modifiedAt: number
  /** 子节点（仅目录有，懒加载时为 null） */
  children: FileTreeNode[] | null
}

/** 工作区目录条目 */
export interface WorkspaceDirectoryEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}
