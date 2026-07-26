# AgentForge 开发规格说明书 v0.1

> 本文档面向 AI 自主开发，所有规格必须严格遵循。冲突时以本文档为准。

## 1. 项目目标

AgentForge 是一款**本地优先**的个人 AI Agent 工作台桌面应用。用户在本地对话下指令，Agent 自主调用工具完成任务。

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

### 非目标（v0.1 范围外）

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

- 渲染进程**不直接**访问 Node.js API，全部通过 `window.electron.*` 调用
- 主进程**不直接**操作 DOM，全部通过 IPC 事件推送
- IPC channel 命名格式: `domain:action`（如 `chat:send`）

## 3. 推荐目录结构

```
agentforge/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── src/
│   ├── main/
│   │   ├── index.ts                 # 窗口创建、应用生命周期
│   │   ├── ipc/
│   │   │   ├── index.ts              # 汇总注册所有 handler
│   │   │   ├── chat.ts
│   │   │   ├── model.ts
│   │   │   ├── file.ts
│   │   │   ├── agent.ts              # P2
│   │   │   ├── mcp.ts                # P2
│   │   │   ├── skill.ts              # P3
│   │   │   └── kb.ts                 # P3
│   │   ├── db/
│   │   │   ├── index.ts              # 连接初始化、migration
│   │   │   ├── schema.sql            # 建表 SQL
│   │   │   └── repos/
│   │   │       ├── conversation.ts
│   │   │       ├── message.ts
│   │   │       ├── model-config.ts
│   │   │       └── app-settings.ts
│   │   ├── models/
│   │   │   ├── adapter.ts            # 抽象基类
│   │   │   ├── openai-adapter.ts
│   │   │   ├── deepseek-adapter.ts
│   │   │   └── router.ts             # 模型路由
│   │   ├── agent/                     # P2
│   │   ├── mcp/                       # P2
│   │   ├── tools/                     # P2
│   │   ├── skills/                    # P3
│   │   ├── kb/                        # P3
│   │   └── utils/
│   │       ├── encryption.ts         # safeStorage 封装
│   │       ├── logger.ts
│   │       └── id.ts                 # UUID 生成
│   ├── preload/
│   │   └── index.ts                  # contextBridge
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.ts
│   │       ├── App.vue
│   │       ├── types/
│   │       │   └── index.ts          # 共享类型
│   │       ├── stores/
│   │       │   ├── chat.ts
│   │       │   ├── model.ts
│   │       │   ├── agent.ts           # P2
│   │       │   ├── mcp.ts             # P2
│   │       │   ├── skill.ts           # P3
│   │       │   ├── kb.ts              # P3
│   │       │   ├── settings.ts
│   │       │   └── ui.ts
│   │       ├── composables/
│   │       │   ├── use-chat.ts
│   │       │   ├── use-agent.ts       # P2
│   │       │   └── use-theme.ts
│   │       ├── components/
│   │       │   ├── ChatPanel/
│   │       │   │   ├── ChatInput.vue
│   │       │   │   └── MessageList.vue
│   │       │   ├── MessageItem/
│   │       │   │   ├── MarkdownRenderer.vue
│   │       │   │   ├── CodeBlock.vue
│   │       │   │   └── ThinkingBlock.vue
│   │       │   ├── Sidebar/
│   │       │   │   ├── Sidebar.vue
│   │       │   │   └── ConversationList.vue
│   │       │   ├── Settings/
│   │       │   │   ├── ModelConfig.vue
│   │       │   │   └── GeneralSettings.vue
│   │       │   └── common/
│   │       │       ├── AppButton.vue
│   │       │       ├── AppInput.vue
│   │       │       ├── AppModal.vue
│   │       │       └── AppToast.vue
│   │       ├── views/
│   │       │   ├── ChatView.vue
│   │       │   └── SettingsView.vue
│   │       ├── utils/
│   │       │   └── markdown.ts
│   │       └── styles/
│   │           └── main.css
│   └── shared/                        # 主进程和渲染进程共享
│       └── types.ts                   # 放 src/shared/types.ts，两边的 tsconfig 都引用
└── resources/                          # 静态资源
```

### 关键约定

- **类型共享**: 共享类型放 `src/shared/types.ts`，主进程和渲染进程的 tsconfig 都 alias 到此路径
- **P 标注**: 目录/文件后标注 `# P2` 表示该阶段才实现，P1 不创建这些文件
- **不存在的文件不要创建空文件占位**，按阶段实际需要创建

