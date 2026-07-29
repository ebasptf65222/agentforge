// window.electron 的类型声明
// Preload 通过 contextBridge.exposeInMainWorld 暴露的 API 类型
import type {
  Conversation,
  ChatMessage,
  ModelConfig,
  AppSettings,
  ModelProvider,
  ModelCapabilities,
  ApprovalMode,
  StreamChunk,
  StreamEndMetadata,
  StreamError,
  TAOTrajectory,
  ApprovalRequest,
  ExecutionResult,
  MCPServerConfig,
  MCPServerStatus,
  Skill,
  SkillVariable,
  SkillTrigger,
  PromptTemplate,
  KbDocument,
  SearchResult,
  ChunkingOptions,
  ImportResult,
  KbStats,
  VoiceConfig,
  TtsConfig,
  SttConfig,
  TtsOptions,
  SttOptions,
  FileTreeNode,
  WorkspaceDirectoryEntry,
  WikiStatus,
  WikiPageSummary,
  AuditReport,
  AuditInput,
  ActiveSessionInfo,
  UserInputResponse,
  ElicitationResponse,
  Checkpoint,
  CheckpointDiff,
} from '@shared/types'

/** 文件过滤器 */
interface FileFilter {
  name: string
  extensions: string[]
}

/** 版本信息 */
interface VersionInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
}

/** 模型连接测试结果 */
interface ModelTestResult {
  success: boolean
  latency: number
  error?: string
}

/** 创建会话参数 */
interface CreateConversationParams {
  title?: string
  modelId: string
  approvalMode?: ApprovalMode
}

/** 创建模型参数 */
interface CreateModelParams {
  name: string
  provider: ModelProvider
  modelId: string
  apiKey: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  capabilities?: Partial<ModelCapabilities>
}

/** 更新模型参数 */
interface UpdateModelParams {
  id: string
  name?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  isDefault?: boolean
  capabilities?: Partial<ModelCapabilities>
}

/** 文件选择参数 */
interface SelectFileParams {
  title?: string
  defaultPath?: string
  filters?: FileFilter[]
}

/** 目录选择参数 */
interface SelectDirParams {
  title?: string
  defaultPath?: string
}

/** Fork 会话参数 */
interface ForkConversationParams {
  sourceConversationId: string
  messageCount?: number
}

/** 会话分支树返回 */
interface ConversationTreeResult {
  ancestors: Conversation[]
  children: Conversation[]
}

/** Chat 命名空间 */
interface ChatAPI {
  createConversation(params: CreateConversationParams): Promise<Conversation>
  listConversations(): Promise<Conversation[]>
  getConversation(id: string): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  updateTitle(id: string, title: string): Promise<Conversation>
  getMessages(conversationId: string): Promise<ChatMessage[]>
  send(conversationId: string, content: string, modelId: string, kbEnabled?: boolean): Promise<void>
  stop(): Promise<void>
  onStreamChunk(callback: (chunk: StreamChunk) => void): () => void
  onStreamEnd(callback: (meta: StreamEndMetadata) => void): () => void
  onStreamError(callback: (error: StreamError) => void): () => void
  /** P3-01: Fork 一个会话 */
  forkConversation(sourceConversationId: string, messageCount?: number): Promise<Conversation>
  /** P3-01: 获取会话分支树 */
  getConversationTree(id: string): Promise<ConversationTreeResult>
}

/** Model 命名空间 */
interface ModelAPI {
  list(): Promise<ModelConfig[]>
  create(params: CreateModelParams): Promise<ModelConfig>
  update(params: UpdateModelParams): Promise<void>
  delete(id: string): Promise<void>
  test(id: string): Promise<ModelTestResult>
  get(id: string): Promise<ModelConfig>
}

/** Settings 命名空间 */
interface SettingsAPI {
  get(): Promise<AppSettings>
  update(settings: Partial<Omit<AppSettings, 'updatedAt'>>): Promise<void>
}

/** File 命名空间 */
interface FileAPI {
  selectDir(params?: SelectDirParams): Promise<string | null>
  selectFile(params?: SelectFileParams): Promise<string | null>
}

/** System 命名空间 */
interface SystemAPI {
  getVersion(): Promise<VersionInfo>
  openExternal(url: string): Promise<void>
}

/** Agent 执行参数 */
interface AgentExecuteParams {
  conversationId: string
  userInput: string
  modelId: string
  approvalMode: ApprovalMode
  maxSteps?: number
  skillName?: string
}

