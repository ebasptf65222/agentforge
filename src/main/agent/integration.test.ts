// AgentForge P2-11: P2 集成测试与闭环验证
// 验证完整 Agent 执行闭环：ReAct 循环 → 工具调用 → 审批 → TAO 轨迹
// 对应 M2 里程碑验收标准

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  AgentExecutionRequest,
  TAOTrajectory,
  ApprovalRequest,
  ToolExecutionResult,
  StreamChunk,
  ApprovalMode,
} from '@shared/types'
import type { AdapterMessage } from '../models/adapter'
import { AgentExecutor, type AgentExecutorConfig } from './executor'
import type { RegisteredTool, AgentEventCallbacks } from './types'
import { shouldRequireApproval, buildToolAction } from './approval'
import { parseLLMOutput } from './parser'
import { getToolRegistry, resetToolRegistry, ToolRegistry } from '../tools/registry'
import type { BuiltinTool } from '../tools/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock ModelAdapter ───────────────────────────────────────────

/**
 * 可控的 Mock ModelAdapter。
 * 按预设序列返回 LLM 输出，模拟 ReAct 循环中的多步推理。
 */
class MockModelAdapter {
  private responses: string[]
  private callIndex = 0

  constructor(responses: string[]) {
    this.responses = responses
  }

  async *streamChat(
    _messages: AdapterMessage[],
    _abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const response = this.responses[this.callIndex] ?? ''
    this.callIndex++
    for (const char of response) {
      yield { type: 'text', content: char }
    }
  }

  getCallCount(): number {
    return this.callIndex
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────

/** 构造 Thought + Tool Action 的 LLM 输出 */
function makeToolResponse(thought: string, tool: string, args: Record<string, unknown>): string {
  return `Thought: ${thought}\nAction: ${JSON.stringify({ type: 'tool', tool, arguments: args })}`
}

/** 构造 Thought + Finish 的 LLM 输出 */
function makeFinishResponse(thought: string, summary: string): string {
  return `Thought: ${thought}\nAction: ${JSON.stringify({ type: 'finish', summary })}`
}

/** 创建 mock 工具 */
function createMockTool(
  name: string,
  riskLevel: 'low' | 'medium' | 'high',
  result: ToolExecutionResult = { isError: false, content: 'OK' },
): BuiltinTool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      inputSchema: { type: 'object' },
      riskLevel,
      source: 'builtin',
    },
    execute: vi.fn().mockResolvedValue(result),
  }
}

/** 创建事件回调收集器 */
function createCallbackCollector(): {
  callbacks: AgentEventCallbacks
  trajectories: TAOTrajectory[]
  approvalRequests: ApprovalRequest[]
  streamChunks: { type: string; content: string }[]
} {
  const trajectories: TAOTrajectory[] = []
  const approvalRequests: ApprovalRequest[] = []
  const streamChunks: { type: string; content: string }[] = []

  const callbacks: AgentEventCallbacks = {
    onTrajectory: (t) => trajectories.push(t),
    onApprovalRequest: (r) => approvalRequests.push(r),
    onStreamChunk: (c) => streamChunks.push(c),
  }

  return { callbacks, trajectories, approvalRequests, streamChunks }
}

/** 创建执行器配置 */
function createExecutorConfig(
  adapter: MockModelAdapter,
  tools: Map<string, RegisteredTool>,
  callbacks: AgentEventCallbacks,
  overrides: Partial<AgentExecutorConfig> = {},
): AgentExecutorConfig {
  return {
    adapter: adapter as unknown as AgentExecutorConfig['adapter'],
    tools,
    callbacks,
    approvalTimeoutMs: 5000,
    maxContextLength: 4096,
    ...overrides,
  }
}

/** 创建执行请求 */
function createRequest(overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
  return {
    conversationId: 'conv-test',
    userInput: '帮我搜索 Vue 3 最新动态并总结成笔记',
    modelId: 'test-model',
    approvalMode: 'auto-edit',
    maxSteps: 10,
    ...overrides,
  }
}

/** 从 ToolRegistry 构建工具映射 */
function buildToolsMap(registry: ToolRegistry): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>()
  for (const t of registry.list()) {
    tools.set(t.definition.name, { definition: t.definition, execute: t.execute })
  }
  return tools
}

// ─── 集成测试 ─────────────────────────────────────────────────────

