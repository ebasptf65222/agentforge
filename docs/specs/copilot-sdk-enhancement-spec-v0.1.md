# Copilot SDK 能力增强规格文档 v0.1

> 基于 `@github/copilot-sdk@1.0.8` 完整能力调研，补齐当前集成中未利用的 SDK 功能。
> 聚焦 v0.1 范围：SystemMessage + Skill 集成 + availableTools 过滤 + workingDirectory + 大输出处理 + thinking 事件修复。

## 1. 背景与目标

### 1.1 现状

AgentForge 已集成 GitHub Copilot SDK（`src/main/copilot/`），实现了 BYOK 流式对话、工具桥接 + 审批、MCP 配置桥接。但 SDK 的很多高级能力尚未利用：

| 能力 | 状态 |
|------|------|
| `systemMessage` 系统提示词定制 | 未使用 — Skill prompt 无法注入 |
| `availableTools` / `excludedTools` 工具过滤 | 未使用 — Skill `allowedTools` 不生效 |
| `workingDirectory` 工作目录 | 未使用 — 文件操作无上下文 |
| `largeOutput` 大输出处理 | 未使用 — 大输出可能撑爆上下文 |
| `reasoningEffort` / `contextTier` | 未使用 |
| `onUserInputRequest` ask_user | 未使用 |
| `thinking` chunk 前端处理 | Bug — store 丢弃 thinking 事件 |
| Skill 系统集成 | 完全缺失 — SDK 引擎下不解析 Skill |

### 1.2 v0.1 目标

**优先级排序**（影响面 × 实现复杂度）：

1. **Skill 系统集成**（P0）— 让 SDK 引擎支持 Skill 解析、prompt 注入、工具过滤
2. **workingDirectory 集成**（P1）— 传入工作区路径，让文件工具有正确上下文
3. **largeOutput 启用**（P1）— 防止大输出撑爆上下文
4. **thinking 事件修复**（P1）— 前端正确处理 reasoning_delta
5. **reasoningEffort 透传**（P2）— 支持模型推理强度配置

### 1.3 非目标（v0.1 不做）

- `customAgents` / `defaultAgent` — 需要 UI 设计支持子代理编排，v0.2
- `onElicitationRequest` / `onUserInputRequest` — 需要前端交互组件，v0.2
- `commands` 斜杠命令 — 需要输入框改造，v0.2
- `enableConfigDiscovery` — 自动发现可能与现有 MCP 管理冲突，v0.2
- `resumeSession` 会话恢复 — 需要重新设计消息持久化架构，v0.2
- 旧代码清理 — 双引擎并存，v0.2 统一清理

## 2. 架构设计

### 2.1 Skill 集成流程

```
用户发送消息
    │
    ▼
executeWithCopilotSdk(request)
    │
    ├── 1. resolveSkill(userInput, skillName)
    │       └── 意图匹配或用户指定 → Skill | null
    │
    ├── 2. 如果 Skill 匹配:
    │       ├── a. skill.modelId? → buildProviderConfigById(skill.modelId)
    │       ├── b. 构造 systemMessage: { content: skill.prompt }
    │       └── c. 构造 availableTools: skill.allowedTools
    │
    ├── 3. 如果无 Skill:
    │       ├── systemMessage: undefined（SDK 默认）
    │       └── availableTools: undefined（全部工具）
    │
    ├── 4. buildMcpServersConfig() — 不变
    │
    └── 5. bridge.execute(request, sessionConfig)
            └── CopilotAgentBridge 传入 systemMessage + availableTools
```

### 2.2 SessionConfig 扩展

`CopilotAgentBridge.execute()` 当前只接收 `AgentExecutionRequest`。需要扩展为接受 `SessionExtras`：

```typescript
interface SessionExtras {
  /** Skill 系统提示词（append 到 SDK 默认 system message） */
  systemMessageContent?: string
  /** Skill 允许的工具列表（SDK availableTools） */
  availableTools?: string[]
  /** 工作区路径 */
  workingDirectory?: string
  /** 推理强度 */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}
```