/** Agent 审批参数 */
interface AgentApproveParams {
  executionId: string
  approved: boolean
  reason?: string
}

/** Agent 命名空间 */
interface AgentAPI {
  execute(params: AgentExecuteParams): Promise<ExecutionResult>
  stop(): Promise<void>
  approve(params: AgentApproveParams): Promise<void>
  /** B7: 查询当前活跃的 SDK 会话列表 */
  listSessions(): Promise<ActiveSessionInfo[]>
  /** ask_user: 响应 AI 主动提问 */
  respondUserInput(params: UserInputResponse): Promise<void>
  /** elicitation: 响应表单交互请求 */
  respondElicitation(params: ElicitationResponse): Promise<void>
  onTrajectory(callback: (data: TAOTrajectory) => void): () => void
  onApprovalRequest(callback: (data: ApprovalRequest) => void): () => void
  onStreamChunk(callback: (data: StreamChunk) => void): () => void
}

/** OPT2-12: MCP 更新 Server 参数 */
interface McpUpdateParams {
  id: string
  name?: string
  transport?: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

/** MCP 添加 Server 参数 */
interface McpAddParams {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

/** MCP Server 状态信息 */
interface McpServerInfo {
  config: MCPServerConfig
  status: MCPServerStatus
  tools: unknown[]
}

/** P3-02: MCP 市场分类 */
type McpCategory = 'filesystem' | 'search' | 'database' | 'devtools' | 'productivity' | 'communication'

/** P3-02: MCP 环境变量键定义 */
interface McpEnvKey {
  key: string
  label: string
  required: boolean
  secret: boolean
  placeholder?: string
}

/** P3-02: MCP 市场目录条目 */
interface McpCatalogEntry {
  id: string
  name: string
  description: string
  category: McpCategory
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  envKeys?: McpEnvKey[]
  icon: string
  homepage?: string
}

/** P3-02: 安装结果 */
interface McpInstallResult {
  config: MCPServerConfig
  entry: McpCatalogEntry
}

/** MCP 命名空间 */
interface McpAPI {
  add(params: McpAddParams): Promise<MCPServerConfig>
  update(params: McpUpdateParams): Promise<MCPServerConfig>
  remove(id: string): Promise<void>
  list(): Promise<MCPServerConfig[]>
  getStatus(id: string): Promise<McpServerInfo>
  toggleEnable(id: string, enabled: boolean): Promise<void>
  /** P3-02: 获取市场目录（可按分类或关键词过滤） */
  catalogList(params?: { category?: McpCategory; query?: string }): Promise<McpCatalogEntry[]>
  /** P3-02: 获取单个目录条目 */
  catalogGet(id: string): Promise<McpCatalogEntry>
  /** P3-02: 一键安装预置 MCP Server */
  catalogInstall(id: string, env?: Record<string, string>): Promise<McpInstallResult>
}

/** 创建 Skill 参数 */
interface CreateSkillParams {
  name: string
  displayName: string
  description: string
  prompt: string
  modelId?: string
  allowedTools: string[]
  trigger: SkillTrigger
  variables?: SkillVariable[]
}

/** 更新 Skill 参数 */
interface UpdateSkillParams {
  id: string
  displayName?: string
  description?: string
  prompt?: string
  modelId?: string | null
  allowedTools?: string[]
  trigger?: SkillTrigger
  variables?: SkillVariable[]
}

/** Skill 列表查询参数 */
interface ListSkillParams {
  trigger?: SkillTrigger
  builtinOnly?: boolean
}

/** Skill 命名空间 */
interface SkillAPI {
  list(params?: ListSkillParams): Promise<Skill[]>
  get(id: string): Promise<Skill>
  getByName(name: string): Promise<Skill | null>
  create(params: CreateSkillParams): Promise<Skill>
  update(params: UpdateSkillParams): Promise<void>
  delete(id: string): Promise<void>
}

/** KB 导入参数 */
interface KbImportParams {
  filePath: string
  fileName: string
  fileType: KbDocument['fileType']
  chunking?: ChunkingOptions
}

/** KB 重新导入参数 */
interface KbReimportParams {
  id: string
  chunking?: ChunkingOptions
}

/** KB 列表查询参数 */
interface KbListParams {
  status?: KbDocument['status']
}

/** KB 搜索参数 */
interface KbSearchParams {
  query: string
  topK?: number
  documentId?: string
  threshold?: number
}

/** KB 索引参数 */
interface KbIndexParams {
  id: string
  batchSize?: number
}

/** Knowledge Base 命名空间 */
interface KbAPI {
  import(params: KbImportParams): Promise<ImportResult>
  list(params?: KbListParams): Promise<KbDocument[]>
  get(id: string): Promise<KbDocument>
  delete(id: string): Promise<void>
  reimport(params: KbReimportParams): Promise<ImportResult>
  search(params: KbSearchParams): Promise<SearchResult[]>
  index(params: KbIndexParams): Promise<number>
  reindex(params: KbIndexParams): Promise<number>
  stats(): Promise<KbStats>
}

/** Window 命名空间（窗口控制 + 自定义菜单） */
interface WindowAPI {
  minimize(): Promise<void>
  maximizeToggle(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  toggleDevtools(): Promise<void>
  quit(): Promise<void>
  onMaximizeChange(callback: (maximized: boolean) => void): () => void
}

/** Workspace 命名空间（本地文件工作区操作） */
interface WorkspaceAPI {
  /** 读取工作区内文件 */
  read(path: string): Promise<string>
  /** 写入工作区内文件，返回写入字节数 */
  write(path: string, content: string): Promise<number>
  /** 列出工作区内目录条目 */
  list(path?: string): Promise<WorkspaceDirectoryEntry[]>
  /** 创建目录 */
  mkdir(path: string): Promise<void>
  /** 删除文件或空目录 */
  delete(path: string): Promise<void>
  /** 重命名/移动 */
  rename(from: string, to: string): Promise<void>
  /** 获取文件树 */
  tree(path?: string, maxDepth?: number): Promise<FileTreeNode>
}

/** 语音 API（TTS + STT） */
interface VoiceAPI {
  // ─── TTS ───
  /** 合成语音，返回音频 ArrayBuffer */
  synthesize(text: string, options?: TtsOptions): Promise<ArrayBuffer>
  // OPT2-05: 修复返回类型与实际实现一致（preload 返回 ArrayBuffer）
  /** 测试 TTS 配置（合成一句测试音频），返回音频 ArrayBuffer */
  testTts(config: VoiceConfig): Promise<ArrayBuffer>

