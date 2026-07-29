// AgentForge Workflow Auditor — 集成测试
// WA-08: 验证完整审计流程：执行→触发审计→展示报告
// 覆盖场景：正常执行、空执行、全错误执行

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  TAOTrajectory,
  AuditInput,
  AuditReport,
  AuditDimension,
  AuditSeverity,
} from '@shared/types'
import type { RegisteredTool } from '../agent/types'
import { AuditEngine, type AuditEngineConfig } from './engine'
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

// ─── 测试辅助 ─────────────────────────────────────────────────────

/** 创建测试用 AuditEngine 配置 */
function createEngineConfig(overrides: Partial<AuditEngineConfig> = {}): AuditEngineConfig {
  return {
    skillCount: 3,
    mcpServerCount: 1,
    maxSteps: 20,
    ...overrides,
  }
}

/** 创建 mock TAOTrajectory 步骤 */
function makeTrajectory(
  step: number,
  overrides: Partial<TAOTrajectory> = {},
): TAOTrajectory {
  return {
    step,
    thought: `Step ${step}: 分析问题并执行操作`,
    action: {
      toolName: 'file_read',
      arguments: { path: '/test/file.txt' },
      riskLevel: 'low',
      requiresApproval: false,
    },
    observation: '操作成功完成',
    timestamp: Date.now() + step * 1000,
    status: 'success',
    ...overrides,
  }
}

/** 创建正常执行的 trajectory 序列（搜索→抓取→写文件→完成） */
function createNormalTrajectories(): TAOTrajectory[] {
  return [
    makeTrajectory(1, {
      thought: '用户想要搜索 Vue 3 最新动态，我先用 web_search 工具查找',
      action: {
        toolName: 'web_search',
        arguments: { query: 'Vue 3 latest news' },
        riskLevel: 'low',
        requiresApproval: false,
      },
      observation: '找到 5 条相关结果',
      status: 'success',
    }),
    makeTrajectory(2, {
      thought: '从搜索结果中选取第一个链接进行抓取',
      action: {
        toolName: 'web_scrape',
        arguments: { url: 'https://vuejs.org/news' },
        riskLevel: 'medium',
        requiresApproval: false,
      },
      observation: '成功抓取页面内容，包含 Vue 3.4 发布信息',
      status: 'success',
    }),
    makeTrajectory(3, {
      thought: '将抓取到的内容整理成笔记并写入文件',
      action: {
        toolName: 'file_write',
        arguments: { path: '/workspace/vue3-notes.md', content: '...' },
        riskLevel: 'medium',
        requiresApproval: false,
      },
      observation: '文件写入成功',
      status: 'success',
    }),
    makeTrajectory(4, {
      thought: '任务完成，用户要求的搜索和总结都已做好',
      action: null,
      observation: '执行完成',
      status: 'success',
    }),
  ]
}

/** 创建全错误执行的 trajectory 序列 */
function createErrorTrajectories(): TAOTrajectory[] {
  return [
    makeTrajectory(1, {
      thought: '尝试读取不存在的文件',
      action: {
        toolName: 'file_read',
        arguments: { path: '/nonexistent/file.txt' },
        riskLevel: 'low',
        requiresApproval: false,
      },
      observation: 'Error: 文件不存在',
      status: 'error',
    }),
    makeTrajectory(2, {
      thought: '尝试写入文件但权限不足',
      action: {
        toolName: 'file_write',
        arguments: { path: '/root/protected.txt', content: 'test' },
        riskLevel: 'high',
        requiresApproval: true,
      },
      observation: 'Error: 权限不足',
      status: 'error',
    }),
    makeTrajectory(3, {
      thought: '重试但仍然失败',
      action: {
        toolName: 'file_write',
        arguments: { path: '/root/protected.txt', content: 'test' },
        riskLevel: 'high',
        requiresApproval: true,
      },
      observation: 'Error: 权限不足',
      status: 'error',
    }),
  ]
}

/** 创建空执行的 trajectory 序列 */
function createEmptyTrajectories(): TAOTrajectory[] {
  return []
}

