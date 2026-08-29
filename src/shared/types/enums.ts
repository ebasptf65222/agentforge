// AgentForge 共享类型定义 - 枚举与基础类型别名
// 与 Spec v0.2 §5 完全一致
// 主进程和渲染进程通过 @shared/types alias 导入

// ─── 5.1 核心枚举 ────────────────────────────────────────────────

/** Agent 审批模式 */
export type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto'

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** 执行状态 */
export type ExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

/** 模型提供商 */
export type ModelProvider = 'openai' | 'deepseek' | 'anthropic' | 'custom'

/** MCP 传输类型 */
export type TransportType = 'stdio' | 'http'

/** Agent 执行引擎类型 */
export type EngineType = 'copilot-sdk' | 'langgraph'

/** 工具风险等级 */
export type ToolRiskLevel = 'low' | 'medium' | 'high'

/** Skill 触发方式 */
export type SkillTrigger = 'auto' | 'manual'

/** 流式 chunk 类型 */
export type StreamChunkType =
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
  | 'node-update'

// ─── MCP Server 状态 ─────────────────────────────────────────────

/** MCP Server 状态 */
export type MCPServerStatus = 'connected' | 'disconnected' | 'error' | 'connecting'

// ─── 5.6 语音枚举 ────────────────────────────────────────────────

/** 语音提供商 */
export type VoiceProvider = 'openai' | 'azure' | 'mimo' | 'custom'

/** TTS 语音音色（字符串类型，适配不同提供商的音色名） */
export type TtsVoice = string

/** TTS 音频格式（pcm16 用于 MiMo 流式，wav 用于 MiMo 非流式） */
export type TtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | 'pcm16'

/** TTS 播放状态 */
export type TtsPlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

/** STT 录音状态 */
export type SttRecordState = 'idle' | 'recording' | 'transcribing' | 'error'

/** 实时语音模式状态 */
export type VoiceModeState = 'off' | 'awaiting' | 'listening' | 'transcribing' | 'speaking'

// ─── 5.7.1 代码库索引枚举 (CB) ────────────────────────────────

/** 代码库文件状态 */
export type CodebaseFileStatus = 'pending' | 'indexing' | 'ready' | 'error'

/** 支持的编程语言 */
export type CodebaseLanguage =
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
export type SymbolType =
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
export type SymbolVisibility = 'public' | 'private' | 'protected' | 'default'

/** 代码分块类型 */
export type CodeChunkType = 'module' | 'function' | 'class' | 'block' | 'comment'

// ─── 5.7a Git 工作流枚举 (P1-03) ────────────────────────────────

/** Git 文件状态码 */
export type GitStatusCode =
  | 'modified' // 修改
  | 'added' // 新增
  | 'deleted' // 删除
  | 'renamed' // 重命名
  | 'copied' // 复制
  | 'untracked' // 未跟踪
  | 'ignored' // 被忽略
  | 'conflicted' // 冲突
  | 'type_changed' // 类型变更

/** Git 文件变更区域 */
export type GitFileArea = 'staged' | 'unstaged' | 'untracked'

/** Git diff 模式 */
export type GitDiffMode = 'unstaged' | 'staged' | 'committed' | 'branch'

// ─── 5.7b 浏览器工具枚举 (P2-01) ────────────────────────────────

/** 浏览器截图格式 */
export type BrowserScreenshotFormat = 'png' | 'jpeg'

// ─── 5.7c Checkpoint 快照枚举 (P2-02) ───────────────────────────

/** 快照操作类型 */
export type CheckpointAction = 'write' | 'delete' | 'rename'

// ─── 5.9 工作流审计枚举 ────────────────────────────────────────

/** 审计维度 */
export type AuditDimension =
  | 'task-understanding'
  | 'controlled-execution'
  | 'change-validation'
  | 'reliable-delivery'
  | 'learning-capture'

/** 证据状态（简化版：Missing / Present / Exercised） */
export type EvidenceState = 'missing' | 'present' | 'exercised'

/** 审计发现严重性 */
export type AuditSeverity = 'low' | 'medium' | 'high'

/** 支持轨道 */
export type SupportTrack = 'bootstrap' | 'operationalize' | 'optimize' | 'undetermined'
