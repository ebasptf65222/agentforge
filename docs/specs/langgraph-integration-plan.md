# LangChain + LangGraph 集成实施规划

> 版本: v1.0 | 日期: 2026-07-29
> 目标: 将 LangChain + LangGraph 作为第三引擎引入 AgentForge，逐步替换自建 ReAct 引擎，最终成为主引擎

---

## 一、总体架构

### 目标架构

```
┌──────────────────────────────────────────────────────────┐
│                    渲染进程 (Vue 3)                        │
│  现有 UI 完全复用 (ChatView / ExecutionPanel / ApprovalCard) │
│  新增: @langchain/vue composables (可选增强)               │
├──────────────────────────────────────────────────────────┤
│                    Preload (contextBridge)                 │
│  现有 API 契约不变 (agent.execute / agent.approve / ...)   │
├──────────────────────────────────────────────────────────┤
│                    IPC 层 (ipc/agent.ts)                   │
│  EngineType 判断:                                         │
│  ├─ 'builtin'     → AgentExecutor (现有)                   │
│  ├─ 'copilot-sdk' → CopilotAgentBridge (现有)              │
│  └─ 'langgraph'   → LangGraphAgentBridge (新增)            │
├──────────────────────────────────────────────────────────┤
│              LangGraph 引擎 (src/main/langgraph/)         │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  LangGraphAgentBridge                               │ │
│  │  ├─ StateGraph (节点+边+条件路由)                      │ │
│  │  ├─ Checkpointer (SQLite 状态持久化)                   │ │
│  │  ├─ interrupt() (审批暂停/恢复)                        │ │
│  │  └─ Memory Store (上下文管理)                         │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────┐  ┌──────────────────┐               │
│  │ ModelAdapter     │  │ ToolAdapter       │              │
│  │ (LangChain Chat  │  │ (Registry →      │              │
│  │  Model 包装)      │  │  StructuredTool)  │              │
│  └────────┬────────┘  └────────┬─────────┘               │
│           │                     │                         │
│  ┌────────┴────────┐  ┌────────┴─────────┐               │
│  │ 现有 ModelRouter  │  │ 现有 ToolRegistry │             │
│  │ (OpenAI/DeepSeek/ │  │ (20+ builtin +   │              │
│  │  Anthropic)       │  │  MCP 工具)        │              │
│  └──────────────────┘  └──────────────────┘              │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Copilot SDK 作为编码子节点 (可选, 第二阶段引入)     │    │
│  │  仅在 'coding' 节点调用 Copilot, 其他节点用通用 LLM  │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 设计原则

1. **零破坏**: 现有 `builtin` 和 `copilot-sdk` 引擎不动，LangGraph 作为第三引擎并行存在
2. **契约一致**: LangGraphAgentBridge 实现与 AgentExecutor 相同的接口 (`execute` / `cancel` / `respondApproval`)，复用 `AgentEventCallbacks`
3. **渐进替换**: 先并存，后逐步用 LangGraph 原生能力替换自建模块
4. **Copilot 编码**: 第二阶段引入 Copilot SDK 作为 LangGraph 图中的编码子节点

---

## 二、分阶段实施

### Phase 0: 基础设施搭建 (预计 2-3 天)

**目标**: 安装依赖、扩展类型、创建目录结构

#### P0-01: 安装 LangChain.js + LangGraph.js 依赖

```bash
pnpm add @langchain/core @langchain/langgraph @langchain/openai @langchain/anthropic @langchain/community langchain-mcp-adapters
```

注意：
- `@langchain/core` — 核心抽象 (BaseMessage, BaseChatModel, Tool 等)
- `@langchain/langgraph` — StateGraph, Checkpointer, interrupt
- `@langchain/openai` / `@langchain/anthropic` — 模型适配器 (可选, 也可包装现有 ModelAdapter)
- `@langchain/community` — 社区工具集成
- `langchain-mcp-adapters` — MCP 工具适配器

验证: `pnpm install` 成功, `electron-vite build` 不报错

#### P0-02: 扩展 EngineType 类型

文件: `src/shared/types.ts`

```typescript
// 修改前
type EngineType = 'builtin' | 'copilot-sdk'