### 2.3 数据流变更

```
agent.ts (IPC)
    │
    ├── resolveSkill() → Skill | null    [复用现有 skills/ 模块]
    │
    ├── 构建 SessionExtras:
    │     systemMessageContent = skill?.prompt
    │     availableTools = skill?.allowedTools
    │     workingDirectory = workspaceStore.path
    │
    └── bridge.execute(request, extras)
          │
          └── CopilotClient.createSession({
                model, provider, streaming: true,
                tools, mcpServers,
                systemMessage: extras.systemMessageContent
                  ? { content: extras.systemMessageContent }
                  : undefined,
                availableTools: extras.availableTools,
                workingDirectory: extras.workingDirectory,
                largeOutput: { enabled: true },
                reasoningEffort: extras.reasoningEffort,
              })
```

## 3. 类型定义

### 3.1 SessionExtras 接口

```typescript
// src/main/copilot/types.ts 新增

/** SDK 会话额外配置（由 Skill 和工作区注入） */
interface SessionExtras {
  /** Skill 系统提示词（append 到 SDK 默认 system message） */
  systemMessageContent?: string
  /** Skill 允许的工具列表（SDK availableTools 过滤） */
  availableTools?: string[]
  /** 工作区路径（SDK workingDirectory） */
  workingDirectory?: string
  /** 推理强度 */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}
```

### 3.2 ExecutionRequest 扩展

`AgentExecutionRequest` 已有 `skillName?: string`，无需修改。`ApprovalMode` 已有，无需修改。

### 3.3 前端 thinking 处理

```typescript
// src/renderer/src/stores/agent.ts 修改 handleStreamChunk

function handleStreamChunk(chunk: StreamChunk): void {
  if (chunk.type === 'text' && chunk.content) {
    streamingContent.value += chunk.content
  } else if (chunk.type === 'thinking' && chunk.content) {
    // 累积 thinking 内容到独立字段
    streamingThinking.value += chunk.content
  }
}
```

需要新增 `streamingThinking: Ref<string>` 状态。

## 4. 实现细节

### 4.1 Skill 集成到 SDK 引擎（CE-01）

**文件**: `src/main/ipc/agent.ts`

在 `executeWithCopilotSdk()` 中，`bridge.execute(request)` 调用前插入 Skill 解析逻辑：

```typescript
// 复用现有 skills/ 模块
import { resolveSkill, buildSkillExecutionContext } from '../skills/skill-executor'

// 在 executeWithCopilotSdk 中：
let sessionExtras: SessionExtras = {}

// 解析 Skill（需要 ModelAdapter 做意图匹配）
// SDK 引擎下用第一个可用模型做匹配
const skillResolution = await resolveSkill(
  request.userInput,
  request.skillName,
  getAdapterForSkillMatching()  // 复用 router
)

if (skillResolution.skill !== null) {
  const skill = skillResolution.skill
  const skillCtx = buildSkillExecutionContext(skill, /* tools not needed for prompt */)

  sessionExtras.systemMessageContent = skillCtx.skillPrompt
  sessionExtras.availableTools = skill.allowedTools.length > 0 ? skill.allowedTools : undefined

  // Skill 指定模型时，覆盖 BYOK 配置
  if (skill.modelId !== undefined) {
    request.modelId = skill.modelId
  }
}

// 传入工作区路径
const settings = getSettings()
if (settings.workspacePath) {
  sessionExtras.workingDirectory = settings.workspacePath
}

result = await bridge.execute(request, sessionExtras)
```

**关键约束**:
- `resolveSkill` 需要 `ModelAdapter`，SDK 引擎下用 `getModelAdapter(request.modelId)` 获取
- `buildSkillExecutionContext` 的 `tools` 参数仅用于变量替换，可传空 Map
- `availableTools` 为空数组时不设置（表示全部允许）

### 4.2 CopilotAgentBridge 扩展（CE-02）

**文件**: `src/main/copilot/agent-bridge.ts`

修改 `execute()` 方法签名和 `createSession` 调用：

