# AgentForge Workflow Auditor 规格说明书 v0.1

> 本文档面向 AI 自主开发，所有规格必须严格遵循。
> 借鉴 Better Harness 的 Agent Work Loop 五维度评估模型，内建为 AgentForge 的原生工作流自审能力。

## 1. 功能目标

### 核心价值

AgentForge 当前能执行 Agent 任务，但缺乏对自身工作流质量的**自审能力**。Workflow Auditor 模块让 AgentForge 在每次执行完成后，从五个维度评估工作流健康度，生成带有证据绑定的诊断报告。

### 借鉴来源

- **Better Harness** 的 Agent Work Loop 五维度模型
- **前馈-反馈循环** 理念（feedforward guides + feedback sensors）
- **证据驱动评分** 方法论（证据状态决定评分上限）

### Phase 1 目标

1. 从已有 TAO Trajectory 数据中提取会话证据
2. 从 ToolRegistry 配置中提取受控执行证据
3. 从 ApprovalManager 审批记录中提取交付安全证据
4. 实现简化版五维度评估（3 种证据状态：Present / Exercised / Missing）
5. 生成结构化审计报告（findings + 维度评分）
6. 在渲染进程中展示审计报告面板

### 非目标（v0.1 范围外）

- 历史报告对比与趋势追踪（Phase 2）
- 自动发现检测和修复建议（Phase 2）
- Loop Discovery 与循环改进（Phase 3）
- 外部 Better Harness CLI 集成（方案 B）

## 2. 评估模型

### 五维度

| 维度 | ID | 核心问题 | 数据源 |
|------|-----|---------|--------|
| Task Understanding | `task-understanding` | Agent 是否理解目标和"完成"的定义？ | 用户输入 + Trajectory thought |
| Controlled Execution | `controlled-execution` | 工作是否在受支持、可复现的路径上？ | ToolRegistry + 工具调用记录 |
| Change Validation | `change-validation` | 是否有证据证明变更有效？ | Trajectory observation + 错误状态 |
| Reliable Delivery | `reliable-delivery` | AI 速度是否绕过了质量检查？ | ApprovalManager + 审批记录 |
| Learning Capture | `learning-capture` | 下一个任务是否从上一个受益？ | Skill 系统 + 历史执行（v0.1 仅基础评估） |

### 简化版证据状态

v0.1 使用 3 种状态（非 Better Harness 的 7 种）：

| 状态 | 含义 | 评分上限 |
|------|------|---------|
| `Missing` | 检查的证据不存在 | 50 |
| `Present` | 机制存在但未被任务使用 | 70 |
| `Exercised` | 机制存在且在任务中被使用 | 100 |

### 评分规则

- 每个维度独立评分（0-100），不依赖 finding 数量
- 维度评分 = 该维度所有检查项的最低证据状态对应分值
- 总评分 = 五个维度评分的加权平均

### Finding 结构

每个 Finding 包含：

```typescript
interface AuditFinding {
  id: string
  dimension: AuditDimension
  checkId: string                    // 检查项 ID
  severity: 'low' | 'medium' | 'high'
  title: string                      // 发现标题
  description: string                // 问题描述
  evidence: string                   // 证据引用
  impact: string                     // 潜在影响
  repair: string                     // 修复建议
  evidenceState: EvidenceState       // 证据状态
}
```

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Agent    │  │ Tool     │  │Approval  │  │ Audit     │  │
│  │ Executor │  │ Registry │  │Manager   │  │ Engine    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │             │             │               │        │
│       │    ┌────────┴─────────────┴───────────────┘        │
│       │    │           Evidence Collectors                 │
│       │    └───────────────────┬──────────────────────────  │
│       │                        │                           │
│       │                ┌───────┴───────┐                   │
│       │                │ Five-Dimension │                   │
│       │                │  Evaluator     │                   │
│       │                └───────┬───────┘                   │
│       │                        │                           │
│       │                ┌───────┴───────┐                   │
│       │                │ Audit Report   │                   │
│       │                │ Generator      │                   │
│       │                └───────┬───────┘                   │
│  ┌────┴────────────────────────┴───────────────────────┐   │
│  │              IPC: audit:run / audit:report         │   │
│  └────────────────────────┬───────────────────────────┘   │
└───────────────────────────┼───────────────────────────────┘
                            │ IPC
