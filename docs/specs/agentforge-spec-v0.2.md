# AgentForge 开发规格说明书 v0.2

> 本文档面向 AI 自主开发，所有规格必须严格遵循。冲突时以本文档为准。
> v0.2 修复了 v0.1 技术评审中的 53 项问题（12 项 P0 阻塞 + 22 项 P1 严重 + 19 项 P2 改进）。
> 变更日志见文末 §20。

## 1. 项目目标

AgentForge 是一款本地优先的个人 AI Agent 工作台桌面应用。用户在本地对话下指令，Agent 自主调用工具完成任务。

### 核心价值

- 多模型可配置（OpenAI / DeepSeek 等）
- MCP 标准工具协议（JSON-RPC 2.0）
- 可自定义 Skills 工作流系统
- Agent 自主执行引擎（ReAct + 三档审批）
- 本地 RAG 知识库

### P1 阶段目标（Week 1-3）

达成第一个可运行闭环：

1. electron-vite 应用启动，主窗口显示
2. 配置一个模型（OpenAI 或 DeepSeek），API Key 本地加密存储
3. 创建会话，发送消息，SSE 流式输出到界面
4. Markdown 渲染 + 代码块高亮
5. 会话和消息持久化到 SQLite

### 非目标（v0.2 范围外）

- 云端同步 / 多端同步
- 插件市场
- 用户注册 / 登录系统
- 移动端适配
- 国际化（i18n）完整支持
- 模型微调 / 本地模型推理

## 2. 系统架构

### 进程模型

```
┌─────────────────────────────────────────────┐
│              Main Process (Node.js)          │
│  ┌──────────┐ ┌──────┐ ┌───────┐ ┌───────┐ │
│  │ Agent    │ │ MCP  │ │ Skills│ │  KB    │ │
│  │ Executor │ │Client│ │Engine │ │Engine │ │
│  └────┬─────┘ └──┬───┘ └───┬───┘ └───┬───┘ │
│       │         │        │         │       │
│  ┌────┴─────────┴────────┴─────────┴───┐  │
│  │          IPC Handlers               │  │
│  ├────────────────────────────────────┤  │
│  │          SQLite + LanceDB           │  │
│  └──────────────┬─────────────────────┘  │
└─────────────────┼───────────────────────┘
                  │ IPC (contextBridge)
┌─────────────────┼───────────────────────┐
│          Preload Script                 │
│  (contextBridge.exposeInMainWorld)     │
└─────────────────┼───────────────────────┘
                  │ window.electron.*
┌─────────────────┼───────────────────────┐
│          Renderer (Vue 3)               │
│  ┌──────┐ ┌──────────┐ ┌───────────┐  │
│  │Chat  │ │Execution │ │ Settings  │  │
│  │Panel │ │ Panel    │ │ Views     │  │
│  └──────┘ └──────────┘ └───────────┘  │
└────────────────────────────────────────┘
```

### 通信规则

- 渲染进程不直接访问 Node.js API，全部通过 `window.electron.*` 调用
- 主进程不直接操作 DOM，全部通过 IPC 事件推送
- IPC channel 命名格式：`domain:action`（如 `chat:send`）。Renderer→Main 用动词，Main→Renderer 事件用名词描述内容（如 `chat:stream-chunk`）

### 应用生命周期与资源管理 <!-- Updated in v0.2: 新增 R09/R10 修复 -->

- **单实例锁**：主进程启动时调用 `app.requestSingleInstanceLock()`，第二个实例启动时聚焦已有窗口并退出
- **资源清理**：`app.on('before-quit')` 中依次执行：
  1. 中止所有进行中的 AbortController（流式生成、Agent 执行）
  2. 关闭所有 MCP Server 子进程（P2）
  3. 关闭数据库连接（`db.close()`）
- **窗口状态持久化**：窗口尺寸和位置在 `resize`/`move` 事件（防抖 500ms）后写入 `app_settings`，下次启动恢复

### 渲染进程安全配置 <!-- Updated in v0.2: 修复 R04/R05 -->

BrowserWindow webPreferences 必须包含：

```typescript
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  navigateOnDragDrop: false,
  // CSP 通过 responseHeaders 注入
}
```

CSP 策略（在 `webRequest.onHeadersReceived` 中注入）：

```
default-src 'self'
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data:
font-src 'self' data:
connect-src 'self' https://api.openai.com https://api.deepseek.com
```

> `connect-src` 的域名列表随用户配置的模型 baseUrl 动态扩展。P1 阶段先硬编码 OpenAI 和 DeepSeek 域名。

## 3. 推荐目录结构

```
agentforge/
├── electron.vite.config.ts
├── electron-builder.yml          # P5
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── unocss.config.ts
├── vitest.config.ts              # 单元测试配置 <!-- Added in P1-02 -->
├── .nvmrc                         # Node 版本锁定
├── .env.example                   # 环境变量模板
├── src/
│   ├── main/
│   │   ├── index.ts               # 窗口创建、应用生命周期、单实例锁
│   │   ├── ipc/
│   │   │   ├── index.ts           # 汇总注册所有 handler
│   │   │   ├── chat.ts
│   │   │   ├── model.ts
│   │   │   ├── file.ts
│   │   │   ├── system.ts
│   │   │   ├── agent.ts           # P2
│   │   │   ├── mcp.ts             # P2
│   │   │   ├── skill.ts           # P3
│   │   │   └── kb.ts              # P3
│   │   ├── db/
│   │   │   ├── index.ts           # 连接初始化、PRAGMA、migration
│   │   │   ├── schema.sql         # 建表 SQL（含版本号）
│   │   │   └── repos/
│   │   │       ├── conversation.ts
│   │   │       ├── message.ts
│   │   │       ├── model-config.ts
│   │   │       └── app-settings.ts
│   │   ├── models/
│   │   │   ├── adapter.ts         # 抽象基类
│   │   │   ├── openai-adapter.ts
│   │   │   ├── deepseek-adapter.ts
│   │   │   └── router.ts          # 模型路由 + 缓存管理
│   │   ├── agent/                 # P2
│   │   ├── mcp/                   # P2
│   │   ├── tools/                 # P2
│   │   ├── skills/                # P3
│   │   ├── kb/                    # P3
│   │   └── utils/
│   │       ├── encryption.ts      # safeStorage 封装
│   │       ├── error.ts           # AppError + 错误码
│   │       ├── logger.ts
│   │       ├── id.ts              # UUID 生成
│   │       └── window-state.ts    # 窗口状态持久化（P1-03 后迁移到 app_settings 表） <!-- Added in P1-02 -->
│   ├── preload/
│   │   └── index.ts               # contextBridge + 类型导出
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.ts
│   │       ├── App.vue
│   │       ├── env.d.ts          # window.electron 类型声明
│   │       ├── types/
│   │       │   └── index.ts       # re-export @shared/types
│   │       ├── stores/
│   │       │   ├── chat.ts
│   │       │   ├── model.ts
│   │       │   ├── agent.ts      # P2
│   │       │   ├── mcp.ts        # P2
│   │       │   ├── skill.ts      # P3
│   │       │   ├── kb.ts         # P3
│   │       │   ├── settings.ts
│   │       │   └── ui.ts
│   │       ├── composables/
│   │       │   ├── use-chat.ts
│   │       │   ├── use-agent.ts   # P2
│   │       │   └── use-theme.ts
│   │       ├── components/
│   │       │   ├── ChatPanel/
│   │       │   ├── MessageItem/
│   │       │   ├── Sidebar/
│   │       │   ├── Settings/
│   │       │   ├── ExecutionPanel/ # P2
│   │       │   └── common/
│   │       ├── views/
│   │       │   ├── ChatView.vue
│   │       │   └── SettingsView.vue
│   │       ├── utils/
│   │       │   └── markdown.ts
│   │       └── styles/
│   │           └── main.css
│   └── shared/
│       └── types.ts               # 主进程和渲染进程共享类型
├── tests/                          # 测试目录
│   ├── unit/
│   └── e2e/                        # P5
└── resources/                      # 静态资源（图标等）
```

### 关键约定

- **类型共享**：共享类型放 `src/shared/types.ts`，`tsconfig.node.json` 和 `tsconfig.web.json` 都配置 `paths` alias `"@shared/*": ["src/shared/*"]`
- **Preload 类型导出**：preload 通过 `// src/renderer/src/env.d.ts` 声明 `window.electron` 的类型，引用 `@shared/types`
- **P 标注**：目录/文件后标注 `# P2` 表示该阶段才实现，P1 不创建这些文件
- **不存在的文件不要创建空文件占位**，按阶段实际需要创建

