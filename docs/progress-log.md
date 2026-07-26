# AgentForge 进度日志

## 依赖版本升级 (2026-07-26)

**原因**: 用户要求所有技术版本使用最新

### 版本变更明细

| 包名 | 旧版本 | 新版本 | 备注 |
|------|--------|--------|------|
| typescript | ^5.8.0 | ~6.0.3 | TS 7.0 与 typescript-eslint 不兼容，锁定 6.x |
| electron | ^36.0.0 | ^43.2.0 | 跨 7 个大版本升级 |
| openai | ^4.0.0 | ^6.49.0 | SDK API 有破坏性变更 |
| better-sqlite3 | ^11.0.0 | ^13.0.1 | N-API 重写，预编译二进制跨 ABI 兼容 |
| pinia | ^2.3.0 | ^4.0.2 | ESM-only，需 @vue/devtools-api v8 |
| eslint | ^9.0.0 | ^10.8.0 | flat config 必需 |
| @eslint/js | ^9.0.0 | ^10.0.1 | |
| eslint-plugin-vue | ^9.32.0 | ^10.10.0 | |
| vue-eslint-parser | ^9.4.3 | ^10.4.1 | |
| vitest | ^3.0.0 | ^4.1.10 | 需要 Vite 6+ |
| vue-tsc | ^2.2.0 | ^3.3.8 | |
| @vueuse/core | ^12.0.0 | ^14.3.0 | |
| marked | ^15.0.0 | ^18.0.7 | ESM-only |
| shiki | ^1.0.0 | ^4.3.1 | |
| dompurify | ^3.2.0 | ^3.4.12 | |
| naive-ui | ^2.41.0 | ^2.44.1 | |
| prettier | ^3.5.0 | ^3.9.6 | |
| eslint-config-prettier | ^10.0.0 | ^10.1.8 | |
| @types/node | ^22.0.0 | ^26.1.1 | |
| unocss | ^66.7.0 | ^66.7.5 | |
| @vitejs/plugin-vue | ^6.0.8 | ^6.0.8 | 已是最新 |
| electron-vite | ^5.0.0 | ^5.0.0 | 已是最新 |
| vite | (隐式) | ^8.1.5 | 新增显式依赖 |

### 移除的依赖

| 包名 | 原因 |
|------|------|
| @electron/rebuild | better-sqlite3 v13 使用 N-API，预编译二进制无需 rebuild |

### 移除的脚本

| 脚本 | 原因 |
|------|------|
| postinstall: `electron-rebuild -f -w better-sqlite3` | 不再需要 |

### 关键技术决策

1. **TypeScript 6.0.3 而非 7.0.2**: `typescript-eslint@8.65.0` 的 peerDependency 要求 `typescript <6.1.0`，TS 7 暂不兼容。待 typescript-eslint 更新后可升级。
2. **Vite 8.1.5 显式安装**: electron-vite 将 Vite 作为 peer dependency，而 vitest 4 要求 Vite 6+，显式安装确保版本一致。
3. **better-sqlite3 N-API 验证**: 确认 v13 预编译二进制可直接加载，无需 electron-rebuild。
4. **Electron 42+ 下载行为变更**: electron npm 包不再在 postinstall 时下载二进制，改为首次运行时下载。

### 验证结果

- `pnpm build`: 通过 (Vite 8.1.5)
- `pnpm lint`: 通过 (ESLint 10.8.0)
- `pnpm format:check`: 通过
- better-sqlite3 加载测试: 通过

### 后续任务需注意的 API 变更

- **openai v6**: `.del()` → `.delete()`，streaming API 调整，path params 自动 URI 编码
- **Pinia v4**: `defineStore({ id, ... })` 已废弃，必须用 `defineStore('id', ...)`
- **marked v18**: ESM-only，自定义 renderer/walker 注意 token 结构变化
- **vitest v4**: `workspace` → `projects`，pool 选项重命名，coverage 配置变更
- **@vueuse/core v14**: `computedAsync` 默认 flush 变为 sync

---

## P1-02: 主进程窗口创建与生命周期 (2026-07-26)

**任务**: 实现主进程入口，创建 BrowserWindow，配置安全策略，注册应用生命周期事件，实现单实例锁和窗口状态持久化

