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

/** Agent 执行引擎类型 */
type EngineType = 'builtin' | 'copilot-sdk'

/** 工具风险等级 */
type ToolRiskLevel = 'low' | 'medium' | 'high'

/** Skill 触发方式 */
type SkillTrigger = 'auto' | 'manual'

/** 流式 chunk 类型 */
type StreamChunkType =
  | 'text'
  | 'thinking'
  | 'tool-call'
  | 'error'
  | 'compaction'
  | 'tool-start'
  | 'tool-complete'
  | 'tool-progress'
  | 'title'
  | 'usage-info'
  | 'ask-user'
  | 'elicitation-request'

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
  engineType: EngineType
  /** SDK 引擎推理强度（仅 copilot-sdk 引擎生效） */
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
interface ActiveSessionInfo {
  conversationId: string
  sdkSessionId?: string
  lastUsedAt: number
  isCompacting: boolean
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
  /** 图片附件（dataUrl 格式），传给 SDK session.send */
  attachments?: Array<{ dataUrl: string; name: string; size: number }>
  /** 自定义代理配置（per-conversation，传给 SDK customAgents） */
  customAgents?: Array<{
    name: string
    displayName?: string
    description?: string
    tools?: string[] | null
    prompt: string
    infer?: boolean
    model?: string
    reasoningEffort?: string
    skills?: string[]
  }>
  /** 预选激活的代理名称 */
  activeAgent?: string
  /** 自定义斜杠命令 */
  commands?: Array<{ name: string; description?: string }>
  /** 系统提示词模式 */
  systemMessageMode?: 'append' | 'replace' | 'customize'
  /** 系统提示词分区配置 */
  systemMessageSections?: Record<string, {
    action: 'replace' | 'remove' | 'append' | 'prepend' | 'transform'
    content?: string
    transformDescription?: string
  }>
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

/** AI 主动提问请求（ask_user） */
interface UserInputRequest {
  /** 唯一请求 ID */
  requestId: string
  /** 关联的执行 ID */
  executionId: string
  /** AI 提出的问题 */
  prompt: string
}

/** AI 主动提问响应 */
interface UserInputResponse {
  /** 对应的请求 ID */
  requestId: string
  /** 用户的回答 */
  response: string
}

/** Elicitation 表单请求 */
interface ElicitationRequest {
  /** 唯一请求 ID */
  requestId: string
  /** 关联的执行 ID */
  executionId: string
  /** 表单提示消息 */
  message: string
  /** 表单字段定义 */
  form: Record<string, unknown>
}

/** Elicitation 表单响应 */
interface ElicitationResponse {
  /** 对应的请求 ID */
  requestId: string
  /** 用户填写的表单数据 */
  response: Record<string, unknown>
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

// ─── 5.6.1 Prompt 模板库类型 (PT-01) ────────────────────────────

/** Prompt 模板 */
interface PromptTemplate {
  id: string
  title: string
  content: string
  category: string
  /** 变量名列表（用于 {{变量名}} 插值） */
  variables: string[]
  createdAt: number
  updatedAt: number
}

// ─── 5.6 语音类型 ────────────────────────────────────────────────

/** 语音提供商 */
type VoiceProvider = 'openai' | 'azure' | 'mimo' | 'custom'

/** TTS 语音音色（字符串类型，适配不同提供商的音色名） */
type TtsVoice = string

/** TTS 音频格式（pcm16 用于 MiMo 流式，wav 用于 MiMo 非流式） */
type TtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | 'pcm16'

/** TTS 播放状态 */
type TtsPlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

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
  /** 内容 SHA-256 哈希（用于快速去重） */
  contentHash?: string
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

// ─── 5.7.1 代码库索引类型 (CB) ────────────────────────────────

/** 代码库文件状态 */
type CodebaseFileStatus = 'pending' | 'indexing' | 'ready' | 'error'

/** 支持的编程语言 */
type CodebaseLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'scala'
  | 'css'
  | 'scss'
  | 'html'
  | 'vue'
  | 'svelte'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'markdown'
  | 'sql'
  | 'shell'
  | 'dockerfile'
  | 'unknown'

/** 代码符号类型 */
type SymbolType =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'import'
  | 'export'
  | 'constant'
  | 'enum'

/** 符号可见性 */
type SymbolVisibility = 'public' | 'private' | 'protected' | 'default'

/** 代码分块类型 */
type CodeChunkType = 'module' | 'function' | 'class' | 'block' | 'comment'

/** 代码库文件记录 */
interface CodebaseFile {
  id: string
  filePath: string
  fileName: string
  language: CodebaseLanguage
  fileHash: string
  lineCount: number
  symbolCount: number
  chunkCount: number
  status: CodebaseFileStatus
  errorMessage?: string
  indexedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 代码符号 */
interface CodebaseSymbol {
  id: string
  fileId: string
  name: string
  qualifiedName: string
  symbolType: SymbolType
  visibility: SymbolVisibility
  signature?: string
  startLine: number
  endLine: number
  docComment?: string
  createdAt: number
}

/** 代码分块 */
interface CodebaseChunk {
  id: string
  fileId: string
  content: string
  chunkType: CodeChunkType
  symbolId?: string
  startLine: number
  endLine: number
  tokenCount: number
  chunkIndex: number
  embedding?: number[]
}

/** 代码库搜索结果 */
interface CodebaseSearchResult {
  chunkId: string
  fileId: string
  filePath: string
  fileName: string
  language: CodebaseLanguage
  content: string
  chunkType: CodeChunkType
  startLine: number
  endLine: number
  score: number
}

/** 代码库索引进度事件 */
interface CodebaseIndexProgress {
  stage: 'scanning' | 'parsing' | 'embedding' | 'completed' | 'error'
  current: number
  total: number
  currentFile?: string
  message?: string
}

/** 代码库统计信息 */
interface CodebaseStats {
  totalFiles: number
  readyFiles: number
  errorFiles: number
  pendingFiles: number
  totalSymbols: number
  totalChunks: number
  embeddedChunks: number
  pendingEmbeddings: number
  languages: Array<{ language: CodebaseLanguage; fileCount: number }>
}

// ─── 5.7a Git 工作流类型 (P1-03) ────────────────────────────────

/** Git 文件状态码 */
type GitStatusCode =
  | 'modified'     // 修改
  | 'added'        // 新增
  | 'deleted'      // 删除
  | 'renamed'      // 重命名
  | 'copied'       // 复制
  | 'untracked'    // 未跟踪
  | 'ignored'      // 被忽略
  | 'conflicted'   // 冲突
  | 'type_changed' // 类型变更

/** Git 文件变更区域 */
type GitFileArea = 'staged' | 'unstaged' | 'untracked'

/** Git 文件变更信息 */
interface GitFileChange {
  /** 文件路径 */
  filePath: string
  /** 暂存区状态码 */
  stagedStatus: GitStatusCode | null
  /** 工作区状态码 */
  unstagedStatus: GitStatusCode | null
  /** 所属区域 */
  area: GitFileArea
}

/** Git 状态摘要 */
interface GitStatus {
  /** 当前分支名 */
  branch: string
  /** 上游分支（如 origin/main），无则为 null */
  upstream: string | null
  /** 领先上游的提交数 */
  ahead: number
  /** 落后上游的提交数 */
  behind: number
  /** 暂存的文件变更 */
  staged: GitFileChange[]
  /** 未暂存的文件变更 */
  unstaged: GitFileChange[]
  /** 未跟踪的文件 */
  untracked: GitFileChange[]
  /** 是否有冲突 */
  hasConflicts: boolean
  /** HEAD 提交哈希（短） */
  headSha: string | null
  /** 是否处于 rebase/cherry-pick/merge 状态 */
  inProgress: 'none' | 'rebase' | 'merge' | 'cherry-pick'
}

/** Git diff 模式 */
type GitDiffMode = 'unstaged' | 'staged' | 'committed' | 'branch'

/** Git diff 结果 */
interface GitDiffResult {
  /** diff 模式 */
  mode: GitDiffMode
  /** diff 原始输出 */
  patch: string
  /** 变更文件统计 */
  stats: GitDiffStat[]
  /** 是否被截断 */
  truncated: boolean
}

/** Git diff 单文件统计 */
interface GitDiffStat {
  filePath: string
  additions: number
  deletions: number
}

/** Git 提交日志条目 */
interface GitLogEntry {
  /** 完整 SHA */
  sha: string
  /** 短 SHA */
  shortSha: string
  /** 作者名 */
  author: string
  /** 作者邮箱 */
  authorEmail: string
  /** 提交时间（ISO 字符串） */
  date: string
  /** 提交消息 */
  message: string
  /** 引用分支列表 */
  refs: string[]
}

/** Git 分支信息 */
interface GitBranch {
  /** 分支名 */
  name: string
  /** 是否为当前分支 */
  isCurrent: boolean
  /** 是否为远程分支 */
  isRemote: boolean
  /** 上游跟踪分支 */
  upstream: string | null
  /** 最后提交 SHA（短） */
  lastCommitSha: string | null
}

/** Git 提交结果 */
interface GitCommitResult {
  /** 提交 SHA（完整） */
  sha: string
  /** 提交 SHA（短） */
  shortSha: string
  /** 提交消息 */
  message: string
  /** 变更文件数 */
  filesChanged: number
  /** 新增行数 */
  insertions: number
  /** 删除行数 */
  deletions: number
}

/** Git 创建分支结果 */
interface GitCreateBranchResult {
  /** 分支名 */
  branchName: string
  /** 是否已切换到新分支 */
  switched: boolean
  /** 基于的分支/提交 */
  baseRef: string
}

/** Git 创建 PR 结果 */
interface GitCreatePrResult {
  /** PR URL */
  url: string
  /** PR 编号 */
  number: number
  /** PR 标题 */
  title: string
  /** 目标分支 */
  base: string
  /** 源分支 */
  head: string
  /** 是否为草稿 */
  draft: boolean
}

// ─── 5.7b 浏览器工具类型 (P2-01) ────────────────────────────────

/** 浏览器页面信息 */
interface BrowserPageInfo {
  /** 当前 URL */
  url: string
  /** 页面标题 */
  title: string
  /** HTTP 状态码 */
  statusCode: number
  /** 页面加载耗时（毫秒） */
  loadTime: number
}

/** 浏览器 DOM 元素信息 */
interface BrowserElementInfo {
  /** 标签名 */
  tagName: string
  /** 元素 ID */
  id: string
  /** CSS 类名 */
  className: string
  /** 元素文本内容（截断） */
  text: string
  /** 属性列表 */
  attributes: Record<string, string>
  /** 是否可见 */
  isVisible: boolean
  /** 是否可点击 */
  isClickable: boolean
  /** 矩形位置 */
  rect: { x: number; y: number; width: number; height: number }
}

/** 浏览器截图格式 */
type BrowserScreenshotFormat = 'png' | 'jpeg'

/** 浏览器截图结果 */
interface BrowserScreenshotResult {
  /** Base64 编码的图片数据 */
  base64: string
  /** 图片格式 */
  format: BrowserScreenshotFormat
  /** 图片宽度 */
  width: number
  /** 图片高度 */
  height: number
  /** 是否截取完整页面 */
  fullPage: boolean
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

// ─── 5.8 LLM Wiki (Karpathy 模式) ────────────────────────────────

/** Wiki 页面摘要信息 */
interface WikiPageSummary {
  title: string
  path: string
  summary: string
}

/** Wiki 状态信息（用于渲染进程展示） */
interface WikiStatus {
  initialized: boolean
  rawCount: number
  pageCount: number
  lastIngest: string | null
  lastLint: string | null
  pages: WikiPageSummary[]
  rawFiles: string[]
  recentLogs: string
}

// ─── 5.9 工作流审计类型 ────────────────────────────────────────

/** 审计维度 */
type AuditDimension =
  | 'task-understanding'
  | 'controlled-execution'
  | 'change-validation'
  | 'reliable-delivery'
  | 'learning-capture'

/** 证据状态（简化版：Missing / Present / Exercised） */
type EvidenceState = 'missing' | 'present' | 'exercised'

/** 审计发现严重性 */
type AuditSeverity = 'low' | 'medium' | 'high'

/** 审计发现 */
interface AuditFinding {
  id: string
  dimension: AuditDimension
  checkId: string
  severity: AuditSeverity
  title: string
  description: string
  evidence: string
  impact: string
  repair: string
  evidenceState: EvidenceState
}

/** 维度检查项 */
interface DimensionCheck {
  checkId: string
  label: string
  evidenceState: EvidenceState
  description: string
}

/** 维度评分 */
interface DimensionScore {
  dimension: AuditDimension
  score: number
  evidenceState: EvidenceState
  checks: DimensionCheck[]
}

/** 支持轨道 */
type SupportTrack = 'bootstrap' | 'operationalize' | 'optimize' | 'undetermined'

/** 审计报告 */
interface AuditReport {
  id: string
  executionId: string
  conversationId: string
  timestamp: number
  dimensions: DimensionScore[]
  findings: AuditFinding[]
  overallScore: number
  supportTrack: SupportTrack
  summary: string
}

/** 审计输入参数 */
interface AuditInput {
  executionId: string
  conversationId: string
  trajectories: TAOTrajectory[]
  approvalMode: ApprovalMode
  totalSteps: number
  duration: number
  tokensUsed: number
  summary: string
}

// ─── 5.7c Checkpoint 快照类型 (P2-02) ───────────────────────────

/** 快照操作类型 */
type CheckpointAction = 'write' | 'delete' | 'rename'

/** 文件快照记录 */
interface Checkpoint {
  /** 快照 ID */
  id: number
  /** 关联的 Agent 执行 ID */
  executionId?: string
  /** 关联的会话 ID */
  conversationId?: string
  /** 工作区相对路径 */
  relativePath: string
  /** 原始内容（undefined 表示文件不存在或超大文件） */
  originalContent?: string
  /** 变更后的内容 */
  newContent: string
  /** 操作类型 */
  action: CheckpointAction
  /** 创建时间（Unix 毫秒） */
  createdAt: number
}

/** 快照差异信息 */
interface CheckpointDiff {
  relativePath: string
  checkpointId: number
  /** 当前文件是否存在 */
  currentExists: boolean
  /** 快照时的原始内容 */
  originalContent?: string
  /** 当前文件内容 */
  currentContent?: string
  /** 当前内容是否已再次变更 */
  hasChanged: boolean
}

// ─── 5.10 错误类型 ────────────────────────────────────────────────

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
  EngineType,
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
  ActiveSessionInfo,
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
  UserInputRequest,
  UserInputResponse,
  ElicitationRequest,
  ElicitationResponse,
  ToolDefinition,
  ToolExecutionResult,
  MCPServerConfig,
  ITransport,
  Skill,
  SkillVariable,
  SkillMatchResult,
  PromptTemplate,
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
  CodebaseFileStatus,
  CodebaseLanguage,
  SymbolType,
  SymbolVisibility,
  CodeChunkType,
  CodebaseFile,
  CodebaseSymbol,
  CodebaseChunk,
  CodebaseSearchResult,
  CodebaseIndexProgress,
  CodebaseStats,
  GitStatusCode,
  GitFileArea,
  GitFileChange,
  GitStatus,
  GitDiffMode,
  GitDiffResult,
  GitDiffStat,
  GitLogEntry,
  GitBranch,
  GitCommitResult,
  GitCreateBranchResult,
  GitCreatePrResult,
  BrowserPageInfo,
  BrowserElementInfo,
  BrowserScreenshotFormat,
  BrowserScreenshotResult,
  WikiPageSummary,
  WikiStatus,
  AuditDimension,
  EvidenceState,
  AuditSeverity,
  AuditFinding,
  DimensionCheck,
  DimensionScore,
  SupportTrack,
  AuditReport,
  AuditInput,
  CheckpointAction,
  Checkpoint,
  CheckpointDiff,
}

export { AppError }
