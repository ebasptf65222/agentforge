# AgentForge 任务 Backlog v0.2

> 本 Backlog 基于 `agentforge-spec-v0.2.md` 规格文档拆解，面向 AI 自主开发。
> v0.2 修复了 v0.1 评审中的 Backlog 问题（B01-B05）。
> P2-P5 任务定义同 v0.1，仅 P1 部分有结构性调整。
> 每个任务块新增「状态」字段，用于 AI 领取和跟踪。

### 变更说明（v0.1 → v0.2）

| 编号 | 变更 |
|------|------|
| B01 | P1-09 拆分为 P1-09a（会话 CRUD）和 P1-09b（设置 + 文件选择） |
| B02 | P1-05 仅暴露 preload 接口，不依赖 P1-08 handler 实现 |
| B03 | P1-14（Markdown 渲染）调整为 P1-13 的前置依赖 |
| B04 | 新增 P1-00 环境配置任务 |
| B05 | 复杂度估算包含单元测试编写时间 |

### 复杂度图例

| 标记 | 含义 | 预估工时（含单元测试） |
|------|------|----------------------|
| S | Small | 2-3h |
| M | Medium | 4-5h |
| L | Large | 6-8h |
| XL | Extra Large | 8h（上限） |

### 第一个可运行闭环路径

```
P1-00 → P1-01 → P1-02 → P1-03 → P1-04 → P1-05 → P1-06 → P1-07 → P1-08
→ P1-09a → P1-09b → P1-10 → P1-11 → P1-14 → P1-12 → P1-13 → P1-15 → P1-16 → P1-17
```

---

## P1 - 基础对话闭环（Week 1-3）

### P1-00: 环境配置 <!-- 新增 B04 -->

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-00 |
| **状态** | done |
| **标题** | 开发环境配置（Node 版本、pnpm、.nvmrc、.env.example） |
| **目标** | 锁定 Node.js 版本，配置 pnpm，创建环境变量模板和 ESLint/Prettier 配置 |
| **依赖任务** | 无 |
| **涉及文件** | `.nvmrc`, `.env.example`, `.prettierrc`, `.eslintrc.js`(flat config), `package.json` |
| **输入** | 空项目 |
| **输出** | `node -v` 匹配 .nvmrc，`pnpm install` 无报错，ESLint 检查通过 |
| **验收标准** | 1) .nvmrc 指定 Node >= 20.0; 2) pnpm 为包管理器; 3) .env.example 含 `OPENAI_API_KEY=` 占位; 4) ESLint flat config 启用 strict TypeScript 规则; 5) Prettier 配置 2 空格缩进、单引号、无分号 |
| **不要做的事情** | 不安装项目依赖（那是 P1-01）；不配置 electron-builder |
| **预估复杂度** | S（2h） |

---

