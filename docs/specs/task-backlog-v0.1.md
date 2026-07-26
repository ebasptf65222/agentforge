# AgentForge 任务 Backlog v0.1

> 本 Backlog 基于 `agentforge-spec-v0.1.md` 规格文档拆解，面向 AI 自主开发。
> 每个任务独立可交付，预估 2-8 小时完成。
> 第一个可运行闭环路径：P1-01 -> P1-02 -> P1-03 -> P1-04 -> P1-05 -> P1-06 -> P1-07 -> P1-08 -> P1-09 -> P1-10 -> P1-11 -> P1-12 -> P1-13 -> P1-14

---

## P1 - 基础对话闭环（Week 1-3）

> 目标：electron-vite 应用启动 -> 模型配置 -> 基础对话 -> SQLite 会话持久化 -> SSE 流式输出

### P1-01: 项目脚手架初始化

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-01 |
| **标题** | 项目脚手架初始化（electron-vite + Vue 3 + TypeScript） |
| **目标** | 创建 electron-vite 项目骨架，配置三进程（main/preload/renderer）TypeScript 严格模式，安装核心依赖 |
| **依赖任务** | 无 |
| **涉及文件** | `electron.vite.config.ts`, `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `src/main/index.ts`(占位), `src/preload/index.ts`(占位), `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/App.vue` |
| **输入** | electron-vite 官方模板 |
| **输出** | `pnpm dev` 可启动 Electron 窗口，窗口显示 "AgentForge" 标题，控制台无报错 |
| **验收标准** | 1) `pnpm dev` 无报错启动; 2) 窗口尺寸 1200x800; 3) TypeScript strict 模式已启用且无 `any` 错误; 4) 依赖清单包含 vue3.5+, pinia, naive-ui, unocss, vueuse, better-sqlite3, marked, shiki, dompurify, openai |
| **不要做的事情** | 不要安装 P2+ 才需要的依赖（lancedb 等）；不要创建 P2+ 的空文件占位；不要配置 electron-builder 打包 |
| **预估复杂度** | S（2h） |

---

### P1-02: 主进程窗口创建与生命周期

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-02 |
| **标题** | 主进程窗口创建与生命周期管理 |
| **目标** | 实现主进程入口，创建 BrowserWindow，配置安全策略（contextIsolation, sandbox, nodeIntegration:false），注册应用生命周期事件 |
| **依赖任务** | P1-01 |
| **涉及文件** | `src/main/index.ts` |
| **输入** | 无 |
| **输出** | 应用启动时创建 1200x800 主窗口，关闭时清理资源 |
| **验收标准** | 1) `nodeIntegration: false`; 2) `contextIsolation: true`; 3) `sandbox: true`; 4) 窗口标题为 "AgentForge"; 5) 开发环境打开 DevTools; 6) 所有窗口关闭时 app.quit() |
| **不要做的事情** | 不要实现多窗口；不要配置自定义协议；不要实现托盘图标 |
| **预估复杂度** | S（2h） |

---

### P1-03: SQLite 数据库初始化与 Schema

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-03 |
| **标题** | SQLite 数据库初始化与表结构创建 |
| **目标** | 使用 better-sqlite3 初始化数据库连接，创建 conversations、messages、model_configs、app_settings 四张表，实现 migration 机制 |
| **依赖任务** | P1-01 |
| **涉及文件** | `src/main/db/index.ts`, `src/main/db/schema.sql`, `src/main/db/repos/conversation.ts`, `src/main/db/repos/message.ts`, `src/main/db/repos/model-config.ts`, `src/main/db/repos/app-settings.ts` |
| **输入** | app.getPath('userData') 路径 |
| **输出** | 数据库文件 `agentforge.db`，含四张表及索引 |
| **验收标准** | 1) 首次启动自动建表; 2) 重复启动不报错（IF NOT EXISTS）; 3) messages 表有 `idx_messages_conv` 索引; 4) app_settings 表有 `CHECK (id = 1)` 约束; 5) 外键 `ON DELETE CASCADE` 生效 |
| **不要做的事情** | 不要实现 ORM；不要创建 P2+ 的表（skills, mcp_servers, kb_documents 等）；不要实现数据库备份 |
| **预估复杂度** | M（4h） |

---

### P1-04: 共享类型定义

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-04 |
| **标题** | 主进程与渲染进程共享类型定义 |
| **目标** | 定义所有核心 TypeScript 类型，配置 tsconfig alias 使主进程和渲染进程都能引用 |
| **依赖任务** | P1-01 |
| **涉及文件** | `src/shared/types.ts`, `src/renderer/src/types/index.ts`(re-export), `tsconfig.node.json`, `tsconfig.web.json` |
| **输入** | 规格文档第 5 节数据模型 |
| **输出** | 所有核心枚举和接口类型定义 |
| **验收标准** | 1) 定义 ApprovalMode, MessageRole, ExecutionStatus, ModelProvider, TransportType 枚举; 2) 定义 Conversation, ChatMessage, ModelConfig, AppSettings, StreamChunk, AppError 接口; 3) 主进程和渲染进程都能 `import type { ... } from '@shared/types'`; 4) 无 `any` 类型 |
| **不要做的事情** | 不要定义 P2+ 才用到的类型（AgentExecutor, MCPServerConfig 等，除非 P1 IPC 也需要）；不要使用 interface extends any |
| **预估复杂度** | S（3h） |

---

### P1-05: Preload 脚本与 contextBridge

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-05 |
| **标题** | Preload 脚本实现（P1 IPC API 暴露） |
| **目标** | 实现预加载脚本，通过 contextBridge 暴露 P1 阶段所有 IPC 方法：chat, model, settings, file, system 五个命名空间 |
| **依赖任务** | P1-02, P1-04 |
| **涉及文件** | `src/preload/index.ts` |
| **输入** | IPC channel 规格（规格文档 7.2 节） |
| **输出** | `window.electron.chat/model/settings/file/system` 可用 |
| **验收标准** | 1) `window.electron.chat.send()` 可调用; 2) `window.electron.chat.onStreamChunk()` 返回 cleanup 函数; 3) `window.electron.model.list()` 可调用; 4) 所有方法参数和返回值有明确类型; 5) 渲染进程中 `require('electron')` 报错（进程隔离验证） |
| **不要做的事情** | 不要暴露 P2+ 的 agent/mcp/skill/kb 命名空间；不要在 preload 中做业务逻辑 |
| **预估复杂度** | M（4h） |

---

### P1-06: IPC Handlers - 模型配置（CRUD + 测试）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-06 |
| **标题** | IPC Handlers - 模型配置 CRUD + 连接测试 |
| **目标** | 实现主进程侧 model 命名空间的所有 IPC handler：list, create, update, delete, test，含 API Key 加密存储 |
| **依赖任务** | P1-03, P1-04, P1-05 |
| **涉及文件** | `src/main/ipc/model.ts`, `src/main/ipc/index.ts`, `src/main/utils/encryption.ts`, `src/main/db/repos/model-config.ts` |
| **输入** | 渲染进程通过 IPC 传入的模型配置数据 |
| **输出** | 模型 CRUD 操作结果，连接测试结果 |
| **验收标准** | 1) `model:create` 能创建并返回含 id 和时间戳的 ModelConfig; 2) provider+modelId 重复时抛 `MODEL_DUPLICATE`; 3) API Key 使用 safeStorage 加密后存入 SQLite; 4) `model:test` 向 API 发送简单请求并返回延迟; 5) 删除默认模型时抛 `MODEL_DELETE_DEFAULT`; 6) 加密后数据库中 api_key 列不是明文 |
| **不要做的事情** | 不要实现 ModelAdapter（那是 P1-07）；不要做拖拽排序、导入导出；test 接口不实现完整的对话流测试 |
| **预估复杂度** | M（5h） |

---

### P1-07: OpenAI/DeepSeek 模型适配器

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-07 |
| **标题** | OpenAI 与 DeepSeek 模型适配器实现（SSE 流式） |
| **目标** | 实现 ModelAdapter 抽象基类、OpenAI Adapter、DeepSeek Adapter、ModelRouter，支持流式对话（AsyncGenerator） |
| **依赖任务** | P1-03, P1-04, P1-06 |
| **涉及文件** | `src/main/models/adapter.ts`, `src/main/models/openai-adapter.ts`, `src/main/models/deepseek-adapter.ts`, `src/main/models/router.ts` |
| **输入** | ModelConfig（含解密后的 API Key） |
| **输出** | AsyncGenerator<StreamChunk> 流式输出 |
| **验收标准** | 1) OpenAI Adapter 使用 `openai` npm 包，`stream: true` 获取 SSE; 2) DeepSeek Adapter 继承/复用 OpenAI Adapter，默认 baseUrl 为 `https://api.deepseek.com/v1`; 3) baseUrl 支持自定义（兼容第三方 OpenAI 兼容 API）; 4) ModelRouter 根据 modelId 返回对应 Adapter 实例; 5) API Key 无效时抛出包含错误信息的 AppError; 6) 网络超时 30s 重试 1 次 |
| **不要做的事情** | 不要实现 Tool-Use 格式转换（P2）；不要实现 detectCapabilities; 不要做本地模型推理 |
| **预估复杂度** | L（6h） |

