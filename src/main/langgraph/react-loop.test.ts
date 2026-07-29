import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReactLoop } from './react-loop'
import type { ReactLoopOptions } from './react-loop'
import { ModelWrapper } from './model-adapter'
import { EventConverter } from './event-converter'
import type { WrappedTool } from './tool-adapter'
import type { AgentEventCallbacks, AgentContextMessage } from '../agent/types'
import type { AgentExecutionRequest } from '@shared/types'

// ─── Fake 工厂 ──────────────────────────────────────────────────

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

// 创建按序返回多个 output 的 MockModelWrapper
function createMockModelWrapper(outputs: string[]): ModelWrapper {
  let callIndex = 0
  const invokeFn = vi.fn(async (): Promise<string> => {
    return outputs[callIndex++] ?? ''
  })
  // ModelWrapper.invoke 是实例方法，通过原型替换
  const wrapper = Object.create(ModelWrapper.prototype) as ModelWrapper
  wrapper.invoke = invokeFn
  return wrapper
}

// 创建带延迟的 MockModelWrapper，用于测试 cancel
function createDelayedModelWrapper(outputs: string[], delayMs: number): ModelWrapper {
  let callIndex = 0
  const invokeFn = vi.fn(async (_messages: AgentContextMessage[], abortSignal?: AbortSignal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs)
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer)
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }
    })
    return outputs[callIndex++] ?? ''
  })
  const wrapper = Object.create(ModelWrapper.prototype) as ModelWrapper
  wrapper.invoke = invokeFn
  return wrapper
}