## 4. 技术栈约束

| 层级   | 技术         | 版本    | 说明                              |
| ------ | ------------ | ------- | --------------------------------- |
| 构建   | electron-vite | latest | 三进程统一构建                     |
| 运行时 | Electron     | >=33   |                                   |
| UI     | Vue          | 3.5+   | Composition API + `<script setup>` |
| 语言   | TypeScript   | 5.x    | strict 模式，禁用 `any`           |
| 状态   | Pinia        | latest | Setup Store 风格                  |
| 样式   | UnoCSS       | latest | 原子化 CSS                        |
| 组件库 | Naive UI     | latest |                                   |
| 工具   | VueUse       | latest | useDark, useMagicKeys 等          |
| 数据库 | better-sqlite3 | latest | 同步 API                          |
| 向量库 | LanceDB      | latest | 本地向量检索                       |
| Markdown | marked     | latest |                                   |
| 代码高亮 | shiki      | latest | 或 highlight.js                    |
| XSS    | DOMPurify    | latest |                                   |
| 模型   | openai       | latest | Node SDK                          |

### 约束规则

1. **禁用 `nodeIntegration`**，预加载脚本使用 `contextBridge`
2. **禁用 `any`** 类型，所有函数参数和返回值必须显式类型
3. **渲染进程不直接 require Node 模块**，通过 preload bridge
4. **不使用 Vue Router**，采用单窗口视图切换
5. **不使用 CSS 预处理器**（Sass/Less），使用 UnoCSS

## 5. 数据模型

### 核心枚举

```typescript
type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto'
type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
type ExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
type ModelProvider = 'openai' | 'deepseek' | 'anthropic' | 'custom'
type TransportType = 'stdio' | 'http'
```

### 核心实体

#### Conversation（会话）

- **输入**: title, modelId, approvalMode
- **输出**: id, title, modelId, approvalMode, messageCount, lastMessageAt, createdAt, updatedAt
- **异常**: title 为空时自动从首条消息截取前 20 字

#### ChatMessage（消息）

- **输入**: conversationId, role, content, thinking?(assistant), toolCalls?(assistant)
- **输出**: id, conversationId, role, content, thinking, toolCalls(JSON), metadata(JSON), createdAt, updatedAt
- **异常**: conversationId 必须关联已有会话

#### ModelConfig（模型配置）

- **输入**: name, provider, modelId, apiKey, baseUrl?, temperature, maxTokens, capabilities
- **输出**: id, name, provider, modelId, apiKey(加密), baseUrl, temperature, maxTokens, isDefault, capabilities(JSON), createdAt, updatedAt
- **异常**: apiKey 使用 Electron safeStorage 加密存储；provider+modelId 组合不能重复
- **验收**: 添加模型后能通过"测试连接"验证 API Key 有效性

#### AppSettings（应用设置）

- **输入**: theme, language, defaultApprovalMode, maxExecutionSteps, defaultModelId, shortcuts
- **输出**: 同输入 + updatedAt
- **异常**: 无，所有字段有默认值

## 6. SQLite 表结构

数据库路径: `app.getPath('userData')/agentforge.db`
驱动: `better-sqlite3`

### conversations

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  approval_mode TEXT NOT NULL DEFAULT 'auto-edit',
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### messages

```sql
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  thinking        TEXT,
  tool_calls      TEXT,
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
```

### model_configs