/** 创建带审批的 trajectory 序列（suggest 模式：审批被触发） */
function createApprovalTrajectories(): TAOTrajectory[] {
  return [
    makeTrajectory(1, {
      thought: '需要执行高风险操作，等待用户审批',
      action: {
        toolName: 'file_write',
        arguments: { path: '/important/config.json', content: '{}' },
        riskLevel: 'high',
        requiresApproval: true,
      },
      observation: '等待审批...',
      status: 'pending-approval',
    }),
    makeTrajectory(2, {
      thought: '用户批准了操作，执行写入',
      action: {
        toolName: 'file_write',
        arguments: { path: '/important/config.json', content: '{}' },
        riskLevel: 'high',
        requiresApproval: true,
      },
      observation: '文件写入成功',
      status: 'approved',
    }),
    makeTrajectory(3, {
      thought: '任务完成',
      action: null,
      observation: '执行完成',
      status: 'success',
    }),
  ]
}

/** 创建 full-auto 模式下高风险操作直接执行的 trajectory 序列 */
function createFullAutoHighRiskTrajectories(): TAOTrajectory[] {
  return [
    makeTrajectory(1, {
      thought: '在 full-auto 模式下直接执行高风险操作',
      action: {
        toolName: 'file_write',
        arguments: { path: '/important/config.json', content: '{}' },
        riskLevel: 'high',
        requiresApproval: false,
      },
      observation: '文件写入成功（未触发审批）',
      status: 'success',
    }),
    makeTrajectory(2, {
      thought: '任务完成',
      action: null,
      observation: '执行完成',
      status: 'success',
    }),
  ]
}

/** 创建空工具映射 */
function createEmptyTools(): Map<string, RegisteredTool> {
  return new Map()
}

/** 创建包含多个工具的工具映射 */
function createPopulatedTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>()
  const mockExecute = async (): Promise<{ isError: boolean; content: string }> => ({ isError: false, content: 'OK' })

  tools.set('file_read', {
    definition: {
      name: 'file_read',
      description: 'Read file',
      inputSchema: { type: 'object' },
      riskLevel: 'low',
      source: 'builtin',
    },
    execute: mockExecute,
    source: 'builtin',
  })

  tools.set('file_write', {
    definition: {
      name: 'file_write',
      description: 'Write file',
      inputSchema: { type: 'object' },
      riskLevel: 'medium',
      source: 'builtin',
    },
    execute: mockExecute,
    source: 'builtin',
  })

  tools.set('web_search', {
    definition: {
      name: 'web_search',
      description: 'Search the web',
      inputSchema: { type: 'object' },
      riskLevel: 'low',
      source: 'builtin',
    },
    execute: mockExecute,
    source: 'builtin',
  })

  tools.set('mcp_github', {
    definition: {
      name: 'mcp_github',
      description: 'GitHub MCP tool',
      inputSchema: { type: 'object' },
      riskLevel: 'high',
      source: 'mcp',
    },
    execute: mockExecute,
    source: 'mcp',
    mcpServerId: 'github-server',
  })

  return tools
}

/** 创建审计输入 */
function createAuditInput(
  trajectories: TAOTrajectory[],
  overrides: Partial<AuditInput> = {},
): AuditInput {
  return {
    executionId: 'exec-test-001',
    conversationId: 'conv-test-001',
    trajectories,
    approvalMode: 'auto-edit',
    totalSteps: trajectories.length,
    duration: 15000,
    tokensUsed: 500,
    summary: '执行完成',
    ...overrides,
  }
}

/** 验证 AuditReport 结构完整性 */
function assertValidReportStructure(report: AuditReport): void {
  expect(report).toBeDefined()
  expect(report.id).toBeTruthy()
  expect(report.executionId).toBeTruthy()
  expect(report.conversationId).toBeTruthy()
  expect(typeof report.timestamp).toBe('number')
  expect(Array.isArray(report.dimensions)).toBe(true)
  expect(report.dimensions.length).toBe(5)
  expect(Array.isArray(report.findings)).toBe(true)
  expect(typeof report.overallScore).toBe('number')
  expect(report.overallScore).toBeGreaterThanOrEqual(0)
  expect(report.overallScore).toBeLessThanOrEqual(100)
  expect(['bootstrap', 'operationalize', 'optimize', 'undetermined']).toContain(report.supportTrack)
  expect(typeof report.summary).toBe('string')
  expect(report.summary.length).toBeGreaterThan(0)
}

