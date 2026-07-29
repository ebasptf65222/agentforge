// AgentForge LangGraph 引擎: MCP 适配器测试 (P2-01)
// 测试 langchain-mcp-adapters 集成和工具转换

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  convertLangChainToolToWrapped,
  convertAllLangChainTools,
  loadMcpToolsAsLangChain,
  closeMcpClient,
} from './mcp-adapter'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import type { ToolWrapOptions } from './tool-adapter'
import { ApprovalManager } from '../agent/approval'
import { resetMcpServerManager } from '../mcp/manager'

// ─── Mock 工厂 ──────────────────────────────────────────────────

function createMockCallbacks() {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

function createWrapOptions(approvalMode: 'suggest' | 'auto-edit' | 'full-auto' = 'full-auto'): ToolWrapOptions {
  return {
    approvalMode,
    approvalManager: new ApprovalManager(),
    approvalTimeoutMs: 5000,
    callbacks: createMockCallbacks(),
    executionId: 'test-exec-1',
  }
}

function createMockDynamicTool(name: string, result: string = 'tool result'): DynamicStructuredTool {
  return {
    name,
    description: `Mock tool: ${name}`,
    schema: { type: 'object', properties: {} } as Record<string, unknown>,
    invoke: vi.fn().mockResolvedValue(result),
  } as unknown as DynamicStructuredTool
}

// ─── Tests ──────────────────────────────────────────────────────

describe('MCP Adapter (P2-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMcpServerManager()
  })

  afterEach(async () => {
    await closeMcpClient()
  })

  describe('convertLangChainToolToWrapped', () => {
    it('应正确转换工具名称和描述', () => {
      const tool = createMockDynamicTool('search_web')
      const wrapped = convertLangChainToolToWrapped(tool, createWrapOptions())

      expect(wrapped.name).toBe('search_web')
      expect(wrapped.description).toBe('Mock tool: search_web')
    })

    it('应保留输入 schema', () => {
      const tool = createMockDynamicTool('test_tool')
      const wrapped = convertLangChainToolToWrapped(tool, createWrapOptions())

      expect(wrapped.inputSchema).toBeDefined()
      expect(wrapped.inputSchema).toHaveProperty('type', 'object')
    })

    it('full-auto 模式下 high 风险工具仍需审批（审批矩阵规定）', async () => {
      const approvalManager = new ApprovalManager()
      const callbacks = createMockCallbacks()
      const options: ToolWrapOptions = {
        approvalMode: 'full-auto',
        approvalManager,
        approvalTimeoutMs: 5000,
        callbacks,
        executionId: 'test-exec-fa',
      }

      const tool = createMockDynamicTool('mcp_tool', 'mcp result')
      const wrapped = convertLangChainToolToWrapped(tool, options)

      // 后台自动批准
      setTimeout(() => approvalManager.respond(true, 'auto-approved'), 10)

      const result = await wrapped.execute({})
      expect(result).toBe('mcp result')
      expect(callbacks.onApprovalRequest).toHaveBeenCalledTimes(1)
    })

    it('suggest 模式下 high 风险工具应触发审批', async () => {
      const approvalManager = new ApprovalManager()
      const callbacks = createMockCallbacks()
      const options: ToolWrapOptions = {
        approvalMode: 'suggest',
        approvalManager,
        approvalTimeoutMs: 5000,
        callbacks,
        executionId: 'test-exec-2',
      }

      const tool = createMockDynamicTool('dangerous_tool', 'executed')
      const wrapped = convertLangChainToolToWrapped(tool, options)

      // 在后台自动批准
      setTimeout(() => approvalManager.respond(true, 'auto-approved'), 10)

      const result = await wrapped.execute({ input: 'test' })
      expect(result).toBe('executed')
      expect(callbacks.onApprovalRequest).toHaveBeenCalledTimes(1)
      const request = callbacks.onApprovalRequest.mock.calls[0][0]
      expect(request.toolAction.toolName).toBe('dangerous_tool')
    })

    it('suggest 模式下审批被拒绝时应返回拒绝消息', async () => {
      const approvalManager = new ApprovalManager()
      const callbacks = createMockCallbacks()
      const options: ToolWrapOptions = {
        approvalMode: 'suggest',
        approvalManager,
        approvalTimeoutMs: 5000,
        callbacks,
        executionId: 'test-exec-3',
      }

      const tool = createMockDynamicTool('blocked_tool', 'should not run')
      const wrapped = convertLangChainToolToWrapped(tool, options)

      // 在后台拒绝
      setTimeout(() => approvalManager.respond(false, 'denied'), 10)

      const result = await wrapped.execute({})
      expect(result).toContain('rejected')
      // 工具不应该被调用
      expect(tool.invoke).not.toHaveBeenCalled()
    })

    it('应处理工具返回非字符串结果', async () => {
      const approvalManager = new ApprovalManager()
      const options: ToolWrapOptions = {
        approvalMode: 'full-auto',
        approvalManager,
        approvalTimeoutMs: 5000,
        callbacks: createMockCallbacks(),
        executionId: 'test-exec-obj',
      }

      const tool = createMockDynamicTool('object_tool')
      ;(tool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'complex' })

      const wrapped = convertLangChainToolToWrapped(tool, options)

      // 后台自动批准
      setTimeout(() => approvalManager.respond(true, 'auto-approved'), 10)

      const result = await wrapped.execute({})
      // 非字符串结果应被 JSON.stringify
      expect(result).toBe(JSON.stringify({ data: 'complex' }))
    })
  })

  describe('convertAllLangChainTools', () => {
    it('应批量转换工具数组', () => {
      const tools = [
        createMockDynamicTool('tool_a'),
        createMockDynamicTool('tool_b'),
        createMockDynamicTool('tool_c'),
      ]
      const wrapped = convertAllLangChainTools(tools, createWrapOptions())

      expect(wrapped).toHaveLength(3)
      expect(wrapped[0].name).toBe('tool_a')
      expect(wrapped[1].name).toBe('tool_b')
      expect(wrapped[2].name).toBe('tool_c')
    })

    it('空数组应返回空数组', () => {
      const wrapped = convertAllLangChainTools([], createWrapOptions())
      expect(wrapped).toHaveLength(0)
    })
  })

  describe('loadMcpToolsAsLangChain', () => {
    it('无 MCP Server 配置时应返回空数组', async () => {
      // MCP Server Manager 未加载任何配置
      const tools = await loadMcpToolsAsLangChain()
      expect(tools).toEqual([])
    })
  })

  describe('closeMcpClient', () => {
    it('无客户端时调用不应报错', async () => {
      await expect(closeMcpClient()).resolves.not.toThrow()
    })
  })
})