```sql
CREATE TABLE IF NOT EXISTS model_configs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  base_url      TEXT,
  temperature   REAL NOT NULL DEFAULT 0.7,
  max_tokens    INTEGER NOT NULL DEFAULT 4096,
  is_default    INTEGER NOT NULL DEFAULT 0,
  capabilities  TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

### app_settings

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  theme                   TEXT NOT NULL DEFAULT 'dark',
  default_approval_mode   TEXT NOT NULL DEFAULT 'auto-edit',
  max_execution_steps     INTEGER NOT NULL DEFAULT 20,
  default_model_id        TEXT,
  shortcuts               TEXT NOT NULL DEFAULT '{}',
  updated_at              INTEGER NOT NULL
);

## 7. IPC 接口规格

### 7.1 Preload 暴露 API 总览

`window.electron` 上挂载以下命名空间：

| 命名空间 | P 阶段 | 方法数 |
|---------|--------|--------|
| `electron.chat` | P1 | 5 |
| `electron.model` | P1 | 6 |
| `electron.settings` | P1 | 2 |
| `electron.file` | P1 | 4 |
| `electron.system` | P1 | 2 |
| `electron.agent` | P2 | 6 |
| `electron.mcp` | P2 | 6 |
| `electron.skill` | P3 | 6 |
| `electron.kb` | P3 | 6 |

### 7.2 P1 IPC Channel 规格

#### chat:send
- **方向**: Renderer → Main
- **输入**: `{ conversationId: string, content: string, modelId: string }`
- **输出**: void（结果通过事件推送）
- **异常**: conversationId 不存在 → 抛错 `CONVERSATION_NOT_FOUND`；modelId 无对应配置 → 抛错 `MODEL_NOT_FOUND`
- **验收**: 发送后主进程开始流式输出
- **暂不实现**: Skill 绑定、审批模式

#### chat:stop
- **方向**: Renderer → Main
- **输入**: 无
- **输出**: void
- **异常**: 无正在进行的生成时静默忽略
- **验收**: 调用后流式输出立即停止

#### chat:stream-chunk
- **方向**: Main → Renderer
- **输入**: `{ type: 'text'|'thinking'|'error', content: string, done?: boolean }`
- **输出**: void（事件）
- **异常**: 无
- **验收**: 渲染进程实时接收并更新消息内容

#### chat:stream-end
- **方向**: Main → Renderer
- **输入**: `{ messageId: string, metadata: { tokensUsed, duration, modelId } }`
- **输出**: void（事件）
- **验收**: 流结束后消息持久化到 SQLite

#### chat:stream-error
- **方向**: Main → Renderer
- **输入**: `{ code: string, message: string }`
- **输出**: void（事件）
- **验收**: UI 显示错误提示

#### model:list
- **方向**: Renderer → Main
- **输入**: 无
- **输出**: `ModelConfig[]`
- **异常**: 无（空表返回空数组）
- **验收**: 返回所有已配置模型

#### model:create
- **方向**: Renderer → Main
- **输入**: `{ name, provider, modelId, apiKey, baseUrl?, temperature?, maxTokens?, capabilities? }`
- **输出**: `ModelConfig`（含 id 和时间戳）
- **异常**: provider+modelId 重复 → 抛错 `MODEL_DUPLICATE`
- **验收**: 创建后能立即在列表中看到

#### model:update
- **方向**: Renderer → Main
- **输入**: `{ id: string, ...partial }`
- **输出**: void
- **异常**: id 不存在 → 抛错 `MODEL_NOT_FOUND`

#### model:delete
- **方向**: Renderer → Main
- **输入**: `{ id: string }`
- **输出**: void
- **异常**: id 不存在 → 抛错 `MODEL_NOT_FOUND`；是默认模型 → 抛错 `MODEL_DELETE_DEFAULT`

#### model:test
- **方向**: Renderer → Main
- **输入**: `{ id: string }`
- **输出**: `{ success: boolean, latency: number, error?: string }`
- **异常**: 网络错误返回 `{ success: false }` 而非抛错
- **验收**: 成功时延迟 < 5000ms，失败时显示错误原因

#### settings:get
- **方向**: Renderer → Main
- **输入**: 无
- **输出**: `AppSettings`
- **异常**: 首次调用自动初始化默认值

#### settings:update
- **方向**: Renderer → Main
- **输入**: `Partial<AppSettings>`
- **输出**: void
- **异常**: 无（所有字段有默认值）

#### file:read / file:write / file:select-dir / file:select-file
- P1 阶段仅 file:select-dir 和 file:select-file 需要实现（用于选择文件路径）
- file:read 和 file:write 在 P2 作为内置工具实现

### 7.3 事件监听模式

所有 Main → Renderer 的事件通过 `ipcRenderer.on(channel, callback)` 监听。Preload 层封装为返回 cleanup 函数的模式：

```
// preload 中
onStreamChunk(callback) { return ipcRenderer.on('chat:stream-chunk', (_, data) => callback(data)) }
// 调用方
const cleanup = window.electron.chat.onStreamChunk(chunk => { ... })
// 组件卸载时
onUnmounted(() => cleanup())
```

## 8. 多模型配置规格

### 8.1 ModelAdapter 抽象接口

```typescript
abstract class ModelAdapter {
  constructor(protected config: ModelConfig) {}
  abstract streamChat(messages: ChatMessage[], options?: { tools?: ToolDefinition[] }): AsyncGenerator<StreamChunk>
  abstract chat(messages: ChatMessage[]): Promise<string>
  abstract detectCapabilities(): Promise<ModelCapabilities>
}
```

### 8.2 OpenAI Adapter
- **输入**: ModelConfig (provider='openai')
- **输出**: 流式/非流式对话结果
- **实现要点**:
  - 使用 `openai` npm 包
  - baseUrl 支持自定义（兼容 OpenAI 兼容 API）
  - streamChat 使用 `stream: true` 获取 SSE 流
  - 将 OpenAI 的 `delta.content` 和 `delta.tool_calls` 转换为统一 StreamChunk 格式
- **异常**: API Key 无效 → 401 错误；网络超时 → 30s 超时重试 1 次
- **验收**: 能与 GPT-4o 和 DeepSeek API（OpenAI 兼容模式）正常通信
- **暂不实现**: Tool-Use 格式转换（P2）

### 8.3 DeepSeek Adapter
- **输入**: ModelConfig (provider='deepseek')
- **输出**: 同 OpenAI Adapter
- **实现**: 继承或复用 OpenAI Adapter，默认 baseUrl 设为 `https://api.deepseek.com/v1`
- **验收**: DeepSeek-Chat 模型正常对话