### P1-01: 项目脚手架初始化

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-01 |
| **状态** | done |
| **标题** | 项目脚手架初始化（electron-vite + Vue 3 + TypeScript） |
| **目标** | 创建 electron-vite 项目骨架，配置三进程 TypeScript strict 模式，安装核心依赖 |
| **依赖任务** | P1-00 |
| **涉及文件** | `electron.vite.config.ts`, `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `unocss.config.ts`, `src/main/index.ts`(占位), `src/preload/index.ts`(占位), `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/App.vue` |
| **输入** | electron-vite 官方模板 |
| **输出** | `pnpm dev` 可启动 Electron 窗口，窗口显示 "AgentForge" 标题，控制台无报错 |
| **验收标准** | 1) `pnpm dev` 无报错启动; 2) 窗口尺寸 1200x800; 3) TypeScript strict 模式已启用且无 `any` 错误; 4) 依赖清单包含 vue^3.5, pinia^2.2, naive-ui^2.40, unocss^0.65, vueuse^11.0, better-sqlite3^11.0, @electron/rebuild^3.6, marked^14.0, shiki^1.0, dompurify^3.1, openai^4.0; 5) `postinstall` 脚本包含 `electron-rebuild -f -w better-sqlite3`; 6) UnoCSS 配置 `preflights: false` |
| **不要做的事情** | 不要安装 P2+ 才需要的依赖（lancedb 等）；不要创建 P2+ 的空文件占位；不要配置 electron-builder 打包 |
| **预估复杂度** | S（3h） |

---

### P1-02: 主进程窗口创建与生命周期

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-02 |
| **状态** | done |
| **标题** | 主进程窗口创建、生命周期管理、单实例锁、安全配置 |
| **目标** | 实现主进程入口，创建 BrowserWindow，配置安全策略，注册应用生命周期事件，实现单实例锁和窗口状态持久化 |
| **依赖任务** | P1-01 |
| **涉及文件** | `src/main/index.ts` |
| **输入** | 无 |
| **输出** | 应用启动时创建 1200x800 主窗口，关闭时清理资源 |
| **验收标准** | 1) `nodeIntegration: false`; 2) `contextIsolation: true`; 3) `sandbox: true`; 4) `webSecurity: true`; 5) `allowRunningInsecureContent: false`; 6) CSP header 注入; 7) `app.requestSingleInstanceLock()` 生效; 8) `before-quit` 中关闭数据库连接; 9) 窗口尺寸/位置持久化到 app_settings; 10) 开发环境打开 DevTools |
| **不要做的事情** | 不要实现多窗口；不要配置自定义协议；不要实现托盘图标 |
| **预估复杂度** | M（4h） |

---

### P1-03: SQLite 数据库初始化与 Schema

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-03 |
| **状态** | done |
| **标题** | SQLite 数据库初始化、PRAGMA 配置、表结构、迁移机制 |
| **目标** | 使用 better-sqlite3 初始化数据库连接，配置 PRAGMA，创建 conversations、messages、model_configs、app_settings、schema_version 五张表，实现 migration 机制 |
| **依赖任务** | P1-01 |
| **涉及文件** | `src/main/db/index.ts`, `src/main/db/schema.sql`, `src/main/db/repos/conversation.ts`, `src/main/db/repos/message.ts`, `src/main/db/repos/model-config.ts`, `src/main/db/repos/app-settings.ts` |
| **输入** | app.getPath('userData') 路径 |
| **输出** | 数据库文件 `agentforge.db`，含五张表及索引 |
| **验收标准** | 1) `PRAGMA journal_mode=WAL` 生效; 2) `PRAGMA foreign_keys=ON` 生效; 3) `PRAGMA busy_timeout=5000` 生效; 4) schema_version 表存在且 version=1; 5) conversations.model_id 有外键引用 model_configs(id); 6) messages.role 有 CHECK 约束; 7) model_configs.provider 有 CHECK 约束; 8) model_configs 有 UNIQUE(provider, model_id); 9) messages 表有 idx_messages_conv 索引; 10) conversations 表有 idx_conv_updated 索引; 11) app_settings 有 INSERT OR IGNORE 初始化; 12) 外键 ON DELETE CASCADE 生效 |
| **不要做的事情** | 不要实现 ORM；不要创建 P2+ 的表（skills, mcp_servers, kb_documents 等）；不要实现数据库备份 |
| **预估复杂度** | M（5h） |

---

### P1-04: 共享类型定义

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-04 |
| **状态** | done |
| **标题** | 主进程与渲染进程共享类型定义（全部核心接口） |
| **目标** | 定义 Spec v0.2 §5 中所有核心 TypeScript 类型，配置 tsconfig alias |
| **依赖任务** | P1-01 |
| **涉及文件** | `src/shared/types.ts`, `src/renderer/src/types/index.ts`(re-export), `tsconfig.node.json`, `tsconfig.web.json` |
| **输入** | Spec v0.2 §5 类型定义 |
| **输出** | 所有核心枚举和接口类型定义 |
| **验收标准** | 1) 定义 §5.1 所有枚举: ApprovalMode, MessageRole, ExecutionStatus, ModelProvider, TransportType, ToolRiskLevel, SkillTrigger, StreamChunkType; 2) 定义 §5.2 所有实体接口: Conversation, ChatMessage, ToolCallRecord, MessageMetadata, ModelConfig, ModelCapabilities, AppSettings, ShortcutConfig; 3) 定义 §5.3-5.7 所有功能接口: StreamChunk, StreamEndMetadata, StreamError, AgentExecutionRequest, ExecutionResult, TAOTrajectory, ToolAction, ApprovalRequest, ApprovalResponse, ToolDefinition, ToolExecutionResult, MCPServerConfig, ITransport, MCPServerStatus, Skill, SkillVariable, SkillMatchResult, KbDocument, DocumentChunk, SearchResult, KbIndexProgress; 4) 定义 §5.8 AppError 类; 5) 主进程和渲染进程都能 `import type { ... } from '@shared/types'`; 6) 无 `any` 类型 |
| **不要做的事情** | 不要定义 Spec 中没有的接口；不要使用 interface extends any |
| **预估复杂度** | S（3h） |

---

### P1-05: Preload 脚本与 contextBridge

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-05 |
| **状态** | done |
| **标题** | Preload 脚本实现（P1 IPC API 暴露 + 类型声明） |
| **目标** | 实现预加载脚本，通过 contextBridge 暴露 P1 阶段所有 IPC 方法：chat, model, settings, file, system 五个命名空间，并生成类型声明文件 |
| **依赖任务** | P1-02, P1-04 |
| **涉及文件** | `src/preload/index.ts`, `src/renderer/src/types/electron-api.ts`, `src/renderer/src/env.d.ts` |
| **输入** | Spec v0.2 §7 IPC 接口规格 |
| **输出** | `window.electron.chat/model/settings/file/system` 可用且有类型提示 |
| **验收标准** | 1) `window.electron.chat.send()` 可调用; 2) `window.electron.chat.createConversation()` 可调用; 3) `window.electron.chat.listConversations()` 可调用; 4) `window.electron.chat.getMessages()` 可调用; 5) `window.electron.chat.onStreamChunk()` 返回 cleanup 函数; 6) `window.electron.model.list/create/update/delete/test/get` 可调用; 7) `window.electron.settings.get/update` 可调用; 8) `window.electron.file.selectDir/selectFile` 可调用; 9) `window.electron.system.getVersion/openExternal` 可调用; 10) 所有方法参数和返回值有明确类型; 11) `env.d.ts` 声明 `window.electron` 类型; 12) 渲染进程中 `require('electron')` 报错 |
| **不要做的事情** | 不要暴露 P2+ 的 agent/mcp/skill/kb 命名空间；不要在 preload 中做业务逻辑；Preload 只定义接口签名，不依赖 handler 实现（handler 在 P1-06/P1-08/P1-09 中实现） |
| **预估复杂度** | M（5h） |

---

### P1-06: IPC Handlers - 模型配置

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-06 |
| **状态** | done |
| **标题** | IPC Handlers - 模型配置 CRUD + 连接测试 + API Key 加密 |
| **目标** | 实现主进程侧 model 命名空间的所有 IPC handler：list, create, update, delete, test, get，含 API Key 加密存储和 ModelRouter 缓存失效 |
| **依赖任务** | P1-03, P1-04, P1-05 |
| **涉及文件** | `src/main/ipc/model.ts`, `src/main/ipc/index.ts`, `src/main/utils/encryption.ts`, `src/main/utils/error.ts`, `src/main/db/repos/model-config.ts` |
| **输入** | 渲染进程通过 IPC 传入的模型配置数据 |
| **输出** | 模型 CRUD 操作结果，连接测试结果 |
| **验收标准** | 1) `model:create` 能创建并返回含 id 和时间戳的 ModelConfig; 2) provider+modelId 重复时抛 `MODEL_DUPLICATE`; 3) API Key 使用 safeStorage 加密后存入 SQLite; 4) `model:list` 和 `model:get` 返回的 apiKey 为 `***`; 5) `model:update` 时清除 ModelRouter 缓存; 6) `model:delete` 时清除 ModelRouter 缓存; 7) `model:test` 向 API 发送 "Hi" 并返回延迟; 8) 删除默认模型时抛 `MODEL_DELETE_DEFAULT`; 9) safeStorage 不可用时抛 `SAFE_STORAGE_UNAVAILABLE`; 10) 加密后数据库中 api_key 列不是明文; 11) 所有错误通过 AppError 包装 |
| **不要做的事情** | 不要实现 ModelAdapter（那是 P1-07）；不要做拖拽排序、导入导出 |
| **预估复杂度** | M（5h） |

---

### P1-07: OpenAI/DeepSeek 模型适配器

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-07 |
| **状态** | done |
| **标题** | OpenAI 与 DeepSeek 模型适配器实现（SSE 流式 + AbortSignal） |
| **目标** | 实现 ModelAdapter 抽象基类、OpenAI Adapter、DeepSeek Adapter、ModelRouter，支持流式对话（AsyncGenerator）和中断 |
| **依赖任务** | P1-03, P1-04, P1-06 |
| **涉及文件** | `src/main/models/adapter.ts`, `src/main/models/openai-adapter.ts`, `src/main/models/deepseek-adapter.ts`, `src/main/models/router.ts` |
| **输入** | ModelConfig（含解密后的 API Key） |
| **输出** | AsyncGenerator<StreamChunk> 流式输出 |
| **验收标准** | 1) OpenAI Adapter 使用 `openai` npm 包，`stream: true` 获取 SSE; 2) DeepSeek Adapter 继承 OpenAI Adapter，默认 baseUrl 为 `https://api.deepseek.com/v1`; 3) baseUrl 支持自定义; 4) streamChat 支持 AbortSignal 中断; 5) ModelRouter 根据 modelId 返回对应 Adapter 实例; 6) model:update/delete 时 ModelRouter 清除缓存; 7) API Key 无效时抛 AppError('MODEL_API_ERROR'); 8) 网络超时 30s 重试 1 次（退避 1000ms）; 9) StreamChunk 转换正确（delta.content → type:'text'） |
| **不要做的事情** | 不要实现 Tool-Use 格式转换（P2）；不要实现 detectCapabilities; 不要做本地模型推理 |
| **预估复杂度** | L（6h） |