## 4. 技术栈约束

| 层级 | 技术 | 版本范围 | 说明 |
|------|------|---------|------|
| 构建 | electron-vite | ^2.3 | 三进程统一构建 |
| 运行时 | Electron | ^33.0 | |
| Node.js | Node | >=20.0 (LTS) | .nvmrc 锁定 |
| UI | Vue | ^3.5 | Composition API + `<script setup>` |
| 语言 | TypeScript | ^5.5 | strict 模式，禁用 `any` |
| 状态 | Pinia | ^2.2 | Setup Store 风格 |
| 样式 | UnoCSS | ^0.65 | 原子化 CSS，关闭 preflight reset |
| 组件库 | Naive UI | ^2.40 | 主题优先级高于 UnoCSS |
| 工具 | VueUse | ^11.0 | useDark, useMagicKeys 等 |
| 数据库 | better-sqlite3 | ^11.0 | 同步 API，需 electron-rebuild |
| 原生编译 | @electron/rebuild | ^3.6 | postinstall 自动编译原生模块 |
| 向量库 | LanceDB | ^0.18 | 本地向量检索（P3） |
| Markdown | marked | ^14.0 | |
| 代码高亮 | shiki | ^1.0 | 支持 VS Code 主题，暗色/亮色兼容 |
| XSS | DOMPurify | ^3.1 | |
| 模型 SDK | openai | ^4.0 | Node SDK |
| 测试 | vitest | ^2.0 | 单元测试 |
| 代码规范 | ESLint | ^9.0 | flat config |
| 格式化 | Prettier | ^3.3 | |

### 约束规则

1. **禁用 `nodeIntegration`**，预加载脚本使用 `contextBridge`
2. **禁用 `any`** 类型，所有函数参数和返回值必须显式类型。`AppError.details` 使用 `Record<string, unknown>` 而非 `any`
3. **渲染进程不直接 require Node 模块**，通过 preload bridge
4. **不使用 Vue Router**，采用单窗口视图切换
5. **不使用 CSS 预处理器**（Sass/Less），使用 UnoCSS
6. **package.json 的 `postinstall`** 必须包含 `electron-rebuild -f -w better-sqlite3`
7. **UnoCSS 配置** `preflights: false`，避免与 Naive UI 的 reset 冲突

## 5. 数据模型与类型定义 <!-- Updated in v0.2: 补全所有缺失类型，修复 T01-T11 -->

### 5.1 核心枚举

```typescript
// src/shared/types.ts

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
```

### 5.2 核心实体接口

```typescript
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
  thinking?: string                    // assistant 推理过程
  toolCalls?: ToolCallRecord[]          // assistant 发起的工具调用
  metadata?: MessageMetadata            // 附加元信息
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
  tokensUsed?: number                  // input + output token 总数
  duration?: number                     // 生成耗时（毫秒）
  stopped?: boolean                     // 用户手动停止
  [key: string]: unknown               // 扩展字段
}

/** 模型配置 */
interface ModelConfig {
  id: string
  name: string
  provider: ModelProvider
  modelId: string
  apiKey: string                        // 运行时解密后的明文，仅内存中
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
  maxContextLength: number              // token 数
}

/** 应用设置 */
interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  defaultApprovalMode: ApprovalMode
  maxExecutionSteps: number
  defaultModelId: string | null
  shortcuts: ShortcutConfig
  approvalTimeoutMs: number             // 审批超时，默认 300000 (5min)
  // 窗口状态持久化
  windowBounds?: { x: number; y: number; width: number; height: number; isMaximized: boolean }
  updatedAt: number
}

/** 快捷键配置 */
interface ShortcutConfig {
  newConversation: string              // 默认 'CmdOrCtrl+N'
  sendMessage: string                  // 默认 'Enter'
  stopGeneration: string                // 默认 'CmdOrCtrl+.'（UI 按钮）
  toggleSidebar: string                // 默认 'CmdOrCtrl+B'
}
```

### 5.3 流式与 IPC 类型 <!-- 修复 T01 -->

```typescript
/** 流式 chunk（ModelAdapter 产出 / IPC 事件传输） */
interface StreamChunk {
  type: StreamChunkType
  content: string
  done?: boolean                        // 是否为最后一个 chunk
}

/** 流式结束元信息 */
interface StreamEndMetadata {
  messageId: string
  tokensUsed: number
  duration: number                      // 毫秒
  modelId: string
  stopped: boolean                      // 是否被用户停止
}

/** 流式错误 */
interface StreamError {
  code: string
  message: string
  details?: Record<string, unknown>
}
```

### 5.4 Agent 执行类型 <!-- 修复 T02, T03, T04 -->

```typescript
/** Agent 执行请求 */
interface AgentExecutionRequest {
  conversationId: string
  userInput: string
  modelId: string
  skillName?: string                    // 可选：指定 Skill 执行
  approvalMode: ApprovalMode
  maxSteps: number
}

/** Agent 执行结果 */
interface ExecutionResult {
  executionId: string
  status: ExecutionStatus
  summary: string                       // 最终输出文本
  trajectories: TAOTrajectory[]        // 完整执行轨迹
  totalSteps: number
  duration: number                      // 毫秒
  tokensUsed: number
}

/** TAO 轨迹（单步） */
interface TAOTrajectory {
  step: number
  thought: string                       // LLM 推理文本
  action: ToolAction | null             // 工具调用（finish 时为 null）
  observation: string                   // 工具返回结果
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
  reason: string                        // 为什么需要审批
}

/** 审批响应 */
interface ApprovalResponse {
  executionId: string
  step: number
  approved: boolean
  reason?: string
}
```

### 5.5 工具与 MCP 类型 <!-- 修复 T04, T08, T09 -->

```typescript
/** 工具定义（注册到 Agent 的工具描述） */
interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema 格式
  riskLevel: ToolRiskLevel
  source: 'builtin' | 'mcp'
}

/** 工具执行结果 */
interface ToolExecutionResult {
  isError: boolean
  content: string                       // 文本结果
  metadata?: Record<string, unknown>
}

/** MCP Server 配置 */
interface MCPServerConfig {
  id: string
  name: string
  transport: TransportType
  command?: string                      // stdio 模式
  args?: string[]                       // stdio 模式
  env?: Record<string, string>          // stdio 模式
  url?: string                           // http 模式
  headers?: Record<string, string>      // http 模式
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
```

### 5.6 Skills 类型 <!-- 修复 T01/T06 变量 -->

```typescript
/** Skill 定义 */
interface Skill {
  id: string
  name: string                          // 唯一标识，用于匹配
  displayName: string
  description: string
  prompt: string                        // System Prompt 模板，支持 {{variable}} 替换
  modelId?: string                      // 可选：指定执行模型
  allowedTools: string[]                // 允许调用的工具名称列表
  trigger: SkillTrigger
  variables: SkillVariable[]            // 可选变量定义
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

/** Skill 变量定义 */
interface SkillVariable {
  name: string                          // 替换占位符名，对应 prompt 中的 {{name}}
  description: string
  required: boolean
  defaultValue?: string
}

/** Skill 意图匹配结果 */
interface SkillMatchResult {
  matched: boolean
  skillName: string | null
  confidence: number                    // 0-1
  reason: string                        // LLM 判断理由
}
```

### 5.7 知识库类型 <!-- 修复 T06, T07 -->

```typescript
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
  chunkIndex: number                    // 在文档中的顺序
  embedding?: number[]                  // 向量（存储到 LanceDB，不在 SQLite）
}

/** 检索结果 */
interface SearchResult {
  chunkId: string
  documentId: string
  fileName: string
  content: string                      // 原文片段
  score: number                         // 相关度分数 0-1
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
```

### 5.8 错误类型 <!-- 修复 AppError.details any -->

```typescript
/** 应用统一错误 */
class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details }
  }
}
```

## 6. SQLite 表结构 <!-- Updated in v0.2: 修复 D01-D06 + R03/R06 -->

数据库路径：`app.getPath('userData')/agentforge.db`
驱动：`better-sqlite3`

### 6.1 PRAGMA 配置（连接初始化时执行）

```sql
PRAGMA journal_mode = WAL;          -- 写入不阻塞读取
PRAGMA foreign_keys = ON;           -- 启用外键约束（SQLite 默认关闭）
PRAGMA busy_timeout = 5000;         -- 并发访问等待 5s
```