### 8.4 ModelRouter
- **输入**: modelId
- **输出**: 对应的 ModelAdapter 实例
- **实现**: 内部 Map<modelId, ModelAdapter> 缓存
- **异常**: modelId 不存在 → 抛错 `MODEL_NOT_FOUND`

### 8.5 API Key 加密
- 使用 `electron.safeStorage.encryptString()` 加密存储到 SQLite
- 运行时通过 `safeStorage.decryptString()` 解密
- **异常**: 平台不支持 safeStorage 时降级为 base64 编码并警告
- **验收**: 数据库文件中 api_key 列不可直接读到明文

## 9. Agent ReAct 执行引擎规格

> P2 阶段实现。P1 仅标注接口预留。

### 9.1 执行流程

```
用户输入 → Skill匹配(可选) → 构建System Prompt → [ReAct 循环]
                                                       │
                                                 ┌─────────┴─────────┐
                                                 │  Thought (LLM推理) │
                                                 │  Action (解析工具调用)│
                                                 │  审批检查            │
                                                 │  执行工具            │
                                                 │  Observation (结果)  │
                                                 └─────────┬─────────┘
                                                           │
                                                    type=finish → 结束
```

### 9.2 AgentExecutor
- **输入**: `{ conversationId, userInput, modelId, skillName?, approvalMode, maxSteps? }`
- **输出**: ExecutionResult (executionId, status, summary, trajectories, duration)
- **每步输出**: 通过 `agent:trajectory` 事件推送 TAOTrajectory
- **审批**: 需要审批时通过 `agent:approval-request` 事件推送到渲染进程，等待 `agent:approve` 响应
- **异常**:
  - 工具返回错误 → 作为 Observation 反馈给 LLM（不中断）
  - 连续 3 次工具失败 → 熔断，停止执行
  - 达到 maxSteps → 强制终止
  - 用户取消 → 立即停止
- **验收**: "帮我搜索 Vue 3 最新动态并总结" 能完整执行 3-8 步后输出总结
- **暂不实现**: 检查点恢复（P4）

### 9.3 审批机制

| 模式 | low 风险工具 | medium 风险工具 | high 风险工具 |
|------|------------|----------------|---------------|
| suggest | 需审批 | 需审批 | 需审批 |
| auto-edit | 自动 | 需审批 | 需审批 |
| full-auto | 自动 | 自动 | 自动 |

风险等级映射：
- low: web_search, web_scrape, kb_search, file_read, directory_list
- medium: file_write, image_generate, screenshot_ocr
- high: 所有 MCP 第三方工具（默认 high，除非 Server 声明 safe）

### 9.4 上下文管理
- 维护 ChatMessage[] 数组
- 每轮 Thought+Action+Observation 作为 assistant 消息追加
- token 估算：中文约 1.5 token/字，英文约 0.25 token/word
- 超过模型 maxContextLength 时，截断最早的对话轮次（保留 system prompt）

## 10. MCP Client 规格

> P2 阶段实现。

### 10.1 传输层