---

### P1-08: IPC Handlers - 对话发送/停止 + 流式事件

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-08 |
| **状态** | done |
| **标题** | IPC Handlers - 对话发送/停止 + 流式事件 + 持久化 + 并发控制 |
| **目标** | 实现 chat:send 和 chat:stop handler，完成流式事件推送（stream-chunk, stream-end, stream-error），实现消息持久化和并发控制 |
| **依赖任务** | P1-05, P1-07, P1-03 |
| **涉及文件** | `src/main/ipc/chat.ts`, `src/main/ipc/index.ts`, `src/main/db/repos/conversation.ts`, `src/main/db/repos/message.ts` |
| **输入** | `{ conversationId, content, modelId }` |
| **输出** | 流式 chunk 事件推送到渲染进程，消息持久化到 SQLite |
| **验收标准** | 1) `chat:send` 触发 ModelAdapter.streamChat 并通过 `chat:stream-chunk` 推送每个 chunk; 2) 流结束后通过 `chat:stream-end` 发送 messageId 和 StreamEndMetadata; 3) conversationId 不存在时抛 `CONVERSATION_NOT_FOUND`; 4) modelId 无对应配置时抛 `MODEL_NOT_FOUND`; 5) 已有进行中的生成时抛 `CHAT_ALREADY_RUNNING`; 6) 用户和助手消息都持久化到 messages 表; 7) 会话的 message_count 和 last_message_at 自动更新; 8) 首条消息时自动截取前 20 字更新 title; 9) `chat:stop` 中断流式并保存已生成内容，metadata.stopped=true; 10) 错误通过 `chat:stream-error` 推送; 11) 使用 AbortController 实现中断 |
| **不要做的事情** | 不要实现 Skill 绑定；不要实现审批模式；不要实现 Agent ReAct 循环 |
| **预估复杂度** | L（7h） |

