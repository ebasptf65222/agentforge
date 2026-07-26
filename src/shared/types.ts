// AgentForge 共享类型定义
// 与 Spec v0.2 §5 完全一致
// 主进程和渲染进程通过 @shared/types alias 导入

// ─── 5.1 核心枚举 ────────────────────────────────────────────────

/** Agent 审批模式 */
type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto'

/** 消息角色 */
type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** 执行状态 */
type ExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

/** 模型提供商 */
type ModelProvider = 'openai' | 'deepseek' | 'anthropic' | 'custom'

/** MCP 传输类型 */
type TransportType = 'stdio' | 'http'

/** 工具风险等级 */
type ToolRiskLevel = 'low' | 'medium' | 'high'

/** Skill 触发方式 */
type SkillTrigger = 'auto' | 'manual'

/** 流式 chunk 类型 */
type StreamChunkType = 'text' | 'thinking' | 'tool-call' | 'error'

// ─── 5.2 核心实体接口 ────────────────────────────────────────────

/** 时间戳统一为 Unix 毫秒 (number) */

/** 会话 */
interface Conversation {
  id: string
  title: string
  modelId: string
  approvalMode: ApprovalMode
  messageCount: number
  lastMessageAt: number | null
  createdAt: number
  updatedAt: number
}

/** 消息 */
interface ChatMessage {
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
interface ToolCallRecord {
  toolName: string
  arguments: Record<string, unknown>
  result?: string
  isError: boolean
  executedAt: number
}

/** 消息元信息 */
interface MessageMetadata {
  modelId?: string
  tokensUsed?: number
  duration?: number
  stopped?: boolean
  [key: string]: unknown
}

/** 模型配置 */
interface ModelConfig {
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
interface ModelCapabilities {
  streaming: boolean
  toolUse: boolean
  vision: boolean
  maxContextLength: number
}

/** 应用设置 */
interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  defaultApprovalMode: ApprovalMode
  maxExecutionSteps: number
  defaultModelId: string | null
  shortcuts: ShortcutConfig
  approvalTimeoutMs: number
  voice: VoiceConfig
  workspace: WorkspaceConfig
  windowBounds?: { x: number; y: number; width: number; height: number; isMaximized: boolean }
  updatedAt: number
}

/** 快捷键配置 */
interface ShortcutConfig {
  newConversation: string
  sendMessage: string
  stopGeneration: string
  toggleSidebar: string
}

// ─── 5.3 流式与 IPC 类型 ───────────────────────────────────────────

/** 流式 chunk */
interface StreamChunk {
  type: StreamChunkType
  content: string
  done?: boolean
}

/** 流式结束元信息 */
interface StreamEndMetadata {
  messageId: string
  tokensUsed: number
  duration: number
  modelId: string
  stopped: boolean
}

/** 流式错误 */
interface StreamError {
  code: string
  message: string
  details?: Record<string, unknown>
}

// ─── 5.4 Agent 执行类型 ────────────────────────────────────────────

/** Agent 执行请求 */
interface AgentExecutionRequest {
  conversationId: string
  userInput: string
  modelId: string
  skillName?: string
  approvalMode: ApprovalMode
  maxSteps: number
}

/** Agent 执行结果 */
interface ExecutionResult {
  executionId: string
  status: ExecutionStatus
  summary: string
  trajectories: TAOTrajectory[]
  totalSteps: number
  duration: number
  tokensUsed: number
}

/** TAO 轨迹（单步） */
interface TAOTrajectory {
  step: number
  thought: string
  action: ToolAction | null
  observation: string
  timestamp: number
  status: 'success' | 'error' | 'pending-approval' | 'approved' | 'rejected'
}

/** 工具动作 */
interface ToolAction {
  toolName: string
  arguments: Record<string, unknown>
  riskLevel: ToolRiskLevel
  requiresApproval: boolean
}

/** 审批请求事件 */
interface ApprovalRequest {
  executionId: string
  step: number
  toolAction: ToolAction
  reason: string
}

/** 审批响应 */
interface ApprovalResponse {
  executionId: string
  step: number
  approved: boolean
  reason?: string
}

// ─── 5.5 工具与 MCP 类型 ───────────────────────────────────────────

/** 工具定义 */
interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  riskLevel: ToolRiskLevel
  source: 'builtin' | 'mcp'
}