### 修改文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/index.ts` | 重写 | 完整主进程入口：单实例锁、安全配置、CSP 注入、窗口状态持久化、DevTools、before-quit 清理 |
| `src/main/utils/window-state.ts` | 新增 | 窗口状态持久化模块（loadWindowState / saveWindowState / createDebouncedSaver） |
| `src/main/utils/window-state.test.ts` | 新增 | 单元测试（14 个测试用例） |
| `vitest.config.ts` | 新增 | vitest 配置文件 |
| `agentforge-dev-spec/agentforge-spec-v0.2.md` | 更新 | §3 目录结构新增 window-state.ts 和 vitest.config.ts |
| `agentforge-dev-spec/task-backlog-v0.2.md` | 更新 | P1-02 状态 → done |

### 验收标准核对

| # | 验收标准 | 状态 | 实现位置 |
|---|---------|------|---------|
| 1 | `nodeIntegration: false` | 通过 | `src/main/index.ts` webPreferences |
| 2 | `contextIsolation: true` | 通过 | `src/main/index.ts` webPreferences |
| 3 | `sandbox: true` | 通过 | `src/main/index.ts` webPreferences |
| 4 | `webSecurity: true` | 通过 | `src/main/index.ts` webPreferences |
| 5 | `allowRunningInsecureContent: false` | 通过 | `src/main/index.ts` webPreferences |
| 6 | CSP header 注入 | 通过 | `injectCsp()` 使用 `session.defaultSession.webRequest.onHeadersReceived` |
| 7 | `app.requestSingleInstanceLock()` 生效 | 通过 | 单实例锁 + `second-instance` 聚焦已有窗口 |
| 8 | `before-quit` 中关闭数据库连接 | 通过 | `before-quit` handler + `cleanupTasks` 注册表（P1-03 注册 db.close） |
| 9 | 窗口尺寸/位置持久化 | 通过 | JSON 文件持久化（防抖 500ms），P1-03 后迁移到 app_settings 表 |
| 10 | 开发环境打开 DevTools | 通过 | `!app.isPackaged` 时 `openDevTools()` |

### 关键技术决策

1. **窗口状态用 JSON 文件而非 SQLite**: P1-03（SQLite）尚未实现，验收标准 9 要求持久化到 app_settings，但 app_settings 表尚不存在。采用 JSON 文件（`userData/window-state.json`）作为临时方案，P1-03 完成后迁移到 SQLite app_settings 表。WindowBounds 接口与 Spec v0.2 §5 AppSettings.windowBounds 类型一致。
2. **CSP 仅生产环境注入**: 开发环境需要 Vite HMR（WebSocket + inline script），CSP 的 `script-src 'self'` 会阻断 HMR。因此 `app.isPackaged` 为 true 时才注入 CSP。
3. **资源清理注册表**: 导出 `registerCleanup()` 函数，P1-03 注册 `db.close()`、P1-08 注册 `AbortController.abort()`、P2 注册 MCP 子进程关闭。
4. **preload 路径修复**: P1-01 中 preload 路径为 `index.c.js`，实际构建输出为 `index.cjs`，已修正。
5. **navigateOnDragDrop: false**: 额外添加安全配置，防止拖拽文件时导航到 file:// URL。

### 验证步骤

```
pnpm build       → 通过 (Vite 8.1.5, 4 modules transformed)
pnpm lint        → 通过 (ESLint 10.8.0, 0 warnings)
pnpm format:check → 通过
pnpm test        → 14 tests passed
```

### 遗留问题

- 窗口状态持久化使用 JSON 文件，P1-03 完成后需迁移到 SQLite app_settings 表
- `before-quit` 清理注册表目前为空，P1-03/P1-08/P2 会逐步注册清理函数

### 是否需要更新文档

- 是：已更新 Spec v0.2 §3 目录结构（新增 `window-state.ts` 和 `vitest.config.ts`）

---

## P1-03: SQLite 数据库初始化与 Schema (2026-07-26)

**任务**: 使用 better-sqlite3 初始化数据库连接，配置 PRAGMA，创建 5 张 P1 表，实现 migration 机制

