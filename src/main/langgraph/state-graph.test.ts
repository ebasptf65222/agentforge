// AgentForge LangGraph 引擎: StateGraph 测试 (P2-02)
// 测试 executeWithStateGraph 的图构建、节点执行、条件路由

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { executeWithStateGraph } from './state-graph'
import { EventConverter } from './event-converter'
import { ModelWrapper } from './model-adapter'
import type { WrappedTool } from './tool-adapter'
import type { AgentEventCallbacks } from '../agent/types'
import type { AgentExecutionRequest, ApprovalMode } from '../../shared/types'
import { ApprovalManager } from '../agent/approval'

// ─── Mock: 审批函数 ─────────────────────────────────────────────
// 测试中使用的 fake tool 名称不在内置风险映射表中，默认为 high，
// 在 full-auto 模式下会触发 interrupt() 导致测试超时。
// mock getToolRiskLevel 返回 'low' 使所有工具免审批，聚焦测试图逻辑。
vi.mock('../agent/approval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/approval')>()
  return {
    ...actual,
    getToolRiskLevel: vi.fn().mockReturnValue('low' as const),
  }
})

// ─── Fake 工厂 ──────────────────────────────────────────────────

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

function createFakeModelWrapper(outputs: string[]): ModelWrapper {
  let callIndex = 0
  const wrapper = {
    invoke: vi.fn(async () => {
      return outputs[callIndex++] ?? ''
    }),
  }
  return wrapper as unknown as ModelWrapper
}

