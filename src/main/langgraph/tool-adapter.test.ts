import { describe, it, expect, vi, beforeEach } from 'vitest'
import { wrapTool, wrapAllTools } from './tool-adapter'
import type { ToolWrapOptions } from './tool-adapter'
import type { RegisteredTool } from '../tools/types'
import type { AgentEventCallbacks } from '../agent/types'
import { ApprovalManager } from '../agent/approval'
import type { ApprovalResponse, ToolRiskLevel, ToolExecutionResult } from '@shared/types'

// ─── Fake 工厂 ──────────────────────────────────────────────────

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

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

function createAutoApproveManager(): ApprovalManager {
  const manager = new ApprovalManager()
  vi.spyOn(manager, 'requestApproval').mockImplementation(
    async (request, _timeoutMs, onRequest) => {
      onRequest(request)
      // 自动批准
      const response: ApprovalResponse = {
        executionId: request.executionId,
        step: request.step,
        approved: true,
        reason: 'auto-approved',
      }
      return response
    },
  )
  return manager
}

function createAutoRejectManager(reason?: string): ApprovalManager {
  const manager = new ApprovalManager()
  vi.spyOn(manager, 'requestApproval').mockImplementation(
    async (request, _timeoutMs, onRequest) => {
      onRequest(request)
      const response: ApprovalResponse = {
        executionId: request.executionId,
        step: request.step,
        approved: false,
        reason: reason ?? 'rejected',
      }
      return response
    },
  )
  return manager
}