### 修改文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/db/schema.sql` | 新增 | 完整 P1 schema（5 表 + 2 索引） |
| `src/main/db/index.ts` | 新增 | 数据库初始化、单例、PRAGMA 配置、schema 执行、关闭、版本查询 |
| `src/main/db/index.test.ts` | 新增 | 18 个单元测试，覆盖全部 12 项验收标准 |
| `src/main/db/repos/model-config.ts` | 新增 | 占位，P1-06 实现 |
| `src/main/db/repos/conversation.ts` | 新增 | 占位，P1-09a 实现 |
| `src/main/db/repos/message.ts` | 新增 | 占位，P1-08/P1-09a 实现 |
| `src/main/db/repos/app-settings.ts` | 新增 | 占位，P1-09b 实现 |
| `src/main/index.ts` | 修改 | 导入并调用 initDatabase()，注册 closeDatabase() 清理 |
| `agentforge-dev-spec/task-backlog-v0.2.md` | 更新 | P1-03 状态 → done |

### 验收标准核对

| # | 验收标准 | 状态 | 测试用例 |
|---|---------|------|---------|
| 1 | `PRAGMA journal_mode=WAL` | 通过 | `should set journal_mode to WAL` |
| 2 | `PRAGMA foreign_keys=ON` | 通过 | `should enable foreign_keys` |
| 3 | `PRAGMA busy_timeout=5000` | 通过 | `should set busy_timeout to 5000` |
| 4 | schema_version 表存在且 version=1 | 通过 | `should create schema_version table with version=1` |
| 5 | conversations.model_id 外键引用 model_configs(id) | 通过 | `should have conversations.model_id referencing model_configs(id)` |
| 6 | messages.role 有 CHECK 约束 | 通过 | `should enforce CHECK constraint on messages.role` |
| 7 | model_configs.provider 有 CHECK 约束 | 通过 | `should enforce CHECK constraint on model_configs.provider` |
| 8 | model_configs 有 UNIQUE(provider, model_id) | 通过 | `should enforce UNIQUE(provider, model_id) on model_configs` |
| 9 | messages 表有 idx_messages_conv 索引 | 通过 | `should have idx_messages_conv index on messages` |
| 10 | conversations 表有 idx_conv_updated 索引 | 通过 | `should have idx_conv_updated index on conversations` |
| 11 | app_settings 有 INSERT OR IGNORE 初始化 | 通过 | 两个测试用例验证初始化和幂等性 |
| 12 | 外键 ON DELETE CASCADE 生效 | 通过 | `should cascade delete messages when conversation is deleted` |

### 关键技术决策

1. **Schema SQL 从文件读取**: 使用 `readFileSync(schema.sql)` 在运行时执行，而非字符串内嵌。便于版本管理和 schema 变更追踪。
2. **better-sqlite3 v13 N-API**: 确认 v13 预编译二进制可直接加载，无需 `electron-rebuild`。
3. **单例模式**: `initDatabase()` 返回单例，多次调用安全。`getDatabase()` 在未初始化时抛出明确错误。
4. **建表顺序**: model_configs → conversations → messages，确保外键引用的表先存在。
5. **迁移机制预留**: `getSchemaVersion()` + `schema_version` 表，P2/P3 新增表时可递增 version 并添加迁移脚本。

### 验证步骤

```
pnpm build  → 通过 (20 modules transformed)
pnpm lint   → 通过
pnpm test   → 32 tests passed (18 db + 14 window-state)
pnpm format:check → 通过
```

### 遗留问题

- 窗口状态持久化目前使用 JSON 文件，**尚未迁移到 app_settings 表的 window_bounds 列**。P1-09b（settings IPC handler）实现时一并迁移。
- Repo 文件仅占位，具体 CRUD 方法在 P1-06/P1-08/P1-09 中实现。

### 是否需要更新文档

- 不需要：Spec v0.2 §6 已完整定义所有表结构，实现完全符合规格。

---

## P1-04 ~ P1-09: 前端 UI + IPC + 对话闭环 (2026-07-26)

**任务**: 完成前端框架搭建、IPC handler、UI 组件，实现完整对话闭环

### 完成内容

| 任务 | 说明 |
|------|------|
| P1-04 | 前端框架搭建 (Vue 3 + Pinia + UnoCSS + Naive UI) |
| P1-05 | Preload 桥接层 (contextBridge API) |
| P1-06 | Model Config IPC + Repository (CRUD) |
| P1-07 | 模型适配器 (OpenAI/DeepSeek adapter + router) |
| P1-08 | Chat IPC + 流式响应 (SSE streaming) |
| P1-09 | 对话/设置 IPC + UI 组件 (ChatView, SettingsView, Sidebar) |

### 验证

- `pnpm test`: 全部 P1 测试通过
- `pnpm build`: 构建成功
- `pnpm lint`: 0 warnings