// 修改后
type EngineType = 'builtin' | 'copilot-sdk' | 'langgraph'
```

文件: `src/main/db/repos/app-settings.ts`
- `DEFAULT_ENGINE_TYPE` 保持 `'builtin'` (不改变默认引擎)
- `engine_type` 列已经是 TEXT 类型, 无需 DB 迁移

#### P0-03: 创建 langgraph 模块目录结构

```
src/main/langgraph/
├── index.ts                 # 模块入口 + 导出
├── bridge.ts                # LangGraphAgentBridge (对标 CopilotAgentBridge)
├── graph-builder.ts         # StateGraph 构建逻辑
├── model-adapter.ts         # 现有 ModelAdapter → LangChain ChatModel 包装
├── tool-adapter.ts          # 现有 ToolRegistry → LangChain StructuredTool 包装
├── checkpointer.ts          # LangGraph SQLite Checkpointer 初始化
├── event-converter.ts       # LangGraph 事件 → AgentEventCallbacks 转换
├── interrupt-handler.ts      # interrupt() 审批暂停/恢复逻辑
└── types.ts                 # LangGraph 引擎内部类型
```

验证: 目录创建完成, 空文件不报错

---

### Phase 1: 核心引擎实现 (预计 5-7 天)

**目标**: 实现 LangGraphAgentBridge, 完成 ReAct 循环, 可作为第三引擎执行

#### P1-01: ModelAdapter 包装层

文件: `src/main/langgraph/model-adapter.ts`

将现有的 `ModelAdapter.streamChat()` 包装为 LangChain `BaseChatModel`:

```typescript
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ModelAdapter } from '../models/adapter'
import type { StreamChunk } from '@shared/types'

/**
 * 将 AgentForge 的 ModelAdapter 包装为 LangChain ChatModel
 * 复用现有 BYOK 配置和密钥管理, 无需重复实现模型适配器
 */
export class LangChainModelWrapper extends BaseChatModel {
  private adapter: ModelAdapter

  constructor(adapter: ModelAdapter) {
    super({})
    this.adapter = adapter
  }

  async _generate(messages, options) {
    // 调用 adapter.streamChat, 累积完整响应
    // 返回 ChatResult
  }

  async *_streamResponseMessages(messages, options) {
    // 调用 adapter.streamChat, 逐 chunk yield
    // 转换 StreamChunk → LangChain AIMessageChunk
  }

  _llmType() { return 'agentforge-adapter' }
}
```

关键点:
- `AdapterMessage.role` 是 string, 需映射为 LangChain `BaseMessage` (HumanMessage / AIMessage / SystemMessage / ToolMessage)
- 现有 `OpenAIAdapter` 把 `tool` role 偷偷改成 `user`, LangGraph 用原生 function calling 时不需要这个 hack
- `options.signal` 透传给 `adapter.streamChat(messages, signal)`

验证: 单元测试 — 构造 wrapper, 调用 `_generate`, 验证返回 ChatResult

#### P1-02: ToolAdapter 包装层

文件: `src/main/langgraph/tool-adapter.ts`

将现有的 `ToolRegistry` 工具映射为 LangChain `StructuredTool`:

```typescript
import { StructuredTool } from '@langchain/core/tools'
import { Tool as LangChainTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getToolRegistry } from '../tools/registry'
import { shouldRequireApproval, buildToolAction } from '../agent/approval'
import type { RegisteredTool } from '../tools/types'
import type { ApprovalMode, ToolAction } from '@shared/types'

/**
 * 将 AgentForge RegisteredTool 包装为 LangChain StructuredTool
 * 在 execute 前嵌入审批检查
 */