### 6.2 Schema 版本管理 <!-- 修复 R06 -->

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (1, strftime('%s','now') * 1000, 'Initial schema - P1 tables');
```

> 每次新增表或列时递增 version，并在 `src/main/db/migrations/` 下新增迁移脚本。应用启动时检查当前 version，依次执行未应用的迁移。

### 6.3 conversations

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  model_id       TEXT NOT NULL REFERENCES model_configs(id),  -- 修复 D01: 新增外键
  approval_mode  TEXT NOT NULL DEFAULT 'auto-edit'
                 CHECK(approval_mode IN ('suggest', 'auto-edit', 'full-auto')),
  message_count  INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  created_at     INTEGER NOT NULL,    -- Unix 毫秒
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);  -- 修复 D04
```

### 6.4 messages

```sql
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL
                  CHECK(role IN ('user', 'assistant', 'system', 'tool')),  -- 修复 D02
  content         TEXT NOT NULL DEFAULT '',
  thinking        TEXT,
  tool_calls      TEXT,    -- JSON: ToolCallRecord[]
  metadata        TEXT,    -- JSON: MessageMetadata
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
```

### 6.5 model_configs

```sql
CREATE TABLE IF NOT EXISTS model_configs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL
                CHECK(provider IN ('openai', 'deepseek', 'anthropic', 'custom')),  -- 修复 D03
  model_id      TEXT NOT NULL,
  api_key       TEXT NOT NULL,         -- safeStorage 加密后的密文
  base_url      TEXT,
  temperature   REAL NOT NULL DEFAULT 0.7,
  max_tokens    INTEGER NOT NULL DEFAULT 4096,
  is_default    INTEGER NOT NULL DEFAULT 0,
  capabilities  TEXT NOT NULL DEFAULT '{"streaming":true,"toolUse":false,"vision":false,"maxContextLength":4096}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(provider, model_id)          -- 修复: provider+modelId 不重复
);
```

### 6.6 app_settings

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  theme                TEXT NOT NULL DEFAULT 'dark',
  default_approval_mode TEXT NOT NULL DEFAULT 'auto-edit',
  max_execution_steps  INTEGER NOT NULL DEFAULT 20,
  default_model_id     TEXT,
  shortcuts            TEXT NOT NULL DEFAULT '{"newConversation":"CmdOrCtrl+N","sendMessage":"Enter","stopGeneration":"CmdOrCtrl+.","toggleSidebar":"CmdOrCtrl+B"}',
  approval_timeout_ms  INTEGER NOT NULL DEFAULT 300000,
  window_bounds        TEXT,           -- JSON: { x, y, width, height, isMaximized }
  updated_at           INTEGER NOT NULL
);
-- 修复 D05: 首次初始化保证
INSERT OR IGNORE INTO app_settings (id, updated_at) VALUES (1, strftime('%s','now') * 1000);
```

## 7. IPC 接口规格 <!-- Updated in v0.2: 修复 I01-I09，补全所有 P1 接口 -->

### 7.1 Preload 暴露 API 总览

`window.electron` 上挂载以下命名空间：

| 命名空间 | P 阶段 | 方法数 | 事件数 |
|---------|--------|--------|--------|
| `electron.chat` | P1 | 7 | 3 |
| `electron.model` | P1 | 6 | 0 |
| `electron.settings` | P1 | 2 | 0 |
| `electron.file` | P1 | 2 | 0 |
| `electron.system` | P1 | 2 | 0 |
| `electron.agent` | P2 | 4 | 2 |
| `electron.mcp` | P2 | 5 | 0 |
| `electron.skill` | P3 | 6 | 0 |
| `electron.kb` | P3 | 4 | 1 |

### 7.2 P1 IPC 接口完整规格

#### chat:create-conversation <!-- 修复 I01 -->

- **方向**：Renderer → Main
- **输入**：`{ title?: string, modelId: string, approvalMode?: ApprovalMode }`
- **输出**：`Conversation`（含生成的 id 和时间戳）
- **异常**：modelId 不存在 → `MODEL_NOT_FOUND`
- **验收**：返回的 Conversation 含 id，数据库中有对应记录
- **规则**：title 为空时不在此处截取（首条消息发送时才截取），暂用"新会话"

#### chat:list-conversations <!-- 修复 I02 -->

- **方向**：Renderer → Main
- **输入**：无
- **输出**：`Conversation[]`（按 `updated_at DESC` 排序）
- **异常**：无（空表返回空数组）

#### chat:get-conversation <!-- 修复 I05 -->

- **方向**：Renderer → Main
- **输入**：`{ id: string }`
- **输出**：`Conversation`
- **异常**：id 不存在 → `CONVERSATION_NOT_FOUND`

#### chat:delete-conversation <!-- 修复 I03 -->

- **方向**：Renderer → Main
- **输入**：`{ id: string }`
- **输出**：`void`
- **异常**：id 不存在 → `CONVERSATION_NOT_FOUND`
- **验收**：删除后 `messages` 表中无该会话的孤儿记录（外键 CASCADE）

#### chat:get-messages <!-- 修复 I04 -->

- **方向**：Renderer → Main
- **输入**：`{ conversationId: string }`
- **输出**：`ChatMessage[]`（按 `created_at ASC` 排序）
- **异常**：conversationId 不存在 → `CONVERSATION_NOT_FOUND`

#### chat:send

- **方向**：Renderer → Main
- **输入**：`{ conversationId: string, content: string, modelId: string }`
- **输出**：`void`（结果通过事件推送）
- **异常**：conversationId 不存在 → `CONVERSATION_NOT_FOUND`；modelId 无对应配置 → `MODEL_NOT_FOUND`；已有进行中的生成 → `CHAT_ALREADY_RUNNING`（修复 R08：P1 同一时间只允许一个流式生成）
- **验收**：发送后主进程开始流式输出
- **规则**：首条消息发送时，若会话 title 为"新会话"，则截取内容前 20 字更新 title

#### chat:stop

- **方向**：Renderer → Main
- **输入**：无
- **输出**：`void`
- **异常**：无正在进行的生成时静默忽略
- **验收**：调用后流式输出立即停止
- **规则**：停止时已接收的内容保存为消息，metadata.stopped = true（修复 R07）

#### chat:stream-chunk（事件）

- **方向**：Main → Renderer
- **Payload**：`StreamChunk`
- **验收**：渲染进程实时接收并更新消息内容

#### chat:stream-end（事件）

- **方向**：Main → Renderer
- **Payload**：`StreamEndMetadata`
- **验收**：流结束后消息持久化到 SQLite

#### chat:stream-error（事件）

- **方向**：Main → Renderer
- **Payload**：`StreamError`
- **验收**：UI 显示错误提示

### 7.3 model 命名空间

#### model:list

- **方向**：Renderer → Main
- **输入**：无
- **输出**：`ModelConfig[]`（不含 apiKey 明文，返回 `***`）
- **异常**：无

#### model:create

- **方向**：Renderer → Main
- **输入**：`{ name: string, provider: ModelProvider, modelId: string, apiKey: string, baseUrl?: string, temperature?: number, maxTokens?: number, capabilities?: Partial<ModelCapabilities> }`
- **输出**：`ModelConfig`（含 id 和时间戳，apiKey 返回 `***`）
- **异常**：provider+modelId 重复 → `MODEL_DUPLICATE`
- **验收**：创建后能立即在列表中看到

#### model:update

- **方向**：Renderer → Main
- **输入**：`{ id: string, name?: string, apiKey?: string, baseUrl?: string, temperature?: number, maxTokens?: number, isDefault?: boolean, capabilities?: Partial<ModelCapabilities> }`
- **输出**：`void`
- **异常**：id 不存在 → `MODEL_NOT_FOUND`
- **规则**：更新 apiKey 时重新加密；更新任何字段时清除 ModelRouter 中该 modelId 的缓存（修复 M03）

#### model:delete

- **方向**：Renderer → Main
- **输入**：`{ id: string }`
- **输出**：`void`
- **异常**：id 不存在 → `MODEL_NOT_FOUND`；是默认模型 → `MODEL_DELETE_DEFAULT`
- **规则**：删除时清除 ModelRouter 缓存

#### model:test

- **方向**：Renderer → Main
- **输入**：`{ id: string }`
- **输出**：`{ success: boolean, latency: number, error?: string }`
- **异常**：网络错误返回 `{ success: false }` 而非抛错
- **验收**：成功时延迟 < 5000ms，失败时显示错误原因
- **实现**：向 API 发送一条 "Hi" 消息（非流式），测量响应时间

#### model:get

- **方向**：Renderer → Main
- **输入**：`{ id: string }`
- **输出**：`ModelConfig`（apiKey 返回 `***`）
- **异常**：id 不存在 → `MODEL_NOT_FOUND`

### 7.4 settings 命名空间

#### settings:get

- **方向**：Renderer → Main
- **输入**：无
- **输出**：`AppSettings`
- **异常**：首次调用自动初始化默认值（INSERT OR IGNORE 已保证）

#### settings:update

- **方向**：Renderer → Main
- **输入**：`Partial<AppSettings>`（不含 updatedAt）
- **输出**：`void`
- **异常**：无（所有字段有默认值）
- **规则**：修改即时保存到 SQLite

### 7.5 file 命名空间 <!-- 修复 I06, I07 -->

#### file:select-dir

- **方向**：Renderer → Main
- **输入**：`{ title?: string, defaultPath?: string }`
- **输出**：`string | null`（选中的目录路径，用户取消返回 null）
- **实现**：`dialog.showOpenDialog` with `properties: ['openDirectory']`

#### file:select-file

- **方向**：Renderer → Main
- **输入**：`{ title?: string, defaultPath?: string, filters?: FileFilter[] }`
- **输出**：`string | null`（选中的文件路径）
- **实现**：`dialog.showOpenDialog` with `properties: ['openFile']`

### 7.6 system 命名空间 <!-- 修复 I08 -->

#### system:get-version

- **方向**：Renderer → Main
- **输入**：无
- **输出**：`{ appVersion: string, electronVersion: string, nodeVersion: string, platform: string }`
- **异常**：无

#### system:open-external

- **方向**：Renderer → Main
- **输入**：`{ url: string }`
- **输出**：`void`
- **异常**：url 非法（非 http/https） → `INVALID_URL`
- **实现**：`shell.openExternal(url)`，仅允许 http/https 协议
- **安全**：阻止 file://、javascript: 等协议

### 7.7 事件监听模式 <!-- 修复 M11: Preload 类型导出 -->

所有 Main → Renderer 的事件通过 `ipcRenderer.on(channel, callback)` 监听。Preload 层封装为返回 cleanup 函数的模式：

```typescript
// src/preload/index.ts
// 每个事件方法返回 cleanup 函数
onStreamChunk(callback: (chunk: StreamChunk) => void): () => void {
  const handler = (_: unknown, data: StreamChunk) => callback(data)
  ipcRenderer.on('chat:stream-chunk', handler)
  return () => ipcRenderer.removeListener('chat:stream-chunk', handler)
}
```

```typescript
// src/renderer/src/env.d.ts  <!-- 修复 M11 -->
/// <reference types="vite/client" />