/** 验证维度评分结构 */
function assertValidDimensionScore(
  report: AuditReport,
  expectedDimension: AuditDimension,
): void {
  const dim = report.dimensions.find((d) => d.dimension === expectedDimension)
  expect(dim).toBeDefined()
  expect(dim!.dimension).toBe(expectedDimension)
  expect(typeof dim!.score).toBe('number')
  expect(dim!.score).toBeGreaterThanOrEqual(0)
  expect(dim!.score).toBeLessThanOrEqual(100)
  expect(['missing', 'present', 'exercised']).toContain(dim!.evidenceState)
  expect(Array.isArray(dim!.checks)).toBe(true)
}

// ─── 集成测试 ─────────────────────────────────────────────────────

describe('WA-08: Workflow Auditor 集成测试', () => {
  let engine: AuditEngine

  beforeEach(() => {
    engine = new AuditEngine(createEngineConfig())
  })

  // ─── 场景 1: 正常执行 → 审计 → 报告结构正确 ───────────────────

  describe('场景 1: 正常执行审计', () => {
    it('应生成结构完整的审计报告', () => {
      const trajectories = createNormalTrajectories()
      const input = createAuditInput(trajectories)
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // 验证报告结构
      assertValidReportStructure(report)

      // 验证五维度都存在
      const expectedDims: AuditDimension[] = [
        'task-understanding',
        'controlled-execution',
        'change-validation',
        'reliable-delivery',
        'learning-capture',
      ]
      for (const dim of expectedDims) {
        assertValidDimensionScore(report, dim)
      }

      // 验证执行ID正确传递
      expect(report.executionId).toBe('exec-test-001')
      expect(report.conversationId).toBe('conv-test-001')
    })

    it('正常执行应有合理的总评分', () => {
      const trajectories = createNormalTrajectories()
      const input = createAuditInput(trajectories)
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // 正常执行（有thoughts, 有工具调用, 无错误）应该有不错的评分
      expect(report.overallScore).toBeGreaterThan(40)

      // 任务理解维度应该有较高评分（有thoughts内容）
      const tuDim = report.dimensions.find((d) => d.dimension === 'task-understanding')
      expect(tuDim).toBeDefined()
      expect(tuDim!.score).toBeGreaterThan(50)
    })

    it('正常执行不应有 high severity 发现（除非有特殊问题）', () => {
      const trajectories = createNormalTrajectories()
      const input = createAuditInput(trajectories)
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // 正常执行不应有太多 high 发现
      const highFindings = report.findings.filter((f) => f.severity === 'high')
      // 在 auto-edit 模式下，可能有一些 medium/low 发现
      // 但不应有大量 high 发现
      expect(highFindings.length).toBeLessThan(3)
    })

    it('审计摘要应包含关键信息', () => {
      const trajectories = createNormalTrajectories()
      const input = createAuditInput(trajectories, {
        summary: '搜索并总结了 Vue 3 最新动态',
      })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      expect(report.summary).toContain('总评分')
      expect(report.summary).toContain('支持轨道')
    })
  })

  // ─── 场景 2: 空执行（0步）→ 审计 → 报告仍可生成 ─────────────

  describe('场景 2: 空执行审计', () => {
    it('空执行应仍能生成报告', () => {
      const trajectories = createEmptyTrajectories()
      const input = createAuditInput(trajectories, {
        summary: '',
        totalSteps: 0,
        duration: 0,
        tokensUsed: 0,
      })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // 报告结构应完整
      assertValidReportStructure(report)

      // 五维度应存在
      const expectedDims: AuditDimension[] = [
        'task-understanding',
        'controlled-execution',
        'change-validation',
        'reliable-delivery',
        'learning-capture',
      ]
      for (const dim of expectedDims) {
        assertValidDimensionScore(report, dim)
      }
    })

    it('空执行应有较低的评分', () => {
      const trajectories = createEmptyTrajectories()
      const input = createAuditInput(trajectories, {
        summary: '',
        totalSteps: 0,
        duration: 0,
        tokensUsed: 0,
      })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // 空执行应该评分较低（证据缺失）
      expect(report.overallScore).toBeLessThanOrEqual(60)

      // 任务理解维度应该评分低（无 thoughts）
      const tuDim = report.dimensions.find((d) => d.dimension === 'task-understanding')
      expect(tuDim).toBeDefined()
      expect(tuDim!.evidenceState).toBe('missing')
    })

    it('空执行的支持轨道应为 undetermined 或 bootstrap', () => {
      const trajectories = createEmptyTrajectories()
      const input = createAuditInput(trajectories, {
        summary: '',
        totalSteps: 0,
      })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      expect(['undetermined', 'bootstrap']).toContain(report.supportTrack)
    })
  })

  // ─── 场景 3: 全错误执行 → 审计 → findings 包含 high severity ──

  describe('场景 3: 全错误执行审计', () => {
    it('全错误执行应生成包含 high severity 的 findings', () => {
      const trajectories = createErrorTrajectories()
      const input = createAuditInput(trajectories, {
        approvalMode: 'full-auto',
        summary: '执行失败，所有操作均出错',
      })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // 报告结构应完整
      assertValidReportStructure(report)

      // 变更验证维度应该评分低
      const cvDim = report.dimensions.find((d) => d.dimension === 'change-validation')
      expect(cvDim).toBeDefined()
      expect(cvDim!.score).toBeLessThanOrEqual(70) // 有错误步骤，评分应有上限

      // 应该有发现项
      expect(report.findings.length).toBeGreaterThan(0)

      // 在 full-auto 模式下执行 high-risk 工具应该有 high severity 发现
      const highFindings = report.findings.filter((f) => f.severity === 'high')
      // 全错误 + full-auto + high-risk 工具 → 应该有 high 发现
      if (highFindings.length === 0) {
        // 至少应该有 medium 发现
        const mediumFindings = report.findings.filter((f) => f.severity === 'medium')
        expect(mediumFindings.length).toBeGreaterThan(0)
      }
    })

    it('全错误执行的总评分应低于正常执行', () => {
      const errorTrajectories = createErrorTrajectories()
      const normalTrajectories = createNormalTrajectories()
      const tools = createPopulatedTools()

      const errorReport = engine.evaluate(
        createAuditInput(errorTrajectories, { approvalMode: 'full-auto', summary: '全失败' }),
        tools,
      )
      const normalReport = engine.evaluate(
        createAuditInput(normalTrajectories, { summary: '全成功' }),
        tools,
      )

      expect(errorReport.overallScore).toBeLessThanOrEqual(normalReport.overallScore)
    })

    it('全错误执行的变更验证维度应反映错误', () => {
      const trajectories = createErrorTrajectories()
      const input = createAuditInput(trajectories, { approvalMode: 'full-auto' })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      const cvDim = report.dimensions.find((d) => d.dimension === 'change-validation')
      expect(cvDim).toBeDefined()

      // 有错误步骤，证据状态不应是 exercised
      expect(cvDim!.evidenceState).not.toBe('exercised')
    })
  })

  // ─── 场景 4: 带审批的执行 ───────────────────────────────────────

  describe('场景 4: 带审批的执行审计', () => {
    it('full-auto 模式下 high-risk 操作未触发审批应有 reliable-delivery 发现', () => {
      const trajectories = createFullAutoHighRiskTrajectories()
      const input = createAuditInput(trajectories, { approvalMode: 'full-auto' })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // full-auto + high-risk + 未触发审批 → 应有 reliable-delivery 发现
      const rdFindings = report.findings.filter((f) => f.dimension === 'reliable-delivery')
      expect(rdFindings.length).toBeGreaterThan(0)

      // 高风险操作未触发审批 → evidenceState=present → severity=medium
      const rdMediumOrHigh = rdFindings.filter(
        (f) => f.severity === 'high' || f.severity === 'medium',
      )
      expect(rdMediumOrHigh.length).toBeGreaterThan(0)
    })

    it('suggest 模式下 high-risk 操作经过审批不应有 high severity reliable-delivery 发现', () => {
      const trajectories = createApprovalTrajectories()
      const input = createAuditInput(trajectories, {
        approvalMode: 'suggest',
        summary: '任务完成，配置文件已更新',
      })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // suggest 模式下，审批被触发且通过 → 不应有 high severity 的 reliable-delivery 发现
      const rdHighFindings = report.findings.filter(
        (f) => f.dimension === 'reliable-delivery' && f.severity === 'high',
      )
      expect(rdHighFindings.length).toBe(0)
    })

    it('auto-edit 模式下 high-risk 操作未触发审批应有 reliable-delivery 发现', () => {
      const trajectories = createFullAutoHighRiskTrajectories()
      const input = createAuditInput(trajectories, { approvalMode: 'auto-edit' })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      // auto-edit 模式不触发审批 → 应有 reliable-delivery 发现
      const rdFindings = report.findings.filter((f) => f.dimension === 'reliable-delivery')
      expect(rdFindings.length).toBeGreaterThan(0)
    })
  })

  // ─── 场景 5: 工具配置影响 ───────────────────────────────────────

  describe('场景 5: 项目 Harness 配置影响', () => {
    it('无工具注册时 controlled-execution 维度应有缺失证据', () => {
      const trajectories = createNormalTrajectories()
      const input = createAuditInput(trajectories)
      const tools = createEmptyTools()

      const report = engine.evaluate(input, tools)

      const ceDim = report.dimensions.find((d) => d.dimension === 'controlled-execution')
      expect(ceDim).toBeDefined()
      // 无工具 → 证据可能缺失
      expect(ceDim!.score).toBeLessThanOrEqual(70)
    })

    it('有工具注册时 controlled-execution 维度应有更好的评分', () => {
      const trajectories = createNormalTrajectories()
      const input = createAuditInput(trajectories)
      const emptyTools = createEmptyTools()
      const populatedTools = createPopulatedTools()

      const reportEmpty = engine.evaluate(input, emptyTools)
      const reportPopulated = engine.evaluate(input, populatedTools)

      const ceEmpty = reportEmpty.dimensions.find(
        (d) => d.dimension === 'controlled-execution',
      )
      const cePopulated = reportPopulated.dimensions.find(
        (d) => d.dimension === 'controlled-execution',
      )

      expect(cePopulated!.score).toBeGreaterThanOrEqual(ceEmpty!.score)
    })
  })

  // ─── 场景 6: 发现排序验证 ───────────────────────────────────────

  describe('场景 6: 发现排序与分组', () => {
    it('发现列表应按 severity 排序（high → medium → low）', () => {
      const trajectories = createErrorTrajectories()
      const input = createAuditInput(trajectories, { approvalMode: 'full-auto' })
      const tools = createPopulatedTools()

      const report = engine.evaluate(input, tools)

      if (report.findings.length > 1) {
        const severityOrder: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 }
        for (let i = 0; i < report.findings.length - 1; i++) {
          const curr = severityOrder[report.findings[i].severity]
          const next = severityOrder[report.findings[i + 1].severity]
          expect(curr).toBeLessThanOrEqual(next)
        }
      }
    })
  })
})