export function wrapToolForLangGraph(
  tool: RegisteredTool,
  options: {
    approvalMode: ApprovalMode
    requestApproval: (action: ToolAction) => Promise<boolean>
    onToolStart?: (name: string, args: unknown) => void
    onToolEnd?: (name: string, result: unknown) => void
  }
): StructuredTool {
  // 1. 从 tool.definition.inputSchema (JSON Schema) 构建 zod schema
  // 2. 包装 execute: 审批检查 → 执行 → 返回 string
  // 3. 返回 StructuredTool 实例
}

export function wrapAllTools(
  approvalMode: ApprovalMode,
  requestApproval: (action: ToolAction) => Promise<boolean>,
  callbacks?: { onToolStart?, onToolEnd? }
): StructuredTool[] {
  const registry = getToolRegistry()
  return registry.list().map(tool =>
    wrapToolForLangGraph(tool, { approvalMode, requestApproval, ...callbacks })
  )
}
```

关键点:
- `tool.definition.inputSchema` 是 JSON Schema, 需转换为 zod schema (可用 `json-schema-to-zod` 或手动映射)
- `tool.execute(args)` 返回 `ToolExecutionResult { isError, content, metadata }`, 需提取 `content` 作为 string 返回
- 审批逻辑复用现有 `shouldRequireApproval` + `ApprovalManager`

验证: 单元测试 — 包装一个工具, 调用, 验证返回值; 审批拒绝时返回拒绝消息

#### P1-03: 事件转换器

文件: `src/main/langgraph/event-converter.ts`

将 LangGraph 的流式事件映射为 `AgentEventCallbacks`:

```typescript
import type { AgentEventCallbacks } from '../agent/types'
import type { TAOTrajectory, StreamChunk, ApprovalRequest } from '@shared/types'

export class EventConverter {
  constructor(private callbacks: AgentEventCallbacks) {}

  /** LangGraph astream_events → onStreamChunk */
  handleEvent(event: { event: string; data: unknown }): void {
    switch (event.event) {
      case 'on_chat_model_stream':
        // → callbacks.onStreamChunk({ type: 'text', content: chunk.text })
        break
      case 'on_tool_start':
        // → callbacks.onStreamChunk({ type: 'tool-start', content: toolName })
        break
      case 'on_tool_end':
        // → callbacks.onStreamChunk({ type: 'tool-complete', content: result })
        break
      // ...
    }
  }

  /** 构建 TAOTrajectory 并推送 */
  pushTrajectory(step: {
    thought: string
    action?: string
    args?: unknown
    observation?: string
    status: 'pending' | 'approved' | 'success' | 'error' | 'failed'
  }): void {
    const trajectory: TAOTrajectory = {
      step: this.stepCounter++,
      thought: step.thought,
      action: step.action,
      args: step.args,
      observation: step.observation,
      status: step.status,
      timestamp: Date.now(),
    }
    this.callbacks.onTrajectory(trajectory)
  }
}
```

关键点:
- LangGraph 的 `astream_events` v2 事件包括: `on_chat_model_stream`, `on_chat_model_end`, `on_tool_start`, `on_tool_end`, `on_chain_start`, `on_chain_end` 等
- 需映射到现有 `StreamChunkType`: `text`, `thinking`, `tool-start`, `tool-complete`, `tool-progress`, `error`
- `TAOTrajectory` 的 step 序号需自维护 (LangGraph 不提供全局 step 计数)

验证: 单元测试 — 模拟 LangGraph 事件, 验证回调被正确调用

#### P1-04: StateGraph 构建

文件: `src/main/langgraph/graph-builder.ts`

构建 ReAct Agent 的 StateGraph:

```typescript
import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import { createAgent } from 'langchain/agents'
import type { StructuredTool } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

const AgentState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // 自定义状态字段
  stepCount: Annotation<number>({ default: () => 0 }),
  trajectories: Annotation({ reducer: (x, y) => x.concat(y), default: () => [] }),
})

/**
 * 方案 A: 使用 LangChain create_agent (最简单)
 * 内部自动构建 ReAct StateGraph
 */
export function createSimpleAgent(model: BaseChatModel, tools: StructuredTool[]) {
  return createAgent({
    llm: model,
    tools,
    // 可配置 max_iterations, early_stopping_method 等
  })
}