import type { ElectronAPI } from './types/electron-api'

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
```

> `ElectronAPI` 接口在 `src/renderer/src/types/electron-api.ts` 中定义，聚合所有命名空间的类型签名。

## 8. 多模型配置规格 <!-- Updated in v0.2: 修复 M02/M03/R01 -->

### 8.1 ModelAdapter 抽象接口

```typescript
abstract class ModelAdapter {
  constructor(protected config: ModelConfig) {}

  /** 流式对话，返回 AsyncGenerator 逐块产出 */
  abstract streamChat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[]
      signal?: AbortSignal          // 支持中断
    }
  ): AsyncGenerator<StreamChunk>

  /** 非流式对话（P2 用于 Skill 意图匹配的快速调用，P1 不实现） */
  abstract chat(messages: ChatMessage[]): Promise<string>

  /** 检测模型能力（P1 返回 capabilities 字段的值，P2 实现主动探测） */
  abstract detectCapabilities(): Promise<ModelCapabilities>
}
```

### 8.2 OpenAI Adapter

- **输入**：ModelConfig (provider='openai')
- **输出**：流式/非流式对话结果
- **实现要点**：
  - 使用 `openai` npm 包
  - baseUrl 支持自定义（兼容 OpenAI 兼容 API）
  - streamChat 使用 `stream: true` 获取 SSE 流
  - 将 OpenAI 的 `delta.content` 转换为 `StreamChunk { type: 'text', content }`
  - 将 OpenAI 的 `delta.tool_calls` 转换为 `StreamChunk { type: 'tool-call', content }`（P2）
  - 支持 AbortSignal 中断请求
- **异常**：API Key 无效 → 401 错误抛 `AppError('MODEL_API_ERROR')`；网络超时 30s → 重试 1 次（指数退避：等待 1000ms 后重试），仍失败抛 `AppError('MODEL_API_ERROR')`
- **验收**：能与 GPT-4o 和 DeepSeek API（OpenAI 兼容模式）正常通信
- **暂不实现**：Tool-Use 格式转换（P2）

### 8.3 DeepSeek Adapter <!-- 修复 M02: 明确继承策略 -->

- **输入**：ModelConfig (provider='deepseek')
- **输出**：同 OpenAI Adapter
- **实现**：**继承** OpenAI Adapter，构造函数中若 baseUrl 为空则设为 `https://api.deepseek.com/v1`，其余逻辑完全复用
- **验收**：DeepSeek-Chat 模型正常对话

### 8.4 ModelRouter <!-- 修复 M03: 缓存失效 -->

- **输入**：modelId
- **输出**：对应的 ModelAdapter 实例
- **实现**：内部 `Map<modelId, ModelAdapter>` 缓存
- **缓存失效规则**：
  - `model:update` 调用时：删除该 modelId 的缓存条目
  - `model:delete` 调用时：删除该 modelId 的缓存条目
  - 应用重启时：缓存自然清空（内存中的 Map）
- **异常**：modelId 不存在 → `AppError('MODEL_NOT_FOUND')`

### 8.5 API Key 加密 <!-- 修复 R01: 禁止降级 -->

- 使用 `electron.safeStorage.encryptString()` 加密存储到 SQLite
- 运行时通过 `safeStorage.decryptString()` 解密，解密后仅在内存中短暂存在
- **safeStorage 不可用时的处理**：抛出 `AppError('SAFE_STORAGE_UNAVAILABLE', '系统不支持安全存储，无法保存 API Key')`，阻止应用启动。**不允许降级为 base64 或明文存储**。
- **验收**：数据库文件中 api_key 列不可直接读到明文（用 `sqlite3 agentforge.db "SELECT api_key FROM model_configs"` 验证值不是明文 Key）

### 8.6 超时与重试 <!-- 新增: 明确参数 -->

| 参数 | 值 | 说明 |
|------|---|------|
| 请求超时 | 30000ms | 单次请求超时 |
| 重试次数 | 1 次 | 超时后重试 1 次 |
| 重试退避 | 1000ms | 指数退避基数 |
| 连接测试超时 | 5000ms | model:test 的超时 |

## 9. Agent ReAct 执行引擎规格 <!-- Updated in v0.2: 修复 M04/M05 -->

> P2 阶段实现。P1 仅标注接口预留。

### 9.1 执行流程

```
用户输入 → Skill匹配(可选) → 构建System Prompt → [ReAct 循环]
                                                       │
                                                 ┌─────────┴─────────┐
                                                 │  Thought (LLM推理) │
                                                 │  Action (解析工具调用)│
                                                 │  审批检查 + 超时     │
                                                 │  执行工具            │
                                                 │  Observation (结果)  │
                                                 └─────────┬─────────┘
                                                           │
                                                    type=finish → 结束
```

### 9.2 AgentExecutor

- **输入**：`AgentExecutionRequest`
- **输出**：`ExecutionResult`（含完整 trajectories）
- **每步输出**：通过 `agent:trajectory` 事件推送 `TAOTrajectory`
- **审批机制**：需要审批时通过 `agent:approval-request` 事件推送 `ApprovalRequest`，等待 `agent:approve` 响应
- **审批超时**：等待 `AppSettings.approvalTimeoutMs`（默认 300000ms），超时自动拒绝并终止执行，推送 `ApprovalResponse { approved: false, reason: 'TIMEOUT' }`（修复 M04）
- **异常**：
  - 工具返回错误 → 作为 Observation 反馈给 LLM（不中断）
  - 连续 3 次工具失败 → 熔断，停止执行。**"连续"定义：中间无任何成功调用。任一次成功调用即重置计数器**（修复 M05）
  - 达到 maxSteps → 强制终止
  - 用户取消 → 立即停止
- **验收**："帮我搜索 Vue 3 最新动态并总结" 能完整执行 3-8 步后输出总结
- **暂不实现**：检查点恢复（P4）、并行工具调用

### 9.3 审批机制

| 模式 | low 风险工具 | medium 风险工具 | high 风险工具 |
|------|------------|----------------|---------------|
| suggest | 需审批 | 需审批 | 需审批 |
| auto-edit | 自动 | 需审批 | 需审批 |
| full-auto | 自动 | 自动 | 需审批 |

