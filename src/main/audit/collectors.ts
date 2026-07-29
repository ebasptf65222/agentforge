// AgentForge Workflow Auditor — 证据收集器
// 从 TAO Trajectory、ToolRegistry、ApprovalManager 中提取评估证据
// WA-02: 三通道证据收集

import type {
  TAOTrajectory,
  ApprovalMode,
  ToolRiskLevel,
} from '@shared/types'
import type { RegisteredTool } from '../agent/types'

// ─── 证据结构定义 ───────────────────────────────────────────────

/** 会话证据（从 Trajectory 提取） */
export interface SessionEvidence {
  /** 总步数 */
  totalSteps: number
  /** 用户原始输入 */
  userInput: string
  /** Agent 最终摘要 */
  agentSummary: string
  /** 思考链记录（每步的 thought） */
  thoughts: string[]
  /** 工具调用记录 */
  toolCalls: ToolCallRecord[]
  /** 错误步骤数 */
  errorSteps: number
  /** 审批触发次数 */
  approvalTriggered: number
  /** 审批通过次数 */
  approvalApproved: number
  /** 审批拒绝次数 */
  approvalRejected: number
  /** 执行时长（ms） */
  duration: number
  /** Token 使用量 */
  tokensUsed: number
  /** 是否被用户取消 */
  wasCancelled: boolean
  /** 是否到达最大步数 */
  hitMaxSteps: boolean
}

/** 工具调用记录（证据用） */
export interface ToolCallRecord {
  step: number
  toolName: string
  arguments: Record<string, unknown>
  result: string
  isError: boolean
  riskLevel: ToolRiskLevel
  requiredApproval: boolean
  timestamp: number
}

/** 项目 Harness 证据（从 ToolRegistry 提取） */
export interface ProjectHarnessEvidence {
  /** 注册的工具总数 */
  totalTools: number
  /** 内置工具数 */
  builtinTools: number
  /** MCP 工具数 */
  mcpTools: number
  /** 各风险等级工具数 */
  riskDistribution: Record<ToolRiskLevel, number>
  /** 工具名称列表 */
  toolNames: string[]
  /** Skill 数量（从外部传入） */
  skillCount: number
  /** MCP Server 数量（从外部传入） */
  mcpServerCount: number
}

/** 交付证据（从审批记录提取） */
export interface DeliveryEvidence {
  /** 审批模式 */
  approvalMode: ApprovalMode
  /** 触发审批的步骤 */
  approvalSteps: number[]
  /** 审批通过数 */
  approvedCount: number
  /** 审批拒绝数 */
  rejectedCount: number
  /** 是否有 high-risk 工具被执行 */
  hasHighRiskExecution: boolean
  /** 是否有工具被拒绝后继续执行 */
  hasPostRejectionContinuation: boolean
  /** 总步数 */
  totalSteps: number
}

// ─── 收集器函数 ───────────────────────────────────────────────

/**
 * 从 TAO Trajectory 提取会话证据。
 *
 * 纯函数，无副作用。从 trajectory 数组中提取：
 * - 思考链（thoughts）
 * - 工具调用记录
 * - 错误步骤
 * - 审批记录
 * - 执行状态
 */
export function collectSessionEvidence(
  trajectories: TAOTrajectory[],
  userInput: string,
  agentSummary: string,
  totalSteps: number,
  duration: number,
  tokensUsed: number,
  wasCancelled: boolean,
  maxSteps: number,
): SessionEvidence {
  const thoughts: string[] = []
  const toolCalls: ToolCallRecord[] = []
  let errorSteps = 0
  let approvalTriggered = 0
  let approvalApproved = 0
  let approvalRejected = 0

  for (const traj of trajectories) {
    // 收集思考
    if (traj.thought) {
      thoughts.push(traj.thought)
    }

    // 收集工具调用
    if (traj.action) {
      toolCalls.push({
        step: traj.step,
        toolName: traj.action.toolName,
        arguments: traj.action.arguments,
        result: traj.observation,
        isError: traj.status === 'error',
        riskLevel: traj.action.riskLevel,
        requiredApproval: traj.action.requiresApproval,
        timestamp: traj.timestamp,
      })

      if (traj.status === 'error') {
        errorSteps++
      }

      // 统计审批
      if (traj.status === 'pending-approval') {
        approvalTriggered++
      } else if (traj.status === 'approved') {
        approvalApproved++
      } else if (traj.status === 'rejected') {
        approvalRejected++
      }
    }
  }

  return {
    totalSteps,
    userInput,
    agentSummary,
    thoughts,
    toolCalls,
    errorSteps,
    approvalTriggered,
    approvalApproved,
    approvalRejected,
    duration,
    tokensUsed,
    wasCancelled,
    hitMaxSteps: totalSteps >= maxSteps,
  }
}

/**
 * 从 ToolRegistry 提取项目 Harness 证据。
 */
export function collectProjectHarnessEvidence(
  tools: Map<string, RegisteredTool>,
  skillCount: number,
  mcpServerCount: number,
): ProjectHarnessEvidence {
  let builtinTools = 0
  let mcpTools = 0
  const riskDistribution: Record<ToolRiskLevel, number> = {
    low: 0,
    medium: 0,
    high: 0,
  }
  const toolNames: string[] = []

  for (const [, tool] of tools) {
    const source = (tool as RegisteredTool & { source?: string }).source ?? 'builtin'
    if (source === 'mcp') {
      mcpTools++
    } else {
      builtinTools++
    }
    riskDistribution[tool.definition.riskLevel]++
    toolNames.push(tool.definition.name)
  }

  return {
    totalTools: tools.size,
    builtinTools,
    mcpTools,
    riskDistribution,
    toolNames,
    skillCount,
    mcpServerCount,
  }
}

/**
 * 从 Trajectory 和审批模式提取交付证据。
 */
export function collectDeliveryEvidence(
  trajectories: TAOTrajectory[],
  approvalMode: ApprovalMode,
  totalSteps: number,
): DeliveryEvidence {
  const approvalSteps: number[] = []
  let approvedCount = 0
  let rejectedCount = 0
  let hasHighRiskExecution = false
  let hasPostRejectionContinuation = false

  let sawRejection = false

  for (const traj of trajectories) {
    if (!traj.action) continue

    if (traj.action.riskLevel === 'high') {
      hasHighRiskExecution = true
    }

    if (traj.status === 'pending-approval') {
      approvalSteps.push(traj.step)
    } else if (traj.status === 'approved') {
      approvedCount++
    } else if (traj.status === 'rejected') {
      rejectedCount++
      sawRejection = true
    } else if (sawRejection && (traj.status === 'success' || traj.status === 'error')) {
      hasPostRejectionContinuation = true
    }
  }

  return {
    approvalMode,
    approvalSteps,
    approvedCount,
    rejectedCount,
    hasHighRiskExecution,
    hasPostRejectionContinuation,
    totalSteps,
  }
}