---

### P1-09a: IPC Handlers - 会话管理 CRUD <!-- 修复 B01: 拆分 -->

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-09a |
| **状态** | done |
| **标题** | IPC Handlers - 会话 CRUD（create/list/get/delete/get-messages） |
| **目标** | 实现会话管理的所有 IPC handler |
| **依赖任务** | P1-03, P1-05 |
| **涉及文件** | `src/main/ipc/chat.ts`(会话部分), `src/main/ipc/index.ts`, `src/main/db/repos/conversation.ts`, `src/main/db/repos/message.ts` |
| **输入** | 会话创建/查询参数 |
| **输出** | 会话列表/单条会话/消息列表 |
| **验收标准** | 1) `chat:create-conversation` 返回含 id 的 Conversation; 2) `chat:list-conversations` 按 updated_at DESC 返回; 3) `chat:get-conversation` 返回单条会话; 4) `chat:delete-conversation` 删除并 CASCADE 删除消息; 5) `chat:get-messages` 按 created_at ASC 返回消息; 6) 创建时 modelId 不存在抛 MODEL_NOT_FOUND; 7) title 为空时默认"新会话" |
| **不要做的事情** | 不要实现拖拽排序、会话搜索、会话归档 |
| **预估复杂度** | M（4h） |

---

### P1-09b: IPC Handlers - 设置 + 文件选择 + 系统接口 <!-- 修复 B01: 拆分 -->

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-09b |
| **状态** | done |
| **标题** | IPC Handlers - 通用设置 + 文件选择 + 系统接口 |
| **目标** | 实现 settings、file、system 命名空间的所有 IPC handler |
| **依赖任务** | P1-03, P1-05 |
| **涉及文件** | `src/main/ipc/chat.ts`(设置部分 → 独立或合并), `src/main/ipc/index.ts`, `src/main/db/repos/app-settings.ts` |
| **输入** | 设置更新参数 / 文件选择参数 |
| **输出** | 设置对象 / 文件路径 / 系统信息 |
| **验收标准** | 1) `settings:get` 首次自动初始化默认值; 2) `settings:update` 即时保存; 3) `file:select-dir` 打开目录选择对话框; 4) `file:select-file` 打开文件选择对话框; 5) `system:get-version` 返回应用/Electron/Node/平台版本; 6) `system:open-external` 仅允许 http/https，非法协议抛 INVALID_URL |
| **不要做的事情** | 不要实现 file:read 和 file:write（P2 作为 Agent 工具实现） |
| **预估复杂度** | S（3h） |

