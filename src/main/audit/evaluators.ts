// AgentForge Workflow Auditor — 五维度评估器
// 借鉴 Better Harness Agent Work Loop 模型，简化为 3 证据状态
// WA-03: 五维度评估逻辑

import type {
  AuditDimension,
  AuditFinding,
  AuditSeverity,
  DimensionScore,
  DimensionCheck,
  EvidenceState,
  SupportTrack,
} from '@shared/types'
import type {
  SessionEvidence,
  ProjectHarnessEvidence,
  DeliveryEvidence,
} from './collectors'
import { generateId } from '../utils/id'

// ─── 评分常量 ───────────────────────────────────────────────────

/** 证据状态 → 评分上限映射 */
const SCORE_CEILING: Record<EvidenceState, number> = {
  missing: 50,
  present: 70,
  exercised: 100,
}

// ─── 辅助函数 ───────────────────────────────────────────────────

/** 取最低证据状态对应的评分作为维度评分 */
function minStateScore(checks: DimensionCheck[]): { score: number; evidenceState: EvidenceState } {
  if (checks.length === 0) {
    return { score: 50, evidenceState: 'missing' }
  }
  let minState: EvidenceState = 'exercised'
  for (const check of checks) {
    if (check.evidenceState === 'missing') {
      minState = 'missing'
      break
    }
    if (check.evidenceState === 'present' && minState === 'exercised') {
      minState = 'present'
    }
  }
  return { score: SCORE_CEILING[minState], evidenceState: minState }
}

/** 创建 Finding */
function createFinding(
  dimension: AuditDimension,
  checkId: string,
  evidenceState: EvidenceState,
  title: string,
  description: string,
  evidence: string,
  impact: string,
  repair: string,
): AuditFinding {
  const severity: AuditSeverity =
    evidenceState === 'missing' ? 'high' : evidenceState === 'present' ? 'medium' : 'low'

  return {
    id: generateId(),
    dimension,
    checkId,
    severity,
    title,
    description,
    evidence,
    impact,
    repair,
    evidenceState,
  }
}

// ─── 1. Task Understanding ──────────────────────────────────────

/**
 * 评估 Task Understanding 维度。
 *
 * 检查项：
 * - goal-understanding: Agent 是否有明确的任务理解（thought 链非空且包含目标引用）
 * - relevant-context: Agent 是否引用了上下文（工具定义、已有信息）
 * - scope-boundary: Agent 是否在合理步数内完成（未到达 maxSteps）
 */
export function evaluateTaskUnderstanding(
  session: SessionEvidence,
): { score: DimensionScore; findings: AuditFinding[] } {
  const findings: AuditFinding[] = []

  // 检查 1: 目标理解
  const hasThoughts = session.thoughts.length > 0
  const hasGoalReference = session.thoughts.some(
    (t) => t.length > 20, // thought 有实质内容
  )
  const goalState: EvidenceState = hasGoalReference ? 'exercised' : hasThoughts ? 'present' : 'missing'

  // 检查 2: 相关上下文
  const hasToolUsage = session.toolCalls.length > 0
  const contextState: EvidenceState = hasToolUsage ? 'exercised' : 'present'

  // 检查 3: 范围边界
  const scopeState: EvidenceState = !session.hitMaxSteps ? 'exercised' : 'present'

  const checks: DimensionCheck[] = [
    {
      checkId: 'goal-understanding',
      label: '意图与验收',
      evidenceState: goalState,
      description: 'Agent 是否有明确的任务理解，thought 链中包含对目标的分析',
    },
    {
      checkId: 'relevant-context',
      label: '相关上下文',
      evidenceState: contextState,
      description: 'Agent 是否使用了工具或引用了上下文信息',
    },
    {
      checkId: 'scope-boundary',
      label: '范围边界',
      evidenceState: scopeState,
      description: 'Agent 是否在合理步数内完成任务',
    },
  ]

  const { score, evidenceState } = minStateScore(checks)

  // 生成 findings
  if (goalState === 'missing') {
    findings.push(
      createFinding(
        'task-understanding',
        'goal-understanding',
        'missing',
        'Agent 缺乏任务理解证据',
        '执行轨迹中未检测到任何思考内容，Agent 可能未理解任务目标就直接行动。',
        `总步数 ${session.totalSteps}，思考记录数 ${session.thoughts.length}`,
        '可能导致 Agent 解决错误的问题或产生无关输出',
        '在 System Prompt 中明确要求 Agent 先分析任务目标再行动',
      ),
    )
  }

  if (scopeState === 'present' && session.hitMaxSteps) {
    findings.push(
      createFinding(
        'task-understanding',
        'scope-boundary',
        'present',
        '执行到达最大步数限制',
        `Agent 执行了 ${session.totalSteps} 步仍未完成任务，可能存在目标不清晰或方案效率问题。`,
        `hitMaxSteps=true, totalSteps=${session.totalSteps}`,
        '消耗过多 token 和时间，可能未达到预期结果',
        '检查任务复杂度，考虑拆分子任务或调整 maxSteps 配置',
      ),
    )
  }

  return {
    score: { dimension: 'task-understanding', score, evidenceState, checks },
    findings,
  }
}