function createWrapOptions(overrides?: Partial<ToolWrapOptions>): ToolWrapOptions {
  return {
    approvalMode: 'full-auto',
    approvalManager: createAutoApproveManager(),
    approvalTimeoutMs: 5000,
    callbacks: createMockCallbacks(),
    executionId: 'exec-1',
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('wrapTool', () => {
  let callbacks: AgentEventCallbacks

  beforeEach(() => {
    callbacks = createMockCallbacks()
    vi.clearAllMocks()
  })

  describe('工具执行', () => {
    it('应正确执行工具并返回 content', async () => {
      const tool = createFakeTool('file_read', 'low', {
        isError: false,
        content: 'file content here',
      })
      const options = createWrapOptions({ callbacks })
      const wrapped = wrapTool(tool, options)

      const result = await wrapped.execute({ path: '/test.txt' })

      expect(result).toBe('file content here')
      expect(tool.execute).toHaveBeenCalledWith({ path: '/test.txt' })
    })

    it('应保留工具的 name、description 和 inputSchema', () => {
      const tool = createFakeTool('web_search', 'low')
      const wrapped = wrapTool(tool, createWrapOptions())

      expect(wrapped.name).toBe('web_search')
      expect(wrapped.description).toBe('Fake tool: web_search')
      expect(wrapped.inputSchema).toEqual({ type: 'object', properties: {} })
    })

    it('工具返回错误结果时仍应返回 content', async () => {
      const tool = createFakeTool('web_search', 'low', {
        isError: true,
        content: 'Network error',
      })
      const wrapped = wrapTool(tool, createWrapOptions({ callbacks }))

      const result = await wrapped.execute({ query: 'test' })

      expect(result).toBe('Network error')
    })
  })

  describe('审批检查', () => {
    it('不需要审批的工具应直接执行', async () => {
      const tool = createFakeTool('file_read', 'low')
      const approvalManager = createAutoApproveManager()
      const requestApprovalSpy = vi.spyOn(approvalManager, 'requestApproval')
      const options = createWrapOptions({
        approvalMode: 'full-auto',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      await wrapped.execute({ path: '/test' })

      // low 风险 + full-auto 模式 = 不需要审批
      expect(requestApprovalSpy).not.toHaveBeenCalled()
      expect(tool.execute).toHaveBeenCalled()
    })

    it('需要审批时应调用 approvalManager.requestApproval', async () => {
      const tool = createFakeTool('file_write', 'medium')
      const approvalManager = createAutoApproveManager()
      const requestApprovalSpy = vi.spyOn(approvalManager, 'requestApproval')
      const options = createWrapOptions({
        approvalMode: 'suggest',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      await wrapped.execute({ content: 'data' })

      expect(requestApprovalSpy).toHaveBeenCalledTimes(1)
      const [request, timeoutMs, onRequest] = requestApprovalSpy.mock.calls[0]
      expect(request.executionId).toBe('exec-1')
      expect(request.toolAction.toolName).toBe('file_write')
      expect(request.toolAction.riskLevel).toBe('medium')
      expect(timeoutMs).toBe(5000)
      expect(onRequest).toBe(callbacks.onApprovalRequest)
    })

    it('审批请求应通过 onApprovalRequest 回调推送', async () => {
      const tool = createFakeTool('file_write', 'medium')
      const options = createWrapOptions({
        approvalMode: 'suggest',
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      await wrapped.execute({ content: 'data' })

      expect(callbacks.onApprovalRequest).toHaveBeenCalledTimes(1)
      const request = (callbacks.onApprovalRequest as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(request.toolAction.toolName).toBe('file_write')
      expect(request.executionId).toBe('exec-1')
    })

    it('审批批准后应执行工具', async () => {
      const tool = createFakeTool('file_write', 'medium', {
        isError: false,
        content: 'written',
      })
      const approvalManager = createAutoApproveManager()
      const options = createWrapOptions({
        approvalMode: 'suggest',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      const result = await wrapped.execute({ content: 'data' })

      expect(result).toBe('written')
      expect(tool.execute).toHaveBeenCalledWith({ content: 'data' })
    })

    it('审批拒绝时应返回拒绝消息', async () => {
      const tool = createFakeTool('file_write', 'medium', {
        isError: false,
        content: 'written',
      })
      const approvalManager = createAutoRejectManager('denied by user')
      const options = createWrapOptions({
        approvalMode: 'suggest',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      const result = await wrapped.execute({ content: 'data' })

      expect(result).toContain('rejected')
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('审批超时应返回超时消息', async () => {
      const tool = createFakeTool('file_write', 'medium', {
        isError: false,
        content: 'written',
      })
      const approvalManager = createAutoRejectManager('TIMEOUT')
      const options = createWrapOptions({
        approvalMode: 'suggest',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      const result = await wrapped.execute({ content: 'data' })

      expect(result).toContain('timed out')
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('high 风险工具在 full-auto 模式下仍需审批', async () => {
      const tool = createFakeTool('terminal_exec', 'high')
      const approvalManager = createAutoApproveManager()
      const requestApprovalSpy = vi.spyOn(approvalManager, 'requestApproval')
      const options = createWrapOptions({
        approvalMode: 'full-auto',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      await wrapped.execute({ command: 'ls' })

      expect(requestApprovalSpy).toHaveBeenCalledTimes(1)
    })

    it('low 风险工具在 suggest 模式下需审批', async () => {
      const tool = createFakeTool('file_read', 'low')
      const approvalManager = createAutoApproveManager()
      const requestApprovalSpy = vi.spyOn(approvalManager, 'requestApproval')
      const options = createWrapOptions({
        approvalMode: 'suggest',
        approvalManager,
        callbacks,
      })
      const wrapped = wrapTool(tool, options)

      await wrapped.execute({ path: '/test' })

      expect(requestApprovalSpy).toHaveBeenCalledTimes(1)
    })
  })
})

describe('wrapAllTools', () => {
  it('应批量包装所有工具', () => {
    const tool1 = createFakeTool('file_read', 'low')
    const tool2 = createFakeTool('file_write', 'medium')
    const tool3 = createFakeTool('web_search', 'low')
    const tools = new Map<string, RegisteredTool>([
      ['file_read', tool1],
      ['file_write', tool2],
      ['web_search', tool3],
    ])
    const options = createWrapOptions()

    const wrapped = wrapAllTools(tools, options)

    expect(wrapped).toHaveLength(3)
    const names = wrapped.map((t) => t.name)
    expect(names).toContain('file_read')
    expect(names).toContain('file_write')
    expect(names).toContain('web_search')
  })

  it('空工具映射应返回空数组', () => {
    const options = createWrapOptions()

    const wrapped = wrapAllTools(new Map(), options)

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
    const options = createWrapOptions({ approvalMode: 'full-auto' })

    const wrapped = wrapAllTools(tools, options)
    const results = await Promise.all([wrapped[0].execute({}), wrapped[1].execute({})])

    expect(results).toContain('content1')
    expect(results).toContain('content2')
  })
})