---

### P1-08: IPC Handlers - 对话（发送/停止/流式事件） + Repo

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-08 |
| **标题** | IPC Handlers - 对话发送/停止 + 流式事件推送 + 数据持久化 |
| **目标** | 实现 chat IPC handler（send, stop）和流式事件（stream-chunk, stream-end, stream-error），完成消息和会话的持久化逻辑 |
| **依赖任务** | P1-05, P1-07, P1-03 |
| **涉及文件** | `src/main/ipc/chat.ts`, `src/main/ipc/index.ts`, `src/main/db/repos/conversation.ts`, `src/main/db/repos/message.ts` |
| **输入** | `{ conversationId, content, modelId }` |
| **输出** | 流式 chunk 事件推送到渲染进程，消息持久化到 SQLite |
| **验收标准** | 1) `chat:send` 触发 ModelAdapter.streamChat 并通过 `chat:stream-chunk` 推送每个 chunk; 2) 流结束后通过 `chat:stream-end` 发送 messageId 和 metadata; 3) conversationId 不存在时抛 `CONVERSATION_NOT_FOUND`; 4) modelId 无对应配置时抛 `MODEL_NOT_FOUND`; 5) 用户消息和助手消息都持久化到 messages 表; 6) 会话的 message_count 和 last_message_at 自动更新; 7) `chat:stop` 能中断正在进行的流式生成; 8) 错误通过 `chat:stream-error` 推送 |
| **不要做的事情** | 不要实现 Skill 绑定；不要实现审批模式；不要实现 Agent ReAct 循环 |
| **预估复杂度** | L（7h） |

---

### P1-09: IPC Handlers - 会话管理 + 设置

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-09 |
| **标题** | IPC Handlers - 会话管理 + 通用设置 + 文件选择 |
| **目标** | 实现会话 CRUD（list, create, delete, get）、设置读写（get, update）、文件选择对话框（select-dir, select-file） |
| **依赖任务** | P1-03, P1-05 |
| **涉及文件** | `src/main/ipc/chat.ts`(会话部分), `src/main/ipc/index.ts`, `src/main/db/repos/conversation.ts`, `src/main/db/repos/app-settings.ts` |
| **输入** | 会话创建参数、设置更新参数 |
| **输出** | 会话列表、设置对象、文件路径 |
| **验收标准** | 1) 会话创建时自动从首条消息截取前 20 字作为 title; 2) 删除会话时 CASCADE 删除关联消息; 3) 首次获取 settings 时自动初始化默认值; 4) `file:select-dir` 和 `file:select-file` 能打开原生对话框; 5) `file:read` 和 `file:write` 在 P1 阶段不实现 |
| **不要做的事情** | 不要实现拖拽排序、会话搜索、会话归档；不要实现 file:read 和 file:write |
| **预估复杂度** | M（4h） |

---

### P1-10: 渲染进程主布局与路由切换

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-10 |
| **标题** | 渲染进程主布局（Sidebar + MainContent）与视图切换 |
| **目标** | 实现 App.vue 主布局（侧边栏 240px + 自适应主内容区），配置 Pinia、UnoCSS、Naive UI，实现 ChatView / SettingsView 简单视图切换（不用 Vue Router） |
| **依赖任务** | P1-01, P1-05 |
| **涉及文件** | `src/renderer/src/main.ts`, `src/renderer/src/App.vue`, `src/renderer/src/views/ChatView.vue`, `src/renderer/src/views/SettingsView.vue`, `src/renderer/src/stores/ui.ts` |
| **输入** | 无 |
| **输出** | 主界面显示侧边栏和主内容区，可在两个视图间切换 |
| **验收标准** | 1) 侧边栏固定宽度 240px; 2) 主内容区自适应宽度; 3) 点击导航可在 ChatView / SettingsView 间切换; 4) 不使用 Vue Router; 5) UnoCSS 原子类生效; 6) Naive UI 组件可正常使用; 7) Pinia Store 初始化 |
| **不要做的事情** | 不要实现 SkillsView、KnowledgeBaseView；不要做复杂的路由动画 |
| **预估复杂度** | M（4h） |

---

### P1-11: 通用 UI 组件

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-11 |
| **标题** | 通用 UI 组件（AppButton, AppInput, AppModal, AppToast） |
| **目标** | 实现 4 个通用基础组件，提供统一的交互和视觉风格 |
| **依赖任务** | P1-10 |
| **涉及文件** | `src/renderer/src/components/common/AppButton.vue`, `src/renderer/src/components/common/AppInput.vue`, `src/renderer/src/components/common/AppModal.vue`, `src/renderer/src/components/common/AppToast.vue` |
| **输入** | Props 参数 |
| **输出** | 可复用的 UI 组件 |
| **验收标准** | 1) AppButton: 支持 primary/secondary/ghost/danger variant, sm/md/lg size, loading spinner; 2) AppInput: 支持 v-model, error 状态边框变红; 3) AppModal: 支持显示/隐藏动画, 点击遮罩/ESC 关闭, default 和 footer slot; 4) AppToast: 通过 `useUiStore().showToast()` 调用, 支持 success/error/info/warning 四种类型, 自动消失 |
| **不要做的事情** | 不要做复杂的动画库集成；不要做拖拽排序组件；不要做表单验证组件 |
| **预估复杂度** | M（4h） |

---

### P1-12: 侧边栏与会话列表

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-12 |
| **标题** | 侧边栏组件与会话列表（CRUD + 切换） |
| **目标** | 实现侧边栏（含会话列表、新建按钮、导航切换），会话列表支持创建、切换、删除 |
| **依赖任务** | P1-09, P1-10, P1-11 |
| **涉及文件** | `src/renderer/src/components/Sidebar/Sidebar.vue`, `src/renderer/src/components/Sidebar/ConversationList.vue`, `src/renderer/src/stores/chat.ts` |
| **输入** | 会话列表数据（从 IPC 获取） |
| **输出** | 可交互的侧边栏会话列表 |
| **验收标准** | 1) 点击"新建"按钮创建空会话; 2) 点击会话切换当前会话并加载消息; 3) 删除会话后从列表消失; 4) 空状态显示引导文字"创建第一个会话开始对话"; 5) 当前选中会话高亮显示; 6) 会话按 last_message_at 倒序排列 |
| **不要做的事情** | 不要做拖拽排序；不要做会话搜索；不要做右键菜单（P2）；不做模型选择器（那是设置页） |
| **预估复杂度** | M（4h） |

---