/**
 * 方案 B: 显式构建 StateGraph (更灵活, 第二阶段使用)
 * 支持自定义节点: 审批 gate / 上下文压缩 / 多 Agent 路由
 */
export function createCustomGraph(model: BaseChatModel, tools: StructuredTool[], options) {
  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)        // LLM 决策
    .addNode('tools', toolNode)          // 工具执行
    .addNode('approval', approvalNode)   // 审批 gate
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue)  // finish → END, tool → approval
    .addEdge('approval', 'tools')        // 审批通过 → 执行工具
    .addEdge('tools', 'agent')           // 工具结果 → 回到 agent
    .compile({ checkpointer: options.checkpointer })
  return graph
}
```

Phase 1 使用方案 A (createAgent), Phase 2 迁移到方案 B (显式 StateGraph)

验证: 构建 graph, 调用 `graph.invoke()`, 验证返回 messages

#### P1-05: LangGraphAgentBridge

文件: `src/main/langgraph/bridge.ts`

核心类, 对标 `AgentExecutor` 和 `CopilotAgentBridge`:

```typescript
import type { AgentExecutionRequest, ExecutionResult, AgentEventCallbacks } from '@shared/types'
import type { ModelAdapter } from '../models/adapter'
import type { ApprovalMode, TAOTrajectory } from '@shared/types'

export interface LangGraphBridgeConfig {
  callbacks: AgentEventCallbacks
  approvalTimeoutMs: number
  maxSteps: number
}

export class LangGraphAgentBridge {
  private config: LangGraphBridgeConfig
  private approvalManager: ApprovalManager
  private abortController: AbortController | null = null
  private cancelled = false

  constructor(config: LangGraphBridgeConfig) {
    this.config = config
    this.approvalManager = new ApprovalManager()
  }

  async execute(
    request: AgentExecutionRequest,
    adapter: ModelAdapter,
    tools: Map<string, RegisteredTool>,
    historyMessages: AgentContextMessage[]
  ): Promise<ExecutionResult> {
    // 1. 包装模型: adapter → LangChainModelWrapper
    // 2. 包装工具: tools → StructuredTool[] (含审批 gate)
    // 3. 构建 agent: createAgent({ llm, tools })
    // 4. 配置 Checkpointer (thread_id = conversationId)
    // 5. 流式执行: agent.astream_events({ messages }, { version: 'v2' })
    // 6. 事件转换: EventConverter.handleEvent → callbacks
    // 7. 构建 ExecutionResult 返回
  }

  cancel(): void {
    this.cancelled = true
    this.abortController?.abort()
    this.approvalManager.cancel()
  }

  respondApproval(approved: boolean, reason?: string): void {
    this.approvalManager.respond(approved, reason)
  }

  hasPendingApproval(): boolean {
    return this.approvalManager.hasPendingApproval()
  }
}
```

关键点:
- `execute` 方法签名与 `AgentExecutor.execute` 对齐 (都接受 `AgentExecutionRequest`, 返回 `ExecutionResult`)
- 审批使用 `interrupt()` 或复用现有 `ApprovalManager` (Phase 1 先用 ApprovalManager, Phase 2 评估是否迁移到 interrupt)
- 流式执行用 `astream_events` v2, 通过 EventConverter 映射到 callbacks
- `cancel()` 通过 `AbortController` 中止 LLM 调用 + `ApprovalManager.cancel()` 中止等待

验证: 集成测试 — 构造 bridge, 执行一个简单请求, 验证返回 ExecutionResult

#### P1-06: IPC 引擎分支

文件: `src/main/ipc/agent.ts`

在 `handleExecute` 中增加 LangGraph 分支:

```typescript
// 修改前 (第 468 行)
if (settings.engineType === 'copilot-sdk') {
  return executeWithCopilotSdk(request)
}

