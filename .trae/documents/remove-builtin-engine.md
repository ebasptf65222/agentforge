# 移除 builtin 引擎（做减法：三引擎 → 双引擎）

## Summary

将 AgentForge 的 Agent 执行引擎从三种（builtin / copilot-sdk / langgraph）精简为两种（copilot-sdk / langgraph）。**彻底删除** builtin 专属代码，**新默认引擎为 copilot-sdk**，并处理 MCP 管理器与 builtin 的隐藏耦合、存量数据库设置迁移。

## Current State Analysis

### 现状架构

- [engine-dispatcher.ts](file:///d:/桌面/ai/agentforge/src/main/agent/engine-dispatcher.ts) `executeAgentFlow`（L657-679）按 `settings.engineType` 三路分发；**builtin 是隐式 fallback**（L678，非 SDK 非 langgraph 一律落 builtin）
- builtin 引擎 = 自研 ReAct 循环，专属文件：`executor.ts`（唯一调用方是 dispatcher L574 `executeWithBuiltin`）、`parser.ts`、`prompt-builder.ts` 及其测试
- 功能已被 copilot-sdk 完全覆盖（SDK 原生工具循环 + tool-bridge 审批桥接 + 上下文压缩）

### 两个隐藏耦合点

1. **MCP manager 强绑定 builtin**：[mcp/manager.ts](file:///d:/桌面/ai/agentforge/src/main/mcp/manager.ts) L77、L142、L156、L213 四处 `getCurrentEngineType() === 'builtin'` 决定是否把 MCP 工具注册到 ToolRegistry 并启动自建连接；L294-295 `copilot-sdk` 时跳过连接（SDK 模式下 MCP 走 mcp-bridge 传配置）。移除后这些判断的语义需变为：**copilot-sdk（默认）→ 仅加载配置不连接；langgraph → 连接并注册工具**
2. **存量数据**：`app_settings.engine_type` 存量值为 `'builtin'` 的库，若无迁移会落入分发 fallback 造成未定义行为

### 不可误伤的部分

- `tools/*.ts`、`audit/collectors.ts`、`shared/types/tools.ts` 中的 `source: 'builtin'` 是**工具来源标记（内置工具 vs MCP 工具）**，与 EngineType 无关，全部保留
- `models/` 全套（router/adapters）——langgraph 主执行、copilot skill 意图匹配、chat IPC 共用
- `agent/` 中共用模块：approval、user-input、context-manager、tokenizer、project-rules、engine-commons、execution-lock、types.ts（裁剪 parser 专属类型后保留）

## Proposed Changes

### A. 删除文件（6 个）

| 文件 | 理由 |
|------|------|
| `src/main/agent/executor.ts` | builtin 专属，唯一调用方是 dispatcher |
| `src/main/agent/parser.ts` | 仅 executor 引用（注意：codebase/parser.ts、knowledge-base/parser.ts 是同名无关文件，不动） |
| `src/main/agent/prompt-builder.ts` | 仅 executor 引用 |
| `src/main/agent/executor.test.ts` | 对应测试 |
| `src/main/agent/parser.test.ts` | 对应测试 |
| `src/main/agent/integration.test.ts` | builtin 集成测试 |

### B. 主进程逻辑修改（8 个）

1. **`src/main/agent/engine-dispatcher.ts`**（核心）
   - 删除 `executeWithBuiltin` 函数（L546-641）、`EngineHandle` 的 builtin 分支（L51）、`getCurrentExecutor` / `resetCurrentExecutor`（L61-71）、executor import（L28）
   - `executeAgentFlow` 重写为显式双分支：`engineType === 'langgraph'` → langgraph；**其余（含旧值容错）→ copilot-sdk**（新默认，不再有隐式 builtin fallback）
2. **`src/main/ipc/agent.ts`**
   - 删除 `getCurrentExecutor` import/重导出（L21/L29）
   - `handleStop` / `handleApprove` 中 executor 分支删除（L91/L94-96/L128/L131-133），仅保留 bridge（copilot）与 langgraph 分支
3. **`src/main/agent/types.ts`**
   - 删除 parser 专属类型 `ParsedLLMResponse` / `ParsedActionType`（L22-38）；`RegisteredTool` / `AgentEventCallbacks` / `AgentContextMessage` 等共享类型保留
4. **`src/shared/types/enums.ts`** L23
   - `EngineType = 'copilot-sdk' | 'langgraph'`
5. **`src/main/db/repos/app-settings.ts`**
   - `DEFAULT_ENGINE_TYPE` 从 `'builtin'` 改为 `'copilot-sdk'`（L114）；L226 回退逻辑随 DEFAULT 自动生效
6. **`src/main/ipc/settings.ts`** L21
   - `VALID_ENGINE_TYPES` 去掉 `'builtin'`
7. **`src/main/mcp/manager.ts`**（隐藏耦合重构）
   - L77、L142、L156、L213 的 `getCurrentEngineType() === 'builtin'` 改为 `getCurrentEngineType() === 'langgraph'`（语义：langgraph 才需要自建连接 + ToolRegistry 注册；copilot-sdk 仅加载配置，MCP 由 mcp-bridge 传给 SDK）
8. **`src/main/ipc/mcp.ts`** L153
   - `?? 'builtin'` fallback 改为 `?? 'copilot-sdk'`

### C. 数据库迁移（新增 1 个 + 改 1 个）

1. **新增 `src/main/db/migrations/008-remove-builtin-engine.sql`**
   ```sql
   -- 008: 移除 builtin 引擎，存量设置迁移到 copilot-sdk
   UPDATE app_settings SET engine_type = 'copilot-sdk' WHERE engine_type = 'builtin';
   ```
   （同时在 `db/index.ts` 的迁移注册表中登记，遵循 002-007 既有模式）
2. **`src/main/db/schema.sql`** L86
   - `engine_type TEXT NOT NULL DEFAULT 'copilot-sdk'`
   - `005-engine-type.sql` 与 `db/index.ts:139-141` 属历史迁移逻辑，保持原样不动

### D. 前端修改（2 个 + 核查 1 个）

1. **`src/renderer/src/composables/use-engine-config.ts`**
   - `ENGINE_OPTIONS` 删除 `{ value: 'builtin', label: '内置引擎' }` 项（L13）；`currentEngine` 默认值 `'builtin'` → `'copilot-sdk'`（L51）
2. **`src/renderer/src/components/Settings/GeneralSettings.vue`**
   - 删除自有 ENGINE_OPTIONS 中的 builtin 项（L41-44 区域）；默认值与选中逻辑随选项数组更新
3. **`src/renderer/src/components/ChatPanel/EngineSwitcher.vue`** — 遍历 ENGINE_OPTIONS 渲染，自动少一项，预计免改（核查）
4. **核查 `src/renderer/src/stores/settings.ts`** — 无引擎字面量则免改

## Assumptions & Decisions

- 新默认引擎：**copilot-sdk**（用户已确认）
- 移除力度：**彻底删除**（用户已确认）
- `EngineType` 保留双值类型而非删成单值：保留 langgraph 作为第二引擎
- 旧库 `engine_type='builtin'` 一律迁移到 copilot-sdk（settings:update 白名单同步收紧后，旧值无法再写入）
- `agent/user-input.ts` 保留：仅 copilot/langgraph 使用（builtin 本就不用）
- `agent/tokenizer.ts` / `context-manager.ts` / `project-rules.ts` 保留：codebase/knowledge-base/langgraph 多处共用

## Verification steps

1. `pnpm typecheck` — 确认无类型残留引用
2. `pnpm lint` — 确认无未使用 import / 死代码告警
3. `pnpm test` — 全量测试通过（builtin 相关测试文件已删除；MCP manager / engine-dispatcher 相关既有测试若有 `getCurrentEngineType` mock 需同步修正）
4. 数据库迁移验证：用 `engine_type='builtin'` 的旧库启动 → 确认自动迁移为 `'copilot-sdk'`
5. `pnpm dev` 手动冒烟：
   - EngineSwitcher 只显示两个引擎选项，默认 copilot-sdk
   - 发送消息走 copilot-sdk 引擎正常流式回复
   - 切换 langgraph 引擎可正常执行
   - 设置页 GeneralSettings 引擎选择只有两项