### P1-13: 对话界面（消息列表 + 输入框 + 流式渲染）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-13 |
| **标题** | 对话界面（ChatInput + MessageList + MessageItem + 流式渲染） |
| **目标** | 实现完整的对话交互界面：消息输入、消息列表展示、流式输出实时更新、停止生成按钮 |
| **依赖任务** | P1-08, P1-11, P1-12 |
| **涉及文件** | `src/renderer/src/components/ChatPanel/ChatInput.vue`, `src/renderer/src/components/ChatPanel/MessageList.vue`, `src/renderer/src/components/MessageItem/MessageItem.vue`, `src/renderer/src/stores/chat.ts`, `src/renderer/src/composables/use-chat.ts` |
| **输入** | 用户消息文本 |
| **输出** | 完整的对话交互体验 |
| **验收标准** | 1) Enter 发送消息, Shift+Enter 换行; 2) 发送后用户消息右对齐显示; 3) 助手消息左对齐，流式时文字逐字出现，末尾显示闪烁光标; 4) 流式输出时发送按钮变为停止按钮; 5) 点击停止后流式输出立即停止; 6) 消息列表自动滚动到底部; 7) 空状态显示"输入消息开始对话"; 8) 切换会话后加载对应消息 |
| **不要做的事情** | 不要实现文件附件；不要做 @提及；不要做语音输入；不做虚拟滚动 |
| **预估复杂度** | L（7h） |

---

### P1-14: Markdown 渲染 + 代码高亮

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-14 |
| **标题** | Markdown 渲染器 + 代码块语法高亮 |
| **目标** | 实现 MarkdownRenderer 组件和 CodeBlock 子组件，支持完整的 Markdown 渲染、代码高亮、XSS 过滤、代码复制 |
| **依赖任务** | P1-11, P1-13 |
| **涉及文件** | `src/renderer/src/components/MessageItem/MarkdownRenderer.vue`, `src/renderer/src/components/MessageItem/CodeBlock.vue`, `src/renderer/src/utils/markdown.ts` |
| **输入** | Markdown 文本字符串 |
| **输出** | 渲染后的安全 HTML |
| **验收标准** | 1) 使用 marked 解析 Markdown; 2) 使用 shiki 做代码块语法高亮; 3) 代码块显示语言标签和复制按钮; 4) 使用 DOMPurify 过滤 XSS; 5) 支持标题、列表、代码块、加粗、链接、表格; 6) Markdown 解析失败时显示原文 |
| **不要做的事情** | 不要做 LaTeX 数学公式渲染；不要做 Mermaid 图表；不要做 ThinkingBlock 折叠（P2） |
| **预估复杂度** | M（5h） |

---

### P1-15: 设置页面 - 模型配置

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-15 |
| **标题** | 设置页面 - 模型配置（添加/编辑/删除/测试） |
| **目标** | 实现模型配置管理界面，支持添加、编辑、删除模型，Modal 弹窗表单，连接测试按钮 |
| **依赖任务** | P1-06, P1-10, P1-11 |
| **涉及文件** | `src/renderer/src/components/Settings/ModelConfig.vue`, `src/renderer/src/stores/model.ts` |
| **输入** | 模型列表数据（从 IPC 获取） |
| **输出** | 完整的模型配置管理界面 |
| **验收标准** | 1) 列表区每行显示模型名称、提供商标签、默认标记、操作按钮; 2) 添加/编辑使用 AppModal 弹窗; 3) 表单字段：名称(必填)、提供商(select)、模型ID(必填)、API Key(password)、Base URL(可选)、Temperature(slider 0-2)、Max Tokens(number); 4) 连接测试按钮点击后显示"连接成功 (xxxms)"或红色错误; 5) 删除默认模型时通过 Toast 提示错误 |
| **不要做的事情** | 不要做拖拽排序；不要做导入导出；不要做模型能力自动检测 |
| **预估复杂度** | L（6h） |

---

### P1-16: 设置页面 - 通用设置 + 主题切换

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-16 |
| **标题** | 设置页面 - 通用设置 + 暗色/亮色主题切换 |
| **目标** | 实现通用设置界面（主题、默认审批模式、最大执行步数、默认模型），使用 VueUse useDark 实现主题切换 |
| **依赖任务** | P1-09, P1-10, P1-11 |
| **涉及文件** | `src/renderer/src/components/Settings/GeneralSettings.vue`, `src/renderer/src/stores/settings.ts`, `src/renderer/src/styles/main.css` |
| **输入** | AppSettings 数据 |
| **输出** | 通用设置界面，主题可切换 |
| **验收标准** | 1) 主题选择：深色/浅色/跟随系统，切换后立即生效; 2) 默认审批模式：建议模式/自动编辑/全自动; 3) 最大执行步数 number 输入; 4) 默认模型 select 从已配置模型中选择; 5) 修改即时保存到 SQLite; 6) 重启后主题保持 |
| **不要做的事情** | 不要做自定义主题配色；不要做快捷键设置界面；不要做语言切换（i18n 不做） |
| **预估复杂度** | M（4h） |

---

### P1-17: P1 集成测试与闭环验证

| 字段 | 内容 |
|------|------|
| **任务 ID** | P1-17 |
| **标题** | P1 集成验证 - 完整闭环走通 |
| **目标** | 按 M1 里程碑验收标准，完整走通第一个可运行闭环，修复所有阻塞问题 |
| **依赖任务** | P1-01 ~ P1-16 全部完成 |
| **涉及文件** | 可能涉及修复的任何已有文件 |
| **输入** | 完整的 P1 功能 |
| **输出** | 通过 M1 里程碑所有验收标准 |
| **验收标准** | 完整流程验证：打开应用 -> 配置 DeepSeek API Key -> 新建会话 -> 发送"你好" -> 收到流式回复 -> Markdown 渲染正常 -> 关闭应用 -> 重新打开 -> 会话和消息仍在 -> 主题切换正常 -> 停止生成正常 |
| **不要做的事情** | 不要添加新功能；不要做性能优化；不要调整已有验收标准 |
| **预估复杂度** | M（4h） |

---

## P2 - Agent 引擎 + MCP 工具（Week 4-6）

> 目标：Agent ReAct 执行引擎 + MCP Client (stdio) + 5 个内置工具 + 三档审批 + Execution Panel

### P2-01: AppError 错误体系

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-01 |
| **标题** | 统一错误处理体系（AppError + 错误码 + 传播链） |
| **目标** | 实现完整的错误处理体系，包括 AppError 类、所有 P2 错误码、错误传播链（底层 -> IPC -> UI） |
| **依赖任务** | P1-17 |
| **涉及文件** | `src/main/utils/error.ts` |
| **输入** | 规格文档 14 节错误码表 |
| **输出** | AppError 类和错误码常量 |
| **验收标准** | 1) AppError 结构包含 code, message, details; 2) 定义所有 P1+P2 错误码常量; 3) 工具层错误包装为 isError:true; 4) 模型层网络错误重试 1 次（指数退避）; 5) IPC 层捕获后通过 stream-error 发送; 6) UI 层通过 AppToast 显示 |
| **不要做的事情** | 不要实现全局错误监控（sentry 等）；不要做错误日志上报 |
| **预估复杂度** | S（3h） |

---

### P2-02: Agent ReAct 执行引擎核心

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-02 |
| **标题** | Agent ReAct 执行引擎（Thought-Action-Observation 循环） |
| **目标** | 实现 AgentExecutor，支持 ReAct 循环：构建 System Prompt -> LLM 推理(Thought) -> 解析工具调用(Action) -> 执行工具(Observation) -> 反馈给 LLM，直到 finish |
| **依赖任务** | P1-17, P2-01 |
| **涉及文件** | `src/main/agent/executor.ts`, `src/main/agent/prompt-builder.ts`, `src/main/agent/types.ts` |
| **输入** | `{ conversationId, userInput, modelId, approvalMode, maxSteps }` |
| **输出** | ExecutionResult + 每步 trajectory 事件 |
| **验收标准** | 1) ReAct 循环正确执行 Thought -> Action -> Observation; 2) type=finish 时退出循环; 3) 达到 maxSteps 强制终止; 4) 连续 3 次工具失败熔断; 5) 每步通过 `agent:trajectory` 事件推送; 6) token 估算：中文 1.5 token/字, 英文 0.25 token/word; 7) 超过 maxContextLength 截断最早对话轮次 |
| **不要做的事情** | 不要实现检查点恢复（P4）；不要实现并行工具调用 |
| **预估复杂度** | XL（8h） |