#### StdioTransport
- **输入**: `{ command: string, args: string[], env?: Record<string,string> }`
- **输出**: 连接状态
- **实现**: `child_process.spawn(command, args, { env })`，通过 stdin/stdout 传输 JSON-RPC
- **异常**: 命令不存在 → `MCP_SPAWN_FAILED`；进程退出 → 自动重连 1 次后标记 disconnected
- **验收**: 能连接标准的 MCP stdio Server，调用 tools/list 返回工具列表

#### HttpTransport
- **输入**: `{ url: string, headers?: Record<string,string> }`
- **输出**: 连接状态
- **实现**: POST 请求 + SSE 响应
- **验收**: 能连接 Streamable HTTP MCP Server
- **暂不实现**: HttpTransport（P2 先只实现 stdio）

### 10.2 MCPClient
- **输入**: ITransport 实例
- **输出**: 工具列表
- **生命周期**: initialize → tools/list → 运行时 tools/call → 关闭
- **异常**: Server 无响应 → 10s 超时；返回错误 → 标记 isError
- **验收**: 完整生命周期可正常走通

### 10.3 MCPServerManager
- **输入**: MCPServerConfig 列表
- **输出**: 聚合的工具列表 + 各 Server 状态
- **实现**: Map<serverId, {config, client}>，启动时连接所有 enabled 的 server
- **验收**: 添加 Server 后自动连接并发现工具
- **暂不实现**: Resources 和 Prompts 支持

## 11. Skills 系统规格

> P3 阶段实现。

### 11.1 Skill 数据结构
- **输入**: name, displayName, description, prompt, modelId?, allowedTools, trigger, variables?
- **输出**: 完整 Skill 对象
- **存储**: SQLite skills 表
- **异常**: name 重复 → 抛错；prompt 为空 → 抛错

### 11.2 意图匹配
- **输入**: 用户消息 string
- **输出**: `{ matched: boolean, skillName?: string, confidence: number }`
- **实现**: 将所有 auto 触发的 Skill 的 name+description 拼接，让 LLM 判断是否匹配
- **阈值**: confidence >= 0.6 才视为匹配
- **异常**: LLM 返回无法解析 → 视为不匹配（不报错）
- **验收**: 输入"帮我总结这个 PDF" 能匹配 summarize-docs Skill

### 11.3 内置 Skills (P3)

| Skill | 触发 | 使用工具 | 完整 prompt 是 | 暂不实现 |
|-------|------|---------|-------------|--------|
| research-report | auto | web_search, web_scrape, file_write | 需要完整中文 prompt | - |
| summarize-docs | auto | file_read, file_parse, kb_index | 需要完整中文 prompt | - |
| weekly-digest | auto | kb_search, web_search, file_write | 需要完整中文 prompt | P4 |
| study-cards | auto | file_read, file_parse, file_write | 需要完整中文 prompt | P4 |
| content-writer | auto | kb_search, file_write, image_generate | 需要完整中文 prompt | P4 |
| knowledge-graph | manual | file_read, file_parse, kb_search | 需要完整中文 prompt | P4 |

### 11.4 Skill 可视化编辑器
- **输入**: Skill 数据
- **输出**: 保存/更新 Skill
- **验收**: 能创建自定义 Skill，填写所有字段并保存
- **暂不实现**: 实时预览、测试运行（P3 先做基础 CRUD）

## 12. 本地知识库规格

> P3 阶段实现。

### 12.1 文档索引管道
- **输入**: 文件路径 string
- **输出**: Document 对象（含 chunkCount）
- **流程**: parse → chunk(500 token/chunk, 50 token overlap) → embed → store(LanceDB)
- **进度**: 每阶段通过 `kb:index-progress` 事件推送
- **异常**: 文件不存在 → `FILE_NOT_FOUND`；解析失败 → 标记 status=error
- **验收**: 能导入一个 PDF/Markdown 文件，索引后能语义检索
- **暂不实现**: 增量索引/chokidar 监听（P4）

### 12.2 Embedding
- **实现 1 (P3)**: 使用 OpenAI text-embedding-3-small API，dimension=1536
- **实现 2 (P4)**: 使用 @xenova/transformers 本地模型，dimension=384
- **验收**: P3 先用 API Embedding 跑通