// 修改后
if (settings.engineType === 'copilot-sdk') {
  return executeWithCopilotSdk(request)
}
if (settings.engineType === 'langgraph') {
  return executeWithLangGraph(request)
}
```

新增 `executeWithLangGraph` 函数:

```typescript
async function executeWithLangGraph(request: AgentExecutionRequest): Promise<ExecutionResult> {
  // 1. 并发锁检查 (复用现有 currentBridge/currentExecutor 模式)
  // 2. 构建 callbacks (复用 sendTrajectory/sendApprovalRequest/sendStreamChunk)
  // 3. 获取模型适配器: getModelAdapter(request.modelId)
  // 4. 获取工具: getToolsMap()
  // 5. 加载历史消息 (同 builtin 引擎逻辑)
  // 6. Skill 解析 (同 builtin 引擎逻辑)
  // 7. new LangGraphAgentBridge(config)
  // 8. result = await bridge.execute(request, adapter, tools, historyMessages)
  // 9. 保存消息 (同 builtin 引擎逻辑)
  // 10. finally: currentBridge = null
}
```

需要新增模块级变量:
```typescript
let currentLangGraphBridge: LangGraphAgentBridge | null = null
```

并更新并发锁检查、`handleStop`、`handleApprove` 等

验证: 设置 `engineType = 'langgraph'`, 发送消息, 验证流式输出和工具调用

#### P1-07: Checkpointer 初始化

文件: `src/main/langgraph/checkpointer.ts`

```typescript
import { MemorySaver } from '@langchain/langgraph'
// 或 import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

let checkpointer: MemorySaver | null = null

export function getCheckpointer() {
  if (!checkpointer) {
    // Phase 1: 内存 Checkpointer (简单, 不持久化)
    checkpointer = new MemorySaver()

    // Phase 2: SQLite Checkpointer (持久化, 崩溃恢复)
    // checkpointer = SqliteSaver.fromConnString(dbPath)
  }
  return checkpointer
}
```

验证: agent 执行后, 可通过 thread_id 恢复上下文

---

### Phase 1 验收标准

- [ ] `engineType = 'langgraph'` 时, 可以正常对话
- [ ] 流式输出正常 (文字逐字显示)
- [ ] 工具调用正常 (至少 web_search / kb_search 可用)
- [ ] 审批流程正常 (high 风险工具弹出审批卡片, 用户可通过/拒绝)
- [ ] 取消执行正常 (agent:stop 可中止)
- [ ] 现有 `builtin` 和 `copilot-sdk` 引擎不受影响

---

### Phase 2: 能力增强 (预计 5-7 天)

**目标**: 用 LangGraph 原生能力替换自建薄弱环节, 引入 Copilot 编码节点

#### P2-01: MCP 适配器迁移

用 `langchain-mcp-adapters` 替换自建 MCP transport + client:

```typescript
import { MultiServerMCPClient } from 'langchain-mcp-adapters'

// 从 DB 读取 MCP Server 配置, 构建适配器
export async function createMcpTools(servers: MCPServerConfig[]) {
  const client = new MultiServerMCPClient({
    // stdio servers
    // http servers
  })
  const tools = await client.getTools()
  return tools // StructuredTool[]
}
```

收益:
- 替换 `mcp/transport.ts` + `mcp/client.ts` + `mcp/http-transport.ts` (~800 行自建代码)
- 解决 SEC-03 (SSRF 防护) 和 OPT2-13 (僵尸进程) 的已知问题
- MCP 工具直接作为 LangChain StructuredTool, 无需手动映射

验证: MCP Server 连接、工具发现、工具调用全部正常

#### P2-02: 显式 StateGraph + 审批 Gate 节点

迁移到显式 StateGraph, 将审批作为独立节点:

```typescript
const graph = new StateGraph(AgentState)
  .addNode('agent', agentNode)
  .addNode('approval_gate', approvalGateNode)  // interrupt() 暂停
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', (state) => {
    const lastMsg = state.messages[state.messages.length - 1]
    return lastMsg.tool_calls?.length ? 'approval_gate' : END
  })
  .addConditionalEdges('approval_gate', (state) => {
    return state.approved ? 'tools' : 'agent'  // 拒绝 → 反馈给 agent
  })
  .addEdge('tools', 'agent')
  .compile({ checkpointer })
