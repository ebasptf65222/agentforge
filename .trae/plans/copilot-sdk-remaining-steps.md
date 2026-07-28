# Copilot SDK 集成 — 剩余步骤实施计划

## 当前状态

### 已完成并提交到 Gitee
- **Step 1 (P0 Bug 修复)**: 3 个提交已完成（cae518d, a2e5308, 1f06dd0）
  - OpenAI 适配器 tool_call_id 修复
  - 知识库搜索 OOM 分页修复
  - MCP HTTP Transport SSE 修复

### Step 2 (SDK 基础集成) — 部分完成，未提交
**已存在的新文件**（untracked）:
- `src/main/copilot/types.ts` — SDK 类型定义
- `src/main/copilot/provider-config.ts` — BYOK 配置生成
- `src/main/copilot/event-converter.ts` — 事件格式转换
- `src/main/copilot/agent-bridge.ts` — SDK↔AgentForge 桥接层
- `src/main/db/migrations/005-engine-type.sql` — engine_type 列迁移

**已安装但未写入 package.json 的依赖**:
- `@github/copilot-sdk`
- `@github/copilot`
- `@github/copilot-linux-x64`

**丢失的修改（上下文断开时未保存）— 需要重新应用**:
1. `package.json` — 缺少 3 个 `@github/*` 依赖声明
2. `src/shared/types.ts` — 缺少 `EngineType` 类型和 `AppSettings.engineType` 字段
3. `src/main/db/schema.sql` — `app_settings` 表缺少 `engine_type` 列定义
4. `src/main/db/index.ts` — 缺少 `engine_type` 条件迁移
5. `src/main/db/repos/app-settings.ts` — 缺少 `engineType` 读写支持（4 处改动）
6. `src/main/ipc/settings.ts` — 缺少 `engineType` 校验与透传
7. `src/main/ipc/agent.ts` — 缺少引擎切换逻辑、`CopilotAgentBridge` 集成

---

## 实施计划

### Step 2: 补全 SDK 基础集成（1 个提交）

**目标**: 恢复丢失的文件修改，使 BYOK 流式对话和引擎切换端到端可用。

**修改清单**:

| # | 文件 | 修改内容 |
|---|---|---|
| 1 | `package.json` | 添加 `@github/copilot-sdk`、`@github/copilot`、`@github/copilot-linux-x64` 到 dependencies |
| 2 | `src/shared/types.ts` | 添加 `EngineType = 'builtin' \| 'copilot-sdk'` 类型；`AppSettings` 接口添加 `engineType: EngineType` 字段；export 列表添加 `EngineType` |
| 3 | `src/main/db/schema.sql` | `app_settings` 表添加 `engine_type TEXT NOT NULL DEFAULT 'builtin'` 列 |
| 4 | `src/main/db/index.ts` | `runConditionalMigrations` 中添加 `engine_type` 列检查（`hasColumn` → `ALTER TABLE ADD COLUMN`） |
| 5 | `src/main/db/repos/app-settings.ts` | `AppSettingsRow` 添加 `engine_type: string`；`UpdateSettingsParams` 添加 `engineType?: EngineType`；`rowToSettings` 解析 `engine_type`；`updateSettings` 添加 SET 子句；导入 `EngineType` 类型 |
| 6 | `src/main/ipc/settings.ts` | 添加 `assertOptionalEngineType` 校验函数；`handleUpdateSettings` 中校验 `p['engineType']` 并透传到 `updateParams` |
| 7 | `src/main/ipc/agent.ts` | 导入 `CopilotAgentBridge`；添加 `currentBridge` 变量；添加 `executeWithCopilotSdk()` 函数；`handleExecute` 中根据 `settings.engineType` 分支选择执行器；`handleStop`/`handleApprove` 兼容 bridge |

**验证**: `pnpm typecheck` + `pnpm lint` 通过

**提交信息**: `feat: 集成 @github/copilot-sdk 基础版，支持 BYOK 模式流式对话和引擎切换`