---

### P1-10: 渲染进程主布局与视图切换

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-10 |
| **状态** | done |
| **标题** | 渲染进程主布局（Sidebar + MainContent）与视图切换 |
| **目标** | 实现 App.vue 主布局，配置 Pinia、UnoCSS、Naive UI，实现 ChatView / SettingsView 视图切换 |
| **依赖任务** | P1-01, P1-05 |
| **涉及文件** | `src/renderer/src/main.ts`, `src/renderer/src/App.vue`, `src/renderer/src/views/ChatView.vue`, `src/renderer/src/views/SettingsView.vue`, `src/renderer/src/stores/ui.ts` |
| **输入** | 无 |
| **输出** | 主界面显示侧边栏和主内容区，可在两个视图间切换 |
| **验收标准** | 1) 侧边栏固定宽度 240px; 2) 主内容区自适应; 3) 点击导航切换 ChatView/SettingsView; 4) 不使用 Vue Router; 5) UnoCSS 原子类生效且 preflight 关闭; 6) Naive UI 组件可正常使用; 7) Pinia Store 初始化 |
| **不要做的事情** | 不要实现 SkillsView、KnowledgeBaseView；不要做复杂路由动画 |
| **预估复杂度** | M（4h） |

---

### P1-11: 通用 UI 组件

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-11 |
| **状态** | done |
| **标题** | 通用 UI 组件（AppButton, AppInput, AppModal, AppToast） |
| **目标** | 实现 4 个通用基础组件 |
| **依赖任务** | P1-10 |
| **涉及文件** | `src/renderer/src/components/common/AppButton.vue`, `src/renderer/src/components/common/AppInput.vue`, `src/renderer/src/components/common/AppModal.vue`, `src/renderer/src/components/common/AppToast.vue` |
| **输入** | Props 参数 |
| **输出** | 可复用 UI 组件 |
| **验收标准** | 1) AppButton: 4 variant, 3 size, loading spinner, disabled; 2) AppInput: v-model, error 边框变红, maxlength; 3) AppModal: fade 动画, 遮罩/ESC 关闭, z-index 1000; 4) AppToast: showToast() 调用, 4 类型, 最多 3 个堆叠, z-index 2000 |
| **不要做的事情** | 不要做复杂动画库集成；不要做拖拽组件 |
| **预估复杂度** | M（4h） |

---

### P1-14: Markdown 渲染 + 代码高亮 <!-- 修复 B03: 调整为 P1-13 前置 -->

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-14 |
| **状态** | done |
| **标题** | Markdown 渲染器 + 代码块语法高亮 |
| **目标** | 实现 MarkdownRenderer 组件和 CodeBlock 子组件 |
| **依赖任务** | P1-11 |
| **涉及文件** | `src/renderer/src/components/MessageItem/MarkdownRenderer.vue`, `src/renderer/src/components/MessageItem/CodeBlock.vue`, `src/renderer/src/utils/markdown.ts` |
| **输入** | Markdown 文本 |
| **输出** | 渲染后的安全 HTML |
| **验收标准** | 1) 使用 marked 解析; 2) 使用 shiki 高亮（暗色 one-dark-pro, 亮色 github-light）; 3) 代码块显示语言标签和复制按钮; 4) 复制用 navigator.clipboard, 显示"已复制"2s; 5) 使用 DOMPurify 过滤 XSS; 6) 解析失败显示原文 |
| **不要做的事情** | 不要做 LaTeX 公式渲染；不要做 Mermaid 图表 |
| **预估复杂度** | M（5h） |