```

审批 Gate 节点使用 `interrupt()`:

```typescript
async function approvalGateNode(state) {
  const toolCall = state.messages[state.messages.length - 1].tool_calls[0]
  const needsApproval = shouldRequireApproval(...)

  if (!needsApproval) {
    return { approved: true }  // 直接通过
  }

  // interrupt() 暂停图执行, 等待用户恢复
  const decision = interrupt({
    type: 'approval_request',
    tool: toolCall.name,
    args: toolCall.args,
  })

  return { approved: decision === 'approve' }
}
```

收益:
- 审批可跨会话恢复 (LangGraph Checkpointer 持久化中断状态)
- 拒绝时优雅反馈给 LLM 继续推理

验证: 审批暂停 → 关闭应用 → 重新打开 → 审批状态恢复

#### P2-03: Copilot SDK 编码节点

将 Copilot SDK 作为 StateGraph 中的一个节点:

```typescript
import { CopilotSession } from '../copilot/session-manager'

async function codingNode(state) {
  // 提取编码任务
  const task = state.messages[state.messages.length - 1].content

  // 调用 Copilot SDK 执行编码任务
  const session = await getSessionManager().getOrCreateSession(...)
  const result = await session.sendAndWait({ prompt: task })

  // 返回结果作为 AIMessage
  return { messages: [new AIMessage(result.summary)] }
}
```

Supervisor 图:

```typescript
const graph = new StateGraph(SupervisorState)
  .addNode('supervisor', supervisorNode)    // LLM 路由
  .addNode('coding', codingNode)            // → Copilot SDK
  .addNode('research', researchNode)        // → 通用 LLM + KB
  .addNode('review', reviewNode)            // → Copilot review agent
  .addEdge(START, 'supervisor')
  .addConditionalEdges('supervisor', routeTask)
  .addEdge('coding', 'supervisor')
  .addEdge('research', 'supervisor')
  .addEdge('review', END)
  .compile({ checkpointer })
```

收益:
- 编码任务由 GitHub 优化提示词驱动 (Plan/Explore/Task/Review 四个 Agent)
- 非编码任务用通用 LLM + 自建工具
- 各司其职, 优势互补

验证: 发送编码任务 → 自动路由到 coding 节点 → Copilot 执行 → 结果返回

#### P2-04: 上下文管理增强

用 LangGraph Memory Store 替换 `context-manager.ts`:

```typescript
import { InMemoryStore } from '@langchain/langgraph'

const store = new InMemoryStore()
// 或 SQLite-backed store