describe('P2 Integration: Agent ReAct 闭环', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    resetToolRegistry()
    registry = getToolRegistry()
  })

  afterEach(() => {
    resetToolRegistry()
  })

  // ─── 场景 1: 完整 ReAct 循环（搜索 → 抓取 → 写文件 → 完成） ────

  describe('完整 ReAct 循环 (M2 验收场景)', () => {
    it('应完成 搜索→抓取→写文件→完成 的完整流程', async () => {
      const webSearch = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Vue 3.5 released with new features',
      })
      const webScrape = createMockTool('web_scrape', 'low', {
        isError: false,
        content: 'Vue 3.5 introduces useTemplateRef, Reactive Props Destructure',
      })
      const fileWrite = createMockTool('file_write', 'medium', {
        isError: false,
        content: 'File saved to /tmp/vue3-notes.md',
      })

      registry.registerBuiltin(webSearch)
      registry.registerBuiltin(webScrape)
      registry.registerBuiltin(fileWrite)
      const tools = buildToolsMap(registry)

      const adapter = new MockModelAdapter([
        makeToolResponse('我需要先搜索 Vue 3 的最新动态', 'web_search', { query: 'Vue 3 latest news' }),
        makeToolResponse('搜索结果有 Vue 3.5 发布信息，我需要抓取详细内容', 'web_scrape', { url: 'https://vuejs.org' }),
        makeToolResponse('已获取详细信息，现在将笔记保存到文件', 'file_write', { path: '/tmp/vue3-notes.md', content: 'Vue 3.5 笔记' }),
        makeFinishResponse('任务已完成，笔记已保存', '已搜索 Vue 3 最新动态并保存笔记到 /tmp/vue3-notes.md'),
      ])

      const { callbacks, approvalRequests, streamChunks } = createCallbackCollector()

      // auto-edit 模式下 file_write 需要审批 → 自动批准
      const customCallbacks: AgentEventCallbacks = {
        ...callbacks,
        onApprovalRequest: (request) => {
          approvalRequests.push(request)
          setTimeout(() => executor.respondApproval(true), 0)
        },
      }

      const config = createExecutorConfig(adapter, tools, customCallbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'auto-edit' })
      const result = await executor.execute(request)

      // 验证最终结果
      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(4)
      expect(result.summary).toContain('已搜索 Vue 3 最新动态')
      expect(result.duration).toBeGreaterThan(0)

      // 验证 TAO 轨迹完整（executor 本地数组，每步一个）
      expect(result.trajectories).toHaveLength(4)

      // Step 1: web_search (low risk, auto-edit → 不需要审批)
      const t1 = result.trajectories[0]
      expect(t1.step).toBe(1)
      expect(t1.thought).toContain('搜索 Vue 3')
      expect(t1.action?.toolName).toBe('web_search')
      expect(t1.status).toBe('success')
      expect(t1.observation).toContain('Vue 3.5 released')

      // Step 2: web_scrape (low risk, auto-edit → 不需要审批)
      const t2 = result.trajectories[1]
      expect(t2.step).toBe(2)
      expect(t2.action?.toolName).toBe('web_scrape')
      expect(t2.status).toBe('success')

      // Step 3: file_write (medium risk, auto-edit → 需要审批)
      const t3 = result.trajectories[2]
      expect(t3.step).toBe(3)
      expect(t3.action?.toolName).toBe('file_write')
      expect(t3.action?.riskLevel).toBe('medium')
      expect(t3.status).toBe('success')
      expect(t3.observation).toContain('File saved')

      // Step 4: finish
      const t4 = result.trajectories[3]
      expect(t4.step).toBe(4)
      expect(t4.action).toBeNull()
      expect(t4.status).toBe('success')

      // 验证审批请求：auto-edit 模式下只有 file_write 需要审批
      expect(approvalRequests).toHaveLength(1)
      expect(approvalRequests[0].toolAction.toolName).toBe('file_write')

      // 验证工具被调用
      expect(webSearch.execute).toHaveBeenCalledTimes(1)
      expect(webScrape.execute).toHaveBeenCalledTimes(1)
      expect(fileWrite.execute).toHaveBeenCalledTimes(1)

      // 验证流式输出
      expect(streamChunks.length).toBeGreaterThan(0)
    })

    it('应在 suggest 模式下对所有工具触发审批', async () => {
      const webSearch = createMockTool('web_search', 'low')
      registry.registerBuiltin(webSearch)
      const tools = buildToolsMap(registry)

      const adapter = new MockModelAdapter([
        makeToolResponse('搜索', 'web_search', { query: 'test' }),
        makeFinishResponse('完成', '已完成'),
      ])

      const { callbacks, approvalRequests } = createCallbackCollector()

      // suggest 模式下所有工具都需要审批 → 自动批准
      const customCallbacks: AgentEventCallbacks = {
        ...callbacks,
        onApprovalRequest: (request) => {
          approvalRequests.push(request)
          setTimeout(() => executor.respondApproval(true), 0)
        },
      }

      const config = createExecutorConfig(adapter, tools, customCallbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'suggest' })
      const result = await executor.execute(request)

      expect(result.status).toBe('completed')
      expect(approvalRequests).toHaveLength(1)
      expect(approvalRequests[0].toolAction.toolName).toBe('web_search')
      expect(result.trajectories[0].status).toBe('success')
    })

    it('应在 full-auto 模式下仅对 high risk 工具触发审批', async () => {
      const webSearch = createMockTool('web_search', 'low')
      const fileWrite = createMockTool('file_write', 'medium')
      const mcpTool = createMockTool('mcp_custom', 'high')

      const tools = new Map<string, RegisteredTool>()
      tools.set('web_search', { definition: webSearch.definition, execute: webSearch.execute })
      tools.set('file_write', { definition: fileWrite.definition, execute: fileWrite.execute })
      tools.set('mcp_custom', { definition: mcpTool.definition, execute: mcpTool.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('搜索', 'web_search', { query: 'test' }),
        makeToolResponse('写文件', 'file_write', { path: '/tmp/test.txt' }),
        makeToolResponse('调用MCP工具', 'mcp_custom', {}),
        makeFinishResponse('完成', '已完成'),
      ])

      const { callbacks, approvalRequests } = createCallbackCollector()

      // 自动批准审批请求
      const customCallbacks: AgentEventCallbacks = {
        ...callbacks,
        onApprovalRequest: (request) => {
          approvalRequests.push(request)
          setTimeout(() => executor.respondApproval(true), 0)
        },
      }

      const config = createExecutorConfig(adapter, tools, customCallbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'full-auto' })
      const result = await executor.execute(request)

      expect(result.status).toBe('completed')
      // full-auto 模式下只有 high risk 需要审批
      expect(approvalRequests).toHaveLength(1)
      expect(approvalRequests[0].toolAction.toolName).toBe('mcp_custom')

      // low 和 medium 不需要审批，直接执行
      expect(result.trajectories[0].status).toBe('success')
      expect(result.trajectories[1].status).toBe('success')
      // high 需要审批，审批后执行成功
      expect(result.trajectories[2].status).toBe('success')
    })
  })

  // ─── 场景 2: 审批拒绝与重试 ─────────────────────────────────────

  describe('审批拒绝与重试', () => {
    it('应在用户拒绝审批后继续执行（将拒绝反馈给 LLM）', async () => {
      const fileWrite = createMockTool('file_write', 'medium')
      const tools = new Map<string, RegisteredTool>()
      tools.set('file_write', { definition: fileWrite.definition, execute: fileWrite.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('需要写文件', 'file_write', { path: '/tmp/test.txt' }),
        makeFinishResponse('文件写入被拒绝，直接总结', '完成'),
      ])

      const { callbacks, approvalRequests } = createCallbackCollector()

      const customCallbacks: AgentEventCallbacks = {
        ...callbacks,
        onApprovalRequest: (request) => {
          approvalRequests.push(request)
          // 模拟用户拒绝
          setTimeout(() => executor.respondApproval(false, 'User rejected'), 0)
        },
      }

      const config = createExecutorConfig(adapter, tools, customCallbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'suggest' })
      const result = await executor.execute(request)

      expect(result.status).toBe('completed')
      expect(approvalRequests).toHaveLength(1)
      // 第一步被拒绝
      expect(result.trajectories[0].status).toBe('rejected')
      expect(result.trajectories[0].observation).toContain('rejected')
      // file_write 未执行
      expect(fileWrite.execute).not.toHaveBeenCalled()
    })

    it('应在审批超时后终止执行', async () => {
      vi.useFakeTimers()

      const fileWrite = createMockTool('file_write', 'medium')
      const tools = new Map<string, RegisteredTool>()
      tools.set('file_write', { definition: fileWrite.definition, execute: fileWrite.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('需要写文件', 'file_write', { path: '/tmp/test.txt' }),
      ])

      const { callbacks, approvalRequests } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks, {
        approvalTimeoutMs: 1000,
      })
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'suggest' })
      const executePromise = executor.execute(request)
      // 立即附加 rejection 处理器，避免 unhandled rejection
      executePromise.catch(() => {})

      // 等待审批请求发出
      await vi.advanceTimersByTimeAsync(0)
      expect(approvalRequests).toHaveLength(1)

      // 等待超时
      await vi.advanceTimersByTimeAsync(1000)

      // 应抛出 AGENT_APPROVAL_TIMEOUT 错误
      let caughtError: AppError | null = null
      try {
        await executePromise
      } catch (error) {
        caughtError = error as AppError
      }

      expect(caughtError).toBeInstanceOf(AppError)
      expect(caughtError!.code).toBe(ErrorCodes.AGENT_APPROVAL_TIMEOUT)

      vi.useRealTimers()
    })
  })

  // ─── 场景 3: 错误处理 ───────────────────────────────────────────

  describe('错误处理与熔断', () => {
    it('应在工具不存在时返回错误 Observation', async () => {
      const tools = new Map<string, RegisteredTool>()

      const adapter = new MockModelAdapter([
        makeToolResponse('调用不存在的工具', 'nonexistent_tool', {}),
        makeFinishResponse('工具不存在，直接完成', '完成'),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'full-auto' })
      const result = await executor.execute(request)

      expect(result.status).toBe('completed')
      expect(result.trajectories[0].action?.toolName).toBe('nonexistent_tool')
      expect(result.trajectories[0].observation).toContain('not found')
      expect(result.trajectories[0].status).toBe('error')
    })

    it('应在连续 3 次工具失败后触发熔断', async () => {
      const failingTool = createMockTool('failing_tool', 'low', {
        isError: true,
        content: 'Connection refused',
      })

      const tools = new Map<string, RegisteredTool>()
      tools.set('failing_tool', { definition: failingTool.definition, execute: failingTool.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('尝试1', 'failing_tool', {}),
        makeToolResponse('重试2', 'failing_tool', {}),
        makeToolResponse('重试3', 'failing_tool', {}),
      ])

      const { callbacks, trajectories } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'full-auto' })

      let caughtError: AppError | null = null
      try {
        await executor.execute(request)
      } catch (error) {
        caughtError = error as AppError
      }

      expect(caughtError).toBeInstanceOf(AppError)
      expect(caughtError!.code).toBe(ErrorCodes.AGENT_CIRCUIT_BREAK)
      // 3 次失败后熔断，回调应收集到 3 条轨迹
      expect(trajectories).toHaveLength(3)
      for (const t of trajectories) {
        expect(t.status).toBe('error')
      }
    })

    it('应在达到最大步数后终止', async () => {
      const webSearch = createMockTool('web_search', 'low')
      const tools = new Map<string, RegisteredTool>()
      tools.set('web_search', { definition: webSearch.definition, execute: webSearch.execute })

      // 每次都返回工具调用，永不 finish
      const adapter = new MockModelAdapter([
        makeToolResponse('搜索1', 'web_search', { query: 'a' }),
        makeToolResponse('搜索2', 'web_search', { query: 'b' }),
        makeToolResponse('搜索3', 'web_search', { query: 'c' }),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ maxSteps: 3, approvalMode: 'full-auto' })

      let caughtError: AppError | null = null
      try {
        await executor.execute(request)
      } catch (error) {
        caughtError = error as AppError
      }

      expect(caughtError).toBeInstanceOf(AppError)
      expect(caughtError!.code).toBe(ErrorCodes.AGENT_MAX_STEPS)
    })
  })

  // ─── 场景 4: 取消执行 ───────────────────────────────────────────

  describe('取消执行', () => {
    it('应支持中途取消执行', async () => {
      const webSearch = createMockTool('web_search', 'low')
      const tools = new Map<string, RegisteredTool>()
      tools.set('web_search', { definition: webSearch.definition, execute: webSearch.execute })

      // 创建一个慢 adapter，在第二次调用后取消
      class SlowMockAdapter extends MockModelAdapter {
        private callCount = 0
        async *streamChat(
          messages: AdapterMessage[],
          abortSignal?: AbortSignal,
        ): AsyncGenerator<StreamChunk, void, unknown> {
          this.callCount++
          if (this.callCount === 2) {
            executor.cancel()
            if (abortSignal?.aborted) return
          }
          yield* super.streamChat(messages, abortSignal)
        }
      }

      const adapter = new SlowMockAdapter([
        makeToolResponse('搜索1', 'web_search', { query: 'a' }),
        makeToolResponse('搜索2', 'web_search', { query: 'b' }),
        makeFinishResponse('完成', '完成'),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const request = createRequest({ approvalMode: 'full-auto' })
      const result = await executor.execute(request)

      expect(result.status).toBe('cancelled')
    })
  })

  // ─── 场景 5: ToolRegistry 集成 ──────────────────────────────────

  describe('ToolRegistry 集成', () => {
    it('应从 ToolRegistry 获取工具并执行', async () => {
      const registry = getToolRegistry()
      const mockTool = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Search results',
      })
      registry.registerBuiltin(mockTool)
      const tools = buildToolsMap(registry)

      const adapter = new MockModelAdapter([
        makeToolResponse('搜索', 'web_search', { query: 'test' }),
        makeFinishResponse('完成', '搜索完成'),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute(createRequest({ approvalMode: 'full-auto' }))

      expect(result.status).toBe('completed')
      expect(mockTool.execute).toHaveBeenCalledWith({ query: 'test' })
    })

    it('应支持 MCP 工具注册和执行', async () => {
      const registry = getToolRegistry()
      const mcpExecute = vi.fn().mockResolvedValue({
        isError: false,
        content: 'MCP tool result',
      })

      registry.registerMcp('srv-1', {
        name: 'mcp_search',
        description: 'MCP search tool',
        inputSchema: { type: 'object' },
        riskLevel: 'high',
        source: 'mcp',
      }, mcpExecute)

      const tools = buildToolsMap(registry)

      const adapter = new MockModelAdapter([
        makeToolResponse('调用 MCP 工具', 'mcp_search', { query: 'test' }),
        makeFinishResponse('完成', 'MCP 工具执行完成'),
      ])

      const { callbacks, approvalRequests } = createCallbackCollector()

      // full-auto 模式下 high risk 仍需要审批 → 自动批准
      const customCallbacks: AgentEventCallbacks = {
        ...callbacks,
        onApprovalRequest: (request) => {
          approvalRequests.push(request)
          setTimeout(() => executor.respondApproval(true), 0)
        },
      }

      const config = createExecutorConfig(adapter, tools, customCallbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute(createRequest({ approvalMode: 'full-auto' }))

      expect(result.status).toBe('completed')
      expect(mcpExecute).toHaveBeenCalledWith({ query: 'test' })
      expect(approvalRequests).toHaveLength(1)
    })

    it('应在注销 MCP Server 后移除其工具', async () => {
      const registry = getToolRegistry()
      const mcpExecute = vi.fn().mockResolvedValue({ isError: false, content: 'result' })

      registry.registerMcp('srv-1', {
        name: 'mcp_tool_1',
        description: 'Tool 1',
        inputSchema: { type: 'object' },
        riskLevel: 'high',
        source: 'mcp',
      }, mcpExecute)

      expect(registry.has('mcp_tool_1')).toBe(true)
      expect(registry.size()).toBe(1)

      registry.unregisterMcpServer('srv-1')

      expect(registry.has('mcp_tool_1')).toBe(false)
      expect(registry.size()).toBe(0)
    })
  })

  // ─── 场景 6: TAO 轨迹完整性 ─────────────────────────────────────

  describe('TAO 轨迹完整性', () => {
    it('应正确记录每步的 Thought-Action-Observation', async () => {
      const webSearch = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Found 3 results about Vue 3',
      })
      const tools = new Map<string, RegisteredTool>()
      tools.set('web_search', { definition: webSearch.definition, execute: webSearch.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('I need to search for Vue 3 updates', 'web_search', { query: 'Vue 3' }),
        makeFinishResponse('I found the information needed', 'Vue 3 search completed successfully'),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute(createRequest({ approvalMode: 'full-auto' }))

      expect(result.trajectories).toHaveLength(2)

      // Step 1: Tool call (成功执行)
      const step1 = result.trajectories[0]
      expect(step1.step).toBe(1)
      expect(step1.thought).toBe('I need to search for Vue 3 updates')
      expect(step1.action).not.toBeNull()
      expect(step1.action?.toolName).toBe('web_search')
      expect(step1.action?.arguments).toEqual({ query: 'Vue 3' })
      expect(step1.observation).toContain('Found 3 results')
      expect(step1.status).toBe('success')

      // Step 2: Finish
      const step2 = result.trajectories[1]
      expect(step2.step).toBe(2)
      expect(step2.thought).toBe('I found the information needed')
      expect(step2.action).toBeNull()
      expect(step2.observation).toBe('Vue 3 search completed successfully')
      expect(step2.status).toBe('success')
    })

    it('应正确记录工具执行错误时的 Observation', async () => {
      const errorTool = createMockTool('web_search', 'low', {
        isError: true,
        content: 'API rate limit exceeded',
      })
      const tools = new Map<string, RegisteredTool>()
      tools.set('web_search', { definition: errorTool.definition, execute: errorTool.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('搜索', 'web_search', { query: 'test' }),
        makeFinishResponse('搜索失败，直接总结', '搜索遇到错误'),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute(createRequest({ approvalMode: 'full-auto' }))

      expect(result.status).toBe('completed')
      expect(result.trajectories[0].status).toBe('error')
      expect(result.trajectories[0].observation).toContain('rate limit')
    })

    it('应正确统计 tokensUsed 和 duration', async () => {
      const webSearch = createMockTool('web_search', 'low')
      const tools = new Map<string, RegisteredTool>()
      tools.set('web_search', { definition: webSearch.definition, execute: webSearch.execute })

      const adapter = new MockModelAdapter([
        makeToolResponse('搜索', 'web_search', { query: 'test' }),
        makeFinishResponse('完成', '完成'),
      ])

      const { callbacks } = createCallbackCollector()
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute(createRequest({ approvalMode: 'full-auto' }))

      expect(result.tokensUsed).toBeGreaterThan(0)
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.executionId).toBeTruthy()
    })
  })

  // ─── 场景 7: 审批矩阵验证 ───────────────────────────────────────

  describe('审批决策矩阵', () => {
    const testCases: Array<{ mode: ApprovalMode; risk: 'low' | 'medium' | 'high'; expected: boolean }> = [
      { mode: 'suggest', risk: 'low', expected: true },
      { mode: 'suggest', risk: 'medium', expected: true },
      { mode: 'suggest', risk: 'high', expected: true },
      { mode: 'auto-edit', risk: 'low', expected: false },
      { mode: 'auto-edit', risk: 'medium', expected: true },
      { mode: 'auto-edit', risk: 'high', expected: true },
      { mode: 'full-auto', risk: 'low', expected: false },
      { mode: 'full-auto', risk: 'medium', expected: false },
      { mode: 'full-auto', risk: 'high', expected: true },
    ]

    for (const { mode, risk, expected } of testCases) {
      it(`应在 ${mode} 模式 + ${risk} risk 下${expected ? '需要' : '不需要'}审批`, () => {
        const action = buildToolAction('test_tool', {}, risk)
        const result = shouldRequireApproval(action, mode)
        expect(result).toBe(expected)
      })
    }
  })

  // ─── 场景 8: 解析器集成 ─────────────────────────────────────────

  describe('LLM 输出解析器集成', () => {
    it('应正确解析 Thought + Tool Action', () => {
      const output = makeToolResponse('我需要搜索', 'web_search', { query: 'Vue 3' })
      const parsed = parseLLMOutput(output)

      expect(parsed.actionType).toBe('tool')
      expect(parsed.thought).toBe('我需要搜索')
      expect(parsed.toolName).toBe('web_search')
      expect(parsed.arguments).toEqual({ query: 'Vue 3' })
    })

    it('应正确解析 Thought + Finish Action', () => {
      const output = makeFinishResponse('任务完成', '已保存笔记')
      const parsed = parseLLMOutput(output)

      expect(parsed.actionType).toBe('finish')
      expect(parsed.thought).toBe('任务完成')
      expect(parsed.summary).toBe('已保存笔记')
    })

    it('应处理代码块中的 JSON', () => {
      const output = `Thought: 分析需求\nAction: \`\`\`json\n{"type": "tool", "tool": "file_read", "arguments": {"path": "/tmp/test.txt"}}\n\`\`\``
      const parsed = parseLLMOutput(output)

      expect(parsed.actionType).toBe('tool')
      expect(parsed.toolName).toBe('file_read')
      expect(parsed.arguments).toEqual({ path: '/tmp/test.txt' })
    })
  })
})