---

### P1-12: 侧边栏与会话列表

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-12 |
| **状态** | done |
| **标题** | 侧边栏组件与会话列表（CRUD + 切换） |
| **目标** | 实现侧边栏（含会话列表、新建按钮、导航切换） |
| **依赖任务** | P1-09a, P1-10, P1-11 |
| **涉及文件** | `src/renderer/src/components/Sidebar/Sidebar.vue`, `src/renderer/src/components/Sidebar/ConversationList.vue`, `src/renderer/src/stores/chat.ts` |
| **输入** | 会话列表数据（从 IPC 获取） |
| **输出** | 可交互的侧边栏会话列表 |
| **验收标准** | 1) 新建按钮创建空会话; 2) 点击切换会话并加载消息; 3) 删除会话后消失; 4) 空状态显示引导文字; 5) 当前选中高亮; 6) 按 last_message_at 倒序; 7) 首次加载显示 skeleton; 8) 侧边栏可折叠（CmdOrCtrl+B） |
| **不要做的事情** | 不要做拖拽排序；不要做会话搜索；不要做右键菜单（P2） |
| **预估复杂度** | M（4h） |

---

### P1-13: 对话界面（消息列表 + 输入框 + 流式渲染） <!-- 修复 B03: 依赖 P1-14 -->

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-13 |
| **状态** | done |
| **标题** | 对话界面（ChatInput + MessageList + MessageItem + 流式渲染） |
| **目标** | 实现完整的对话交互界面 |
| **依赖任务** | P1-08, P1-09a, P1-11, P1-14, P1-12 |
| **涉及文件** | `src/renderer/src/components/ChatPanel/ChatInput.vue`, `src/renderer/src/components/ChatPanel/MessageList.vue`, `src/renderer/src/components/MessageItem/MessageItem.vue`, `src/renderer/src/stores/chat.ts`, `src/renderer/src/composables/use-chat.ts` |
| **输入** | 用户消息文本 |
| **输出** | 完整对话交互体验 |
| **验收标准** | 1) Enter 发送, Shift+Enter 换行; 2) 用户消息右对齐; 3) 助手消息左对齐，流式逐字出现，末尾光标; 4) 流式时发送变停止按钮; 5) 停止后已生成内容保留; 6) 消息列表自动滚动，用户上滚时停止跟随并显示"回到底部"; 7) 空状态显示引导; 8) 切换会话加载消息; 9) ChatInput 最大 32000 字符; 10) 空消息禁用发送; 11) 100 条消息渲染 ≤ 500ms |
| **不要做的事情** | 不要实现文件附件；不要做 @提及；不要做虚拟滚动 |
| **预估复杂度** | L（7h） |

---

### P1-15: 设置页面 - 模型配置

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-15 |
| **状态** | done |
| **标题** | 设置页面 - 模型配置（添加/编辑/删除/测试） |
| **目标** | 实现模型配置管理界面 |
| **依赖任务** | P1-06, P1-10, P1-11 |
| **涉及文件** | `src/renderer/src/components/Settings/ModelConfig.vue`, `src/renderer/src/stores/model.ts` |
| **输入** | 模型列表数据 |
| **输出** | 模型配置管理界面 |
| **验收标准** | 1) 列表显示名称/提供商标签/默认标记/操作; 2) 添加/编辑用 AppModal; 3) 表单字段完整（名称/提供商/模型ID/API Key/Base URL/Temperature/Max Tokens）; 4) 连接测试 loading → "成功 (xxxms)"或错误; 5) 删除默认模型 Toast 提示; 6) 列表加载 skeleton |
| **不要做的事情** | 不要做拖拽排序；不要做导入导出 |
| **预估复杂度** | L（6h） |

---