### 12.3 检索
- **输入**: query string, limit number
- **输出**: SearchResult[]（含原文片段、来源文档、相关度分数）
- **实现**: query → embedding → LanceDB 向量搜索 → 返回 top-k
- **验收**: 检索结果与查询语义相关
- **暂不实现**: 来源溯源跳转到原文具体位置（P4）
```

## 13. UI 页面规格

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

- **侧边栏**: 固定宽度 240px，可折叠
- **主内容区**: 自适应宽度
- **暗色/亮色主题**: 通过 VueUse `useDark` 实现，持久化到 app_settings
- **P1 阶段只有两个视图**: ChatView、SettingsView
- **暂不实现**: SkillsView、KnowledgeBaseView

### 13.2 ChatView（P1）

**输入**: 无（自动加载会话列表）
**输出**: 对话界面

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
- **输入**: 会话列表数据
- **输出**: 渲染会话列表，支持点击切换
- **交互**: 点击切换当前会话；新建按钮创建空会话；右键/长按删除
- **空状态**: 显示引导文字"创建第一个会话开始对话"
- **验收**: 能创建、切换、删除会话
- **暂不实现**: 拖拽排序、会话搜索

#### 消息列表 (MessageList)
- **输入**: messages 数据
- **输出**: 渲染消息列表
- **交互**: 自动滚动到底部；流式输出时跟随滚动
- **空状态**: 显示引导文字"输入消息开始对话"
- **验收**: 消息按时间排序，流式时实时更新
- **暂不实现**: 虚拟滚动（P5 性能优化）

#### 消息项 (MessageItem)
- **输入**: ChatMessage
- **输出**: 渲染单条消息
- **用户消息**: 右对齐，无头像
- **助手消息**: 左对齐，显示头像（AI 图标）
- **流式状态**: 末尾显示闪烁光标
- **操作**: hover 显示复制按钮
- **验收**: 用户/助手消息样式区分明显
- **暂不实现**: 思考过程折叠（P2）、工具调用卡片（P2）

#### MarkdownRenderer
- **输入**: content string
- **输出**: 渲染后的 HTML
- **实现**: marked 解析 + shiki/highlight.js 代码高亮 + DOMPurify XSS 过滤
- **支持**: 标题、列表、代码块（带语言标签和复制按钮）、加粗、链接、表格
- **异常**: Markdown 解析失败显示原文
- **验收**: 代码块有语法高亮和复制功能

#### ChatInput
- **输入**: 用户输入文本
- **输出**: 触发 sendMessage
- **交互**: Enter 发送（Shift+Enter 换行）；发送中禁用发送按钮；停止按钮替代发送按钮
- **验收**: 能发送消息，流式中能停止
- **暂不实现**: 文件附件、@提及、语音输入

### 13.3 SettingsView（P1）

#### 13.3.1 模型配置页 (ModelConfig)
- **输入**: 模型列表数据
- **输出**: 模型管理界面
- **列表区**: 每行显示 模型名称、提供商标签、默认标记、操作（编辑/删除/测试）
- **添加/编辑**: Modal 弹窗，表单字段：
  - 名称 (必填, text)
  - 提供商 (必填, select: OpenAI / DeepSeek / Custom)
  - 模型 ID (必填, text)
  - API Key (必填, password)
  - Base URL (可选, text, placeholder 显示默认值)
  - Temperature (slider, 0-2, step 0.1, default 0.7)
  - Max Tokens (number, default 4096)
- **连接测试**: 表单中按钮，点击后在按钮旁显示"连接成功 (234ms)"或红色错误
- **验收**: 能添加/编辑/删除/测试模型
- **暂不实现**: 拖拽排序、导入导出

#### 13.3.2 通用设置页 (GeneralSettings)
- **输入**: AppSettings
- **输出**: 设置界面
- **字段**:
  - 主题 (select: 深色/浅色/跟随系统)
  - 默认审批模式 (select: 建议模式/自动编辑/全自动)
  - 最大执行步数 (number, default 20)
  - 默认模型 (select, 从已配置模型中选择)
- **交互**: 修改即时保存
- **验收**: 修改主题后立即切换；修改默认模型后新会话使用该模型

### 13.4 通用组件 (common/)

#### AppButton
- **Props**: `{ variant: 'primary'|'secondary'|'ghost'|'danger', size: 'sm'|'md'|'lg', loading: boolean, disabled: boolean }`
- **验收**: 各 variant 样式正确，loading 时显示 spinner

#### AppInput
- **Props**: `{ modelValue, placeholder, type, error?: string }`
- **验收**: error 时边框变红

#### AppModal
- **Props**: `{ visible, title, width?: number }`
- **Slots**: default, footer
- **交互**: 点击遮罩或 ESC 关闭
- **验收**: 显示/隐藏动画正常

#### AppToast
- **使用**: `useUiStore().showToast(message, type)` 调用
- **Props**: `message, type: 'success'|'error'|'info'|'warning', duration?: number`
- **实现**: Vue teleport 挂载到 body，自动消失
- **验收**: 成功/错误/信息/警告四种样式

## 14. 错误处理规格

### 14.1 错误码

| 错误码 | 场景 | 用户提示 | P 阶段 |
|--------|------|---------|--------|
| CONVERSATION_NOT_FOUND | 会话 ID 不存在 | 会话不存在或已被删除 | P1 |
| MODEL_NOT_FOUND | 模型 ID 不存在 | 模型配置不存在 | P1 |
| MODEL_DUPLICATE | provider+modelId 重复 | 该模型已存在 | P1 |
| MODEL_DELETE_DEFAULT | 删除默认模型 | 无法删除默认模型，请先设置其他模型为默认 | P1 |
| MODEL_API_ERROR | API 调用失败 | 模型服务暂时不可用，请检查网络或 API Key | P1 |
| MODEL_RATE_LIMIT | API 限流 | 请求过于频繁，请稍后重试 | P1 |
| AGENT_MAX_STEPS | 达到最大步数 | 执行步数已达上限 | P2 |
| AGENT_CIRCUIT_BREAK | 熔断 | 连续多次工具调用失败，已终止执行 | P2 |
| AGENT_CANCELLED | 用户取消 | 执行已取消 | P2 |
| TOOL_NOT_FOUND | 工具不存在 | 工具未找到 | P2 |
| TOOL_EXECUTION_ERROR | 工具执行失败 | 工具执行出错 | P2 |
| MCP_SPAWN_FAILED | MCP Server 启动失败 | MCP Server 启动失败，请检查配置 | P2 |
| MCP_CONNECT_FAILED | MCP 连接失败 | MCP Server 连接失败 | P2 |
| KB_INDEX_ERROR | 文档索引失败 | 文档索引出错，请检查文件格式 | P3 |
| FILE_NOT_FOUND | 文件不存在 | 文件不存在 | P2 |
| FILE_ACCESS_ERROR | 文件访问被拒绝 | 无法访问文件，请检查权限 | P2 |

### 14.2 错误传播链

```
底层(工具/模型/MCP) → 包装为 AppError → IPC 上报 → UI 展示
```

**AppError 结构**: `{ code: string, message: string, details?: any }`

### 14.3 各层处理规则
- **工具层**: try/catch 包装，返回 `{ isError: true, content: 错误信息 }`（Agent 会自动反馈给 LLM 重试）
- **模型层**: 网络错误重试 1 次（指数退避），仍然失败则抛出 AppError
- **IPC 层**: ipcMain.handle 中 try/catch，捕获后通过 `chat:stream-error` 发送
- **UI 层**: 接收 error 事件后，通过 AppToast 显示用户提示，消息区显示错误状态

## 15. 安全与权限规格

### 15.1 API Key 保护
- 使用 Electron `safeStorage` 加密存储到 SQLite
- 运行时解密后仅在内存中短暂存在
- **规则**: API Key 不得出现在日志中、不得通过 IPC 明文传输

### 15.2 进程隔离
- 渲染进程 `nodeIntegration: false`
- 渲染进程 `contextIsolation: true`
- 渲染进程 `sandbox: true`（预加载脚本使用 electron-vite 隔离构建）
- **规则**: 所有 Node.js 能力必须通过 preload bridge 显式暴露

### 15.3 文件系统访问
- P1: 通过 `file:select-dir` 和 `file:select-file` 让用户主动选择，不直接操作用户文件
- P2: Agent 内置工具可读写文件，但仅限于用户指定的目录或知识库目录
- **规则**: 不实现全盘文件访问

### 15.4 MCP Server 安全
- MCP Server 作为子进程运行，继承主进程权限
- 第三方 MCP Server 标记为 high 风险，审批模式下必须用户确认
- **规则**: stdio 命令不能是危险的系统命令（如 rm -rf）

## 16. 测试计划

### 16.1 P1 测试（必须通过才能进入 P2）

| 测试场景 | 方法 | 验收标准 |
|---------|------|---------|
| 应用启动 | E2E | electron-vite dev 启动无报错，窗口显示 |
| 模型配置 CRUD | 单元 | 创建/读取/更新/删除模型配置，API Key 加密存储 |
| API Key 加密一致性 | 单元 | 加密后解密得到原文 |
| 创建会话 | 单元 | 创建会话返回 id，数据库中存在对应记录 |
| 发送消息并持久化 | 单元 | 发送消息后 messages 表有对应记录 |
| 流式输出 | 集成 | 模拟流式 chunk，UI 实时更新内容 |
| Markdown 渲染 | 单元 | 代码块有高亮，表格正常渲染 |
| 主题切换 | 单元 | 切换后 CSS 变量正确变化 |
| 对话切换 | 集成 | 切换会话后加载对应消息 |

### 16.2 P2 测试
| 测试场景 | 方法 | 验收标准 |
|---------|------|---------|
| Agent ReAct 循环 | 集成 | 模拟工具，验证 Thought→Action→Observation 完整执行 |
| 审批机制 | 集成 | 三种模式下工具调用行为正确 |
| MCP stdio 连接 | 集成 | 连接测试 Server，获取工具列表 |
| 工具调用 | 单元 | 各内置工具输入输出正确 |

### 16.3 P3 测试
| 测试场景 | 方法 | 验收标准 |
|---------|------|---------|
| Skill 意图匹配 | 单元 | 预设 10 组测试用例，匹配准确率 >= 80% |
| 文档索引 | 集成 | 导入 PDF/Markdown 后能检索到相关内容 |

## 17. 里程碑计划

### M1: P1 可运行闭环（Week 1-3）

**交付物**:
1. electron-vite 应用可启动
2. 模型配置界面可用
3. 基础对话 + SSE 流式输出
4. 会话持久化
5. Markdown + 代码高亮

**验收标准**: 打开应用 → 配置 DeepSeek API Key → 新建会话 → 发送"你好" → 收到流式回复 → 关闭应用 → 重新打开 → 会话和消息仍在

### M2: P2 Agent 闭环（Week 4-6）

**交付物**:
1. Agent ReAct 引擎
2. MCP Client (stdio)
3. 5 个内置工具
4. 三档审批 + Execution Panel

**验收标准**: "帮我搜索 Vue 3 最新动态并总结成笔记" → Agent 自主搜索 3-5 次 → 调用 file_write 保存笔记 → 完整展示 TAO 轨迹

### M3: P3 Skills + 知识库（Week 7-9）

**交付物**:
1. Skills CRUD + 意图匹配
2. 3 个内置 Skill
3. 文档导入 + 语义检索

**验收标准**: 导入一个 PDF → 输入"总结这个文档" → 匹配 summarize-docs Skill → Agent 自动读取并总结 → 检索知识库能找到相关内容

### M4: P4 完善（Week 10-12）
**交付物**: 剩余 Skills、AI 工具、截图 OCR、MCP 管理界面、检查点恢复

### M5: P5 发布（Week 13-14）
**交付物**: UI 打磨、性能优化、electron-builder 打包

## 18. 验收标准总表

### P1 核心验收（阻塞 P2）

| # | 功能 | 验收标准 | 阻塞 |
|---|------|---------|------|
| 1.1 | 应用启动 | `pnpm dev` 无报错，窗口 1200x800，显示侧边栏+空白对话区 | 是 |
| 1.2 | 模型配置-添加 | 打开设置 → 模型配置 → 添加 DeepSeek → 填写 API Key → 保存 → 列表显示新模型 | 是 |
| 1.3 | 模型配置-测试 | 点击测试 → 1s 内显示"连接成功 (xxxms)" | 是 |
| 1.4 | 模型配置-加密 | 打开 SQLite 文件 → api_key 列不是明文 | 是 |
| 1.5 | 新建会话 | 点击新建 → 侧边栏出现新会话 → 主区域切换到空对话 | 是 |
| 1.6 | 发送消息 | 输入"你好" → 发送 → 用户消息右对齐显示 | 是 |
| 1.7 | 流式接收 | 助手消息左对齐显示，文字逐字出现，末尾有光标 | 是 |
| 1.8 | Markdown 渲染 | 发送"用代码展示 hello world" → 代码块有语法高亮和复制按钮 | 是 |
| 1.9 | 会话持久化 | 关闭应用 → 重启 → 会话列表和消息仍在 | 是 |
| 1.10 | 主题切换 | 设置中切换为浅色 → 整体界面变亮 | 否 |
| 1.11 | 停止生成 | 发送长问题 → 点击停止 → 输出停止 | 否 |