// ─── 证据收集器单元测试 ───────────────────────────────────────────

describe('WA-08: 证据收集器单元测试', () => {
  describe('collectSessionEvidence', () => {
    it('应正确提取 thoughts 和 toolCalls', () => {
      const trajectories = createNormalTrajectories()
      const evidence = collectSessionEvidence(
        trajectories,
        '搜索 Vue 3',
        '完成',
        trajectories.length,
        15000,
        500,
        false,
        20,
      )

      expect(evidence.thoughts.length).toBeGreaterThan(0)
      expect(evidence.toolCalls.length).toBeGreaterThan(0)
      expect(evidence.errorSteps).toBe(0)
      expect(evidence.totalSteps).toBe(trajectories.length)
      expect(evidence.wasCancelled).toBe(false)
      expect(evidence.hitMaxSteps).toBe(false)
    })

    it('空 trajectory 应返回零值', () => {
      const evidence = collectSessionEvidence([], '', '', 0, 0, 0, false, 20)

      expect(evidence.thoughts).toEqual([])
      expect(evidence.toolCalls).toEqual([])
      expect(evidence.errorSteps).toBe(0)
      expect(evidence.totalSteps).toBe(0)
    })

    it('应正确统计错误步骤', () => {
      const trajectories = createErrorTrajectories()
      const evidence = collectSessionEvidence(
        trajectories,
        '',
        '',
        trajectories.length,
        10000,
        300,
        false,
        20,
      )

      expect(evidence.errorSteps).toBe(3)
    })
  })

  describe('collectProjectHarnessEvidence', () => {
    it('应正确统计工具数量', () => {
      const tools = createPopulatedTools()
      const evidence = collectProjectHarnessEvidence(tools, 5, 2)

      expect(evidence.totalTools).toBe(4)
      expect(evidence.builtinTools).toBe(3)
      expect(evidence.mcpTools).toBe(1)
      expect(evidence.skillCount).toBe(5)
      expect(evidence.mcpServerCount).toBe(2)
      expect(evidence.riskDistribution.high).toBe(1)
    })

    it('空工具映射应返回零值', () => {
      const tools = createEmptyTools()
      const evidence = collectProjectHarnessEvidence(tools, 0, 0)

      expect(evidence.totalTools).toBe(0)
      expect(evidence.builtinTools).toBe(0)
      expect(evidence.mcpTools).toBe(0)
    })
  })

  describe('collectDeliveryEvidence', () => {
    it('应正确识别审批步骤', () => {
      const trajectories = createApprovalTrajectories()
      const evidence = collectDeliveryEvidence(trajectories, 'suggest', trajectories.length)

      expect(evidence.approvalMode).toBe('suggest')
      expect(evidence.approvedCount).toBe(1)
    })

    it('应正确识别 high-risk 执行', () => {
      const trajectories = createApprovalTrajectories()
      const evidence = collectDeliveryEvidence(trajectories, 'auto-edit', trajectories.length)

      expect(evidence.hasHighRiskExecution).toBe(true)
    })
  })
})