---

### P2-03: Agent 审批机制

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-03 |
| **标题** | 三档审批机制（suggest / auto-edit / full-auto） |
| **目标** | 实现 Agent 工具调用审批系统，按风险等级和审批模式决定自动执行或等待用户确认 |
| **依赖任务** | P2-02 |
| **涉及文件** | `src/main/agent/approval.ts`, `src/main/agent/executor.ts`(修改) |
| **输入** | 工具调用信息 + 当前审批模式 |
| **输出** | 审批决定（通过/拒绝/需要用户确认） |
| **验收标准** | 1) suggest 模式：所有工具调用都需审批; 2) auto-edit 模式：low 风险自动，medium/high 需审批; 3) full-auto 模式：low/medium 自动，high 需审批; 4) 需要审批时通过 `agent:approval-request` 推送到渲染进程; 5) 等待 `agent:approve` 响应; 6) 风险等级映射正确（low/medium/high） |
| **不要做的事情** | 不要实现审批历史记录；不要实现批量审批 |
| **预估复杂度** | M（5h） |

---

### P2-04: Agent IPC Handlers

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-04 |
| **标题** | Agent IPC Handlers + Preload 扩展 |
| **目标** | 实现 agent 命名空间的 IPC handlers（execute, stop, approve, list, get-status 等），扩展 preload 暴露 agent API |
| **依赖任务** | P2-02, P2-03 |
| **涉及文件** | `src/main/ipc/agent.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`(扩展 agent 命名空间) |
| **输入** | 渲染进程调用 agent.execute |
| **输出** | Agent 执行结果和 trajectory 事件流 |
| **验收标准** | 1) `agent:execute` 启动 Agent 执行; 2) `agent:stop` 取消执行; 3) `agent:approve` 响应审批请求; 4) `agent:trajectory` 事件实时推送每步执行信息; 5) `agent:approval-request` 事件推送待审批工具调用; 6) 渲染进程可正确监听所有事件 |
| **不要做的事情** | 不要实现执行历史查询（P4）；不要实现执行结果导出 |
| **预估复杂度** | M（5h） |

---

### P2-05: 内置工具 - web_search + web_scrape

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-05 |
| **标题** | 内置工具实现：web_search（网络搜索）+ web_scrape（网页抓取） |
| **目标** | 实现两个低风险内置工具：web_search 使用搜索 API 获取结果，web_scrape 抓取网页文本内容 |
| **依赖任务** | P2-02 |
| **涉及文件** | `src/main/tools/web-search.ts`, `src/main/tools/web-scrape.ts`, `src/main/tools/types.ts`, `src/main/tools/registry.ts` |
| **输入** | 搜索查询 / URL |
| **输出** | 搜索结果列表 / 网页纯文本内容 |
| **验收标准** | 1) web_search 返回搜索结果列表（标题+摘要+URL）; 2) web_scrape 返回网页纯文本（去除 HTML 标签）; 3) 两个工具都标记为 low 风险; 4) 超时 10s 后返回错误; 5) 通过 ToolRegistry 统一注册 |
| **不要做的事情** | 不要实现爬虫深度跟踪；不要做 JavaScript 渲染页面抓取；不要实现搜索结果缓存 |
| **预估复杂度** | M（4h） |

---

### P2-06: 内置工具 - file_read + file_write + directory_list

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-06 |
| **标题** | 内置工具实现：file_read + file_write + directory_list |
| **目标** | 实现文件系统操作工具：读取文件、写入文件、列出目录，含安全限制 |
| **依赖任务** | P2-02 |
| **涉及文件** | `src/main/tools/file-read.ts`, `src/main/tools/file-write.ts`, `src/main/tools/directory-list.ts`, `src/main/tools/registry.ts` |
| **输入** | 文件路径 / 目录路径 |
| **输出** | 文件内容 / 写入确认 / 目录列表 |
| **验收标准** | 1) file_read 返回文件内容，支持文本文件; 2) file_write 写入文件，自动创建目录; 3) directory_list 返回目录下文件列表; 4) file_read 和 directory_list 标记为 low 风险; 5) file_write 标记为 medium 风险; 6) 路径安全检查，不允许访问系统关键目录 |
| **不要做的事情** | 不要实现文件删除/重命名；不要做二进制文件处理；不要实现全盘文件访问 |
| **预估复杂度** | M（4h） |

---

### P2-07: MCP Client - StdioTransport

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-07 |
| **标题** | MCP Client - StdioTransport 实现 |
| **目标** | 实现 MCP 协议的 StdioTransport 层，通过 child_process.spawn 启动 MCP Server，stdin/stdout 传输 JSON-RPC 2.0 |
| **依赖任务** | P2-01 |
| **涉及文件** | `src/main/mcp/transport.ts`, `src/main/mcp/client.ts` |
| **输入** | `{ command, args, env }` |
| **输出** | 连接状态 + JSON-RPC 响应 |
| **验收标准** | 1) `child_process.spawn` 启动 MCP Server 进程; 2) 通过 stdin 发送 JSON-RPC 请求; 3) 通过 stdout 接收 JSON-RPC 响应; 4) 完整生命周期：initialize -> tools/list -> tools/call -> 关闭; 5) 进程退出时自动重连 1 次后标记 disconnected; 6) Server 无响应 10s 超时; 7) 命令不存在时抛 `MCP_SPAWN_FAILED` |
| **不要做的事情** | 不要实现 HttpTransport（P3）；不要实现 Resources 和 Prompts 支持 |
| **预估复杂度** | L（6h） |

---

### P2-08: MCP Server 管理器

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-08 |
| **标题** | MCP Server 管理器（MCPServerManager）+ IPC + 配置持久化 |
| **目标** | 实现 MCPServerManager，管理多个 MCP Server 的生命周期，聚合工具列表，暴露 IPC 接口供渲染进程管理 |
| **依赖任务** | P2-07 |
| **涉及文件** | `src/main/mcp/manager.ts`, `src/main/mcp/types.ts`, `src/main/ipc/mcp.ts`, `src/main/ipc/index.ts`, `src/main/db/schema.sql`(新增 mcp_servers 表), `src/preload/index.ts`(扩展 mcp 命名空间) |
| **输入** | MCPServerConfig 列表 |
| **输出** | 聚合工具列表 + 各 Server 状态 |
| **验收标准** | 1) 添加 Server 后自动连接并发现工具; 2) 启动时连接所有 enabled 的 server; 3) 持久化配置到 SQLite; 4) 第三方 MCP Server 工具标记为 high 风险; 5) Server 状态（connected/disconnected/error）实时更新; 6) IPC 接口：add, remove, list, get-status, toggle-enable |
| **不要做的事情** | 不要实现 UI 管理界面（P4）；不要实现 Resources/Prompts |
| **预估复杂度** | L（7h） |

---

### P2-09: Execution Panel UI

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-09 |
| **标题** | 执行面板 UI（TAO 轨迹展示 + 审批卡片） |
| **目标** | 实现 Execution Panel 组件，实时展示 Agent 执行的 Thought-Action-Observation 轨迹，以及审批确认卡片 |
| **依赖任务** | P2-04, P2-03 |
| **涉及文件** | `src/renderer/src/components/ExecutionPanel/ExecutionPanel.vue`, `src/renderer/src/components/ExecutionPanel/TrajectoryItem.vue`, `src/renderer/src/components/ExecutionPanel/ApprovalCard.vue`, `src/renderer/src/composables/use-agent.ts`, `src/renderer/src/stores/agent.ts` |
| **输入** | agent:trajectory 和 agent:approval-request 事件 |
| **输出** | 可视化的执行轨迹和审批交互界面 |
| **验收标准** | 1) 实时展示每步 Thought/Action/Observation; 2) 思考过程折叠显示（ThinkingBlock）; 3) 工具调用显示工具名称和参数; 4) 审批卡片显示工具信息，有"允许"/"拒绝"按钮; 5) 用户取消执行按钮; 6) 执行完成后显示汇总信息 |
| **不要做的事情** | 不要做执行历史回看（P4）；不要做轨迹导出；不要做执行时间线图表 |
| **预估复杂度** | L（7h） |