风险等级映射：
- low: web_search, web_scrape, kb_search, file_read, directory_list
- medium: file_write, image_generate, screenshot_ocr, kb_index
- high: 所有 MCP 第三方工具（默认 high，除非 Server 声明 safe）

> 未在映射表中注册的新工具，默认风险等级为 high。

### 9.4 上下文管理

- 维护 `ChatMessage[]` 数组
- 每轮 Thought+Action+Observation 作为 assistant 消息追加
- **token 估算**：使用模型对应的 tokenizer。OpenAI 模型使用 `tiktoken`；其他模型使用近似公式（中文约 1.5 token/字，英文约 0.25 token/word）。从 `ModelConfig.capabilities.maxContextLength` 读取上限。（修复 v0.1 模糊的 token 估算）
- 超过 maxContextLength 时，截断最早的对话轮次（保留 system prompt 和最近 5 轮）

### 9.5 System Prompt 模板 <!-- 新增 -->

```
你是一个自主执行 Agent。你可以使用以下工具来完成任务：

{{tool_definitions}}

执行规则：
1. 每次输出一个 Thought（推理过程）和一个 Action（工具调用）
2. Action 格式为 JSON: {"type": "tool", "tool": "工具名", "arguments": {...}}
3. 任务完成时输出: {"type": "finish", "summary": "总结"}
4. 不要编造工具结果，等待系统返回 Observation
{{skill_prompt}}
```

## 10. MCP Client 规格 <!-- Updated in v0.2: 补全类型 -->

> P2 阶段实现。

### 10.1 传输层

#### StdioTransport

- **输入**：`{ command: string, args: string[], env?: Record<string, string> }`
- **输出**：连接状态
- **实现**：`child_process.spawn(command, args, { env })`，通过 stdin/stdout 传输 JSON-RPC 2.0
- **JSON-RPC 消息格式**：
  ```json
  { "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
  ```
- **异常**：命令不存在 → `MCP_SPAWN_FAILED`；进程退出 → 自动重连 1 次（等待 2000ms），仍失败标记 disconnected
- **验收**：能连接标准的 MCP stdio Server，调用 tools/list 返回工具列表
- **安全检查**：命令校验 blocklist（`rm`、`del`、`format`、`mkfs` 等危险命令直接拒绝）

#### HttpTransport

- **暂不实现**（P4 实现 Streamable HTTP）

### 10.2 MCPClient

- **输入**：ITransport 实例
- **输出**：工具列表
- **生命周期**：
  1. `initialize()` → 发送 initialize 请求，交换能力
  2. `tools/list` → 获取工具列表
  3. 运行时 `tools/call` → 调用工具
  4. `close()` → 关闭连接
- **异常**：Server 无响应 → 10s 超时；返回错误 → 标记 isError
- **验收**：完整生命周期可正常走通

### 10.3 MCPServerManager

- **输入**：MCPServerConfig 列表
- **输出**：聚合的工具列表 + 各 Server 状态
- **实现**：`Map<serverId, { config: MCPServerConfig, client: MCPClient, status: MCPServerStatus }>`
- **启动行为**：应用启动时连接所有 enabled 的 server
- **验收**：添加 Server 后自动连接并发现工具
- **暂不实现**：Resources 和 Prompts 支持

## 11. Skills 系统规格 <!-- Updated in v0.2: 修复 M06/M07 -->

> P3 阶段实现。

### 11.1 Skill 数据结构

参见 §5.6 `Skill` 接口定义。

- **存储**：SQLite skills 表（P3 新增）
- **异常**：name 重复 → `SKILL_DUPLICATE`；prompt 为空 → `SKILL_PROMPT_EMPTY`

### 11.2 变量替换机制 <!-- 修复 M06 -->

- **语法**：prompt 中使用 `{{variableName}}` 作为占位符
- **替换时机**：Agent 执行前一次性替换（在构建 System Prompt 时）
- **替换规则**：遍历 `Skill.variables`，从用户输入中提取或使用 defaultValue。未找到且 required=true 时抛 `SKILL_VARIABLE_MISSING`
- **示例**：prompt 中 `{{topic}}` → 替换为用户输入的 topic 值

### 11.3 意图匹配 <!-- 修复 M07 -->

- **输入**：用户消息 string
- **输出**：`SkillMatchResult`
- **实现**：
  1. 获取所有 trigger='auto' 的 Skill
  2. 将各 Skill 的 name + description 拼接为选项列表
  3. 使用当前会话配置的模型调用 LLM，prompt 模板：
     ```
     用户消息: "{{user_message}}"

     可选 Skill:
     {{skill_list}}

     请判断用户意图匹配哪个 Skill。返回 JSON:
     {"matched": true/false, "skillName": "skill名或null", "confidence": 0-1, "reason": "判断理由"}
     ```
  4. 解析 LLM 返回的 JSON，提取 confidence
- **阈值**：confidence >= 0.6 才视为匹配
- **异常**：LLM 返回无法解析的 JSON → 视为不匹配（不报错）
- **验收**：输入"帮我总结这个 PDF" 能匹配 summarize-docs Skill

### 11.4 内置 Skills (P3)

| Skill | 触发 | 使用工具 | 完整 prompt | 暂不实现 |
|-------|------|---------|-------------|--------|
| research-report | auto | web_search, web_scrape, file_write | 需要完整中文 prompt | - |
| summarize-docs | auto | file_read, file_parse, kb_index | 需要完整中文 prompt | - |
| weekly-digest | auto | kb_search, web_search, file_write | 需要完整中文 prompt | P4 |
| study-cards | auto | file_read, file_parse, file_write | 需要完整中文 prompt | P4 |
| content-writer | auto | kb_search, file_write, image_generate | 需要完整中文 prompt | P4 |
| knowledge-graph | manual | file_read, file_parse, kb_search | 需要完整中文 prompt | P4 |

### 11.5 内置 Skill 注册 <!-- 新增 -->

- 首次启动时检查 skills 表，若内置 Skill 不存在则 INSERT
- 内置 Skill 的 `isBuiltin = true`，用户不可删除
- 用户不可修改内置 Skill 的 prompt（可创建副本编辑）

### 11.6 Skill 可视化编辑器

- **输入**：Skill 数据
- **输出**：保存/更新 Skill
- **验收**：能创建自定义 Skill，填写所有字段并保存
- **暂不实现**：实时预览、测试运行（P3 先做基础 CRUD）

## 12. 本地知识库规格 <!-- Updated in v0.2: 修复 M08 -->

> P3 阶段实现。

### 12.1 文档索引管道

- **输入**：文件路径 string
- **输出**：`KbDocument` 对象（含 chunkCount）
- **流程**：parse → chunk → embed → store(LanceDB)
- **进度**：每阶段通过 `kb:index-progress` 事件推送 `KbIndexProgress`
- **异常**：文件不存在 → `FILE_NOT_FOUND`；解析失败 → 标记 status='error' 并记录 errorMessage
- **验收**：能导入一个 PDF/Markdown 文件，索引后能语义检索
- **暂不实现**：增量索引/chokidar 监听（P4）

### 12.2 文档解析

- **PDF**：使用 `pdf-parse` 提取纯文本
- **Markdown**：直接读取，去除 frontmatter
- **TXT**：直接读取
- **文件大小限制**：单文件 ≤ 50MB，超过则拒绝并提示
- **暂不实现**：Word/Excel（P4）

### 12.3 Chunking <!-- 修复 M08: token 计算 -->

- **分块策略**：500 token/chunk，50 token overlap
- **token 计算**：
  - OpenAI 模型：使用 `tiktoken` 精确计算
  - 其他模型：近似计算（中文按 1.5 token/字，英文按空格分词后 0.25 token/word）
- **分块规则**：尽量在句子边界处分块，不在词中间截断

### 12.4 Embedding

- **实现 1 (P3)**：使用 OpenAI text-embedding-3-small API，dimension=1536
- **实现 2 (P4)**：使用 @xenova/transformers 本地模型，dimension=384
- **批量处理**：每次请求最多 100 个 chunk，避免 API 限流
- **异常处理**：embedding API 调用失败时标记该 chunk 为 error，不影响其他 chunk
- **验收**：P3 先用 API Embedding 跑通

### 12.5 检索

- **输入**：query string, limit number (默认 5)
- **输出**：`SearchResult[]`
- **实现**：query → embedding → LanceDB 向量搜索 → 返回 top-k
- **验收**：检索结果与查询语义相关
- **暂不实现**：来源溯源跳转到原文具体位置（P4）