  // ─── STT ───
  /** 上传音频并转录，返回识别文本 */
  transcribe(audioBuffer: ArrayBuffer, options?: SttOptions): Promise<string>
  /** 测试 STT 配置 */
  testStt(config: VoiceConfig): Promise<string>

  // ─── 配置 ───
  /** 获取语音配置 */
  getConfig(): Promise<VoiceConfig>
  /** 保存语音配置 */
  saveConfig(config: VoiceConfig): Promise<void>
}

/** Wiki 命名空间 (LLM Wiki / Karpathy 模式) */
interface WikiAPI {
  /** 获取 Wiki 当前状态（初始化状态、统计、页面列表） */
  status(): Promise<WikiStatus>
  /** 初始化 Wiki 工作区结构 */
  init(): Promise<{ success: boolean }>
  /** 将文件添加到 raw/ 目录 */
  ingest(sourcePath: string): Promise<{ rawRelPath: string; fileName: string }>
}

/** Audit 命名空间（工作流审计） */
interface AuditAPI {
  /** 触发审计评估，返回审计报告 */
  run(params: AuditInput): Promise<AuditReport>
  /** 监听审计报告推送事件 */
  onReport(callback: (report: AuditReport) => void): () => void
}

/** 创建 Prompt 模板参数 */
interface CreatePromptTemplateParams {
  title: string
  content: string
  category?: string
  variables?: string[]
}

/** 更新 Prompt 模板参数 */
interface UpdatePromptTemplateParams {
  id: string
  title?: string
  content?: string
  category?: string
  variables?: string[]
}

/** Prompt 模板列表查询参数 */
interface ListPromptTemplateParams {
  category?: string
}

/** Prompt Template 命名空间（Prompt 模板库） */
interface PromptTemplateAPI {
  /** 获取所有模板，可选按分类过滤 */
  list(params?: ListPromptTemplateParams): Promise<PromptTemplate[]>
  /** 获取单个模板（不存在时返回 null） */
  get(id: string): Promise<PromptTemplate | null>
  /** 创建模板 */
  create(params: CreatePromptTemplateParams): Promise<PromptTemplate>
  /** 更新模板（仅更新提供的字段） */
  update(id: string, data: Omit<UpdatePromptTemplateParams, 'id'>): Promise<void>
  /** 删除模板 */
  delete(id: string): Promise<void>
}

/** Checkpoint 列表查询参数 */
interface CheckpointListParams {
  relativePath?: string
  executionId?: string
  limit?: number
  offset?: number
}

/** Checkpoint 列表返回 */
interface CheckpointListResult {
  checkpoints: Checkpoint[]
  count: number
}

/** Checkpoint 回滚参数 */
interface CheckpointRollbackParams {
  checkpointId: number
}

/** Checkpoint 回滚结果 */
interface CheckpointRollbackResult {
  success: boolean
  relativePath: string
  action: string
  restored: boolean
}

/** Checkpoint Diff 参数 */
interface CheckpointDiffParams {
  checkpointId: number
}

/** Checkpoint 历史参数 */
interface CheckpointHistoryParams {
  relativePath: string
  limit?: number
}

/** Checkpoint 历史返回 */
interface CheckpointHistoryResult {
  checkpoints: Checkpoint[]
  relativePath: string
}

/** Checkpoint 清理参数 */
interface CheckpointCleanupParams {
  retentionDays?: number
  keepPerFile?: number
}

/** Checkpoint 清理返回 */
interface CheckpointCleanupResult {
  deleted: number
}

/** Checkpoint 删除参数 */
interface CheckpointDeleteParams {
  checkpointId: number
}

/** Checkpoint 删除返回 */
interface CheckpointDeleteResult {
  deleted: boolean
}

/** Checkpoint 命名空间（快照与回滚） */
interface CheckpointAPI {
  /** 获取快照列表（可按路径/执行 ID 过滤） */
  list(params?: CheckpointListParams): Promise<CheckpointListResult>
  /** 回滚到指定快照 */
  rollback(params: CheckpointRollbackParams): Promise<CheckpointRollbackResult>
  /** 获取快照与当前文件的差异 */
  diff(params: CheckpointDiffParams): Promise<CheckpointDiff>
  /** 获取指定文件的快照历史 */
  history(params: CheckpointHistoryParams): Promise<CheckpointHistoryResult>
  /** 清理旧快照 */
  cleanup(params?: CheckpointCleanupParams): Promise<CheckpointCleanupResult>
  /** 删除指定快照 */
  delete(params: CheckpointDeleteParams): Promise<CheckpointDeleteResult>
}

/** window.electron 完整类型 */
interface ElectronAPI {
  chat: ChatAPI
  model: ModelAPI
  settings: SettingsAPI
  file: FileAPI
  system: SystemAPI
  agent: AgentAPI
  mcp: McpAPI
  skill: SkillAPI
  kb: KbAPI
  voice: VoiceAPI
  window: WindowAPI
  workspace: WorkspaceAPI
  wiki: WikiAPI
  audit: AuditAPI
  promptTemplate: PromptTemplateAPI
  checkpoint: CheckpointAPI
}

export type {
  FileFilter,
  VersionInfo,
  ModelTestResult,
  CreateConversationParams,
  CreateModelParams,
  UpdateModelParams,
  SelectFileParams,
  SelectDirParams,
  ChatAPI,
  ModelAPI,
  SettingsAPI,
  FileAPI,
  SystemAPI,
  AgentExecuteParams,
  AgentApproveParams,
  AgentAPI,
  McpAddParams,
  McpUpdateParams,
  McpServerInfo,
  McpAPI,
  McpCategory,
  McpEnvKey,
  McpCatalogEntry,
  McpInstallResult,
  CreateSkillParams,
  UpdateSkillParams,
  ListSkillParams,
  SkillAPI,
  KbImportParams,
  KbReimportParams,
  KbListParams,
  KbSearchParams,
  KbIndexParams,
  KbAPI,
  VoiceAPI,
  WindowAPI,
  WorkspaceAPI,
  ElectronAPI,
  AuditAPI,
  CreatePromptTemplateParams,
  UpdatePromptTemplateParams,
  ListPromptTemplateParams,
  PromptTemplateAPI,
  CheckpointAPI,
  CheckpointListParams,
  CheckpointListResult,
  CheckpointRollbackParams,
  CheckpointRollbackResult,
  CheckpointDiffParams,
  CheckpointHistoryParams,
  CheckpointHistoryResult,
  CheckpointCleanupParams,
  CheckpointCleanupResult,
  CheckpointDeleteParams,
  CheckpointDeleteResult,
  ForkConversationParams,
  ConversationTreeResult,
}