// 在 graph 配置中注入
const graph = compiledGraph.withConfig({
  configurable: { thread_id: conversationId },
  store,
})
```

收益:
- LangGraph 内置 token 计数和上下文压缩
- 长对话自动压缩, 无需手动 manageContext
- Memory Store 支持跨会话记忆 (Phase 3 可用)

验证: 长对话不超 token 限制, 压缩后仍保持上下文连贯

---

### Phase 2 验收标准

- [ ] MCP 工具通过 `langchain-mcp-adapters` 连接, 自建 transport 可移除
- [ ] 审批使用 `interrupt()`, 可跨会话恢复
- [ ] Copilot SDK 作为编码节点可用 (如果 Copilot CLI 可用)
- [ ] 上下文自动压缩正常
- [ ] 显式 StateGraph 可运行

---

### Phase 3: 高级功能 (预计 7-10 天)

**目标**: 利用 LangGraph 独有能力做新功能

#### P3-01: 多 Agent 编排 (Supervisor 模式)

实现 Supervisor 模式, 将现有 Skills 系统映射为子 Agent:

```
Supervisor (LLM 路由)
├─ Coding Agent (→ Copilot SDK)
├─ Research Agent (→ 通用 LLM + KB + Web Search)
├─ Review Agent (→ Copilot Code Review)
├─ Doc Agent (→ 通用 LLM + 文档生成)
└─ Test Agent (→ 通用 LLM + 代码库索引)
```

每个子 Agent 是 StateGraph 中的一个节点, Supervisor 决定路由。

#### P3-02: Deep Agents (长时任务)

引入 LangChain Deep Agents 框架:
- 任务自动分解
- 子 Agent 生成
- 文件系统上下文管理
- 跨会话执行

适用于: "重构这个模块"、"为整个项目补充测试" 等大型任务

#### P3-03: LangSmith 可观测性集成

- 接入 LangSmith trace
- 替换或增强现有 TAOTrajectory 记录
- 支持 trace 回放和调试

#### P3-04: Agent as MCP Server

将 AgentForge 的 Agent 暴露为 MCP Server:
- 其他工具 (VS Code, 其他 Electron 应用) 可直接调用
- 使用 LangGraph 的 MCP endpoint 功能

---

### Phase 3 验收标准

- [ ] 多 Agent 模式可用, Supervisor 可路由到不同子 Agent
- [ ] 长时任务可执行 (跨多次用户交互)
- [ ] LangSmith trace 可查看
- [ ] Agent 可作为 MCP Server 被外部调用

---

## 三、风险评估与缓解

| 风险 | 影响 | 概率 | 缓解方案 |
|------|------|------|---------|
| LangChain.js 包体积过大 | Electron 打包体积增加 | 中 | 评估 tree-shaking, 按需导入; 打包后对比体积 |
| 异步生成器阻塞主进程 | UI 卡顿 | 低 | LangGraph 操作是异步的, 不阻塞; 注意 DB 同步操作 |
| MCP 适配器不兼容现有配置 | MCP Server 无法连接 | 中 | Phase 1 先用自建 MCP, Phase 2 再迁移; 迁移时做兼容测试 |
| Checkpointer 与现有 DB 冲突 | 数据不一致 | 低 | Phase 1 用 MemorySaver (内存), Phase 2 评估 SQLite 持久化 |
| Copilot SDK 节点集成复杂 | 编码节点不可用 | 中 | Phase 2 才引入, 先验证 LangGraph 基础功能; Copilot 不可用时 fallback 到通用 LLM |
| interrupt() 恢复逻辑复杂 | 审批恢复失败 | 中 | Phase 1 先用 ApprovalManager, Phase 2 再迁移到 interrupt; 充分测试 |

---

## 四、文件变更清单

### 新增文件

```
src/main/langgraph/
├── index.ts                 # 模块入口
├── bridge.ts                # LangGraphAgentBridge
├── graph-builder.ts         # StateGraph 构建
├── model-adapter.ts         # ModelAdapter → LangChain ChatModel
├── tool-adapter.ts           # ToolRegistry → LangChain StructuredTool
├── checkpointer.ts          # Checkpointer 初始化
├── event-converter.ts       # 事件转换
├── interrupt-handler.ts     # interrupt() 审批逻辑
├── types.ts                 # 内部类型
├── bridge.test.ts            # 单元测试
├── model-adapter.test.ts    # 单元测试
├── tool-adapter.test.ts     # 单元测试
└── event-converter.test.ts  # 单元测试

src/main/langgraph/
├── mcp-adapter.ts            # (Phase 2) langchain-mcp-adapters 集成
├── copilot-node.ts           # (Phase 2) Copilot SDK 编码节点
├── supervisor.ts             # (Phase 3) 多 Agent Supervisor
└── deep-agent.ts             # (Phase 3) Deep Agents 集成
```

### 修改文件

| 文件 | 变更 | Phase |
|------|------|-------|
| `src/shared/types.ts` | `EngineType` 增加 `'langgraph'` | P0 |
| `src/main/ipc/agent.ts` | 增加 `executeWithLangGraph` 分支 + `currentLangGraphBridge` | P1 |
| `src/renderer/src/types/electron-api.ts` | (可选) 新增 LangGraph 配置字段类型 | P1 |
| `src/renderer/src/components/Settings/GeneralSettings.vue` | 引擎选择增加 LangGraph 选项 | P1 |
| `src/main/db/repos/app-settings.ts` | (可选) 新增 LangGraph 配置字段 | P2 |

### 不变文件 (零破坏)

- `src/main/agent/executor.ts` — builtin 引擎不动
- `src/main/copilot/agent-bridge.ts` — Copilot 引擎不动
- `src/main/tools/registry.ts` — 工具注册表不动
- `src/main/models/router.ts` — 模型路由不动
- `src/preload/index.ts` — API 契约不动
- 所有渲染进程组件 — UI 不动

---

## 五、依赖关系图

```
P0-01 (安装依赖)
  ↓