---

## P2: Agent 引擎 + MCP 工具 (2026-07-26)

**任务**: 实现 ReAct 执行引擎、工具系统、审批机制、MCP 客户端/服务端，以及 Agent UI 组件

### 修改文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/agent/executor.ts` | 新增 | ReAct 执行引擎（Thought-Action-Observation 循环） |
| `src/main/agent/executor.test.ts` | 新增 | 13 个单元测试 |
| `src/main/agent/parser.ts` | 新增 | LLM 响应解析器（提取 Thought/Action/Input） |
| `src/main/agent/parser.test.ts` | 新增 | 11 个解析器测试 |
| `src/main/agent/prompt-builder.ts` | 新增 | System prompt 构建（工具描述注入） |
| `src/main/agent/approval.ts` | 新增 | 工具审批机制（风险等级映射、超时处理） |
| `src/main/agent/approval.test.ts` | 新增 | 19 个审批测试 |
| `src/main/agent/tokenizer.ts` | 新增 | Token 计数与上下文长度管理 |
| `src/main/agent/tokenizer.test.ts` | 新增 | 13 个 tokenizer 测试 |
| `src/main/agent/types.ts` | 新增 | Agent 类型定义 |
| `src/main/agent/integration.test.ts` | 新增 | 27 个集成测试（完整执行流程） |
| `src/main/tools/registry.ts` | 新增 | 工具注册表（注册/注销/查询） |
| `src/main/tools/registry-init.ts` | 新增 | 内置工具自动注册 |
| `src/main/tools/types.ts` | 新增 | 工具类型定义 |
| `src/main/tools/file-read.ts` | 新增 | 文件读取工具 |
| `src/main/tools/file-write.ts` | 新增 | 文件写入工具 |
| `src/main/tools/web-search.ts` | 新增 | 网络搜索工具 |
| `src/main/tools/web-scrape.ts` | 新增 | 网页抓取工具 |
| `src/main/tools/directory-list.ts` | 新增 | 目录列表工具 |
| `src/main/tools/*.test.ts` | 新增 | 各工具单元测试（134 tests） |
| `src/main/mcp/client.ts` | 新增 | MCP 客户端（JSON-RPC 2.0） |
| `src/main/mcp/transport.ts` | 新增 | stdio 传输层 |
| `src/main/mcp/manager.ts` | 新增 | MCP 服务管理器（生命周期、工具发现） |
| `src/main/mcp/db-repo.ts` | 新增 | MCP 服务配置持久化 |
| `src/main/mcp/*.test.ts` | 新增 | MCP 单元测试（78 tests） |
| `src/main/ipc/agent.ts` | 新增 | Agent IPC handler（执行入口、审批回调） |
| `src/renderer/src/components/Agent/*.vue` | 新增 | ExecutionPanel, ThinkingBlock, ApprovalCard |
| `src/renderer/src/composables/use-agent.ts` | 新增 | Agent 执行 composable |
| `src/renderer/src/stores/agent.ts` | 新增 | Agent Pinia store |
| `src/preload/index.ts` | 修改 | 添加 agent 命名空间 |

### 关键技术决策

1. **ReAct 循环**: Thought → Action → Observation 循环，最大迭代次数限制，支持流式输出
2. **工具风险等级**: `low`（自动执行）/ `medium`（需要确认）/ `high`（必须审批），审批超时默认 60s
3. **MCP 通信**: JSON-RPC 2.0 over stdio，支持工具发现（`tools/list`）和调用（`tools/call`）
4. **Prompt 注入**: 工具描述动态注入 system prompt，包含参数 schema 和使用示例
5. **Token 管理**: 使用 tiktoken 估算上下文长度，超限时自动截断历史消息

### 验证

- `pnpm test`: 全部 P2 测试通过（27 integration + 13 executor + 19 approval + 11 parser + 13 tokenizer + 134 tool + 78 mcp）
- `pnpm build`: 构建成功
- `pnpm lint`: 0 warnings

---

## P3: Skills 系统 (2026-07-26)

**任务**: 实现 Skills 数据库、IPC、意图匹配引擎、执行集成和内置 Skills

