# AgentForge 项目了解报告

## 项目定位

**AgentForge** 是一款**本地优先（Local-first）的个人 AI Agent 桌面工作站**，基于 Electron 构建，数据全部存储在本地 SQLite，无云端依赖。当前处于 **P5 发布打磨完成**阶段，共 947 个测试用例（43 个文件）全部通过。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron ^43.2.0 |
| 前端 | Vue 3 + Pinia + Naive UI + TypeScript 6 |
| 构建 | electron-vite + Vite 8，electron-builder 打包（Win NSIS / macOS DMG / Linux AppImage+deb） |
| 数据库 | better-sqlite3 v13（WAL 模式） |
| AI SDK | GitHub Copilot SDK、LangGraph/LangChain、OpenAI、Anthropic、DeepSeek |
| 测试 | Vitest 4 |

## 三层进程架构

```
src/
├── main/       # 主进程：Agent 引擎、工具、数据库、IPC handlers
├── preload/    # 桥接层：contextIsolation + sandbox 安全通信
├── renderer/   # 渲染进程：Vue 3 UI（ChatView / KbView / WikiView / SettingsView）
└── shared/     # 共享类型定义（main 与 renderer 通过 @shared/types 共用）
```

## 核心功能

### 1. 三引擎 Agent 架构（核心亮点）

通过 [engine-dispatcher.ts](file:///d:/桌面/ai/agentforge/src/main/agent/engine-dispatcher.ts) 路由分发三种执行引擎，可按会话切换：

- **`builtin`**：自研 ReAct（Thought-Action-Observation）执行循环，含审批机制、Token 计数、上下文截断
- **`copilot-sdk`**：桥接 GitHub Copilot SDK（[agent-bridge.ts](file:///d:/桌面/ai/agentforge/src/main/copilot/agent-bridge.ts)），持久化会话 + SDK 原生上下文压缩（Infinite Sessions）、BYOK 自定义模型提供商、子代理编排、ask_user / Elicitation 双向交互、斜杠命令、技能目录、Hooks 生命周期钩子
- **`langgraph`**：桥接 LangGraph 状态图（state-graph + checkpointer），支持 SQLite 检查点、记忆存储、MCP 适配

### 2. 工具系统（约 20+ 内置工具）

文件读写/目录浏览、Git 操作、终端执行、网络搜索/网页抓取、浏览器自动化（截图）、代码库语义搜索、知识库搜索、知识图谱抽取/查询、定时任务、Wiki 摄取/查询、检查点回滚等。全部工具带**风险分级**（low 自动执行 / medium 确认 / high 审批）与路径守卫（path-guard）。

### 3. MCP 协议集成

自研 JSON-RPC 2.0 客户端（stdio / http 双传输）+ langchain-mcp-adapters，支持 MCP 市场安装、动态工具发现与调用、连接状态管理。

### 4. Skills 意图匹配系统

LLM 驱动的意图识别引擎，自动触发对应 Skill；支持变量替换、工具过滤、内置 Skill（研究报告、文档摘要）。

### 5. 本地知识库（RAG）

支持 PDF / DOCX / XLSX / Markdown / TXT / CSV 导入，分块（固定/段落）→ 向量嵌入（默认 Ollama nomic-embed-text，可配置 OpenAI 等）→ 余弦相似度语义搜索，并作为 `kb-search` 工具接入 Agent。

### 6. 工作区与代码能力

- **工作区管理**：多工作区切换，文件树浏览与预览
- **代码库索引**：多语言解析（TS/Python/Go/Rust 等 20+）、符号抽取、代码分块语义搜索
- **Git 集成**：状态/暂存/diff/提交等操作，UI 内 Git 面板
- **Checkpoint 快照**：文件写入前自动快照（write/delete/rename），支持一键回滚

### 7. 对话与会话管理

多会话树（支持 fork 分叉）、消息持久化、会话标题自动生成、上下文使用量可视化、压缩事件展示、图片附件、链接预览面板、斜杠命令菜单。

### 8. 语音交互

STT 语音输入 + TTS 语音播放（OpenAI / Azure / MiMo 提供商），支持实时语音模式（listening → transcribing → speaking 状态机）。

### 9. 定时任务调度

croner 驱动的 cron 调度器，支持任务定时触发 Agent 执行，系统休眠恢复后自动检查错过的任务。

### 10. 工作流审计器

五维审计引擎（任务理解 / 受控执行 / 变更验证 / 可靠交付 / 学习沉淀），对 Agent 执行过程生成审计报告（AuditReportPanel）。

### 11. Wiki 知识管理

Wiki 视图 + 摄取/lint/查询工具链，可作为 Agent 工具使用。

## 安全设计

- `contextIsolation` + `sandbox` + `nodeIntegration: false`
- CSP 头注入（仅生产环境）、单实例锁
- API Key AES-256-GCM 加密存储 + 损坏 Key 自动扫描重置
- 外部链接走系统浏览器、阻止页面导航
- IPC 参数校验（ipc-validator）、路径守卫防越权

## 数据库 Schema（12+ 迁移）

model_configs / conversations / messages / app_settings / mcp_servers / skills / kb_documents / kb_chunks / kg_entities / kg_relations / checkpoints / scheduled_tasks / prompt_templates 等，通过 `schema_version` 表管理迁移。

## 当前状态与文档

- **AGENT.md**：AI 开发代理指南，记录任务索引（P1~P5 全部完成）
- **docs/progress-log.md**：开发进度日志（最新：2026-08-21 UI 重构 v1.0，AppShell 导航壳 + 执行可视化重组 + 响应式断点）
- **docs/specs/**：完整规格文档（spec v0.1~v0.3、优化 backlog、语音/审计/工作区/Copilot SDK 增强规格、LangGraph 集成方案）

## 开发约定

- 包管理器：pnpm 10
- Git 提交信息使用中文，格式 `feat(任务ID): 描述` / `fix(任务ID): 描述`
- 每完成任务后提交推送并更新进度日志
- 常用命令：`pnpm dev` / `pnpm test` / `pnpm typecheck` / `pnpm lint`

## 结论

这是一个功能相当完整的桌面 AI Agent 工作站，覆盖了「对话 → 引擎执行 → 工具调用 → 审批 → 快照回滚 → 审计」的完整闭环，并具备知识库 RAG、代码库索引、MCP 生态、语音交互、定时任务等外围能力。工程质量较高（947 测试、严格 lint、类型检查、规格文档驱动开发）。