---

### P2-10: ThinkingBlock 折叠组件

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-10 |
| **标题** | ThinkingBlock 折叠组件（思考过程展示） |
| **目标** | 实现思考过程的折叠展示组件，在 MessageItem 中展示 Assistant 的思考过程 |
| **依赖任务** | P1-14, P2-09 |
| **涉及文件** | `src/renderer/src/components/MessageItem/ThinkingBlock.vue`, `src/renderer/src/components/MessageItem/MessageItem.vue`(修改) |
| **输入** | thinking 文本 |
| **输出** | 可折叠的思考过程展示 |
| **验收标准** | 1) 默认折叠，点击展开; 2) 折叠状态显示"思考中..."或"查看思考过程"; 3) 展开后显示完整思考内容; 4) 流式输出时实时更新思考内容; 5) 流式结束后自动折叠 |
| **不要做的事情** | 不要做思考过程的编辑功能；不要做思考过程的搜索 |
| **预估复杂度** | S（3h） |

---

### P2-11: P2 集成测试与闭环验证

| 字段 | 内容 |
|------|------|
| **任务 ID** | P2-11 |
| **标题** | P2 集成验证 - Agent 闭环走通 |
| **目标** | 按 M2 里程碑验收标准，完整走通 Agent 执行闭环，修复所有阻塞问题 |
| **依赖任务** | P2-01 ~ P2-10 全部完成 |
| **涉及文件** | 可能涉及修复的任何已有文件 |
| **输入** | 完整的 P1+P2 功能 |
| **输出** | 通过 M2 里程碑所有验收标准 |
| **验收标准** | 完整流程验证：输入"帮我搜索 Vue 3 最新动态并总结成笔记" -> Agent 自主执行 ReAct 循环 -> 调用 web_search 搜索 -> 调用 web_scrape 抓取 -> 调用 file_write 保存 -> TAO 轨迹完整展示 -> 审批在 auto-edit 模式下正确触发 |
| **不要做的事情** | 不要添加新功能；不要做性能优化 |
| **预估复杂度** | L（6h） |

---

## P3 - Skills 系统 + 本地知识库（Week 7-9）

> 目标：Skills CRUD + 意图匹配 + 3 个内置 Skill + 文档导入 + 语义检索

### P3-01: Skills 数据库表 + CRUD

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-01 |
| **标题** | Skills 数据库表 + CRUD 操作 |
| **目标** | 创建 skills SQLite 表，实现 Skill 的增删改查仓库层 |
| **依赖任务** | P2-11 |
| **涉及文件** | `src/main/db/schema.sql`(新增 skills 表), `src/main/db/repos/skill.ts` |
| **输入** | Skill 数据（name, displayName, description, prompt, modelId, allowedTools, trigger, variables） |
| **输出** | Skill CRUD 操作结果 |
| **验收标准** | 1) skills 表含所有规格定义字段; 2) name 唯一约束; 3) prompt 非空约束; 4) CRUD 操作返回完整 Skill 对象; 5) 按创建时间倒序列表 |
| **不要做的事情** | 不要实现 Skill 版本管理；不要做 Skill 导入导出 |
| **预估复杂度** | S（3h） |

---

### P3-02: Skills IPC + Preload

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-02 |
| **标题** | Skills IPC Handlers + Preload 扩展 |
| **目标** | 实现 skill 命名空间的 IPC handlers（create, update, delete, list, get, match），扩展 preload |
| **依赖任务** | P3-01 |
| **涉及文件** | `src/main/ipc/skill.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`(扩展 skill 命名空间) |
| **输入** | Skill 数据 / 用户消息（意图匹配） |
| **输出** | Skill CRUD 结果 / 匹配结果 |
| **验收标准** | 1) `skill:create` 创建 Skill; 2) `skill:update` 更新 Skill; 3) `skill:delete` 删除 Skill; 4) `skill:list` 返回 Skill 列表; 5) `skill:match` 接收用户消息返回匹配结果 |
| **不要做的事情** | 不要实现 Skill 执行（那是 P3-04）；不要做 UI（P3-06） |
| **预估复杂度** | S（3h） |

---

### P3-03: Skill 意图匹配引擎

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-03 |
| **标题** | Skill 意图匹配引擎 |
| **目标** | 实现基于 LLM 的 Skill 意图匹配：将所有 auto 触发的 Skill 拼接为选项，让 LLM 判断用户意图匹配哪个 Skill |
| **依赖任务** | P3-02, P1-07 |
| **涉及文件** | `src/main/skills/matcher.ts` |
| **输入** | 用户消息 string |
| **输出** | `{ matched: boolean, skillName?: string, confidence: number }` |
| **验收标准** | 1) 将所有 auto Skill 的 name+description 拼接为选项; 2) 使用 LLM 判断匹配; 3) confidence >= 0.6 视为匹配; 4) LLM 返回无法解析时视为不匹配; 5) 无 auto Skill 时直接返回不匹配 |
| **不要做的事情** | 不要实现基于关键词的快速匹配（P4）；不要做匹配缓存 |
| **预估复杂度** | M（4h） |

---

### P3-04: Skill 执行集成（Agent + Skill 绑定）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-04 |
| **标题** | Skill 执行集成（Agent ReAct + Skill Prompt + allowedTools） |
| **目标** | 将 Skill 系统与 Agent 引擎集成：匹配到 Skill 后，使用 Skill 的 prompt 作为 System Prompt，allowedTools 限制可用工具 |
| **依赖任务** | P3-03, P2-02 |
| **涉及文件** | `src/main/agent/executor.ts`(修改), `src/main/skills/runner.ts` |
| **输入** | 匹配到的 Skill + 用户消息 |
| **输出** | Agent 按 Skill 定义执行 |
| **验收标准** | 1) 匹配到 Skill 后使用其 prompt 构建系统提示; 2) Agent 只能调用 Skill 的 allowedTools 中的工具; 3) Skill 变量在执行前替换为实际值; 4) 执行完成后返回 Skill 执行结果; 5) 未匹配 Skill 时走普通对话流程 |
| **不要做的事情** | 不要实现 Skill 链式调用；不要实现 Skill 调度优先级 |
| **预估复杂度** | M（5h） |

---

### P3-05: 内置 Skills（research-report + summarize-docs）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-05 |
| **标题** | 内置 Skills 实现：research-report + summarize-docs |
| **目标** | 实现两个内置 Skill：research-report（网络调研报告）和 summarize-docs（文档总结），包含完整中文 prompt 和工具配置 |
| **依赖任务** | P3-04 |
| **涉及文件** | `src/main/skills/builtin/research-report.ts`, `src/main/skills/builtin/summarize-docs.ts`, `src/main/skills/builtin/registry.ts` |
| **输入** | Skill 定义模板 |
| **输出** | 两个可用的内置 Skill |
| **验收标准** | 1) research-report 使用 web_search + web_scrape + file_write; 2) summarize-docs 使用 file_read + file_parse + kb_index; 3) 两个 Skill 都有完整的中文 prompt; 4) 首次启动自动注册到数据库; 5) 用户不可删除内置 Skill |
| **不要做的事情** | 不要实现 weekly-digest, study-cards, content-writer, knowledge-graph（P4）; 不要让用户修改内置 Skill 的 prompt |
| **预估复杂度** | M（5h） |

---