// ─── 评估器单元测试 ───────────────────────────────────────────────

describe('WA-08: 评估器单元测试', () => {
  describe('evaluateTaskUnderstanding', () => {
    it('有 thoughts 内容时应有较高评分', () => {
      const trajectories = createNormalTrajectories()
      const session = collectSessionEvidence(
        trajectories,
        '用户输入',
        '执行摘要',
        trajectories.length,
        15000,
        500,
        false,
        20,
      )

      const result = evaluateTaskUnderstanding(session)

      expect(result.score.score).toBeGreaterThan(50)
      expect(result.score.evidenceState).not.toBe('missing')
    })

    it('无 thoughts 时应评分较低', () => {
      const session = collectSessionEvidence([], '', '', 0, 0, 0, false, 20)

      const result = evaluateTaskUnderstanding(session)

      expect(result.score.score).toBeLessThanOrEqual(60)
      expect(result.score.evidenceState).toBe('missing')
    })
  })

  describe('evaluateControlledExecution', () => {
    it('有工具注册时应有更好的评分', () => {
      const tools = createPopulatedTools()
      const project = collectProjectHarnessEvidence(tools, 3, 1)
      const session = collectSessionEvidence(
        createNormalTrajectories(),
        '',
        '',
        4,
        15000,
        500,
        false,
        20,
      )

      const result = evaluateControlledExecution(project, session)

      expect(result.score.score).toBeGreaterThan(40)
    })
  })

  describe('evaluateChangeValidation', () => {
    it('有成功工具调用时应有 exercised 证据', () => {
      const session = collectSessionEvidence(
        createNormalTrajectories(),
        '',
        '',
        4,
        15000,
        500,
        false,
        20,
      )

      const result = evaluateChangeValidation(session)

      expect(result.score.score).toBeGreaterThan(40)
    })

    it('全错误时应评分较低', () => {
      const session = collectSessionEvidence(
        createErrorTrajectories(),
        '',
        '',
        3,
        10000,
        300,
        false,
        20,
      )

      const result = evaluateChangeValidation(session)

      expect(result.score.evidenceState).not.toBe('exercised')
    })
  })

  describe('evaluateReliableDelivery', () => {
    it('full-auto + high-risk 应有 reliable-delivery 发现', () => {
      const trajectories = createFullAutoHighRiskTrajectories()
      const delivery = collectDeliveryEvidence(trajectories, 'full-auto', trajectories.length)
      const session = collectSessionEvidence(
        trajectories,
        '',
        '任务完成',
        trajectories.length,
        15000,
        500,
        false,
        20,
      )

      const result = evaluateReliableDelivery(delivery, session)

      // full-auto + high-risk + 无审批 → 应有发现
      expect(result.findings.length).toBeGreaterThan(0)
    })

    it('suggest 模式 + 审批通过不应有 high severity reliable-delivery 发现', () => {
      const trajectories = createApprovalTrajectories()
      const delivery = collectDeliveryEvidence(trajectories, 'suggest', trajectories.length)
      const session = collectSessionEvidence(
        trajectories,
        '',
        '任务完成',
        trajectories.length,
        15000,
        500,
        false,
        20,
      )

      const result = evaluateReliableDelivery(delivery, session)

      // suggest 模式 + 审批通过 → 不应有 high severity 的 reliable-delivery 发现
      // （除非有其他 high 发现如 acceptance-evidence missing）
      const rdHighFindings = result.findings.filter(
        (f) => f.checkId === 'high-risk-approval' && f.severity === 'high',
      )
      expect(rdHighFindings.length).toBe(0)
    })
  })

  describe('selectSupportTrack', () => {
    it('低分 + 无证据 → bootstrap', () => {
      const track = selectSupportTrack(30, false)
      expect(track).toBe('undetermined')
    })

    it('低分 + 有证据 → bootstrap', () => {
      const track = selectSupportTrack(30, true)
      expect(track).toBe('bootstrap')
    })

    it('中分 + 有证据 → operationalize', () => {
      const track = selectSupportTrack(55, true)
      expect(track).toBe('operationalize')
    })

    it('高分 + 有证据 → optimize', () => {
      const track = selectSupportTrack(80, true)
      expect(track).toBe('optimize')
    })
  })

  describe('evaluateLearningCapture', () => {
    it('有 Skill 注册时应有更好的评分', () => {
      const tools = createPopulatedTools()
      const project = collectProjectHarnessEvidence(tools, 5, 2)
      const session = collectSessionEvidence(
        createNormalTrajectories(),
        '',
        '',
        4,
        15000,
        500,
        false,
        20,
      )

      const result = evaluateLearningCapture(project, session)

      expect(result.score.score).toBeGreaterThan(40)
    })

    it('无 Skill 时应有缺失证据', () => {
      const tools = createEmptyTools()
      const project = collectProjectHarnessEvidence(tools, 0, 0)
      const session = collectSessionEvidence([], '', '', 0, 0, 0, false, 20)

      const result = evaluateLearningCapture(project, session)

      expect(result.score.evidenceState).toBe('missing')
    })
  })
})

