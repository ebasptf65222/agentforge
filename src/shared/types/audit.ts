// AgentForge 共享类型定义 - 工作流审计类型
// 与 Spec v0.2 §5.9 一致

import type { AuditDimension, EvidenceState, AuditSeverity, SupportTrack } from './enums'
import type { TAOTrajectory } from './agent'
import type { ApprovalMode } from './enums'

// ─── 5.9 工作流审计类型 ────────────────────────────────────────

/** 审计发现 */
export interface AuditFinding {
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

/** 维度检查项 */
export interface DimensionCheck {
  checkId: string
  label: string
  evidenceState: EvidenceState
  description: string
}

/** 维度评分 */
export interface DimensionScore {
  dimension: AuditDimension
  score: number
  evidenceState: EvidenceState
  checks: DimensionCheck[]
}

/** 审计报告 */
export interface AuditReport {
  id: string
  executionId: string
  conversationId: string
  timestamp: number
  dimensions: DimensionScore[]
  findings: AuditFinding[]
  overallScore: number
  supportTrack: SupportTrack
  summary: string
}

/** 审计输入参数 */
export interface AuditInput {
  executionId: string
  conversationId: string
  trajectories: TAOTrajectory[]
  approvalMode: ApprovalMode
  totalSteps: number
  duration: number
  tokensUsed: number
  summary: string
}