### P3-06: Skills 管理界面

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-06 |
| **标题** | Skills 管理界面（CRUD + 可视化编辑器） |
| **目标** | 实现 Skills 管理视图，支持查看、创建、编辑、删除自定义 Skill，包含可视化编辑器 |
| **依赖任务** | P3-02 |
| **涉及文件** | `src/renderer/src/views/SkillsView.vue`, `src/renderer/src/components/Skills/SkillEditor.vue`, `src/renderer/src/components/Skills/SkillList.vue`, `src/renderer/src/stores/skill.ts`, `src/renderer/src/components/Sidebar/Sidebar.vue`(修改, 添加导航) |
| **输入** | Skill 列表数据 |
| **输出** | Skills 管理界面 |
| **验收标准** | 1) 列表显示所有 Skill（内置 + 自定义）; 2) 创建自定义 Skill 填写所有字段; 3) 编辑已有 Skill; 4) 删除自定义 Skill; 5) 内置 Skill 标记且不可删除; 6) 触发方式选择：auto/manual |
| **不要做的事情** | 不要实现实时预览；不要实现测试运行功能；不要做 Skill 模板市场 |
| **预估复杂度** | L（6h） |

---

### P3-07: 知识库数据库表 + Embedding（API 模式）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-07 |
| **标题** | 知识库数据库表 + Embedding API 集成 |
| **目标** | 创建知识库相关 SQLite 表（kb_documents, kb_chunks），集成 OpenAI text-embedding-3-small API |
| **依赖任务** | P2-11 |
| **涉及文件** | `src/main/db/schema.sql`(新增 kb_documents, kb_chunks 表), `src/main/db/repos/kb-document.ts`, `src/main/kb/embedding.ts`, `src/main/kb/types.ts` |
| **输入** | 文本 chunk |
| **输出** | embedding 向量 (dimension=1536) |
| **验收标准** | 1) kb_documents 表记录文档元信息; 2) kb_chunks 表记录 chunk 文本和向量; 3) 使用 OpenAI text-embedding-3-small API; 4) dimension=1536; 5) 批量 embedding 支持避免 API 限流 |
| **不要做的事情** | 不要实现本地 embedding（P4）; 不要实现增量索引 |
| **预估复杂度** | M（5h） |

---

### P3-08: 文档解析 + Chunking

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-08 |
| **标题** | 文档解析管道（PDF/Markdown/TXT）+ Chunking |
| **目标** | 实现文档解析管道，支持 PDF、Markdown、TXT 文件的解析，按 500 token/chunk + 50 token overlap 分块 |
| **依赖任务** | P3-07 |
| **涉及文件** | `src/main/kb/parser.ts`, `src/main/kb/chunker.ts` |
| **输入** | 文件路径 |
| **输出** | DocumentChunk[] |
| **验收标准** | 1) 支持 PDF 解析（提取纯文本）; 2) 支持 Markdown 解析; 3) 支持 TXT 解析; 4) chunk 大小约 500 token, overlap 约 50 token; 5) 每阶段通过 `kb:index-progress` 事件推送进度; 6) 文件不存在时抛 `FILE_NOT_FOUND`; 7) 解析失败时标记 status=error |
| **不要做的事情** | 不要实现 Word/Excel 解析（P4）; 不要实现 chokidar 监听（P4） |
| **预估复杂度** | M（5h） |

---

### P3-09: LanceDB 向量存储 + 语义检索

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-09 |
| **标题** | LanceDB 向量存储 + 语义检索实现 |
| **目标** | 集成 LanceDB 实现本地向量存储和语义检索 |
| **依赖任务** | P3-07, P3-08 |
| **涉及文件** | `src/main/kb/vector-store.ts`, `src/main/kb/search.ts` |
| **输入** | embedding 向量 / query string |
| **输出** | 存储确认 / SearchResult[] |
| **验收标准** | 1) embedding 向量存入 LanceDB; 2) 语义检索：query -> embedding -> LanceDB 向量搜索 -> 返回 top-k; 3) SearchResult 包含原文片段、来源文档、相关度分数; 4) 支持设置返回数量 limit |
| **不要做的事情** | 不要实现来源溯源跳转到原文具体位置（P4）；不要实现混合检索（向量+关键词） |
| **预估复杂度** | M（5h） |

---

### P3-10: 知识库 IPC + 内置工具（kb_search + kb_index + file_parse）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-10 |
| **标题** | 知识库 IPC Handlers + 内置工具（kb_search, kb_index, file_parse） + Preload |
| **目标** | 实现 kb 命名空间的 IPC 接口，注册 kb_search、kb_index、file_parse 三个内置工具供 Agent 使用 |
| **依赖任务** | P3-09 |
| **涉及文件** | `src/main/ipc/kb.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`(扩展 kb 命名空间), `src/main/tools/kb-search.ts`, `src/main/tools/kb-index.ts`, `src/main/tools/file-parse.ts`, `src/main/tools/registry.ts` |
| **输入** | 文件路径 / 查询 string |
| **输出** | 索引结果 / 检索结果 / 文件解析结果 |
| **验收标准** | 1) kb IPC: import-document, search, list-documents, delete-document; 2) kb_search 工具标记为 low 风险; 3) kb_index 工具标记为 medium 风险; 4) file_parse 工具标记为 low 风险; 5) 导入文档后能通过语义检索找到相关内容 |
| **不要做的事情** | 不要实现知识库 UI 管理界面（P4）；不要做文档分类/标签 |
| **预估复杂度** | L（6h） |

---

### P3-11: P3 集成测试与闭环验证

| 字段 | 内容 |
|------|------|
| **任务 ID** | P3-11 |
| **标题** | P3 集成验证 - Skills + 知识库闭环走通 |
| **目标** | 按 M3 里程碑验收标准，完整走通 Skills 和知识库闭环 |
| **依赖任务** | P3-01 ~ P3-10 全部完成 |
| **涉及文件** | 可能涉及修复的任何已有文件 |
| **输入** | 完整的 P1+P2+P3 功能 |
| **输出** | 通过 M3 里程碑所有验收标准 |
| **验收标准** | 完整流程验证：导入一个 PDF -> 输入"总结这个文档" -> 匹配 summarize-docs Skill -> Agent 自动读取并总结 -> 检索知识库能找到相关内容 -> research-report Skill 能正常搜索并生成报告 |
| **不要做的事情** | 不要添加新功能；不要做性能优化 |
| **预估复杂度** | L（6h） |

---

## P4 - 功能完善（Week 10-12）

> 目标：剩余 Skills、AI 工具（截图 OCR、图片生成）、MCP 管理界面、检查点恢复、MCP HTTP Transport

### P4-01: MCP HTTP Transport

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-01 |
| **标题** | MCP HttpTransport 实现（Streamable HTTP） |
| **目标** | 实现 MCP 协议的 HTTP 传输层，支持 Streamable HTTP MCP Server |
| **依赖任务** | P3-11 |
| **涉及文件** | `src/main/mcp/transport.ts`(修改, 新增 HttpTransport) |
| **输入** | `{ url, headers }` |
| **输出** | 连接状态 + JSON-RPC 响应 |
| **验收标准** | 1) POST 请求发送 JSON-RPC; 2) SSE 接收响应; 3) 与 StdioTransport 共享同一 MCPClient 接口; 4) 传输类型可在配置中选择 |
| **不要做的事情** | 不要实现 WebSocket 传输 |
| **预估复杂度** | M（4h） |

---