// ─── 2. Controlled Execution ───────────────────────────────────

/**
 * 评估 Controlled Execution 维度。
 *
 * 检查项：
 * - supported-operation: 是否有可用工具
 * - permission-boundary: 高风险工具是否经过审批
 * - reproducible-startup: 工具配置是否完整
 */
export function evaluateControlledExecution(
  project: ProjectHarnessEvidence,
  session: SessionEvidence,
): { score: DimensionScore; findings: AuditFinding[] } {
  const findings: AuditFinding[] = []

  // 检查 1: 受支持操作
  const operationState: EvidenceState =
    project.totalTools > 0 && session.toolCalls.length > 0
      ? 'exercised'
      : project.totalTools > 0
        ? 'present'
        : 'missing'

  // 检查 2: 权限边界
  const hasHighRiskWithoutApproval = session.toolCalls.some(
    (tc) => tc.riskLevel === 'high' && !tc.requiredApproval,
  )
  const permissionState: EvidenceState = hasHighRiskWithoutApproval
    ? 'present'
    : session.toolCalls.some((tc) => tc.requiredApproval)
      ? 'exercised'
      : 'present'

  // 检查 3: 可复现启动
  const startupState: EvidenceState = project.totalTools > 0 ? 'present' : 'missing'

  const checks: DimensionCheck[] = [
    {
      checkId: 'supported-operation',
      label: '受支持操作',
      evidenceState: operationState,
      description: '是否有可用工具且在任务中被调用',
    },
    {
      checkId: 'permission-boundary',
      label: '权限边界',
      evidenceState: permissionState,
      description: '高风险工具是否经过审批检查',
    },
    {
      checkId: 'reproducible-startup',
      label: '可复现启动',
      evidenceState: startupState,
      description: '工具配置是否完整可复现',
    },
  ]

  const { score, evidenceState } = minStateScore(checks)

  if (operationState === 'missing') {
    findings.push(
      createFinding(
        'controlled-execution',
        'supported-operation',
        'missing',
        '无可用工具',
        'ToolRegistry 中没有注册任何工具，Agent 无法执行受支持的操作。',
        `totalTools=${project.totalTools}, toolCalls=${session.toolCalls.length}`,
        'Agent 只能生成文本，无法执行文件操作、搜索等实际任务',
        '注册内置工具或添加 MCP Server 以扩展 Agent 能力',
      ),
    )
  }

  if (hasHighRiskWithoutApproval) {
    findings.push(
      createFinding(
        'controlled-execution',
        'permission-boundary',
        'present',
        '高风险工具未经过审批',
        '检测到高风险工具调用未触发审批流程，可能存在安全风险。',
        `toolCalls 中有 high-risk 工具未设置 requiresApproval`,
        '可能导致不可逆的文件修改或外部操作',
        '检查工具风险等级配置，确保 high-risk 工具正确设置审批要求',
      ),
    )
  }

  return {
    score: { dimension: 'controlled-execution', score, evidenceState, checks },
    findings,
  }
}