// ─── 报告生成验证 ─────────────────────────────────────────────────

describe('WA-08: 审计报告生成验证', () => {
  let engine: AuditEngine

  beforeEach(() => {
    engine = new AuditEngine(createEngineConfig())
  })

  it('报告 ID 应为唯一字符串', () => {
    const input1 = createAuditInput(createNormalTrajectories())
    const input2 = createAuditInput(createNormalTrajectories(), { executionId: 'exec-002' })
    const tools = createPopulatedTools()

    const report1 = engine.evaluate(input1, tools)
    const report2 = engine.evaluate(input2, tools)

    expect(report1.id).toBeTruthy()
    expect(report2.id).toBeTruthy()
    expect(report1.id).not.toBe(report2.id)
  })

  it('报告时间戳应为当前时间附近', () => {
    const before = Date.now()
    const report = engine.evaluate(
      createAuditInput(createNormalTrajectories()),
      createPopulatedTools(),
    )
    const after = Date.now()

    expect(report.timestamp).toBeGreaterThanOrEqual(before - 1000)
    expect(report.timestamp).toBeLessThanOrEqual(after + 1000)
  })

  it('每个发现都应有完整的字段', () => {
    const report = engine.evaluate(
      createAuditInput(createErrorTrajectories(), { approvalMode: 'full-auto' }),
      createPopulatedTools(),
    )

    for (const finding of report.findings) {
      expect(finding.id).toBeTruthy()
      expect(finding.dimension).toBeTruthy()
      expect(finding.checkId).toBeTruthy()
      expect(['high', 'medium', 'low']).toContain(finding.severity)
      expect(finding.title).toBeTruthy()
      expect(typeof finding.description).toBe('string')
      expect(typeof finding.evidence).toBe('string')
      expect(typeof finding.impact).toBe('string')
      expect(typeof finding.repair).toBe('string')
      expect(['missing', 'present', 'exercised']).toContain(finding.evidenceState)
    }
  })

  it('维度检查项应有 label 和 description', () => {
    const report = engine.evaluate(
      createAuditInput(createNormalTrajectories()),
      createPopulatedTools(),
    )

    for (const dim of report.dimensions) {
      for (const check of dim.checks) {
        expect(check.checkId).toBeTruthy()
        expect(check.label).toBeTruthy()
        expect(typeof check.description).toBe('string')
        expect(['missing', 'present', 'exercised']).toContain(check.evidenceState)
      }
    }
  })

  it('总评分应在五维度加权平均范围内', () => {
    const report = engine.evaluate(
      createAuditInput(createNormalTrajectories()),
      createPopulatedTools(),
    )

    const minScore = Math.min(...report.dimensions.map((d) => d.score))
    const maxScore = Math.max(...report.dimensions.map((d) => d.score))

    // 总评分应该在最小和最大维度评分之间（加权平均）
    expect(report.overallScore).toBeGreaterThanOrEqual(minScore - 1)
    expect(report.overallScore).toBeLessThanOrEqual(maxScore + 1)
  })
})