### 12.6 LanceDB 集合 Schema <!-- 新增 -->

```
Collection: "knowledge_base"
Fields:
  - id: string (primary key)
  - document_id: string
  - chunk_index: int32
  - content: string
  - vector: float32[dimension]  // 1536 (API) 或 384 (local)
  ```

## 13. UI 页面规格 <!-- Updated in v0.2: 补充加载/错误状态 -->

### 13.1 主布局

```
┌──────────┬────────────────────────────────────┐
│          │                                    │
│ Sidebar  │         Main Content              │
│ (240px)  │                                    │
│          │   ChatView / SettingsView         │
│          │   (后续: SkillsView, KbView)        │
│          │                                    │
└──────────┴────────────────────────────────────┘
```

- **侧边栏**：固定宽度 240px，可折叠（`CmdOrCtrl+B`）
- **主内容区**：自适应宽度
- **暗色/亮色主题**：通过 VueUse `useDark` 实现，持久化到 app_settings
- **P1 阶段只有两个视图**：ChatView、SettingsView
- **应用菜单**：macOS 标准菜单（File/Edit/View/Window/Help），Windows/Linux 精简菜单（仅 About/Settings/Quit）
- **暂不实现**：SkillsView、KnowledgeBaseView

### 13.2 ChatView（P1）

**输入**：无（自动加载会话列表）
**输出**：对话界面

#### 布局

```
┌──────────┬────────────────────────────────────┐
│          │  ┌──────────────────────────────┐   │
│ 会话列表 │  │    消息列表 (MessageList)    │   │
│          │  │    - MessageItem (user)     │   │
│ [+新建]  │  │    - MessageItem (assistant)│   │
│ 模型选择 │  │    - ...                     │   │
│          │  ├──────────────────────────────┤   │
│          │  │    输入框 (ChatInput)        │   │
│          │  │    [附件] [发送]             │   │
│          │  └──────────────────────────────┘   │
└──────────┴────────────────────────────────────┘
```

#### 会话列表 (ConversationList)

- **输入**：会话列表数据
- **输出**：渲染会话列表，支持点击切换
- **交互**：点击切换当前会话；新建按钮创建空会话；右键/长按删除
- **空状态**：显示引导文字"创建第一个会话开始对话"
- **加载状态**：首次加载时显示 skeleton 占位
- **验收**：能创建、切换、删除会话
- **暂不实现**：拖拽排序、会话搜索

#### 消息列表 (MessageList)

- **输入**：messages 数据
- **输出**：渲染消息列表
- **交互**：自动滚动到底部；**用户手动上滚时停止自动跟随**，显示"回到底部"按钮；新消息到达时若用户在底部则恢复自动跟随
- **空状态**：显示引导文字"输入消息开始对话"
- **加载状态**：切换会话时显示 skeleton
- **验收**：消息按时间排序，流式时实时更新
- **性能要求**：100 条消息渲染 ≤ 500ms（修复 A04）
- **暂不实现**：虚拟滚动（P5 性能优化）

#### 消息项 (MessageItem)

- **输入**：ChatMessage
- **输出**：渲染单条消息
- **用户消息**：右对齐，无头像
- **助手消息**：左对齐，显示头像（AI 图标）
- **流式状态**：末尾显示闪烁光标
- **操作**：hover 显示复制按钮
- **加载状态**：助手消息流式中显示 typing indicator
- **验收**：用户/助手消息样式区分明显
- **暂不实现**：思考过程折叠（P2）、工具调用卡片（P2）

#### MarkdownRenderer

- **输入**：content string
- **输出**：渲染后的 HTML
- **实现**：marked 解析 + shiki 代码高亮 + DOMPurify XSS 过滤
- **shiki 主题**：暗色用 `one-dark-pro`，亮色用 `github-light`，跟随主题切换
- **支持**：标题、列表、代码块（带语言标签和复制按钮）、加粗、链接、表格
- **代码复制**：使用 `navigator.clipboard.writeText()`，复制后按钮显示"已复制"2s
- **异常**：Markdown 解析失败显示原文
- **验收**：代码块有语法高亮和复制功能

#### ChatInput

- **输入**：用户输入文本
- **输出**：触发 sendMessage
- **交互**：Enter 发送（Shift+Enter 换行）；发送中禁用发送按钮；停止按钮替代发送按钮
- **最大输入长度**：32000 字符（超出时截断并提示）
- **空消息**：不允许发送（按钮禁用）
- **验收**：能发送消息，流式中能停止
- **暂不实现**：文件附件、@提及、语音输入

### 13.3 SettingsView（P1）

#### 模型配置页 (ModelConfig)

- **输入**：模型列表数据
- **输出**：模型管理界面
- **列表区**：每行显示 模型名称、提供商标签、默认标记、操作（编辑/删除/测试）
- **加载状态**：列表加载中显示 skeleton
- **添加/编辑**：Modal 弹窗，表单字段：
  - 名称 (必填, text, maxlength 50)
  - 提供商 (必填, select: OpenAI / DeepSeek / Custom)
  - 模型 ID (必填, text, placeholder 如 `gpt-4o`)
  - API Key (必填, password, minlength 10)
  - Base URL (可选, text, placeholder 显示默认值)
  - Temperature (slider, 0-2, step 0.1, default 0.7)
  - Max Tokens (number, default 4096, min 100, max 128000)
- **连接测试**：表单中按钮，点击后按钮变为 loading，完成后显示"连接成功 (xxxms)"或红色错误信息
- **验收**：能添加/编辑/删除/测试模型
- **暂不实现**：拖拽排序、导入导出

#### 通用设置页 (GeneralSettings)

- **输入**：AppSettings
- **输出**：设置界面
- **字段**：
  - 主题 (select: 深色/浅色/跟随系统)
  - 默认审批模式 (select: 建议模式/自动编辑/全自动)
  - 最大执行步数 (number, default 20, min 1, max 100)
  - 默认模型 (select, 从已配置模型中选择)
  - 审批超时 (number, 单位秒, default 300, min 30, max 3600)
- **交互**：修改即时保存
- **验收**：修改主题后立即切换；修改默认模型后新会话使用该模型

### 13.4 通用组件 (common/)

#### AppButton
- **Props**：`{ variant: 'primary'|'secondary'|'ghost'|'danger', size: 'sm'|'md'|'lg', loading: boolean, disabled: boolean }`
- **验收**：各 variant 样式正确，loading 时显示 spinner 且禁用点击

#### AppInput
- **Props**：`{ modelValue, placeholder, type, error?: string, maxlength?: number }`
- **验收**：error 时边框变红且显示错误文字

#### AppModal
- **Props**：`{ visible, title, width?: number }`
- **Slots**：default, footer
- **交互**：点击遮罩或 ESC 关闭；显示/隐藏有 fade 过渡动画
- **z-index**：Modal 层级 1000，Toast 层级 2000

#### AppToast
- **使用**：`useUiStore().showToast(message, type)` 调用
- **Props**：`message, type: 'success'|'error'|'info'|'warning', duration?: number`
- **实现**：Vue teleport 挂载到 body，自动消失（默认 3000ms）
- **堆叠**：多个 Toast 从上到下排列，最多同时显示 3 个
- **验收**：成功/错误/信息/警告四种样式

## 14. 错误处理规格 <!-- Updated in v0.2: 修复 AppError details any -->

### 14.1 错误码