### P3-01: Skills 数据库表 + CRUD 仓库层

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/db/schema.sql` | 修改 | 新增 skills 表 + schema_version 升级到 3 |
| `src/main/db/migrations/003-skills.sql` | 新增 | Skills 迁移脚本 |
| `src/main/db/repos/skill.ts` | 新增 | SkillRepository CRUD（create/get/getByName/list/update/delete） |
| `src/main/db/repos/skill.test.ts` | 新增 | 45 个单元测试 |
| `src/main/utils/error.ts` | 修改 | 新增 SKILL_* 错误码 |
| `src/shared/types.ts` | 修改 | 新增 Skill / SkillVariable 类型定义 |

**关键技术决策**:
- `name` 字段 UNIQUE，用于意图匹配查找
- `allowed_tools` / `variables` 以 JSON 字符串存储
- 内置 Skill (`is_builtin=1`) 不可删除，仅允许更新 `model_id`
- `model_id` 为 NULL 时使用默认模型；显式传 `null` 可清除

### P3-02: Skills IPC + Preload 扩展

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/ipc/skill.ts` | 新增 | Skill IPC handlers（CRUD + 列表/搜索） |
| `src/main/ipc/skill.test.ts` | 新增 | 34 个 IPC handler 测试 |
| `src/main/ipc/index.ts` | 修改 | 注册 skill IPC handlers |
| `src/preload/index.ts` | 修改 | 添加 skill 命名空间 |
| `src/renderer/src/types/electron-api.ts` | 修改 | 添加 Skill API 类型定义 |

### P3-03: Skill 意图匹配引擎

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/skills/matcher.ts` | 新增 | 意图匹配引擎（LLM 分类 + 置信度阈值） |
| `src/main/skills/matcher.test.ts` | 新增 | 43 个单元测试 |

**关键技术决策**:
- 构建 classification prompt（所有 auto Skills 描述 + 用户输入）
- LLM 返回 JSON `{ "skill": "name", "confidence": 0-1 }`
- 置信度 < 阈值（默认 0.6）时返回 null（不匹配）
- 健壮的 JSON 提取：支持直接 JSON、代码块包裹、文本包围三种格式

### P3-04: Skill 执行集成

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/skills/skill-executor.ts` | 新增 | 变量替换、工具过滤、执行上下文构建 |
| `src/main/skills/skill-executor.test.ts` | 新增 | 32 个单元测试 |
| `src/main/agent/executor.ts` | 修改 | 注入 skillPrompt 到 system prompt |
| `src/main/ipc/agent.ts` | 修改 | 集成 skill 解析与执行流程 |

**关键技术决策**:
- 变量替换: `{{variable_name}}` → 值/默认值/空字符串（必填无值时抛错）
- 工具过滤: 仅保留 Skill `allowed_tools` 中定义的工具
- 模型覆盖: Skill 的 `model_id` 可覆盖默认模型
- 用户可显式指定 `skillName`，跳过意图匹配

### P3-05: 内置 Skills 种子数据

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/db/schema.sql` | 修改 | 新增 research-report 和 summarize-docs 种子数据，schema_version → 4 |
| `src/main/db/migrations/003-skills.sql` | 修改 | 添加种子数据 INSERT 语句 |
| `src/main/skills/builtin-skills.test.ts` | 新增 | 20 个测试验证内置 Skills 属性与保护机制 |
| `src/main/db/index.test.ts` | 修改 | schema_version 期望值 → 4 |
| `src/main/db/repos/skill.test.ts` | 修改 | 适配内置 Skills 种子数据（计数/过滤测试） |

**内置 Skills**:
1. **research-report** - 研究报告生成：使用 web-search + web-scrape 工具，变量 `{{topic}}`（必填）
2. **summarize-docs** - 文档摘要：使用 file-read 工具，变量 `{{content}}`（必填）+ `{{style}}`（可选，默认"简洁"）

### P3 验证

```
pnpm test   → 802 tests passed (35 files)
pnpm lint   → 0 warnings
pnpm format:check → 通过
```

---

## P4: 本地知识库

### P4-01: 知识库数据表设计与仓库层

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/db/schema.sql` | 修改 | 新增 kb_documents、kb_chunks 表，schema_version → 5 |
| `src/main/db/migrations/004-knowledge-base.sql` | 新增 | 知识库迁移脚本 |
| `src/main/db/repos/kb-document.ts` | 新增 | 文档元数据 CRUD（create/get/list/update/delete） |
| `src/main/db/repos/kb-document.test.ts` | 新增 | 20 个单元测试 |
| `src/main/db/repos/kb-chunk.ts` | 新增 | 分块 CRUD + 嵌入管理（batchCreate/updateEmbedding） |
| `src/main/db/repos/kb-chunk.test.ts` | 新增 | 18 个单元测试 |
| `src/shared/types.ts` | 修改 | 新增 KbDocument / DocumentChunk / SearchResult 类型 |
| `src/main/utils/error.ts` | 修改 | 新增 KB_* 错误码 |