function createFakeTool(name: string, result: string = 'tool result'): WrappedTool {
  return {
    name,
    description: `Fake: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue(result),
  }
}

function createRequest(overrides?: Partial<AgentExecutionRequest>): AgentExecutionRequest {
  return {
    conversationId: 'conv-1',
    userInput: 'test input',
    modelId: 'model-1',
    approvalMode: 'full-auto',
    maxSteps: 10,
    ...overrides,
  }
}

function createOptions(overrides?: Partial<ReactLoopOptions>): ReactLoopOptions {
  const callbacks = createMockCallbacks()
  const eventConverter = new EventConverter(callbacks)
  return {
    model: createMockModelWrapper(['Final Answer: Done.']),
    tools: [],
    eventConverter,
    maxSteps: 10,
    historyMessages: [],
    request: createRequest(),
    abortSignal: new AbortController().signal,
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('createReactLoop', () => {
  let callbacks: AgentEventCallbacks
  let eventConverter: EventConverter

  beforeEach(() => {
    callbacks = createMockCallbacks()
    eventConverter = new EventConverter(callbacks)
    vi.clearAllMocks()
  })

  describe('正常完成', () => {
    it('LLM 返回 Final Answer 时应正确完成', async () => {
      const model = createMockModelWrapper(['Final Answer: Task completed.'])
      const options = createOptions({
        model,
        eventConverter,
        abortSignal: new AbortController().signal,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Task completed.')
      expect(result.trajectories).toHaveLength(1)
      expect(result.trajectories[0].action).toBeNull()
      expect(result.trajectories[0].status).toBe('success')
    })

    it('工具调用时应推送 tool-start 和 tool-complete 事件到 onStreamChunk', async () => {
      const tool = createFakeTool('file_read', 'content')
      const model = createMockModelWrapper([
        'Action: file_read\nArguments: {"path": "/test"}',
        'Final Answer: Done.',
      ])
      const options = createOptions({
        model,
        tools: [tool],
        eventConverter,
      })

      await createReactLoop(options)

      expect(callbacks.onStreamChunk).toHaveBeenCalled()
      const chunks = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0],
      )
      expect(chunks.some((c) => c.type === 'tool-start')).toBe(true)
      expect(chunks.some((c) => c.type === 'tool-complete')).toBe(true)
    })

    it('应推送轨迹到回调', async () => {
      const model = createMockModelWrapper(['Final Answer: Done.'])
      const options = createOptions({
        model,
        eventConverter,
      })

      await createReactLoop(options)

      expect(callbacks.onTrajectory).toHaveBeenCalledTimes(1)
      const trajectory = (callbacks.onTrajectory as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(trajectory.observation).toBe('Done.')
    })

    it('执行完成后应返回正确的 executionId 和 duration', async () => {
      const model = createMockModelWrapper(['Final Answer: Done.'])
      const options = createOptions({ model, eventConverter })

      const result = await createReactLoop(options)

      expect(result.executionId).toBeTruthy()
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.tokensUsed).toBe(0)
    })
  })

  describe('工具调用流程', () => {
    it('应正确执行工具调用并继续到完成', async () => {
      const tool = createFakeTool('file_read', 'file content')
      const model = createMockModelWrapper([
        'Action: file_read\nArguments: {"path": "/test.txt"}',
        'Final Answer: Read the file.',
      ])
      const options = createOptions({
        model,
        tools: [tool],
        eventConverter,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('Read the file.')
      expect(result.totalSteps).toBe(2)
      expect(tool.execute).toHaveBeenCalledWith({ path: '/test.txt' })
    })

    it('工具执行结果应反馈到上下文', async () => {
      const tool = createFakeTool('web_search', 'search results')
      const invokeFn = vi.fn()
      let callIndex = 0
      const outputs = [
        'Action: web_search\nArguments: {"query": "test"}',
        'Final Answer: Found results.',
      ]
      invokeFn.mockImplementation(async (messages: AgentContextMessage[]) => {
        // 验证第二次调用时上下文中包含工具结果
        if (callIndex === 1) {
          const toolMessages = messages.filter((m) => m.role === 'tool')
          expect(toolMessages).toHaveLength(1)
          expect(toolMessages[0].content).toBe('search results')
        }
        return outputs[callIndex++] ?? ''
      })
      const model = Object.create(ModelWrapper.prototype) as ModelWrapper
      model.invoke = invokeFn

      const options = createOptions({
        model,
        tools: [tool],
        eventConverter,
      })

      await createReactLoop(options)

      expect(invokeFn).toHaveBeenCalledTimes(2)
    })

    it('应推送 tool-start 和 tool-complete 事件', async () => {
      const tool = createFakeTool('file_read', 'content')
      const model = createMockModelWrapper([
        'Action: file_read\nArguments: {"path": "/test"}',
        'Final Answer: Done.',
      ])
      const options = createOptions({
        model,
        tools: [tool],
        eventConverter,
      })

      await createReactLoop(options)

      const chunks = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0],
      )
      const toolStarts = chunks.filter((c) => c.type === 'tool-start')
      const toolCompletes = chunks.filter((c) => c.type === 'tool-complete')
      expect(toolStarts).toHaveLength(1)
      expect(toolStarts[0].content).toBe('file_read')
      expect(toolCompletes).toHaveLength(1)
      expect(toolCompletes[0].content).toBe('content')
    })

    it('连续多次工具调用应正确执行', async () => {
      const tool1 = createFakeTool('file_read', 'content1')
      const tool2 = createFakeTool('web_search', 'content2')
      const model = createMockModelWrapper([
        'Action: file_read\nArguments: {"path": "/a"}',
        'Action: web_search\nArguments: {"query": "test"}',
        'Final Answer: All done.',
      ])
      const options = createOptions({
        model,
        tools: [tool1, tool2],
        eventConverter,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(3)
      expect(tool1.execute).toHaveBeenCalledWith({ path: '/a' })
      expect(tool2.execute).toHaveBeenCalledWith({ query: 'test' })
    })
  })

  describe('工具不存在时的错误处理', () => {
    it('工具不存在时应推送 error 轨迹并继续', async () => {
      const model = createMockModelWrapper([
        'Action: nonexistent_tool\nArguments: {}',
        'Final Answer: Could not complete.',
      ])
      const options = createOptions({
        model,
        tools: [],
        eventConverter,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(2)
      expect(result.trajectories[0].status).toBe('error')
      expect(result.trajectories[0].observation).toContain('not found')
    })

    it('工具不存在时应将错误信息反馈到上下文', async () => {
      const invokeFn = vi.fn()
      let callIndex = 0
      const outputs = ['Action: missing_tool\nArguments: {}', 'Final Answer: Done.']
      invokeFn.mockImplementation(async (messages: AgentContextMessage[]) => {
        if (callIndex === 1) {
          const toolMessages = messages.filter((m) => m.role === 'tool')
          expect(toolMessages).toHaveLength(1)
          expect(toolMessages[0].content).toContain('not found')
        }
        return outputs[callIndex++] ?? ''
      })
      const model = Object.create(ModelWrapper.prototype) as ModelWrapper
      model.invoke = invokeFn

      const options = createOptions({
        model,
        tools: [],
        eventConverter,
      })

      await createReactLoop(options)

      expect(invokeFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('maxSteps 限制', () => {
    it('达到 maxSteps 时应标记为 failed', async () => {
      // LLM 一直调用工具，不返回 Final Answer
      const outputs: string[] = []
      for (let i = 0; i < 5; i++) {
        outputs.push(`Action: file_read\nArguments: {"step": ${i}}`)
      }
      const tool = createFakeTool('file_read', 'result')
      const model = createMockModelWrapper(outputs)
      const options = createOptions({
        model,
        tools: [tool],
        eventConverter,
        maxSteps: 3,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('failed')
      expect(result.totalSteps).toBe(3)
    })

    it('maxSteps = 1 时应只执行一步', async () => {
      const model = createMockModelWrapper([
        'Action: file_read\nArguments: {}',
        'Final Answer: Done.',
      ])
      const tool = createFakeTool('file_read')
      const options = createOptions({
        model,
        tools: [tool],
        eventConverter,
        maxSteps: 1,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('failed')
      expect(result.totalSteps).toBe(1)
    })
  })

  describe('cancel 通过 abortSignal', () => {
    it('abortSignal 已中止时应返回 cancelled 状态', async () => {
      const controller = new AbortController()
      controller.abort()
      const model = createMockModelWrapper(['Final Answer: Done.'])
      const options = createOptions({
        model,
        eventConverter,
        abortSignal: controller.signal,
      })

      const result = await createReactLoop(options)

      expect(result.status).toBe('cancelled')
    })

    it('执行过程中 abort 应中止执行', async () => {
      const controller = new AbortController()
      const model = createDelayedModelWrapper(
        ['Action: slow_tool\nArguments: {}', 'Final Answer: done.'],
        200,
      )
      const options = createOptions({
        model,
        eventConverter,
        abortSignal: controller.signal,
      })

      // 延迟后中止
      setTimeout(() => controller.abort(), 50)

      const result = await createReactLoop(options)

      expect(result.status).toBe('cancelled')
    })
  })

  describe('skillPrompt', () => {
    it('应将 skillPrompt 注入到系统提示词中', async () => {
      const capturedMessages: AgentContextMessage[][] = []
      const invokeFn = vi.fn(async (messages: AgentContextMessage[]) => {
        capturedMessages.push([...messages])
        return 'Final Answer: Done.'
      })
      const model = Object.create(ModelWrapper.prototype) as ModelWrapper
      model.invoke = invokeFn
      const options = createOptions({
        model,
        eventConverter,
        skillPrompt: 'You are a code reviewer.',
      })

      await createReactLoop(options)

      const messages = capturedMessages[0]
      const systemMessage = messages.find((m) => m.role === 'system')
      expect(systemMessage).toBeTruthy()
      expect(systemMessage?.content).toContain('You are a code reviewer.')
    })
  })

  describe('historyMessages', () => {
    it('应将历史消息注入到上下文中', async () => {
      const capturedMessages: AgentContextMessage[][] = []
      const invokeFn = vi.fn(async (messages: AgentContextMessage[]) => {
        // 捕获快照，避免后续 push 修改影响断言
        capturedMessages.push([...messages])
        return 'Final Answer: Done.'
      })
      const model = Object.create(ModelWrapper.prototype) as ModelWrapper
      model.invoke = invokeFn
      const historyMessages: AgentContextMessage[] = [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ]
      const options = createOptions({
        model,
        eventConverter,
        historyMessages,
      })

      await createReactLoop(options)

      const messages = capturedMessages[0]
      // system + 2 history + user = 4
      expect(messages).toHaveLength(4)
      expect(messages[1].content).toBe('Previous question')
      expect(messages[2].content).toBe('Previous answer')
      expect(messages[3].role).toBe('user')
    })
  })
})