### P4-02: MCP Server 管理界面

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-02 |
| **标题** | MCP Server 管理界面（添加/删除/状态监控） |
| **目标** | 实现 MCP Server 的可视化管理界面，支持添加、删除、启用/禁用 Server，查看状态和工具列表 |
| **依赖任务** | P2-08, P4-01 |
| **涉及文件** | `src/renderer/src/views/McpView.vue`, `src/renderer/src/components/Mcp/ServerList.vue`, `src/renderer/src/components/Mcp/ServerConfig.vue`, `src/renderer/src/components/Mcp/ToolList.vue`, `src/renderer/src/stores/mcp.ts`, `src/renderer/src/components/Sidebar/Sidebar.vue`(修改) |
| **输入** | MCP Server 配置和状态数据 |
| **输出** | MCP Server 管理界面 |
| **验收标准** | 1) 列表显示所有配置的 MCP Server; 2) 添加新 Server（命令/参数/传输类型）; 3) 删除 Server; 4) 启用/禁用切换; 5) 显示连接状态和发现的工具列表; 6) 标记第三方 Server 为 high 风险 |
| **不要做的事情** | 不要实现 MCP Server 市场；不要做 Server 日志查看 |
| **预估复杂度** | L（6h） |

---

### P4-03: 内置工具 - screenshot_ocr + image_generate

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-03 |
| **标题** | 内置工具实现：screenshot_ocr（截图 OCR）+ image_generate（图片生成） |
| **目标** | 实现截图 OCR 工具（调用系统截图 API + OCR 识别）和图片生成工具（调用图片生成 API） |
| **依赖任务** | P3-11 |
| **涉及文件** | `src/main/tools/screenshot-ocr.ts`, `src/main/tools/image-generate.ts`, `src/main/tools/registry.ts` |
| **输入** | 截图指令 / 图片描述 prompt |
| **输出** | OCR 文本 / 生成的图片路径 |
| **验收标准** | 1) screenshot_ocr 标记为 medium 风险; 2) image_generate 标记为 medium 风险; 3) OCR 返回识别的文本内容; 4) 图片生成保存到本地并返回路径; 5) 两个工具都正确注册到 ToolRegistry |
| **不要做的事情** | 不要实现视频处理；不要做实时屏幕监控 |
| **预估复杂度** | L（6h） |

---

### P4-04: 剩余内置 Skills（weekly-digest + study-cards + content-writer + knowledge-graph）

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-04 |
| **标题** | 剩余内置 Skills 实现 |
| **目标** | 实现 4 个内置 Skill：weekly-digest（周报）、study-cards（学习卡片）、content-writer（内容创作）、knowledge-graph（知识图谱，手动触发） |
| **依赖任务** | P3-05, P4-03 |
| **涉及文件** | `src/main/skills/builtin/weekly-digest.ts`, `src/main/skills/builtin/study-cards.ts`, `src/main/skills/builtin/content-writer.ts`, `src/main/skills/builtin/knowledge-graph.ts`, `src/main/skills/builtin/registry.ts` |
| **输入** | Skill 定义模板 |
| **输出** | 4 个可用的内置 Skill |
| **验收标准** | 1) weekly-digest 使用 kb_search + web_search + file_write; 2) study-cards 使用 file_read + file_parse + file_write; 3) content-writer 使用 kb_search + file_write + image_generate; 4) knowledge-graph 使用 file_read + file_parse + kb_search，手动触发; 5) 都有完整的中文 prompt; 6) 首次启动自动注册 |
| **不要做的事情** | 不要做 Skill 链式编排 |
| **预估复杂度** | L（6h） |

---

### P4-05: 检查点恢复

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-05 |
| **标题** | Agent 执行检查点恢复 |
| **目标** | 实现 Agent 执行的检查点保存和恢复，应用重启后可继续中断的执行 |
| **依赖任务** | P3-11 |
| **涉及文件** | `src/main/db/schema.sql`(新增 execution_checkpoints 表), `src/main/db/repos/checkpoint.ts`, `src/main/agent/executor.ts`(修改), `src/main/agent/checkpoint.ts` |
| **输入** | 执行状态快照 |
| **输出** | 检查点保存/恢复 |
| **验收标准** | 1) 每步执行后自动保存检查点; 2) 应用重启后可恢复中断的执行; 3) 恢复时从检查点继续 ReAct 循环; 4) 完成的执行清理检查点 |
| **不要做的事情** | 不要实现执行分支/回溯 |
| **预估复杂度** | L（7h） |

---

### P4-06: 知识库管理界面

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-06 |
| **标题** | 知识库管理界面（文档导入/删除/检索预览） |
| **目标** | 实现知识库管理视图，支持文档导入、删除、状态查看、语义检索预览 |
| **依赖任务** | P3-10 |
| **涉及文件** | `src/renderer/src/views/KbView.vue`, `src/renderer/src/components/Kb/DocumentList.vue`, `src/renderer/src/components/Kb/SearchPanel.vue`, `src/renderer/src/components/Kb/ImportDialog.vue`, `src/renderer/src/stores/kb.ts`, `src/renderer/src/components/Sidebar/Sidebar.vue`(修改) |
| **输入** | 文档列表和检索结果 |
| **输出** | 知识库管理界面 |
| **验收标准** | 1) 文档列表显示已导入文档及状态; 2) 支持拖拽/选择文件导入; 3) 导入进度显示; 4) 删除文档; 5) 语义检索测试面板; 6) 检索结果展示原文片段和来源 |
| **不要做的事情** | 不要实现文档分类管理；不要做知识图谱可视化 |
| **预估复杂度** | L（7h） |

---

### P4-07: Word/Excel 文档解析支持

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-07 |
| **标题** | 扩展文档解析（Word/Excel） |
| **目标** | 扩展文档解析管道支持 Word(.docx) 和 Excel(.xlsx/.csv) 文件 |
| **依赖任务** | P3-08 |
| **涉及文件** | `src/main/kb/parser.ts`(修改) |
| **输入** | .docx / .xlsx / .csv 文件 |
| **输出** | 解析后的文本内容 |
| **验收标准** | 1) .docx 提取纯文本; 2) .xlsx 提取单元格文本（表格形式）; 3) .csv 解析为文本; 4) 解析失败时标记 status=error |
| **不要做的事情** | 不要实现 PPT 解析 |
| **预估复杂度** | M（4h） |

---

### P4-08: 本地 Embedding 模型

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-08 |
| **标题** | 本地 Embedding 模型（@xenova/transformers） |
| **目标** | 使用 @xenova/transformers 实现本地 embedding，作为 API embedding 的替代方案 |
| **依赖任务** | P3-07 |
| **涉及文件** | `src/main/kb/embedding.ts`(修改, 新增 LocalEmbeddingProvider) |
| **输入** | 文本 chunk |
| **输出** | embedding 向量 (dimension=384) |
| **验收标准** | 1) 使用 @xenova/transformers 加载本地模型; 2) dimension=384; 3) 首次使用时自动下载模型; 4) 可在设置中切换 API/本地 embedding; 5) 无需网络即可完成 embedding |
| **不要做的事情** | 不要实现模型微调 |
| **预估复杂度** | M（5h） |

---

### P4-09: 增量索引 + 文件监听

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-09 |
| **标题** | 增量索引 + chokidar 文件监听 |
| **目标** | 实现文件变更监听和增量索引，文件修改后自动更新知识库 |
| **依赖任务** | P3-10 |
| **涉及文件** | `src/main/kb/watcher.ts`, `src/main/kb/indexer.ts` |
| **输入** | 监听目录路径 |
| **输出** | 自动增量索引 |
| **验收标准** | 1) 使用 chokidar 监听文件变更; 2) 文件新增时自动解析+embedding+存储; 3) 文件修改时自动更新 chunk; 4) 文件删除时自动清理; 5) 可启用/禁用监听 |
| **不要做的事情** | 不要实现大规模批量导入优化 |
| **预估复杂度** | M（4h） |

---

### P4-10: P4 集成测试

| 字段 | 内容 |
|------|------|
| **任务 ID** | P4-10 |
| **标题** | P4 集成验证 |
| **目标** | 验证 M4 里程碑所有交付物 |
| **依赖任务** | P4-01 ~ P4-09 全部完成 |
| **涉及文件** | 可能涉及修复的任何已有文件 |
| **输入** | 完整的 P1+P2+P3+P4 功能 |
| **输出** | 通过 M4 里程碑验收 |
| **验收标准** | 1) 所有 6 个内置 Skill 可正常使用; 2) MCP HTTP Server 可连接; 3) 截图 OCR 和图片生成工具可用; 4) 检查点恢复正常; 5) 知识库管理界面可用; 6) 本地 embedding 可正常工作 |
| **不要做的事情** | 不要添加新功能 |
| **预估复杂度** | M（4h） |