**关键技术决策**:
- `embedding` 以 JSON 数组字符串存储，nullable（导入时先空，后续生成）
- `kb_chunks` 外键 ON DELETE CASCADE，删除文档自动清理分块
- `status` 字段跟踪文档生命周期：`indexing` → `ready` / `error`

---

### P4-02: 文档导入与分块

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/knowledge-base/parser.ts` | 新增 | 文档解析器（markdown/txt/csv 完整实现，pdf/docx/xlsx stub） |
| `src/main/knowledge-base/chunking.ts` | 新增 | 分块策略：fixed-size（含 overlap）+ paragraph-based |
| `src/main/knowledge-base/chunking.test.ts` | 新增 | 14 个分块测试 |
| `src/main/knowledge-base/importer.ts` | 新增 | 导入协调器（解析 → 分块 → 存储，含错误清理） |
| `src/main/knowledge-base/importer.test.ts` | 新增 | 11 个导入流程测试 |

**关键技术决策**:
- 分块大小以 token 数为度量（复用 tokenizer.ts 估算）
- overlap 在句子/换行边界切割，回退到字符数
- 长行（> maxChunkSize）单独成块，避免无限累积
- 导入失败时自动清理：更新文档状态为 error，删除已创建分块

---

### P4-03: 向量嵌入与语义搜索

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/knowledge-base/embedding.ts` | 新增 | 嵌入服务：Ollama + OpenAI 兼容 API，支持单条/批量生成 |
| `src/main/knowledge-base/embedding.test.ts` | 新增 | 17 个嵌入测试（配置管理 + API mock） |
| `src/main/knowledge-base/search.ts` | 新增 | 语义搜索：余弦相似度 + Top-K + 阈值过滤 |
| `src/main/knowledge-base/search.test.ts` | 新增 | 18 个搜索测试（向量数学 + 排序过滤） |
| `src/main/knowledge-base/indexing.ts` | 新增 | 索引导向器：分批生成嵌入 + 进度回调 + 重新索引 |

**关键技术决策**:
- 嵌入在应用层通过 HTTP API 获取（Ollama 本地 / OpenAI 远程），零额外依赖
- Ollama 串行请求避免过载本地服务；OpenAI 支持 true batch（单请求最多 2048 条）
- 余弦相似度在内存中计算，SQLite 仅存储向量 JSON（无专用向量扩展）
- 搜索支持 `topK`、`threshold`、`documentId` 过滤选项
- 向量维度不匹配时取最小公共维度，增强兼容性
- 文件名缓存减少搜索时的数据库查询次数

---

### P4-04: KB 搜索工具集成到 Agent

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/tools/kb-search.ts` | 新增 | 知识库语义搜索工具（kb_search），封装 semanticSearch 供 Agent 调用 |
| `src/main/tools/kb-search.test.ts` | 新增 | 20 个单元测试（定义验证 + 执行逻辑 + 错误处理） |
| `src/main/tools/registry-init.ts` | 修改 | 注册 kb_search 到内置工具列表 |

**关键技术决策**:
- 工具风险等级 `low`：只读操作，无需用户审批
- 参数：query（必需）、topK（1-20）、documentId（限定文档）、threshold（0-1）
- 结果格式化：包含相似度百分比、来源文件名、内容片段，便于 LLM 理解
- 与 Agent 无缝集成：prompt builder 动态从 ToolRegistry 获取定义，注册后自动可用

### P4 验证

```
pnpm test   → 857 tests passed (38 files)
pnpm lint   → 0 errors (2 warnings 为已有 better-sqlite3 类型声明问题)
pnpm format:check → 通过
```

---

## P5: 发布打磨

### P5-01: 知识库 IPC 层

**任务**: 实现 KB IPC handlers，连接 KB 后端与渲染进程

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/ipc/knowledge-base.ts` | 新增 | 9 个 IPC handler（import/list/get/delete/reimport/search/index/reindex/stats），含参数校验和统一错误处理 |
| `src/main/ipc/index.ts` | 修改 | 注册 `registerKbHandlers()` |