---

### Step 3: 工具桥接 — defineTool + 审批机制适配（1 个提交）

**目标**: SDK 引擎下 Agent 能调用内置工具，审批 UI 正常弹出。

**新增文件**:
- `src/main/copilot/tool-bridge.ts`
  - `bridgeAllTools(approvalMode, approvalManager)` — 将 `ToolRegistry` 中所有工具包装为 SDK 的 `defineTool` 格式
  - 每个 tool handler 内部嵌入审批检查流程：
    1. `getToolRiskLevel(toolName)` 获取风险等级
    2. `shouldRequireApproval(toolAction, approvalMode)` 判断是否需要审批
    3. 需要审批 → `approvalManager.requestApproval()` 阻塞等待用户响应（推送 IPC `agent:approval-request`）
    4. 审批通过 → 执行工具；审批拒绝 → 返回拒绝信息
  - 复用 `agent/approval.ts` 中的 `ApprovalManager`、`shouldRequireApproval`、`getToolRiskLevel`、`buildToolAction`

**修改文件**:
- `src/main/copilot/agent-bridge.ts`
  - `execute()` 中创建 `ApprovalManager` 实例
  - `createSession` 时传入 `tools: bridgeAllTools(approvalMode, approvalManager)`
  - 订阅 SDK 工具调用事件，转换为 `TAOTrajectory` 推送（使用 `buildToolStartTrajectory` / `buildToolCompleteTrajectory`）
  - 实现 `respondApproval()` — 调用 `approvalManager.respond()`
  - `cancel()` 中调用 `approvalManager.cancel()`
- `src/main/ipc/agent.ts`
  - `handleApprove` 中判断引擎类型，SDK 模式调用 `currentBridge.respondApproval()`
  - `handleStop` 中调用 `currentBridge.cancel()`（已有，确认兼容）

**验证**: `pnpm typecheck` + `pnpm lint`

**提交信息**: `feat: 实现 defineTool 工具桥接层，迁移内置工具并适配审批机制`

---

### Step 4: MCP 迁移到 SDK 原生 mcpServers（1 个提交）

**目标**: SDK 引擎下 MCP 工具通过 SDK 原生 `mcpServers` 配置自动发现和调用。

**新增文件**:
- `src/main/copilot/mcp-bridge.ts`
  - `buildMcpServersConfig()` — 从 SQLite `mcp_servers` 表读取配置，转换为 SDK `mcpServers` 格式
  - stdio 类型 → `{ type: "local", command, args, env, tools: ["*"] }`
  - http 类型 → `{ type: "http", url, headers, tools: ["*"] }`
  - 仅返回 `enabled = true` 的服务器

**修改文件**:
- `src/main/copilot/agent-bridge.ts`
  - 导入 `buildMcpServersConfig`
  - `createSession` 时在 sessionConfig 中添加 `mcpServers: buildMcpServersConfig()`
- `src/main/index.ts`
  - 根据 `engineType` 决定是否调用 `getMcpServerManager().initialize()`（SDK 模式跳过自建连接）
- `src/main/ipc/mcp.ts`
  - SDK 模式下 `handleToggleEnable` / `handleAdd` 等仅做配置 CRUD，不手动连接/断开
  - 通过 `getSettings().engineType` 判断当前引擎

**保留**:
- `src/main/mcp/db-repo.ts` — 配置持久化保留
- `src/main/mcp/manager.ts` — 保留但 SDK 模式下不调用（作为 builtin 引擎的 fallback）

**验证**: `pnpm typecheck` + `pnpm lint`

**提交信息**: `feat: MCP 迁移到 SDK 原生 mcpServers 配置，移除自建 transport 依赖`

---

### Step 5: 清理旧代码 + 修复 RAG 维度校验 + 前端适配（1 个提交）

**目标**: 移除不再需要的旧引擎代码，修复 RAG 维度校验 bug，适配前端。

#### 5.1 移除旧代码