---

## P5 - 发布打磨（Week 13-14）

> 目标：UI 打磨、性能优化、electron-builder 打包、最终验收

### P5-01: UI 视觉打磨

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-01 |
| **标题** | UI 视觉细节打磨与交互优化 |
| **目标** | 打磨所有页面的视觉细节，优化交互动画，统一视觉风格 |
| **依赖任务** | P4-10 |
| **涉及文件** | `src/renderer/src/styles/main.css`, `src/renderer/src/components/`(多个组件微调) |
| **输入** | 现有 UI |
| **输出** | 打磨后的 UI |
| **验收标准** | 1) 统一的间距和字体规范; 2) 过渡动画流畅; 3) 暗色/亮色主题无视觉瑕疵; 4) 空状态引导美观; 5) 加载状态有骨架屏或 loading 指示器 |
| **不要做的事情** | 不要重构组件结构；不要引入新的 UI 库 |
| **预估复杂度** | M（5h） |

---

### P5-02: 虚拟滚动 + 消息列表性能优化

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-02 |
| **标题** | 消息列表虚拟滚动 + 长对话性能优化 |
| **目标** | 为消息列表实现虚拟滚动，优化长对话场景下的渲染性能 |
| **依赖任务** | P4-10 |
| **涉及文件** | `src/renderer/src/components/ChatPanel/MessageList.vue` |
| **输入** | 大量消息数据 |
| **输出** | 高性能消息列表 |
| **验收标准** | 1) 1000+ 消息时滚动流畅（60fps）; 2) 内存占用不随消息数线性增长; 3) 自动滚动到底部功能在虚拟滚动下正常工作; 4) 流式输出时新消息正常追加 |
| **不要做的事情** | 不要引入重量级虚拟滚动库（如 react-window 的 Vue 版本），优先使用轻量方案 |
| **预估复杂度** | M（5h） |

---

### P5-03: electron-builder 打包配置

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-03 |
| **标题** | electron-builder 打包配置（macOS/Windows/Linux） |
| **目标** | 配置 electron-builder，支持三平台打包分发 |
| **依赖任务** | P4-10 |
| **涉及文件** | `electron-builder.yml`, `package.json`(scripts) |
| **输入** | 构建配置 |
| **输出** | 可分发的安装包 |
| **验收标准** | 1) macOS 生成 .dmg; 2) Windows 生成 .exe 安装包; 3) Linux 生成 .AppImage; 4) better-sqlite3 原生模块正确打包; 5) 应用图标正确显示; 6) Code Signing 配置（可选） |
| **不要做的事情** | 不要实现自动更新（P5 后续版本）; 不要配置 CI/CD 流水线 |
| **预估复杂度** | L（6h） |

---

### P5-04: 应用图标 + 资源

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-04 |
| **标题** | 应用图标 + 启动画面 + 关于页面 |
| **目标** | 设计并集成应用图标、启动画面、关于页面 |
| **依赖任务** | P5-03 |
| **涉及文件** | `resources/icon.png`, `resources/icon.icns`, `resources/icon.ico`, `src/renderer/src/components/AboutDialog.vue` |
| **输入** | 设计资源 |
| **输出** | 应用图标和关于页面 |
| **验收标准** | 1) 各平台图标正确（macOS icns, Windows ico, Linux png）; 2) Dock/任务栏图标显示正确; 3) 关于页面显示应用名称、版本、技术栈信息 |
| **不要做的事情** | 不要实现自定义启动画面动画 |
| **预估复杂度** | S（3h） |

---

### P5-05: 日志系统 + 错误上报

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-05 |
| **标题** | 结构化日志系统 + 用户可选错误上报 |
| **目标** | 实现结构化日志记录，提供用户可选的匿名错误上报机制 |
| **依赖任务** | P4-10 |
| **涉及文件** | `src/main/utils/logger.ts`, `src/renderer/src/components/Settings/GeneralSettings.vue`(修改) |
| **输入** | 运行时日志事件 |
| **输出** | 日志文件 + 可选上报 |
| **验收标准** | 1) 日志写入文件（`app.getPath('userData')/logs/`）; 2) 日志分级（debug/info/warn/error）; 3) API Key 不得出现在日志中; 4) 设置中可选择是否开启匿名错误上报; 5) 日志文件自动轮转（不超过 10MB） |
| **不要做的事情** | 不要集成第三方监控服务（sentry 等）; 不要做远程日志服务器 |
| **预估复杂度** | S（3h） |

---

### P5-06: 端到端测试

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-06 |
| **标题** | 关键路径端到端测试（Playwright/Spectron） |
| **目标** | 对关键用户路径编写端到端测试 |
| **依赖任务** | P5-03 |
| **涉及文件** | `tests/e2e/`(测试文件) |
| **输入** | 测试用例 |
| **输出** | 端到端测试套件 |
| **验收标准** | 1) 应用启动测试; 2) 模型配置 CRUD 测试; 3) 创建会话 -> 发送消息 -> 收到回复 测试; 4) 设置修改持久化测试; 5) 主题切换测试 |
| **不要做的事情** | 不要追求 100% 覆盖率；不要做性能基准测试 |
| **预估复杂度** | M（5h） |

---

### P5-07: 最终验收与发布准备

| 字段 | 内容 |
|------|------|
| **任务 ID** | P5-07 |
| **标题** | 最终验收 + 发布文档准备 |
| **目标** | 最终全流程验收，准备发布所需文档和物料 |
| **依赖任务** | P5-01 ~ P5-06 全部完成 |
| **涉及文件** | 可能涉及修复的任何已有文件 |
| **输入** | 完整的 AgentForge 应用 |
| **输出** | 可发布的 v0.1 |
| **验收标准** | 1) M1-M5 全部里程碑验收通过; 2) 三平台打包产物可用; 3) 无 P0/P1 级别已知 Bug; 4) 基本使用流程顺畅 |
| **不要做的事情** | 不要在此阶段添加任何新功能 |
| **预估复杂度** | M（4h） |

---

## 任务统计

| 阶段 | 任务数 | 总预估工时 | 里程碑 |
|------|--------|-----------|--------|
| P1 | 17 | ~65h | M1: 基础对话闭环 |
| P2 | 11 | ~55h | M2: Agent 闭环 |
| P3 | 11 | ~53h | M3: Skills + 知识库 |
| P4 | 10 | ~52h | M4: 功能完善 |
| P5 | 7 | ~31h | M5: 发布打磨 |
| **合计** | **56** | **~256h** | - |

## 复杂度图例

| 标记 | 含义 | 预估工时 |
|------|------|---------|
| S | Small | 2-3h |
| M | Medium | 4-5h |
| L | Large | 6-8h |
| XL | Extra Large | 8h（上限） |

## 关键依赖链

```
P1 闭环：P1-01 -> P1-02 -> P1-03 -> P1-04 -> P1-05 -> P1-06 -> P1-07 -> P1-08 -> P1-09
         -> P1-10 -> P1-11 -> P1-12 -> P1-13 -> P1-14 -> P1-15 -> P1-16 -> P1-17

P2 闭环：P2-01 -> P2-02 -> P2-03 -> P2-04 -> P2-05/P2-06(并行) -> P2-07 -> P2-08
         -> P2-09 -> P2-10 -> P2-11

P3 闭环：P3-01 -> P3-02 -> P3-03 -> P3-04 -> P3-05 -> P3-06
         P3-07 -> P3-08 -> P3-09 -> P3-10 -> P3-11

P4：各任务基本独立，依赖 P3-11

P5：各任务基本独立，依赖 P4-10
```