// ─── 3. Change Validation ──────────────────────────────────────

/**
 * 评估 Change Validation 维度。
 *
 * 检查项：
 * - relevant-check: 工具执行是否产生结果
 * - failure-repair: 错误是否被处理
 * - validate-again: 修复后是否重新验证
 */
export function evaluateChangeValidation(
  session: SessionEvidence,
): { score: DimensionScore; findings: AuditFinding[] } {
  const findings: AuditFinding[] = []

  const hasResults = session.toolCalls.some((tc) => tc.result && tc.result.length > 0)
  const hasErrors = session.errorSteps > 0
  const hasRecovery = hasErrors && session.toolCalls.some((tc, i) =>
    i > 0 && tc.isError === false && session.toolCalls[i - 1]?.isError === true,
  )

  // 检查 1: 相关验证
  const checkState: EvidenceState = hasResults ? 'exercised' : session.toolCalls.length > 0 ? 'present' : 'missing'

  // 检查 2: 失败诊断与修复
  const repairState: EvidenceState = hasRecovery ? 'exercised' : hasErrors ? 'present' : 'exercised'

  // 检查 3: 修复后重验
  const revalidateState: EvidenceState = hasRecovery ? 'exercised' : hasErrors ? 'present' : 'exercised'

  const checks: DimensionCheck[] = [
    {
      checkId: 'relevant-check',
      label: '相关验证',
      evidenceState: checkState,
      description: '工具执行是否产生了可观察的结果',
    },
    {
      checkId: 'failure-repair',
      label: '失败诊断与修复',
      evidenceState: repairState,
      description: '执行错误是否被诊断和修复',
    },
    {
      checkId: 'validate-again',
      label: '修复后重验',
      evidenceState: revalidateState,
      description: '修复后是否重新验证结果',
    },
  ]

  const { score, evidenceState } = minStateScore(checks)

  if (hasErrors && !hasRecovery) {
    findings.push(
      createFinding(
        'change-validation',
        'failure-repair',
        'present',
        '执行错误未被修复',
        `检测到 ${session.errorSteps} 步执行错误，但未观察到后续修复行为。`,
        `errorSteps=${session.errorSteps}, totalSteps=${session.totalSteps}`,
        '任务可能未完成或产生了不正确的结果',
        '在 System Prompt 中引导 Agent 在遇到错误时分析原因并重试',
      ),
    )
  }

  return {
    score: { dimension: 'change-validation', score, evidenceState, checks },
    findings,
  }
}

// ─── 4. Reliable Delivery ─────────────────────────────────────

/**
 * 评估 Reliable Delivery 维度。
 *
 * 检查项：
 * - acceptance-evidence: 任务是否有明确的完成信号
 * - high-risk-approval: 高风险操作是否被审批
 * - rollback-recovery: 拒绝后是否有恢复路径
 */