### P1-16: 设置页面 - 通用设置 + 主题切换

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-16 |
| **状态** | done |
| **标题** | 设置页面 - 通用设置 + 暗色/亮色主题切换 |
| **目标** | 实现通用设置界面，使用 VueUse useDark 实现主题切换 |
| **依赖任务** | P1-09b, P1-10, P1-11 |
| **涉及文件** | `src/renderer/src/components/Settings/GeneralSettings.vue`, `src/renderer/src/stores/settings.ts`, `src/renderer/src/styles/main.css` |
| **输入** | AppSettings 数据 |
| **输出** | 通用设置界面 |
| **验收标准** | 1) 主题选择即时切换; 2) 默认审批模式; 3) 最大执行步数; 4) 默认模型 select; 5) 审批超时设置; 6) 修改即时保存; 7) 重启后保持 |
| **不要做的事情** | 不要做自定义主题配色；不要做快捷键设置界面 |
| **预估复杂度** | M（4h） |

---

### P1-17: P1 集成测试与闭环验证

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-17 |
| **状态** | done |
| **标题** | P1 集成验证 - 完整闭环走通 |
| **目标** | 按 M1 里程碑验收标准，完整走通第一个可运行闭环 |
| **依赖任务** | P1-00 ~ P1-16 全部完成 |
| **涉及文件** | 可能涉及修复的任何已有文件 |
| **输入** | 完整的 P1 功能 |
| **输出** | 通过 M1 里程碑所有验收标准 |
| **验收标准** | 完整流程：打开应用 → 配置 DeepSeek API Key → 新建会话 → 发送"你好" → 收到流式回复 → Markdown 渲染正常 → 关闭应用 → 重新打开 → 会话和消息仍在 → 主题切换正常 → 停止生成正常 → 冷启动 ≤ 3s → 空闲内存 ≤ 300MB → 100 条消息渲染 ≤ 500ms → PRAGMA 配置正确 → 级联删除无孤儿记录 |
| **不要做的事情** | 不要添加新功能；不要做性能优化 |
| **预估复杂度** | M（4h） |

---

## P2 - Agent 引擎 + MCP 工具（Week 4-6）

> P2 任务定义同 v0.1，新增「状态」字段。关键变更：
> - P2-01 新增 AppError 类实现（引用 Spec v0.2 §5.8）
> - P2-03 审批机制新增超时处理（Spec v0.2 §9.2）
> - P2-05/P2-06 工具注册引用 Spec v0.2 §5.5 ToolDefinition/ToolExecutionResult 类型

### P2 任务列表（简表）

| 任务 ID | 标题 | 依赖 | 复杂度 | 状态 |
|---------|------|------|--------|------|
| P2-01 | AppError 错误体系 | P1-17 | S(3h) | in-progress |
| P2-02 | Agent ReAct 执行引擎核心 | P1-17, P2-01 | XL(8h) | pending |
| P2-03 | Agent 审批机制（含超时） | P2-02 | M(5h) | pending |
| P2-04 | Agent IPC Handlers + Preload 扩展 | P2-02, P2-03 | M(5h) | pending |
| P2-05 | 内置工具 - web_search + web_scrape | P2-02 | M(4h) | pending |
| P2-06 | 内置工具 - file_read + file_write + directory_list | P2-02 | M(4h) | pending |
| P2-07 | MCP Client - StdioTransport | P2-01 | L(6h) | pending |
| P2-08 | MCP Server 管理器 | P2-07 | L(7h) | pending |
| P2-09 | Execution Panel UI | P2-04, P2-03 | L(7h) | pending |
| P2-10 | ThinkingBlock 折叠组件 | P1-14, P2-09 | S(3h) | pending |
| P2-11 | P2 集成测试与闭环验证 | P2-01~P2-10 | L(6h) | pending |

> 详细任务定义参见 `task-backlog-v0.1.md` P2 部分，类型引用 Spec v0.2 §5。

---

## P3 - Skills 系统 + 本地知识库（Week 7-9）

> P3 任务定义同 v0.1，新增「状态」字段。关键变更：
> - P3-03 意图匹配引用 Spec v0.2 §11.3 prompt 模板和返回格式
> - P3-04 Skill 变量替换引用 Spec v0.2 §11.2
> - P3-07/P3-08/P3-09 知识库类型引用 Spec v0.2 §5.7

### P3 任务列表（简表）