| 错误码 | 场景 | 用户提示 | P 阶段 |
|--------|------|---------|--------|
| CONVERSATION_NOT_FOUND | 会话 ID 不存在 | 会话不存在或已被删除 | P1 |
| CHAT_ALREADY_RUNNING | 已有进行中的生成 | 正在生成中，请先停止当前对话 | P1 |
| MODEL_NOT_FOUND | 模型 ID 不存在 | 模型配置不存在 | P1 |
| MODEL_DUPLICATE | provider+modelId 重复 | 该模型已存在 | P1 |
| MODEL_DELETE_DEFAULT | 删除默认模型 | 无法删除默认模型，请先设置其他模型为默认 | P1 |
| MODEL_API_ERROR | API 调用失败 | 模型服务暂时不可用，请检查网络或 API Key | P1 |
| MODEL_RATE_LIMIT | API 限流 | 请求过于频繁，请稍后重试 | P1 |
| SAFE_STORAGE_UNAVAILABLE | safeStorage 不可用 | 系统不支持安全存储，无法保存 API Key | P1 |
| INVALID_URL | URL 协议非法 | 仅支持 http/https 链接 | P1 |
| AGENT_MAX_STEPS | 达到最大步数 | 执行步数已达上限 | P2 |
| AGENT_CIRCUIT_BREAK | 熔断 | 连续多次工具调用失败，已终止执行 | P2 |
| AGENT_CANCELLED | 用户取消 | 执行已取消 | P2 |
| AGENT_APPROVAL_TIMEOUT | 审批超时 | 审批超时，执行已终止 | P2 |
| TOOL_NOT_FOUND | 工具不存在 | 工具未找到 | P2 |
| TOOL_EXECUTION_ERROR | 工具执行失败 | 工具执行出错 | P2 |
| MCP_SPAWN_FAILED | MCP Server 启动失败 | MCP Server 启动失败，请检查配置 | P2 |
| MCP_CONNECT_FAILED | MCP 连接失败 | MCP Server 连接失败 | P2 |
| SKILL_DUPLICATE | Skill 名称重复 | 该 Skill 名称已存在 | P3 |
| SKILL_PROMPT_EMPTY | Skill prompt 为空 | Skill prompt 不能为空 | P3 |
| SKILL_VARIABLE_MISSING | Skill 变量缺失 | 缺少必要变量: {varName} | P3 |
| KB_INDEX_ERROR | 文档索引失败 | 文档索引出错，请检查文件格式 | P3 |
| FILE_NOT_FOUND | 文件不存在 | 文件不存在 | P2 |
| FILE_ACCESS_ERROR | 文件访问被拒绝 | 无法访问文件，请检查权限 | P2 |
| FILE_TOO_LARGE | 文件超过大小限制 | 文件超过 50MB 限制 | P3 |
| DB_ERROR | 数据库操作失败 | 数据操作失败，请重试 | P1 |

### 14.2 错误传播链

```
底层(工具/模型/MCP) → 包装为 AppError → IPC 上报 → UI 展示
```

**AppError 结构**：参见 §5.8。`details` 类型为 `Record<string, unknown>`，不含 `any`。

### 14.3 各层处理规则

- **工具层**：try/catch 包装，返回 `ToolExecutionResult { isError: true, content: 错误信息 }`（Agent 会自动反馈给 LLM 重试）
- **模型层**：网络错误重试 1 次（指数退避 1000ms），仍然失败则抛出 `AppError('MODEL_API_ERROR')`
- **IPC 层**：`ipcMain.handle` 中 try/catch，捕获后通过 `chat:stream-error` 发送或通过返回值传递错误
- **UI 层**：接收 error 事件后，通过 AppToast 显示用户提示，消息区显示错误状态

### 14.4 IPC 错误传递模式 <!-- 新增 -->

Renderer→Main 的 IPC 调用，错误通过 `ipcRenderer.invoke` 的 reject 传递：

```typescript
// Main 侧
ipcMain.handle('model:create', async (_event, input) => {
  try {
    return await modelRepo.create(input)
  } catch (err) {
    if (err instanceof AppError) throw err.toJSON()
    throw { code: 'DB_ERROR', message: String(err) }
  }
})

// Renderer 侧
try {
  const model = await window.electron.model.create(input)
} catch (err) {
  // err: { code: string, message: string, details?: Record<string, unknown> }
  useUiStore().showToast(err.message, 'error')
}
```

## 15. 安全与权限规格 <!-- Updated in v0.2: 修复 R04/R05 + 补全 -->

### 15.1 API Key 保护

- 使用 Electron `safeStorage.encryptString()` 加密存储到 SQLite
- 运行时解密后仅在内存中短暂存在
- **规则**：API Key 不得出现在日志中、不得通过 IPC 明文传输
- **safeStorage 不可用**：抛出 `SAFE_STORAGE_UNAVAILABLE`，阻止应用启动（不降级）

### 15.2 进程隔离

BrowserWindow webPreferences（参见 §2）：

| 配置项 | 值 | 说明 |
|--------|---|------|
| nodeIntegration | false | |
| contextIsolation | true | |
| sandbox | true | |
| webSecurity | true | |
| allowRunningInsecureContent | false | |
| navigateOnDragDrop | false | |

- **规则**：所有 Node.js 能力必须通过 preload bridge 显式暴露

### 15.3 CSP（内容安全策略）

通过 `session.defaultSession.webRequest.onHeadersReceived` 注入 CSP header（参见 §2 CSP 配置）。

### 15.4 文件系统访问

- P1: 通过 `file:select-dir` 和 `file:select-file` 让用户主动选择，不直接操作用户文件
- P2: Agent 内置工具可读写文件，但仅限于用户指定的目录或知识库目录
- **路径安全检查**：工具执行前校验路径不在系统关键目录（`/System`、`/Windows`、`/usr` 等）
- **规则**：不实现全盘文件访问

### 15.5 MCP Server 安全

- MCP Server 作为子进程运行，继承主进程权限
- 第三方 MCP Server 标记为 high 风险，审批模式下必须用户确认
- **命令 blocklist**：`rm`、`del`、`format`、`mkfs`、`dd`、`shutdown` 等危险命令直接拒绝
- **规则**：stdio 命令不能是 blocklist 中的命令

### 15.6 用户数据导出 <!-- 新增 O04 -->

- P5 阶段实现：设置中提供"导出数据"功能，将所有会话、消息、设置导出为 JSON 文件
- 导出文件不包含 API Key（即使加密也不导出）

## 16. 测试计划 <!-- Updated in v0.2: 修复测试框架/覆盖率 -->

### 16.1 测试框架

- **单元测试**：vitest
- **测试文件位置**：`tests/unit/` 下，与源文件同构（如 `src/main/db/repos/conversation.ts` → `tests/unit/db/repos/conversation.test.ts`）
- **覆盖率要求**：P1 核心模块（db repos, models, utils）行覆盖率 ≥ 70%
- **Mock 策略**：LLM API 调用使用 mock（不依赖真实 API Key），数据库使用内存 SQLite（`:memory:`）
- **E2E 框架**：P5 使用 Playwright（Electron 支持）

### 16.2 P1 测试

| 测试场景 | 方法 | 验收标准 |
|---------|------|---------|
| 应用启动 | E2E | electron-vite dev 启动无报错，窗口显示 |
| 模型配置 CRUD | 单元 | 创建/读取/更新/删除模型配置，API Key 加密存储 |
| API Key 加密一致性 | 单元 | 加密后解密得到原文；数据库中非明文 |
| 数据库 PRAGMA | 单元 | foreign_keys=ON, journal_mode=WAL |
| 外键级联删除 | 单元 | 删除 conversation 后 messages 无孤儿记录 |
| 创建会话 | 单元 | 创建会话返回 id，数据库中有对应记录 |
| 发送消息并持久化 | 单元 | 发送消息后 messages 表有对应记录 |
| 流式输出 | 集成 | 模拟流式 chunk，UI 实时更新内容 |
| 停止生成 | 集成 | 点击停止后流立即中断，已生成内容保存 |
| 并发生成拦截 | 单元 | 已有进行中生成时，再次 send 抛 CHAT_ALREADY_RUNNING |
| Markdown 渲染 | 单元 | 代码块有高亮，表格正常渲染 |
| 主题切换 | 单元 | 切换后 CSS 变量正确变化 |
| 对话切换 | 集成 | 切换会话后加载对应消息 |

### 16.3 P2 测试

| 测试场景 | 方法 | 验收标准 |
|---------|------|---------|
| Agent ReAct 循环 | 集成 | 模拟工具，验证 Thought→Action→Observation 完整执行 |
| 审批机制 | 集成 | 三种模式下工具调用行为正确 |
| 审批超时 | 集成 | 超时后自动拒绝并终止 |
| 熔断机制 | 单元 | 连续 3 次失败后熔断，中间成功重置计数器 |
| MCP stdio 连接 | 集成 | 连接测试 Server，获取工具列表 |
| 工具调用 | 单元 | 各内置工具输入输出正确 |

### 16.4 P3 测试

| 测试场景 | 方法 | 验收标准 |
|---------|------|---------|
| Skill 意图匹配 | 单元 | 预设 10 组测试用例，匹配准确率 ≥ 80% |
| 变量替换 | 单元 | `{{variable}}` 正确替换为值 |
| 文档索引 | 集成 | 导入 PDF/Markdown 后能检索到相关内容 |
| 语义检索 | 集成 | 查询返回 top-k 结果且相关 |

## 17. 里程碑计划 <!-- Updated in v0.2: 修复 A06 补全 -->

### M1: P1 可运行闭环（Week 1-3）

**交付物**：
1. electron-vite 应用可启动
2. 模型配置界面可用
3. 基础对话 + SSE 流式输出
4. 会话持久化
5. Markdown + 代码高亮