P0-02 (EngineType 类型)
  ↓
P0-03 (目录结构)
  ↓
P1-01 (ModelAdapter 包装) ──┐
P1-02 (ToolAdapter 包装)  ──┤
P1-03 (事件转换器)        ──┤
P1-07 (Checkpointer)     ──┤
                           ↓
P1-04 (StateGraph 构建) ───┐
                           ↓
P1-05 (LangGraphAgentBridge)
                           ↓
P1-06 (IPC 引擎分支)
                           ↓
Phase 1 验收
                           ↓
P2-01 (MCP 适配器) ────────┐
P2-02 (显式 StateGraph)    ─┤
P2-04 (上下文管理)        ─┤
                           ↓
P2-03 (Copilot 编码节点)
                           ↓
Phase 2 验收
                           ↓
P3-01 (多 Agent)
P3-02 (Deep Agents)
P3-03 (LangSmith)
P3-04 (Agent as MCP Server)
                           ↓
Phase 3 验收
```

---

## 六、与现有模块的对应关系

| 现有自建模块 | LangGraph 对应 | 替换时机 | 策略 |
|-------------|---------------|---------|------|
| `agent/executor.ts` (ReAct 循环) | `createAgent()` / StateGraph | Phase 1 | LangGraph 并行, 不删除旧的 |
| `agent/approval.ts` (审批管理) | `interrupt()` + Checkpointer | Phase 2 | 先用 ApprovalManager, 后迁移 |
| `agent/context-manager.ts` (上下文) | Memory Store + 自动压缩 | Phase 2 | LangGraph 内置替代 |
| `checkpoint/index.ts` (文件快照) | 不替换 | - | 保留, 职责不同 (文件 vs Agent 状态) |
| `mcp/transport.ts` + `client.ts` | `langchain-mcp-adapters` | Phase 2 | 整体替换 |
| `models/adapter.ts` (模型适配) | LangChain ChatModel (包装) | Phase 1 | 包装现有适配器, 不重复实现 |
| `copilot/agent-bridge.ts` | Copilot 作为 LangGraph 节点 | Phase 2 | 降级为节点, 不再作为独立引擎 |
| `agent/parser.ts` (LLM 输出解析) | LangGraph 原生 function calling | Phase 1 | 不再需要文本解析 |
| `agent/prompt-builder.ts` | LangChain prompt template | Phase 2 | 逐步迁移 |
| `audit/engine.ts` (审计) | LangSmith trace | Phase 3 | 补充, 不替换 |

---

## 七、测试策略

### 单元测试

每个新模块都要有对应的 `.test.ts`:
- `model-adapter.test.ts` — 验证 ModelAdapter 包装正确
- `tool-adapter.test.ts` — 验证工具包装和审批 gate
- `event-converter.test.ts` — 验证事件映射
- `bridge.test.ts` — 验证执行流程

### 集成测试

- 端到端: 设置 `engineType = 'langgraph'`, 发消息, 验证流式输出
- 工具调用: 触发 web_search / kb_search, 验证结果
- 审批: 触发 high 风险工具, 验证审批卡片弹出
- 取消: 执行中 stop, 验证中止
- 引擎切换: 在 builtin / langgraph 间切换, 验证都正常

### 回归测试

- 现有 1427 个测试全部通过
- `builtin` 引擎功能不受影响
- `copilot-sdk` 引擎功能不受影响
