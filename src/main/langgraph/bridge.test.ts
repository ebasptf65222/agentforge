import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Phase 2 依赖（避免 electron / 数据库 / Copilot SDK 依赖） ──

vi.mock('../db/index', () => ({
  getDatabase: vi.fn(() => ({
    exec: vi.fn(),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => undefined), all: vi.fn(() => []) })),
  })),
}))

vi.mock('../db/repos/app-settings', () => ({
  getSettings: vi.fn(() => ({ approvalTimeoutMs: 10000, engineType: 'langgraph' })),
}))

vi.mock('../copilot/agent-bridge', () => ({
  CopilotAgentBridge: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ status: 'completed', summary: 'coding done' }),
    cancel: vi.fn(),
  })),
}))

vi.mock('../mcp/manager', () => ({
  getMcpServerManager: vi.fn(() => ({
    listServers: vi.fn(() => []),
  })),
}))

import { LangGraphAgentBridge } from './bridge'
import type { LangGraphBridgeConfig, LangGraphExecuteParams } from './types'
import type { ModelAdapter, StreamChunk } from '../models/adapter'
import type { RegisteredTool } from '../tools/types'
import type { AgentEventCallbacks } from '../agent/types'
import type { AgentExecutionRequest, ToolRiskLevel } from '@shared/types'

// ─── Fake 工厂 ──────────────────────────────────────────────────

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

// 每次 streamChat 调用返回一个 output（按 callIndex 递增）
function createFakeAdapter(outputs: string[]): ModelAdapter {
  let callIndex = 0
  return {
    streamChat: async function* (): AsyncGenerator<StreamChunk, void, unknown> {
      const output = outputs[callIndex++] ?? ''
      yield { type: 'text', content: output }
    },
  } as unknown as ModelAdapter
}

// 带延迟的 adapter，每次 streamChat 调用等待 delayMs 后返回一个 output
function createDelayedAdapter(outputs: string[], delayMs: number): ModelAdapter {
  let callIndex = 0
  return {
    streamChat: async function* (): AsyncGenerator<StreamChunk, void, unknown> {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      const output = outputs[callIndex++] ?? ''
      yield { type: 'text', content: output }
    },
  } as unknown as ModelAdapter
}

function createFakeTool(
  name: string,
  riskLevel: ToolRiskLevel,
  content = 'result',
): RegisteredTool {
  return {
    definition: {
      name,
      description: `Fake: ${name}`,
      inputSchema: { type: 'object', properties: {} },
      riskLevel,
      source: 'builtin',
    },
    execute: vi.fn().mockResolvedValue({ isError: false, content }),
    source: 'builtin',
  }
}

function createExecuteParams(
  adapter: ModelAdapter,
  tools: Map<string, RegisteredTool>,
  overrides?: {
    userInput?: string
    approvalMode?: AgentExecutionRequest['approvalMode']
    maxSteps?: number
  },
): LangGraphExecuteParams {
  const request: AgentExecutionRequest = {
    conversationId: 'conv-1',
    userInput: overrides?.userInput ?? 'test input',
    modelId: 'model-1',
    approvalMode: overrides?.approvalMode ?? 'full-auto',
    maxSteps: overrides?.maxSteps ?? 10,
  }
  return {
    request,
    adapter,
    tools,
    historyMessages: [],
  }
}