**IPC 通道**:

| 通道 | 功能 | 参数 |
|------|------|------|
| `kb:import` | 导入文档 | filePath, fileName, fileType, chunking? |
| `kb:list` | 列出文档 | status? |
| `kb:get` | 获取文档详情 | id |
| `kb:delete` | 删除文档 | id |
| `kb:reimport` | 重新导入 | id, chunking? |
| `kb:search` | 语义搜索 | query, topK?, documentId?, threshold? |
| `kb:index` | 生成嵌入 | id, batchSize? |
| `kb:reindex` | 重新索引 | id, batchSize? |
| `kb:stats` | 统计信息 | 无 |

**关键技术决策**:
- 统一参数校验：`assertNonEmptyString` / `assertFileType` / `assertOptionalNumber`
- 所有 handler 包裹在 try/catch 中，`AppError` 透传，其他错误包装为 `INTERNAL_ERROR`
- 注册函数幂等（`registered` 标志位）
- 所有 handler 函数添加显式返回类型

---

### P5-02: 完善 PDF/DOCX/XLSX 文档解析器

**任务**: 将 P4 中的 stub 解析器替换为完整实现，支持 PDF/DOCX/XLSX 二进制格式解析

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/knowledge-base/parser.ts` | 重写 | 异步解析器：PDF (unpdf)、DOCX (mammoth)、XLSX (exceljs) |
| `src/main/knowledge-base/parser.test.ts` | 新增 | 解析器测试（PDF/DOCX/XLSX 各类型，含 mock 和真实文件测试） |
| `src/main/knowledge-base/importer.ts` | 修改 | `importDocument` / `reimportDocument` 转为 async，支持 await parseDocument |
| `src/main/knowledge-base/importer.test.ts` | 修改 | 测试转为 async/await，修复目录创建和断言问题 |
| `src/main/knowledge-base/chunking.ts` | 修改 | 修复 no-useless-assignment 和 no-non-null-assertion lint 错误 |
| `src/main/knowledge-base/chunking.test.ts` | 修改 | 修正长行和 overlap 测试断言 |
| `src/main/ipc/knowledge-base.ts` | 修改 | handleImport/handleReimport 改为 async/await |
| `package.json` | 修改 | 新增依赖：unpdf、mammoth、exceljs |

**关键技术决策**:
- **动态导入**：`await import('unpdf')` / `await import('mammoth')` / `await import('exceljs')`，避免初始加载开销
- **PDF 解析**：使用 unpdf（基于 pdfjs-dist），`extractText(buffer, { mergePages: true })` 提取全文
- **DOCX 解析**：使用 mammoth 的 `extractRawText({ path })`，输出纯文本
- **XLSX 解析**：使用 exceljs 逐工作表逐行读取，单元格对象类型处理（富文本、公式结果、超链接）
- **文本规范化**：统一换行符（\r\n → \n），压缩多余空行（3+ → 2）
- **错误传播**：解析失败时通过 AppError 传播，importDocument 捕获后更新文档状态为 error

---

### P5-03: Preload 扩展 + 前端类型定义

**任务**: 将知识库 IPC API 暴露到渲染进程，添加完整的 TypeScript 类型声明

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/shared/types.ts` | 修改 | 新增 `ChunkingOptions`、`ImportResult`、`KbStats` 类型定义并导出 |
| `src/preload/index.ts` | 修改 | 新增 `kb` 命名空间（9 个方法），添加到 contextBridge |
| `src/renderer/src/types/electron-api.ts` | 修改 | 新增 KB 参数类型、`KbAPI` 接口，添加到 `ElectronAPI` |
| `src/main/ipc/knowledge-base.ts` | 修改 | `KbStats` 改用 shared 类型，移除本地定义 |

**Preload kb 命名空间方法**:

| 方法 | IPC 通道 | 说明 |
|------|---------|------|
| `import(params)` | `kb:import` | 导入文档 |
| `list(params?)` | `kb:list` | 列出文档 |
| `get(id)` | `kb:get` | 获取文档详情 |
| `delete(id)` | `kb:delete` | 删除文档 |
| `reimport(params)` | `kb:reimport` | 重新导入 |
| `search(params)` | `kb:search` | 语义搜索 |
| `index(params)` | `kb:index` | 生成嵌入 |
| `reindex(params)` | `kb:reindex` | 重新索引 |
| `stats()` | `kb:stats` | 统计信息 |