```typescript
async execute(
  request: AgentExecutionRequest,
  extras?: SessionExtras,
): Promise<ExecutionResult> {
  // ... 现有 BYOK 配置逻辑 ...

  const sessionConfig: Record<string, unknown> = {
    model,
    provider,
    streaming: true,
    tools,
    mcpServers,
    // 新增：大输出处理
    largeOutput: { enabled: true },
  }

  // 新增：系统提示词
  if (extras?.systemMessageContent) {
    sessionConfig['systemMessage'] = {
      content: extras.systemMessageContent,
    }
  }

  // 新增：工具过滤
  if (extras?.availableTools && extras.availableTools.length > 0) {
    sessionConfig['availableTools'] = extras.availableTools
  }

  // 新增：工作目录
  if (extras?.workingDirectory) {
    sessionConfig['workingDirectory'] = extras.workingDirectory
  }

  // 新增：推理强度
  if (extras?.reasoningEffort) {
    sessionConfig['reasoningEffort'] = extras.reasoningEffort
  }

  const session = await this.client.createSession(sessionConfig)
  // ... 后续不变 ...
}
```

### 4.3 thinking 事件修复（CE-03）

**文件**: `src/renderer/src/stores/agent.ts`

```typescript
// 新增状态
const streamingThinking = ref('')

// 修改 handleStreamChunk
function handleStreamChunk(chunk: StreamChunk): void {
  if (chunk.type === 'text' && chunk.content) {
    streamingContent.value += chunk.content
  } else if (chunk.type === 'thinking' && chunk.content) {
    streamingThinking.value += chunk.content
  }
}

// execute() 中重置
streamingThinking.value = ''

// reset() 中重置
streamingThinking.value = ''

// 返回值中导出
return { /* ... */, streamingThinking }
```

### 4.4 工作区路径获取（CE-04）

**文件**: `src/main/ipc/agent.ts`

```typescript
// 从 settings 获取工作区路径
function getWorkspacePath(): string | undefined {
  const settings = getSettings()
  // WorkspaceConfig.path 可能为 null
  return settings.workspacePath ?? undefined
}
```

需要检查 `AppSettings` 是否有 `workspacePath` 字段，如果没有需要从 workspace store 获取。

### 4.5 reasoningEffort 配置支持（CE-05）

**文件**: `src/shared/types.ts`, `src/main/db/repos/app-settings.ts`

在 `AppSettings` 中新增可选字段：

```typescript
interface AppSettings {
  // ... 现有字段 ...
  /** SDK 引擎推理强度（仅 copilot-sdk 引擎生效） */
  copilotReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}
```

前端 `GeneralSettings.vue` 增加下拉选择。

## 5. 验收标准

### CE-01: Skill 集成
1. SDK 引擎下选择 Skill 后，Skill prompt 通过 `systemMessage` 注入
2. Skill `allowedTools` 通过 `availableTools` 过滤生效
3. Skill `modelId` 覆盖 BYOK 模型配置
4. 无 Skill 时行为不变（全部工具、默认 system message）

### CE-02: Bridge 扩展
1. `execute()` 接受可选 `SessionExtras` 参数
2. `systemMessage` 正确传入 `createSession`
3. `availableTools` 正确传入 `createSession`
4. `workingDirectory` 正确传入 `createSession`
5. `largeOutput` 默认启用

### CE-03: thinking 修复
1. `reasoning_delta` 事件在前端正确累积
2. `streamingThinking` 状态可在组件中读取
3. 重置时 `streamingThinking` 清空

### CE-04: workingDirectory
1. 设置工作区后，SDK 会话的 `workingDirectory` 正确设置
2. 未设置工作区时不传 `workingDirectory`（SDK 用默认）

### CE-05: reasoningEffort
1. 设置面板可选择推理强度
2. 选择后下次 SDK 会话生效
3. 未设置时不传 `reasoningEffort`

### 通用
1. TypeScript 编译无错误
2. ESLint 无新增 error
3. 现有测试不回归