┌───────────────────────────┼───────────────────────────────┐
│                    Renderer (Vue 3)                       │
│  ┌──────────────────────────────────────────┐             │
│  │         AuditReportPanel.vue              │             │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────┐  │             │
│  │  │ Radar   │ │ Findings │ │ Dimension  │  │             │
│  │  │ Chart   │ │ List     │ │ Details    │  │             │
│  │  └─────────┘ └──────────┘ └────────────┘  │             │
│  └──────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────┘
```

### 数据流

1. Agent 执行完成后，渲染进程调用 `audit:run`
2. 主进程从 `ExecutionResult.trajectories` 提取会话证据
3. 从 `ToolRegistry` 提取工具配置证据
4. 从 `ApprovalManager` 提取审批记录证据
5. 五维度评估器分析证据，生成 findings 和评分
6. 通过 `audit:report` 事件推送审计报告到渲染进程

## 4. 类型定义

### 新增类型（添加到 `src/shared/types.ts`）

```typescript
/** 审计维度 */
type AuditDimension =
  | 'task-understanding'
  | 'controlled-execution'
  | 'change-validation'
  | 'reliable-delivery'
  | 'learning-capture'

/** 证据状态（简化版） */
type EvidenceState = 'missing' | 'present' | 'exercised'

/** 审计发现严重性 */
type AuditSeverity = 'low' | 'medium' | 'high'

/** 审计发现 */
interface AuditFinding {
  id: string
  dimension: AuditDimension
  checkId: string
  severity: AuditSeverity
  title: string
  description: string
  evidence: string
  impact: string
  repair: string
  evidenceState: EvidenceState
}

/** 维度评分 */
interface DimensionScore {
  dimension: AuditDimension
  score: number                      // 0-100
  evidenceState: EvidenceState
  checks: DimensionCheck[]
}

/** 维度检查项 */
interface DimensionCheck {
  checkId: string
  label: string
  evidenceState: EvidenceState
  description: string
}

/** 审计报告 */
interface AuditReport {
  id: string
  executionId: string
  conversationId: string
  timestamp: number
  dimensions: DimensionScore[]
  findings: AuditFinding[]
  overallScore: number                // 0-100
  supportTrack: 'bootstrap' | 'operationalize' | 'optimize' | 'undetermined'
  summary: string
}
```

## 5. 模块设计

### 5.1 审计引擎 (`src/main/audit/engine.ts`)

```typescript
class AuditEngine {
  /** 执行审计评估 */
  evaluate(input: AuditInput): AuditReport
}

interface AuditInput {
  executionResult: ExecutionResult
  conversationId: string
  tools: Map<string, RegisteredTool>
  approvalMode: ApprovalMode
  trajectories: TAOTrajectory[]
}
```

### 5.2 证据收集器 (`src/main/audit/collectors.ts`)

三个收集器，各自负责一个证据域：

- `collectSessionEvidence(trajectories)` — 从 TAO Trajectory 提取会话证据
- `collectProjectHarnessEvidence(tools, settings)` — 从工具注册表和设置提取项目证据
- `collectDeliveryEvidence(trajectories, approvalMode)` — 从审批记录提取交付证据

### 5.3 维度评估器 (`src/main/audit/evaluators.ts`)

五个评估函数，每个返回 `DimensionScore` + 相关 findings：

- `evaluateTaskUnderstanding(sessionEvidence)` 
- `evaluateControlledExecution(projectEvidence, sessionEvidence)`
- `evaluateChangeValidation(sessionEvidence)`
- `evaluateReliableDelivery(deliveryEvidence)`
- `evaluateLearningCapture(projectEvidence, sessionEvidence)`

### 5.4 IPC 处理器 (`src/main/ipc/audit.ts`)

| Channel | 方向 | 说明 |
|---------|------|------|
| `audit:run` | Renderer→Main | 触发审计评估 |
| `audit:report` | Main→Renderer | 推送审计报告 |

## 6. 前端设计

### AuditReportPanel.vue

- 雷达图：五维度评分可视化
- 发现列表：按严重性排序的 finding 卡片
- 维度详情：点击维度展开检查项详情
- 总评分 + 支持轨道标签

## 7. 验收标准

1. Agent 执行完成后可通过 UI 触发审计
2. 审计报告包含五维度评分（0-100）
3. 每个维度至少有 1 个检查项
4. Findings 包含证据引用和修复建议
5. 前端面板正确渲染雷达图和发现列表
6. 不影响现有 Agent 执行流程
7. 单元测试覆盖评估器核心逻辑