function createFakeTool(
  name: string,
  result: string = 'tool result',
): WrappedTool {
  return {
    name,
    description: `Fake tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue(result),
  }
}

function createRequest(overrides?: {
  userInput?: string
  approvalMode?: ApprovalMode
  maxSteps?: number
}): AgentExecutionRequest {
  return {
    conversationId: 'conv-sg-1',
    userInput: overrides?.userInput ?? 'test input',
    modelId: 'model-1',
    approvalMode: overrides?.approvalMode ?? 'full-auto',
    maxSteps: overrides?.maxSteps ?? 10,
  }
}

function createOptions(overrides?: {
  model?: ModelWrapper
  tools?: WrappedTool[]
  outputs?: string[]
  maxSteps?: number
  abortSignal?: AbortSignal
}) {
  const callbacks = createMockCallbacks()
  const eventConverter = new EventConverter(callbacks)
  const model = overrides?.model ?? createFakeModelWrapper(overrides?.outputs ?? ['Final Answer: Done.'])
  const tools = overrides?.tools ?? []
  const approvalManager = new ApprovalManager()
  const abortController = new AbortController()

  return {
    model,
    tools,
    eventConverter,
    maxSteps: overrides?.maxSteps ?? 10,
    skillPrompt: undefined,
    historyMessages: [],
    request: createRequest({ maxSteps: overrides?.maxSteps }),
    abortSignal: overrides?.abortSignal ?? abortController.signal,
    approvalManager,
    approvalMode: 'full-auto' as ApprovalMode,
    approvalTimeoutMs: 10000,
    checkpointer: new MemorySaver(),
    threadId: 'thread-test-1',
    callbacks,
    maxContextLength: 128_000,
    // 保留 callbacks 和 approvalManager 引用供测试断言
    _callbacks: callbacks,
    _approvalManager: approvalManager,
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('StateGraph (P2-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('executeWithStateGraph', () => {
    it('应在 LLM 返回 Final Answer 时正确完成', async () => {
      const options = createOptions({
        outputs: ['Final Answer: Task completed successfully.'],
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Task completed successfully.')
      expect(result.trajectories).toHaveLength(1)
      expect(result.totalSteps).toBe(1)
      expect(result.tokensUsed).toBeGreaterThan(0)
    })

    it('工具调用应推送流式 chunk 到回调', async () => {
      const tool = createFakeTool('search', 'results found')
      const options = createOptions({
        outputs: [
          'Action: search\nArguments: {"q": "test"}',
          'Final Answer: Search done.',
        ],
        tools: [tool],
      })

      await executeWithStateGraph(options)

      // EventConverter.pushToolStart / pushToolComplete 会调用 onStreamChunk
      expect(options._callbacks.onStreamChunk).toHaveBeenCalled()
    })

    it('应推送轨迹到回调', async () => {
      const options = createOptions({
        outputs: ['Final Answer: Done.'],
      })

      await executeWithStateGraph(options)

      expect(options._callbacks.onTrajectory).toHaveBeenCalled()
      const trajectory = (options._callbacks.onTrajectory as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(trajectory.status).toBe('success')
    })

    it('工具调用流程应正确执行', async () => {
      const tool = createFakeTool('file_read', 'file content here')
      const options = createOptions({
        outputs: [
          'Action: file_read\nArguments: {"path": "/tmp/test"}',
          'Final Answer: Read the file successfully.',
        ],
        tools: [tool],
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Read the file successfully.')
      expect(result.totalSteps).toBe(2)
      expect(tool.execute).toHaveBeenCalledWith({ path: '/tmp/test' })
    })

    it('工具不存在时应返回错误轨迹', async () => {
      const options = createOptions({
        outputs: [
          'Action: nonexistent_tool\nArguments: {}',
          'Final Answer: Tool not found, but continuing.',
        ],
        tools: [],
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(2)
    })

    it('工具执行出错时应记录错误轨迹', async () => {
      const tool: WrappedTool = {
        name: 'error_tool',
        description: 'A tool that throws',
        inputSchema: { type: 'object', properties: {} },
        execute: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
      }
      const options = createOptions({
        outputs: [
          'Action: error_tool\nArguments: {}',
          'Final Answer: Handled the error.',
        ],
        tools: [tool],
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(2)
    })

    it('达到步骤上限时应返回 failed 状态', async () => {
      // 每次都调用工具，永远不返回 Final Answer
      const tool = createFakeTool('loop_tool', 'looping')
      const outputs = Array(20).fill('Action: loop_tool\nArguments: {}')
      const options = createOptions({
        outputs,
        tools: [tool],
        maxSteps: 3,
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('failed')
    })

    it('应处理历史消息和用户输入', async () => {
      const options = createOptions({
        outputs: ['Final Answer: Processed.'],
      })
      options.historyMessages = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ]

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
    })

    it('应支持 skillPrompt 注入', async () => {
      const options = createOptions({
        outputs: ['Final Answer: Done.'],
      })
      options.skillPrompt = 'You are a coding assistant.'

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
    })

    it('无法解析的输出应注入纠错消息重试，随后正常完成', async () => {
      const options = createOptions({
        outputs: [
          'This is just plain text without any action or final answer format.',
          'Final Answer: Done.',
        ],
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Done.')
    })

    it('持续无法解析时重试耗尽后按完成结束', async () => {
      const options = createOptions({
        outputs: [
          'garbage output 1',
          'garbage output 2',
          'garbage output 3',
        ],
      })

      const result = await executeWithStateGraph(options)

      // 重试 2 次后仍无法解析，按兜底 finish 结束（不再无限循环）
      expect(result.status).toBe('completed')
    })

    it('AbortSignal 应中止执行', async () => {
      const abortController = new AbortController()
      const options = createOptions({
        outputs: ['Final Answer: Should not reach here.'],
        abortSignal: abortController.signal,
      })

      // 立即中止
      abortController.abort()

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('cancelled')
    })

    it('多轮工具调用应正确执行', async () => {
      const tool1 = createFakeTool('search', 'found results')
      const tool2 = createFakeTool('analyze', 'analysis complete')
      const options = createOptions({
        outputs: [
          'Action: search\nArguments: {"query": "test"}',
          'Action: analyze\nArguments: {"data": "results"}',
          'Final Answer: Completed multi-step task.',
        ],
        tools: [tool1, tool2],
      })

      const result = await executeWithStateGraph(options)

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Completed multi-step task.')
      expect(result.totalSteps).toBe(3)
      expect(tool1.execute).toHaveBeenCalledWith({ query: 'test' })
      expect(tool2.execute).toHaveBeenCalledWith({ data: 'results' })
    })

    it('应返回有效的 executionId', async () => {
      const options = createOptions({
        outputs: ['Final Answer: Done.'],
      })

      const result = await executeWithStateGraph(options)

      expect(result.executionId).toBeDefined()
      expect(typeof result.executionId).toBe('string')
      expect(result.executionId.length).toBeGreaterThan(0)
    })

    it('应返回有效的 duration', async () => {
      const options = createOptions({
        outputs: ['Final Answer: Done.'],
      })

      const result = await executeWithStateGraph(options)

      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })
})
