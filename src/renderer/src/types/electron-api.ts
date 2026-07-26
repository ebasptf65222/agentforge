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

/** Chat 命名空间 */
interface ChatAPI {
  createConversation(params: CreateConversationParams): Promise<Conversation>
  listConversations(): Promise<Conversation[]>
  getConversation(id: string): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  getMessages(conversationId: string): Promise<ChatMessage[]>
  send(conversationId: string, content: string, modelId: string): Promise<void>
  stop(): Promise<void>
  onStreamChunk(callback: (chunk: StreamChunk) => void): () => void
  onStreamEnd(callback: (meta: StreamEndMetadata) => void): () => void
  onStreamError(callback: (error: StreamError) => void): () => void
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
  onTrajectory(callback: (data: TAOTrajectory) => void): () => void
  onApprovalRequest(callback: (data: ApprovalRequest) => void): () => void
  onStreamChunk(callback: (data: StreamChunk) => void): () => void
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

/** MCP 命名空间 */
interface McpAPI {
  add(params: McpAddParams): Promise<MCPServerConfig>
  remove(id: string): Promise<void>
  list(): Promise<MCPServerConfig[]>
  getStatus(id: string): Promise<McpServerInfo>
  toggleEnable(id: string, enabled: boolean): Promise<void>
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
  McpServerInfo,
  McpAPI,
  ElectronAPI,
}