export function evaluateReliableDelivery(
  delivery: DeliveryEvidence,
  session: SessionEvidence,
): { score: DimensionScore; findings: AuditFinding[] } {
  const findings: AuditFinding[] = []

  // 检查 1: 交付验收
  const hasSummary = session.agentSummary.length > 0
  const acceptanceState: EvidenceState = hasSummary && !session.wasCancelled ? 'exercised' : hasSummary ? 'present' : 'missing'

  // 检查 2: 高风险审批
  const approvalState: EvidenceState =
    delivery.hasHighRiskExecution && delivery.approvedCount > 0
      ? 'exercised'
      : delivery.hasHighRiskExecution
        ? 'present'
        : 'exercised'

  // 检查 3: 回滚或恢复
  const recoveryState: EvidenceState =
    delivery.rejectedCount > 0 && delivery.hasPostRejectionContinuation
      ? 'exercised'
      : delivery.rejectedCount > 0
        ? 'present'
        : 'exercised'

  const checks: DimensionCheck[] = [
    {
      checkId: 'acceptance-evidence',
      label: '交付验收',
      evidenceState: acceptanceState,
      description: '任务是否有明确的完成信号和摘要',
    },
    {
      checkId: 'high-risk-approval',
      label: '高风险审批',
      evidenceState: approvalState,
      description: '高风险操作是否经过审批',
    },
    {
      checkId: 'rollback-recovery',
      label: '回滚或恢复',
      evidenceState: recoveryState,
      description: '拒绝后是否有恢复路径',
    },
  ]

  const { score, evidenceState } = minStateScore(checks)

  if (acceptanceState === 'missing') {
    findings.push(
      createFinding(
        'reliable-delivery',
        'acceptance-evidence',
        'missing',
        '缺乏交付验收证据',
        'Agent 执行未产生明确的完成摘要，无法判断任务是否成功完成。',
        `summary.length=${session.agentSummary.length}, wasCancelled=${session.wasCancelled}`,
        '无法确认任务是否达成预期目标',
        '确保 Agent 在执行结束时生成明确的完成摘要',
      ),
    )
  }

  if (delivery.hasHighRiskExecution && delivery.approvedCount === 0 && delivery.rejectedCount === 0) {
    findings.push(
      createFinding(
        'reliable-delivery',
        'high-risk-approval',
        'present',
        '高风险操作未触发审批',
        '执行过程中包含高风险工具调用，但未记录任何审批事件。',
        `hasHighRiskExecution=${delivery.hasHighRiskExecution}, approvalMode=${delivery.approvalMode}`,
        '可能绕过安全检查执行了危险操作',
        '检查审批模式配置，确保高风险工具在非 full-auto 模式下触发审批',
      ),
    )
  }

  return {
    score: { dimension: 'reliable-delivery', score, evidenceState, checks },
    findings,
  }
}

// ─── 5. Learning Capture ───────────────────────────────────────

/**
 * 评估 Learning Capture 维度（v0.1 基础版）。
 *
 * 检查项：
 * - lifecycle-repeat-detection: 是否有可重复的工作模式
 * - loop-engineering: 是否有 Skill 可用于复用
 * - later-validation: 暂不支持（Phase 3）
 */
export function evaluateLearningCapture(
  project: ProjectHarnessEvidence,
  _session: SessionEvidence,
): { score: DimensionScore; findings: AuditFinding[] } {
  const findings: AuditFinding[] = []

  // 检查 1: 生命周期检测
  const lifecycleState: EvidenceState = project.skillCount > 0 ? 'present' : 'missing'

  // 检查 2: 循环工程
  const loopState: EvidenceState = project.skillCount > 0 ? 'present' : 'missing'

  // 检查 3: 纵向验证（v0.1 暂不支持）
  const validationState: EvidenceState = 'missing'

  const checks: DimensionCheck[] = [
    {
      checkId: 'lifecycle-repeat-detection',
      label: '生命周期检测',
      evidenceState: lifecycleState,
      description: '是否有 Skill 用于检测和复用工作模式',
    },
    {
      checkId: 'loop-engineering',
      label: '循环工程',
      evidenceState: loopState,
      description: '是否有可复用的 Skill 定义',
    },
    {
      checkId: 'later-validation',
      label: '纵向验证',
      evidenceState: validationState,
      description: '跨任务改进效果验证（Phase 3 实现）',
    },
  ]

  const { score, evidenceState } = minStateScore(checks)

  if (lifecycleState === 'missing') {
    findings.push(
      createFinding(
        'learning-capture',
        'lifecycle-repeat-detection',
        'missing',
        '无可复用工作模式',
        '尚未配置任何 Skill，重复的工作模式无法被检测和复用。',
        `skillCount=${project.skillCount}`,
        '相同的操作流程在每次任务中重复执行，效率低下',
        '为常见任务创建 Skill，将重复操作固化为可复用的工作流',
      ),
    )
  }

  return {
    score: { dimension: 'learning-capture', score, evidenceState, checks },
    findings,
  }
}

// ─── 支持轨道选择 ───────────────────────────────────────────────

/** 根据总评分选择支持轨道 */
export function selectSupportTrack(overallScore: number, hasEvidence: boolean): SupportTrack {
  if (!hasEvidence) return 'undetermined'
  if (overallScore < 50) return 'bootstrap'
  if (overallScore < 70) return 'operationalize'
  return 'optimize'
}