| 任务 ID | 标题 | 依赖 | 复杂度 | 状态 |
|---------|------|------|--------|------|
| P3-01 | Skills 数据库表 + CRUD | P2-11 | S(3h) | pending |
| P3-02 | Skills IPC + Preload | P3-01 | S(3h) | pending |
| P3-03 | Skill 意图匹配引擎 | P3-02, P1-07 | M(4h) | pending |
| P3-04 | Skill 执行集成 | P3-03, P2-02 | M(5h) | pending |
| P3-05 | 内置 Skills（research-report + summarize-docs） | P3-04 | M(5h) | pending |
| P3-06 | Skills 管理界面 | P3-02 | L(6h) | pending |
| P3-07 | 知识库数据库表 + Embedding API | P2-11 | M(5h) | pending |
| P3-08 | 文档解析 + Chunking | P3-07 | M(5h) | pending |
| P3-09 | LanceDB 向量存储 + 语义检索 | P3-07, P3-08 | M(5h) | pending |
| P3-10 | 知识库 IPC + 内置工具 | P3-09 | L(6h) | pending |
| P3-11 | P3 集成测试与闭环验证 | P3-01~P3-10 | L(6h) | pending |

---

## P4 - 功能完善（Week 10-12）

> P4 任务定义同 v0.1。

| 任务 ID | 标题 | 依赖 | 复杂度 | 状态 |
|---------|------|------|--------|------|
| P4-01 | MCP HTTP Transport | P3-11 | M(4h) | pending |
| P4-02 | MCP Server 管理界面 | P2-08, P4-01 | L(6h) | pending |
| P4-03 | screenshot_ocr + image_generate | P3-11 | L(6h) | pending |
| P4-04 | 剩余内置 Skills | P3-05, P4-03 | L(6h) | pending |
| P4-05 | 检查点恢复 | P3-11 | L(7h) | pending |
| P4-06 | 知识库管理界面 | P3-10 | L(7h) | pending |
| P4-07 | Word/Excel 文档解析 | P3-08 | M(4h) | pending |
| P4-08 | 本地 Embedding 模型 | P3-07 | M(5h) | pending |
| P4-09 | 增量索引 + 文件监听 | P3-10 | M(4h) | pending |
| P4-10 | P4 集成测试 | P4-01~P4-09 | M(4h) | pending |

---

## P5 - 发布打磨（Week 13-14）

> P5 任务定义同 v0.1。

| 任务 ID | 标题 | 依赖 | 复杂度 | 状态 |
|---------|------|------|--------|------|
| P5-01 | UI 视觉打磨 | P4-10 | M(5h) | pending |
| P5-02 | 虚拟滚动 + 性能优化 | P4-10 | M(5h) | pending |
| P5-03 | electron-builder 打包配置 | P4-10 | L(6h) | pending |
| P5-04 | 应用图标 + 资源 | P5-03 | S(3h) | pending |
| P5-05 | 日志系统 + 错误上报 | P4-10 | S(3h) | pending |
| P5-06 | 端到端测试 | P5-03 | M(5h) | pending |
| P5-07 | 最终验收与发布准备 | P5-01~P5-06 | M(4h) | pending |

---

## 任务统计（v0.2）

| 阶段 | 任务数 | 总预估工时 | 里程碑 |
|------|--------|-----------|--------|
| P1 | 18 (+1 环境, P1-09 拆分) | ~72h | M1: 基础对话闭环 |
| P2 | 11 | ~55h | M2: Agent 闭环 |
| P3 | 11 | ~53h | M3: Skills + 知识库 |
| P4 | 10 | ~52h | M4: 功能完善 |
| P5 | 7 | ~31h | M5: 发布打磨 |
| **合计** | **57** | **~263h** | - |

## 关键依赖链

```
P1 闭环：P1-00 → P1-01 → P1-02 → P1-03 → P1-04 → P1-05 → P1-06 → P1-07 → P1-08
         → P1-09a → P1-09b → P1-10 → P1-11 → P1-14 → P1-12 → P1-13 → P1-15 → P1-16 → P1-17

P2 闭环：P2-01 → P2-02 → P2-03 → P2-04 → P2-05/P2-06(并行) → P2-07 → P2-08
         → P2-09 → P2-10 → P2-11

P3 闭环：P3-01 → P3-02 → P3-03 → P3-04 → P3-05 → P3-06
         P3-07 → P3-08 → P3-09 → P3-10 → P3-11

P4：各任务基本独立，依赖 P3-11
P5：各任务基本独立，依赖 P4-10
```