| 文件 | 操作 |
|---|---|
| `src/main/agent/executor.ts` | 删除 |
| `src/main/agent/parser.ts` | 删除 |
| `src/main/agent/tokenizer.ts` | 删除 |
| `src/main/agent/prompt-builder.ts` | 删除 |
| `src/main/models/adapter.ts` | 删除 |
| `src/main/models/openai-adapter.ts` | 删除 |
| `src/main/models/anthropic-adapter.ts` | 删除 |
| `src/main/models/deepseek-adapter.ts` | 删除 |
| `src/main/models/router.ts` | 删除 |
| `src/main/mcp/transport.ts` | 删除 |
| `src/main/mcp/http-transport.ts` | 删除 |
| `src/main/mcp/client.ts` | 删除 |
| 对应的 `*.test.ts` | 删除或更新 |

#### 5.2 保留的文件

- `src/main/agent/approval.ts` — 审批机制保留
- `src/main/agent/types.ts` — 共享类型保留
- `src/main/mcp/db-repo.ts` — 配置持久化保留
- `src/main/mcp/manager.ts` — 保留但标记为 deprecated（builtin 引擎已移除）
- `src/main/tools/*` — 所有工具实现保留
- `src/main/knowledge-base/*` — RAG 保留并增强

#### 5.3 更新引用

| 文件 | 修改内容 |
|---|---|
| `src/main/ipc/agent.ts` | 移除 `AgentExecutor` 导入，仅使用 `CopilotAgentBridge`；移除 `currentExecutor` 和引擎分支 |
| `src/main/ipc/chat.ts` | `handleSend` 中移除 `getModelAdapter` 调用 |
| `src/main/ipc/model.ts` | 移除 `invalidateModelCache` 调用 |
| `src/main/index.ts` | 移除 MCP manager 初始化（SDK 模式不需要） |
| `src/main/skills/skill-executor.ts` | 移除 `ModelAdapter` 依赖，改为 `buildProviderConfig` |

#### 5.4 修复 RAG 维度校验

**文件**: `src/main/knowledge-base/search.ts`

**问题**: `cosineSimilarity` 函数在向量维度不匹配时静默截断（取最小公共维度），导致用户切换嵌入模型后搜索结果错误。

**修复**: 维度不匹配时抛出 `AppError(KB_SEARCH_ERROR)`，提示用户重建索引。

**同步更新测试**: `src/main/knowledge-base/search.test.ts` 中 "should handle vectors with different dimensions" 测试用例改为断言抛出错误。

#### 5.5 前端适配

| 文件 | 修改内容 |
|---|---|
| `src/renderer/src/components/Settings/GeneralSettings.vue` | 添加引擎切换 UI（NRadioGroup: 内置引擎 / Copilot SDK） |
| `src/renderer/src/stores/agent.ts` | `handleTrajectory` 适配 SDK 模式（`action: null` 时正常渲染） |
| `src/renderer/src/components/Agent/ExecutionPanel.vue` | 适配 trajectory `action: null` 渲染 |

#### 5.6 清理废弃依赖

移除 `openai` 和 `@anthropic-ai/sdk` 包。

**验证**: `pnpm typecheck` + `pnpm lint` + `pnpm test`

**提交信息**: `refactor: 移除旧 agent/models/mcp 代码，修复 RAG 维度校验，适配前端事件格式`

---

## 依赖关系

```
Step 2 (补全基础集成) ← 恢复丢失的修改
    │
Step 3 (工具桥接) ←── 依赖 Step 2
    │
Step 4 (MCP 迁移) ←── 依赖 Step 2 + 3
    │
Step 5 (清理与增强) ←── 依赖 Step 2/3/4
```

共 4 个提交（Step 2-5），每个提交后 push 到 Gitee。

## 每步验证流程

1. `pnpm typecheck` — 类型检查通过
2. `pnpm lint` — 代码规范检查通过
3. `git add -A && git commit -m "<提交信息>"` — 提交
4. `git push gitee master` — 推送到 Gitee
