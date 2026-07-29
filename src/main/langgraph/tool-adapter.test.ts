// AgentForge LangGraph 引擎: 工具适配层测试 (Phase 3)
// 测试 toWrappedTool / toWrappedTools（不含审批检查版本）

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toWrappedTool, toWrappedTools } from './tool-adapter'
import type { RegisteredTool } from '../tools/types'
import type { ToolExecutionResult, ToolRiskLevel } from '@shared/types'

// ─── Fake 工厂 ──────────────────────────────────────────────────

function createFakeTool(
  name: string,
  riskLevel: ToolRiskLevel,
  result?: ToolExecutionResult | Error,
): RegisteredTool {
  const execFn =
    result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue(result ?? { isError: false, content: 'tool result' })
  return {
    definition: {
      name,
      description: `Fake tool: ${name}`,
      inputSchema: { type: 'object', properties: {} },
      riskLevel,
      source: 'builtin',
    },
    execute: execFn,
    source: 'builtin',
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('toWrappedTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('工具转换', () => {
    it('应正确转换工具名称和描述', () => {
      const tool = createFakeTool('file_read', 'low')
      const wrapped = toWrappedTool(tool)

      expect(wrapped.name).toBe('file_read')
      expect(wrapped.description).toBe('Fake tool: file_read')
    })

    it('应保留 inputSchema', () => {
      const tool = createFakeTool('web_search', 'low')
      const wrapped = toWrappedTool(tool)

      expect(wrapped.inputSchema).toEqual({ type: 'object', properties: {} })
    })

    it('应保留 riskLevel 字段', () => {
      const tool = createFakeTool('terminal_exec', 'high')
      const wrapped = toWrappedTool(tool)

      expect(wrapped.riskLevel).toBe('high')
    })

    it('low 风险工具也应保留 riskLevel', () => {
      const tool = createFakeTool('file_read', 'low')
      const wrapped = toWrappedTool(tool)

      expect(wrapped.riskLevel).toBe('low')
    })
  })

  describe('工具执行', () => {
    it('应正确执行工具并返回 content', async () => {
      const tool = createFakeTool('file_read', 'low', {
        isError: false,
        content: 'file content here',
      })
      const wrapped = toWrappedTool(tool)

      const result = await wrapped.execute({ path: '/test.txt' })

      expect(result).toBe('file content here')
      expect(tool.execute).toHaveBeenCalledWith({ path: '/test.txt' })
    })

    it('工具返回错误结果时仍应返回 content', async () => {
      const tool = createFakeTool('web_search', 'low', {
        isError: true,
        content: 'Network error',
      })
      const wrapped = toWrappedTool(tool)

      const result = await wrapped.execute({ query: 'test' })

      expect(result).toBe('Network error')
    })

    it('工具执行抛错时应向上传播错误', async () => {
      const tool = createFakeTool('error_tool', 'high', new Error('Tool execution failed'))
      const wrapped = toWrappedTool(tool)

      await expect(wrapped.execute({})).rejects.toThrow('Tool execution failed')
    })

    it('不含审批检查：high 风险工具也直接执行', async () => {
      const tool = createFakeTool('terminal_exec', 'high', {
        isError: false,
        content: 'executed',
      })
      const wrapped = toWrappedTool(tool)

      const result = await wrapped.execute({ command: 'ls' })

      expect(result).toBe('executed')
      expect(tool.execute).toHaveBeenCalled()
    })
  })
})

describe('toWrappedTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应批量转换所有工具', () => {
    const tool1 = createFakeTool('file_read', 'low')
    const tool2 = createFakeTool('file_write', 'medium')
    const tool3 = createFakeTool('web_search', 'low')
    const tools = new Map<string, RegisteredTool>([
      ['file_read', tool1],
      ['file_write', tool2],
      ['web_search', tool3],
    ])

    const wrapped = toWrappedTools(tools)

    expect(wrapped).toHaveLength(3)
    const names = wrapped.map((t) => t.name)
    expect(names).toContain('file_read')
    expect(names).toContain('file_write')
    expect(names).toContain('web_search')
  })

  it('应保留所有工具的 riskLevel', () => {
    const tool1 = createFakeTool('file_read', 'low')
    const tool2 = createFakeTool('file_write', 'medium')
    const tools = new Map<string, RegisteredTool>([
      ['file_read', tool1],
      ['file_write', tool2],
    ])

    const wrapped = toWrappedTools(tools)

    expect(wrapped[0].riskLevel).toBe('low')
    expect(wrapped[1].riskLevel).toBe('medium')
  })

  it('空工具映射应返回空数组', () => {
    const wrapped = toWrappedTools(new Map())

    expect(wrapped).toHaveLength(0)
  })

  it('批量包装的工具应可独立执行', async () => {
    const tool1 = createFakeTool('file_read', 'low', {
      isError: false,
      content: 'content1',
    })
    const tool2 = createFakeTool('web_search', 'low', {
      isError: false,
      content: 'content2',
    })
    const tools = new Map<string, RegisteredTool>([
      ['file_read', tool1],
      ['web_search', tool2],
    ])

    const wrapped = toWrappedTools(tools)
    const results = await Promise.all([wrapped[0].execute({}), wrapped[1].execute({})])

    expect(results).toContain('content1')
    expect(results).toContain('content2')
  })
})