**验收标准**：打开应用 → 配置 DeepSeek API Key → 新建会话 → 发送"你好" → 收到流式回复 → 关闭应用 → 重新打开 → 会话和消息仍在

**性能要求**：冷启动 ≤ 3s，空闲内存 ≤ 300MB

### M2: P2 Agent 闭环（Week 4-6）

**交付物**：
1. Agent ReAct 引擎
2. MCP Client (stdio)
3. 5 个内置工具
4. 三档审批 + Execution Panel

**验收标准**："帮我搜索 Vue 3 最新动态并总结成笔记" → Agent 自主搜索 3-5 次 → 调用 file_write 保存笔记 → 完整展示 TAO 轨迹

### M3: P3 Skills + 知识库（Week 7-9）

**交付物**：
1. Skills CRUD + 意图匹配
2. 3 个内置 Skill
3. 文档导入 + 语义检索

**验收标准**：导入一个 PDF → 输入"总结这个文档" → 匹配 summarize-docs Skill → Agent 自动读取并总结 → 检索知识库能找到相关内容

### M4: P4 完善（Week 10-12）

**交付物**：剩余 Skills、AI 工具、截图 OCR、MCP 管理界面、检查点恢复

### M5: P5 发布（Week 13-14）

**交付物**：UI 打磨、性能优化、electron-builder 打包

## 18. 验收标准总表 <!-- Updated in v0.2: 修复 A01-A08 + 补全 P2-P5 -->

### P1 核心验收（阻塞 P2）

| # | 功能 | 验收标准 | 阻塞 |
|---|------|---------|------|
| 1.1 | 应用启动 | `pnpm dev` 无报错，窗口 1200x800，显示侧边栏+空白对话区 | 是 |
| 1.2 | 模型配置-添加 | 打开设置 → 模型配置 → 添加 DeepSeek → 填写 API Key → 保存 → 列表显示新模型 | 是 |
| 1.3 | 模型配置-测试 | 点击测试 → 5s 内显示"连接成功 (xxxms)"或红色错误 | 是 |
| 1.4 | 模型配置-加密 | `sqlite3 agentforge.db "SELECT api_key FROM model_configs"` 返回值不是明文 Key | 是 |
| 1.5 | 新建会话 | 点击新建 → 侧边栏出现新会话 → 主区域切换到空对话 | 是 |
| 1.6 | 发送消息 | 输入"你好" → 发送 → 用户消息右对齐显示 | 是 |
| 1.7 | 流式接收 | 助手消息左对齐显示，文字逐字出现，末尾有光标 | 是 |
| 1.8 | Markdown 渲染 | 发送"用代码展示 hello world" → 代码块有语法高亮和复制按钮 | 是 |
| 1.9 | 会话持久化 | 关闭应用 → 重启 → 会话列表和消息仍在 | 是 |
| 1.10 | 主题切换 | 设置中切换为浅色 → 整体界面变亮 | 否 |
| 1.11 | 停止生成 | 发送长问题 → 点击停止 → 输出停止，已生成内容保留 | 是 |
| 1.12 | 并发拦截 | 流式生成中再次发送 → 显示"正在生成中"提示 | 是 |
| 1.13 | 级联删除 | 删除会话 → 查询 messages 表无孤儿记录 | 是 |
| 1.14 | 数据完整性 | PRAGMA foreign_keys=ON 且级联生效 | 是 |
| 1.15 | 性能-启动 | 冷启动 ≤ 3s | 否 |
| 1.16 | 性能-渲染 | 100 条消息列表渲染 ≤ 500ms | 否 |
| 1.17 | 性能-内存 | 空闲状态内存 ≤ 300MB | 否 |

### P2 核心验收

| # | 功能 | 验收标准 | 阻塞 |
|---|------|---------|------|
| 2.1 | Agent 执行 | "搜索 Vue 3 动态并总结" → 3-8 步后输出总结 | 是 |
| 2.2 | TAO 轨迹 | 每步 Thought/Action/Observation 实时展示 | 是 |
| 2.3 | 审批-auto-edit | file_write 触发审批，web_search 自动执行 | 是 |
| 2.4 | 审批超时 | 5 分钟无响应自动终止 | 否 |
| 2.5 | 熔断 | 连续 3 次工具失败后终止 | 是 |
| 2.6 | MCP 连接 | 添加 stdio MCP Server → 自动发现工具 | 是 |
| 2.7 | 停止执行 | Agent 执行中点击停止 → 立即终止 | 是 |

### P3 核心验收

| # | 功能 | 验收标准 | 阻塞 |
|---|------|---------|------|
| 3.1 | Skill 意图匹配 | "总结这个 PDF" → 匹配 summarize-docs | 是 |
| 3.2 | Skill 变量替换 | `{{topic}}` 正确替换 | 是 |
| 3.3 | 文档导入 | 导入 PDF → 状态变为 ready | 是 |
| 3.4 | 语义检索 | 查询返回相关结果，top-5 | 是 |
| 3.5 | 内置 Skill | research-report 能完整执行 | 是 |

## 19. 日志系统规格 <!-- 新增 O01 -->

### 19.1 日志配置

- **日志文件路径**：`app.getPath('userData')/logs/agentforge-{date}.log`
- **日志分级**：debug / info / warn / error
- **开发环境**：debug 及以上输出到控制台
- **生产环境**：info 及以上写入文件
- **文件轮转**：单文件最大 10MB，保留最近 7 天日志

### 19.2 日志格式

```
[2026-07-26T10:30:00.000Z] [INFO] [main/db] Database initialized (WAL mode, foreign_keys=ON)
[2026-07-26T10:30:01.000Z] [ERROR] [main/models/openai-adapter] API request failed: 401 Unauthorized
```

### 19.3 API Key 脱敏

- 日志中不得出现 API Key 明文
- 日志工具自动检测并替换疑似 API Key 的字符串为 `sk-***`
- ModelConfig 日志只记录 name/provider/modelId，不记录 apiKey

### 19.4 实现

```typescript
// src/main/utils/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
function log(level: LogLevel, module: string, message: string, ...args: unknown[]): void
```

## 20. 变更日志（v0.1 → v0.2）

### P0 阻塞修复（12 项）

| 编号 | 问题 | 修复章节 |
|------|------|---------|
| T01-T11 | 11 项类型定义缺失 | §5.2-5.8 补全所有接口 |
| I01-I09 | 9 项 IPC 接口缺失 | §7.2-7.6 补全所有 P1 接口 |
| R01 | safeStorage 降级为 base64 | §8.5 改为不允许降级 |

### P1 严重修复（22 项）

| 编号 | 问题 | 修复章节 |
|------|------|---------|
| M01 | 代码高亮库二选一 | §4 明确选用 shiki |
| M02 | DeepSeek 继承策略 | §8.3 明确继承 OpenAI Adapter |
| M03 | ModelRouter 缓存失效 | §8.4 新增失效规则 |
| M04 | 审批等待超时 | §9.2 新增 300s 超时 |
| M05 | 熔断计数器重置 | §9.2 明确"连续"定义 |
| M06 | Skill variables 替换 | §11.2 定义替换机制 |
| M07 | 意图匹配 LLM 规格 | §11.3 定义 prompt 模板和返回格式 |
| M08 | Chunking token 计算 | §12.3 明确 tiktoken/近似 |
| M09 | 时间戳格式 | §5.2 明确 Unix 毫秒 |
| M10 | IPC 命名规范 | §2 统一命名格式说明 |
| M11 | Preload 类型导出 | §7.7 新增 env.d.ts |
| M12 | UnoCSS/Naive UI 冲突 | §4 关闭 preflight |
| M13 | chat() 使用场景 | §8.1 标注 P2 用途 |
| M14 | 快捷键配置 | §5.2 ShortcutConfig |
| R02-R10 | 安全/DB/并发/资源清理 | §2/§4/§6/§15 |
| D01-D06 | 数据库约束缺失 | §6 全部修复 |
| A01-A08 | 验收标准缺失 | §18 补全 |

### P2 改进修复（19 项）

| 编号 | 问题 | 修复章节 |
|------|------|---------|
| O01 | 日志系统 | §19 新增 |
| O02 | 应用菜单 | §13.1 新增 |
| O03 | 窗口状态持久化 | §2/§5/§6 新增 |
| O04 | 数据导出 | §15.6 新增 |
| O05 | 版本锁定 | §4 替换为具体版本范围 |
| B01-B05 | Backlog 问题 | task-backlog-v0.2 同步修订 |
| R01-R03 | 迭代规则问题 | ai-iteration-rules-v0.2 同步修订 |