function createConfig(callbacks: AgentEventCallbacks): LangGraphBridgeConfig {
  return {
    callbacks,
    approvalTimeoutMs: 10000,
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('LangGraphAgentBridge', () => {
  let callbacks: AgentEventCallbacks

  beforeEach(() => {
    callbacks = createMockCallbacks()
    vi.clearAllMocks()
  })

  describe('execute 方法', () => {
    it('应正确调用并返回 ExecutionResult', async () => {
      const adapter = createFakeAdapter(['Final Answer: Task completed successfully.'])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const result = await bridge.execute(createExecuteParams(adapter, new Map()))

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Task completed successfully.')
      expect(result.executionId).toBe('conv-1')
      expect(result.trajectories).toHaveLength(1)
      expect(result.tokensUsed).toBeGreaterThan(0)
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('应推送流式 chunk 到回调', async () => {
      const adapter = createFakeAdapter(['Final Answer: Task completed.'])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      await bridge.execute(createExecuteParams(adapter, new Map()))

      expect(callbacks.onStreamChunk).toHaveBeenCalled()
    })

    it('应推送轨迹到回调', async () => {
      const adapter = createFakeAdapter(['Final Answer: Task completed.'])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      await bridge.execute(createExecuteParams(adapter, new Map()))

      expect(callbacks.onTrajectory).toHaveBeenCalled()
    })

    it('工具调用流程应正确执行', async () => {
      const tool = createFakeTool('file_read', 'low', 'file content')
      const tools = new Map<string, RegisteredTool>([['file_read', tool]])
      const adapter = createFakeAdapter([
        'Action: file_read\nArguments: {"path": "/tmp/test"}',
        'Final Answer: Read the file.',
      ])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const result = await bridge.execute(createExecuteParams(adapter, tools))

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Read the file.')
      expect(result.totalSteps).toBe(2)
      expect(tool.execute).toHaveBeenCalledWith({ path: '/tmp/test' })
    })

    it('应将历史消息和用户输入作为初始消息传递', async () => {
      const adapter = createFakeAdapter(['Final Answer: Done.'])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))
      const params = createExecuteParams(adapter, new Map(), { userInput: 'Hello agent' })
      params.historyMessages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Previous message' },
      ]

      const result = await bridge.execute(params)

      expect(result.status).toBe('completed')
    })

    it('多次 execute 应重置状态', async () => {
      const adapter1 = createFakeAdapter(['Final Answer: First run.'])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const result1 = await bridge.execute(createExecuteParams(adapter1, new Map()))

      const adapter2 = createFakeAdapter(['Final Answer: Second run.'])
      const result2 = await bridge.execute(createExecuteParams(adapter2, new Map()))

      expect(result1.status).toBe('completed')
      expect(result1.summary).toBe('First run.')
      expect(result2.status).toBe('completed')
      expect(result2.summary).toBe('Second run.')
    })
  })

  describe('cancel 方法', () => {
    it('cancel 应中止正在进行的执行', async () => {
      const adapter = createDelayedAdapter(
        ['Action: slow_tool\nArguments: {}', 'Final Answer: done.'],
        200,
      )
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const executePromise = bridge.execute(createExecuteParams(adapter, new Map()))

      // 等待执行开始后取消
      await new Promise((resolve) => setTimeout(resolve, 50))
      bridge.cancel()

      const result = await executePromise

      expect(result.status).toBe('cancelled')
    })

    it('cancel 后的 summary 应包含取消信息', async () => {
      const adapter = createDelayedAdapter(
        ['Action: slow_tool\nArguments: {}', 'Final Answer: done.'],
        200,
      )
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const executePromise = bridge.execute(createExecuteParams(adapter, new Map()))

      await new Promise((resolve) => setTimeout(resolve, 50))
      bridge.cancel()

      const result = await executePromise

      expect(result.summary).toContain('cancel')
    })

    it('无执行时调用 cancel 不应报错', () => {
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      expect(() => bridge.cancel()).not.toThrow()
    })
  })

  describe('respondApproval 方法', () => {
    it('respondApproval 批准后应继续执行工具', async () => {
      const tool = createFakeTool('file_write', 'medium', 'written')
      const tools = new Map<string, RegisteredTool>([['file_write', tool]])
      const adapter = createFakeAdapter([
        'Action: file_write\nArguments: {"content": "data"}',
        'Final Answer: File written.',
      ])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const executePromise = bridge.execute(
        createExecuteParams(adapter, tools, { approvalMode: 'suggest' }),
      )

      // 等待审批请求产生
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(bridge.hasPendingApproval()).toBe(true)

      // 批准审批
      bridge.respondApproval(true, 'approved')

      const result = await executePromise

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('File written.')
      expect(tool.execute).toHaveBeenCalledWith({ content: 'data' })
    })

    it('respondApproval 拒绝后应跳过工具执行', async () => {
      const tool = createFakeTool('file_write', 'medium', 'written')
      const tools = new Map<string, RegisteredTool>([['file_write', tool]])
      const adapter = createFakeAdapter([
        'Action: file_write\nArguments: {"content": "data"}',
        'Final Answer: Tool was rejected.',
      ])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const executePromise = bridge.execute(
        createExecuteParams(adapter, tools, { approvalMode: 'suggest' }),
      )

      // 等待审批请求产生
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(bridge.hasPendingApproval()).toBe(true)

      // 拒绝审批
      bridge.respondApproval(false, 'denied')

      const result = await executePromise

      expect(result.status).toBe('completed')
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('审批请求应通过 onApprovalRequest 回调推送', async () => {
      const tool = createFakeTool('file_write', 'medium', 'written')
      const tools = new Map<string, RegisteredTool>([['file_write', tool]])
      const adapter = createFakeAdapter([
        'Action: file_write\nArguments: {"content": "data"}',
        'Final Answer: Done.',
      ])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const executePromise = bridge.execute(
        createExecuteParams(adapter, tools, { approvalMode: 'suggest' }),
      )

      // 等待审批请求产生
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(callbacks.onApprovalRequest).toHaveBeenCalledTimes(1)
      const request = (callbacks.onApprovalRequest as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(request.toolAction.toolName).toBe('file_write')
      expect(request.executionId).toBe('conv-1')

      // 清理：批准审批以完成执行
      bridge.respondApproval(true, 'approved')
      await executePromise
    })
  })

  describe('hasPendingApproval 方法', () => {
    it('无执行时应返回 false', () => {
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      expect(bridge.hasPendingApproval()).toBe(false)
    })

    it('执行完成后应返回 false', async () => {
      const adapter = createFakeAdapter(['Final Answer: Done.'])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      await bridge.execute(createExecuteParams(adapter, new Map()))

      expect(bridge.hasPendingApproval()).toBe(false)
    })

    it('等待审批时应返回 true', async () => {
      const tool = createFakeTool('file_write', 'medium', 'written')
      const tools = new Map<string, RegisteredTool>([['file_write', tool]])
      const adapter = createFakeAdapter([
        'Action: file_write\nArguments: {"content": "data"}',
        'Final Answer: Done.',
      ])
      const bridge = new LangGraphAgentBridge(createConfig(callbacks))

      const executePromise = bridge.execute(
        createExecuteParams(adapter, tools, { approvalMode: 'suggest' }),
      )

      // 等待审批请求产生
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(bridge.hasPendingApproval()).toBe(true)

      // 清理：批准审批以完成执行
      bridge.respondApproval(true, 'approved')
      await executePromise

      expect(bridge.hasPendingApproval()).toBe(false)
    })
  })
})