/** 工具执行结果 */
interface ToolExecutionResult {
  isError: boolean
  content: string
  metadata?: Record<string, unknown>
}

/** MCP Server 配置 */
interface MCPServerConfig {
  id: string
  name: string
  transport: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** MCP 传输层接口 */
interface ITransport {
  connect(): Promise<void>
  send(message: string): Promise<void>
  onMessage(callback: (data: string) => void): void
  onClose(callback: () => void): void
  onError(callback: (error: Error) => void): void
  close(): Promise<void>
}

/** MCP Server 状态 */
type MCPServerStatus = 'connected' | 'disconnected' | 'error' | 'connecting'

// ─── 5.6 Skills 类型 ──────────────────────────────────────────────

/** Skill 定义 */
interface Skill {
  id: string
  name: string
  displayName: string
  description: string
  prompt: string
  modelId?: string
  allowedTools: string[]
  trigger: SkillTrigger
  variables: SkillVariable[]
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

/** Skill 变量定义 */
interface SkillVariable {
  name: string
  description: string
  required: boolean
  defaultValue?: string
}

/** Skill 意图匹配结果 */
interface SkillMatchResult {
  matched: boolean
  skillName: string | null
  confidence: number
  reason: string
}

// ─── 5.6 语音类型 ────────────────────────────────────────────────

/** 语音提供商 */
type VoiceProvider = 'openai' | 'azure' | 'custom'

/** TTS 语音音色 */
type TtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

/** TTS 音频格式 */
type TtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'

/** TTS 播放状态 */
type TtsPlayState = 'idle' | 'playing' | 'paused' | 'finished' | 'error'

/** STT 录音状态 */
type SttRecordState = 'idle' | 'recording' | 'transcribing' | 'error'

/** 实时语音模式状态 */
type VoiceModeState = 'off' | 'awaiting' | 'listening' | 'transcribing' | 'speaking'

/** TTS 配置 */
interface TtsConfig {
  /** 是否启用 TTS */
  enabled: boolean
  /** 服务提供商 */
  provider: VoiceProvider
  /** API Base URL */
  baseUrl: string
  /** API Key */
  apiKey: string
  /** 模型名称，如 tts-1, tts-1-hd */
  model: string
  /** 音色 */
  voice: TtsVoice
  /** 语速 0.25 ~ 4.0 */
  speed: number
  /** 音频格式 */
  format: TtsFormat
  /** 是否自动播报回复 */
  autoPlay: boolean
}

/** STT 配置 */
interface SttConfig {
  /** 是否启用 STT */
  enabled: boolean
  /** 服务提供商 */
  provider: VoiceProvider
  /** API Base URL */
  baseUrl: string
  /** API Key */
  apiKey: string
  /** 模型名称，如 whisper-1 */
  model: string
  /** 语言代码，空=自动检测 */
  language: string
  /** 温度 0.0 ~ 1.0 */
  temperature: number
}

/** 实时语音模式配置 */
interface VoiceModeConfig {
  /** VAD 静音阈值（秒）1.0 ~ 3.0 */
  vadSilenceThreshold: number
  /** 播报完毕是否自动进入等待说话状态 */
  autoAwait: boolean
}

/** 完整语音配置 */
interface VoiceConfig {
  tts: TtsConfig
  stt: SttConfig
  mode: VoiceModeConfig
}

/** TTS 合成选项（单次调用覆盖默认配置） */
interface TtsOptions {
  model?: string
  voice?: TtsVoice
  speed?: number
  format?: TtsFormat
}

/** STT 转录选项（单次调用覆盖默认配置） */
interface SttOptions {
  model?: string
  language?: string
  temperature?: number
}

/** 语音播放进度信息 */
interface TtsPlayProgress {
  messageId: string | null
  state: TtsPlayState
  currentTime: number
  duration: number
  volume: number
  playbackRate: number
}

/** 语音录音进度信息 */
interface SttRecordProgress {
  state: SttRecordState
  duration: number
  volume: number
  error?: string
}

// ─── 5.7 知识库类型 ──────────────────────────────────────────────

/** 文档记录 */
interface KbDocument {
  id: string
  filePath: string
  fileName: string
  fileType: 'pdf' | 'markdown' | 'txt' | 'docx' | 'xlsx' | 'csv'
  chunkCount: number
  status: 'indexing' | 'ready' | 'error'
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/** 文档分块 */
interface DocumentChunk {
  id: string
  documentId: string
  content: string
  tokenCount: number
  chunkIndex: number
  embedding?: number[]
}

/** 检索结果 */
interface SearchResult {
  chunkId: string
  documentId: string
  fileName: string
  content: string
  score: number
  chunkIndex: number
}

/** 索引进度事件 */
interface KbIndexProgress {
  documentId: string
  stage: 'parsing' | 'chunking' | 'embedding' | 'storing' | 'completed' | 'error'
  current: number
  total: number
  message?: string
}

/** 分块策略选项 */
interface ChunkingOptions {
  /** 分块策略 */
  strategy: 'fixed' | 'paragraph'
  /** 目标分块大小（token 数），默认 500 */
  chunkSize?: number
  /** 分块重叠大小（token 数），默认 50 */
  overlap?: number
  /** 最大分块大小（硬限制），默认 chunkSize * 1.5 */
  maxChunkSize?: number
}

/** 导入结果 */
interface ImportResult {
  documentId: string
  fileName: string
  status: KbDocument['status']
  chunkCount: number
  totalTokens: number
}

/** 知识库统计信息 */
interface KbStats {
  totalDocs: number
  readyDocs: number
  errorDocs: number
  indexingDocs: number
  totalChunks: number
  embeddedChunks: number
  pendingEmbeddings: number
}

// ─── 5.7 工作区类型 ──────────────────────────────────────────────

/** 工作区配置 */
interface WorkspaceConfig {
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
interface FileTreeNode {
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
interface WorkspaceDirectoryEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

// ─── 5.8 错误类型 ────────────────────────────────────────────────

/** 应用统一错误 */
class AppError extends Error {
  public code: string
  public details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details }
  }
}

// ─── 导出 ──────────────────────────────────────────────────────

export type {
  ApprovalMode,
  MessageRole,
  ExecutionStatus,
  ModelProvider,
  TransportType,
  ToolRiskLevel,
  SkillTrigger,
  StreamChunkType,
  VoiceProvider,
  TtsVoice,
  TtsFormat,
  TtsPlayState,
  SttRecordState,
  VoiceModeState,
  MCPServerStatus,
  Conversation,
  ChatMessage,
  ToolCallRecord,
  MessageMetadata,
  ModelConfig,
  ModelCapabilities,
  AppSettings,
  ShortcutConfig,
  StreamChunk,
  StreamEndMetadata,
  StreamError,
  AgentExecutionRequest,
  ExecutionResult,
  TAOTrajectory,
  ToolAction,
  ApprovalRequest,
  ApprovalResponse,
  ToolDefinition,
  ToolExecutionResult,
  MCPServerConfig,
  ITransport,
  Skill,
  SkillVariable,
  SkillMatchResult,
  VoiceConfig,
  TtsConfig,
  SttConfig,
  VoiceModeConfig,
  TtsOptions,
  SttOptions,
  TtsPlayProgress,
  SttRecordProgress,
  WorkspaceConfig,
  FileTreeNode,
  WorkspaceDirectoryEntry,
  KbDocument,
  DocumentChunk,
  SearchResult,
  KbIndexProgress,
  ChunkingOptions,
  ImportResult,
  KbStats,
}

export { AppError }
