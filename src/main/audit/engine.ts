// AgentForge Workflow Auditor — 审计引擎
// 协调证据收集 → 维度评估 → 报告生成的完整流程
// WA-04: AuditEngine

import type {
  AuditReport,
  AuditFinding,
  DimensionScore,
  AuditInput,
} from '@shared/types'
import type { RegisteredTool } from '../agent/types'
import { generateId } from '../utils/id'
import {
  collectSessionEvidence,
  collectProjectHarnessEvidence,
  collectDeliveryEvidence,
} from './collectors'
import {
  evaluateTaskUnderstanding,
  evaluateControlledExecution,
  evaluateChangeValidation,
  evaluateReliableDelivery,
  evaluateLearningCapture,
  selectSupportTrack,
} from './evaluators'

/** 维度权重（用于计算总评分） */
const DIMENSION_WEIGHTS: Record<string, number> = {
  'task-understanding': 0.25,
  'controlled-execution': 0.20,
  'change-validation': 0.20,
  'reliable-delivery': 0.20,
  'learning-capture': 0.15,
}

/** 审计引擎配置 */
export interface AuditEngineConfig {
  /** Skill 数量（从 DB 获取） */
  skillCount: number
  /** MCP Server 数量（从 DB 获取） */
  mcpServerCount: number
  /** maxSteps 配置（用于判断是否到达上限） */
  maxSteps: number
}

/**
 * 审计引擎。
 *
 * 编排流程：
 * 1. 收集三通道证据（Session / Project / Delivery）
 * 2. 五维度独立评估
 * 3. 合并 findings，计算总评分
 * 4. 选择支持轨道
 * 5. 生成审计报告
 */
export class AuditEngine {
  private readonly config: AuditEngineConfig

  constructor(config: AuditEngineConfig) {
    this.config = config
  }

  /**
   * 执行审计评估。
   *
   * @param input - 审计输入（包含 trajectories, approvalMode 等）
   * @param tools - 当前注册的工具映射
   * @returns 完整的审计报告
   */
  evaluate(
    input: AuditInput,
    tools: Map<string, RegisteredTool>,
  ): AuditReport {
    // 1. 收集三通道证据
    const sessionEvidence = collectSessionEvidence(
      input.trajectories,
      '', // userInput 在 v0.1 中不单独传入，从 trajectory 推断
      input.summary,
      input.totalSteps,
      input.duration,
      input.tokensUsed,
      input.trajectories.some((t) => t.status === 'rejected' && t.step === input.trajectories.length),
      this.config.maxSteps,
    )

    const projectEvidence = collectProjectHarnessEvidence(
      tools,
      this.config.skillCount,
      this.config.mcpServerCount,
    )

    const deliveryEvidence = collectDeliveryEvidence(
      input.trajectories,
      input.approvalMode,
      input.totalSteps,
    )

    // 2. 五维度独立评估
    const tuResult = evaluateTaskUnderstanding(sessionEvidence)
    const ceResult = evaluateControlledExecution(projectEvidence, sessionEvidence)
    const cvResult = evaluateChangeValidation(sessionEvidence)
    const rdResult = evaluateReliableDelivery(deliveryEvidence, sessionEvidence)
    const lcResult = evaluateLearningCapture(projectEvidence, sessionEvidence)

    // 3. 合并结果
    const dimensions: DimensionScore[] = [
      tuResult.score,
      ceResult.score,
      cvResult.score,
      rdResult.score,
      lcResult.score,
    ]

    const findings: AuditFinding[] = [
      ...tuResult.findings,
      ...ceResult.findings,
      ...cvResult.findings,
      ...rdResult.findings,
      ...lcResult.findings,
    ]

    // 4. 计算总评分（加权平均）
    const overallScore = Math.round(
      dimensions.reduce((sum, dim) => sum + dim.score * (DIMENSION_WEIGHTS[dim.dimension] ?? 0.2), 0),
    )

    // 5. 选择支持轨道
    const hasEvidence = input.trajectories.length > 0
    const supportTrack = selectSupportTrack(overallScore, hasEvidence)

    // 6. 生成摘要
    const summary = this.generateSummary(dimensions, findings, overallScore, supportTrack)

    return {
      id: generateId(),
      executionId: input.executionId,
      conversationId: input.conversationId,
      timestamp: Date.now(),
      dimensions,
      findings,
      overallScore,
      supportTrack,
      summary,
    }
  }

  /**
   * 生成人类可读的审计摘要。
   */
  private generateSummary(
    dimensions: DimensionScore[],
    findings: AuditFinding[],
    overallScore: number,
    track: string,
  ): string {
    const trackLabel: Record<string, string> = {
      bootstrap: '初始阶段（需要建立基础能力）',
      operationalize: '运营化阶段（机制存在但需接入日常工作）',
      optimize: '优化阶段（能力完备，可持续改进）',
      undetermined: '待定（证据不足）',
    }

    const highFindings = findings.filter((f) => f.severity === 'high').length
    const mediumFindings = findings.filter((f) => f.severity === 'medium').length

    const dimSummary = dimensions
      .map((d) => `${this.getDimensionLabel(d.dimension)}: ${d.score}分`)
      .join('，')

    let summary = `工作流审计完成。总评分 ${overallScore}/100，支持轨道：${trackLabel[track] ?? track}。`
    summary += ` 各维度评分：${dimSummary}。`

    if (highFindings > 0) {
      summary += ` 发现 ${highFindings} 个高严重性问题`
      if (mediumFindings > 0) {
        summary += `和 ${mediumFindings} 个中严重性问题`
      }
      summary += `，建议优先处理高严重性发现。`
    } else if (mediumFindings > 0) {
      summary += ` 发现 ${mediumFindings} 个中严重性问题，建议关注。`
    } else {
      summary += ` 未发现严重问题，工作流状态良好。`
    }

    return summary
  }

  private getDimensionLabel(dimension: string): string {
    const labels: Record<string, string> = {
      'task-understanding': '任务理解',
      'controlled-execution': '受控执行',
      'change-validation': '变更验证',
      'reliable-delivery': '可靠交付',
      'learning-capture': '学习捕获',
    }
    return labels[dimension] ?? dimension
  }
}