**关键技术决策**:
- `ChunkingOptions`、`ImportResult`、`KbStats` 提升到 shared/types.ts，作为 IPC 边界的单一类型源
- Preload 使用 `Record<string, unknown>` 参数类型（运行时透传），类型安全由 electron-api.ts 保证
- KB IPC handler 的 `KbStats` 改为从 shared 导入，消除类型重复定义

---

### P5-04: 知识库管理 UI

**任务**: 创建知识库前端管理界面，实现文档导入、列表、搜索、索引操作

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/renderer/src/stores/kb.ts` | 新增 | KB Pinia store：文档列表、统计、导入/删除/重导入、搜索/索引 |
| `src/renderer/src/views/KbView.vue` | 新增 | KB 管理视图：头部统计、工具栏、文档列表表格、导入弹窗、语义搜索面板 |
| `src/renderer/src/App.vue` | 修改 | 新增 KbView 路由分支 |
| `src/renderer/src/stores/ui.ts` | 修改 | ViewName 类型新增 `'kb'` |
| `src/renderer/src/components/Sidebar/SidebarHeader.vue` | 修改 | 新增知识库导航按钮（展开和折叠两种状态） |
| `src/renderer/src/views/ChatView.vue` | 修改 | 处理 `open-kb` 事件，切换到 KB 视图 |

**UI 功能**:

| 功能 | 说明 |
|------|------|
| 文档列表 | 表格展示：文件名、类型徽章、分块数、状态徽章、导入时间、操作按钮 |
| 导入弹窗 | 文件选择器 + 类型自动检测 + 分块策略配置（fixed/paragraph、chunkSize、overlap） |
| 语义搜索 | 查询输入 + Top-K 结果展示（文件名、相似度百分比、内容片段） |
| 文档操作 | 重新导入、生成嵌入、重新索引、删除 |
| 统计信息 | 头部显示：文档数 / 分块数 / 已索引数 |
| 导航 | 侧边栏头部知识库按钮，返回按钮 |

**关键技术决策**:
- Store 封装所有 IPC 调用，统一错误处理和 toast 提示
- 导入弹窗使用原生模态（非 Naive UI），保持轻量
- 文件类型自动检测：根据扩展名映射到 fileType
- 索引状态使用 `Set<string>` 跟踪正在索引的文档 ID
- 搜索结果内容使用 `-webkit-line-clamp` 限制为 3 行

---

### P5-05: 打包配置 (electron-builder)

**任务**: 配置 electron-builder，实现跨平台打包（Linux AppImage/deb、macOS DMG、Windows NSIS）

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `build` 配置、打包脚本、`author` 字段 |
| `src/main/db/index.ts` | 修改 | 新增 `resolveSchemaPath()` 支持开发和生产环境的 SQL 文件路径解析 |

**打包脚本**:

| 脚本 | 说明 |
|------|------|
| `pnpm pack` | 构建并打包当前平台 |
| `pnpm pack:linux` | Linux: AppImage + deb |
| `pnpm pack:mac` | macOS: DMG (x64 + arm64) |
| `pnpm pack:win` | Windows: NSIS 安装程序 |
| `pnpm pack:dir` | 仅解包不打包（快速测试） |

**electron-builder 配置要点**:
- `appId`: `com.agentforge.app`
- `extraResources`: schema.sql 和 migrations 目录复制到 `Resources/db/`
- `asarUnpack`: `.node` 和 `.dll` 文件不打入 asar（native 模块兼容）
- `files`: 仅包含 `out/` 编译输出，排除 `.map` 和 `.ts` 文件
- Linux: AppImage + deb (x64)
- macOS: DMG (x64 + arm64)
- Windows: NSIS 安装程序（允许自定义安装路径、创建快捷方式）

**Schema 路径解析**:
- 生产环境: `process.resourcesPath/db/schema.sql`（extraResources 复制）
- 开发环境/测试: 多路径候选查找（`process.cwd()` → 编译输出目录 → 上溯源码目录）

### P5 验证

```
pnpm test     → 947 tests passed (43 files)
pnpm lint     → 0 errors, 0 warnings
pnpm build    → 通过 (electron-vite build)
pnpm pack:dir → 通过 (electron-builder --dir, Linux x64)
```
