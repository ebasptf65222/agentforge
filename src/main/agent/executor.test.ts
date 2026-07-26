import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentExecutor } from './executor'
import type { AgentExecutorConfig } from './executor'
import type { AgentEventCallbacks, RegisteredTool } from './types'
import type { ModelAdapter, AdapterMessage, StreamChunk } from '../models/adapter'
import type { ToolDefinition, ToolExecutionResult } from '@shared/types'

// ─── Mock Model Adapter ──────────────────────────────────────────

class MockModelAdapter implements ModelAdapter {
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

    // Simulate streaming by yielding in chunks
    const chunkSize = 10
    for (let i = 0; i < response.length; i += chunkSize) {
      yield {
        type: 'text',
        content: response.slice(i, i + chunkSize),
      }
    }
    yield { type: 'text', content: '', done: true }
  }
}

// ─── Mock Tool ───────────────────────────────────────────────────

function createMockTool(
  name: string,
  riskLevel: 'low' | 'medium' | 'high',
  result: ToolExecutionResult,
): RegisteredTool {
  const definition: ToolDefinition = {
    name,
    description: `Mock tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    riskLevel,
    source: 'builtin',
  }

  return {
    definition,
    execute: vi.fn().mockResolvedValue(result),
    source: 'builtin',
  }
}

function createMockToolMap(
  tools: RegisteredTool[],
): Map<string, RegisteredTool> {
  const map = new Map<string, RegisteredTool>()
  for (const tool of tools) {
    map.set(tool.definition.name, tool)
  }
  return map
}

// ─── Test Setup ──────────────────────────────────────────────────

function createCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

function createExecutorConfig(
  adapter: ModelAdapter,
  tools: Map<string, RegisteredTool>,
  callbacks: AgentEventCallbacks,
  overrides?: Partial<AgentExecutorConfig>,
): AgentExecutorConfig {
  return {
    adapter,
    tools,
    callbacks,
    approvalTimeoutMs: 5000,
    maxContextLength: 4096,
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AgentExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic execution', () => {
    it('should complete when LLM returns finish action', async () => {
      const adapter = new MockModelAdapter([
        `Thought: I can answer this directly.
Action: {"type": "finish", "summary": "The answer is 42."}`,
      ])
      const callbacks = createCallbacks()
      const config = createExecutorConfig(adapter, new Map(), callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'What is the answer?',
        modelId: 'model-1',
        approvalMode: 'auto-edit',
        maxSteps: 10,
      })

      expect(result.status).toBe('completed')
      expect(result.summary).toBe('The answer is 42.')
      expect(result.trajectories).toHaveLength(1)
      expect(result.trajectories[0].action).toBeNull()
      expect(result.trajectories[0].status).toBe('success')
    })

    it('should stream text chunks to callback', async () => {
      const adapter = new MockModelAdapter([
        `Thought: Direct answer.
Action: {"type": "finish", "summary": "Hello world"}`,
      ])
      const callbacks = createCallbacks()
      const config = createExecutorConfig(adapter, new Map(), callbacks)
      const executor = new AgentExecutor(config)

      await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Hi',
        modelId: 'model-1',
        approvalMode: 'auto-edit',
        maxSteps: 10,
      })

      expect(callbacks.onStreamChunk).toHaveBeenCalled()
      const chunks = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls
      const allContent = chunks.map((c) => c[0].content).join('')
      expect(allContent).toContain('Hello world')
    })
  })

  describe('tool execution', () => {
    it('should execute tool and continue to finish', async () => {
      const searchTool = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Search results: Vue 3 is great.',
      })

      const adapter = new MockModelAdapter([
        `Thought: I need to search.
Action: {"type": "tool", "tool": "web_search", "arguments": {"query": "Vue 3"}}`,
        `Thought: Now I have the answer.
Action: {"type": "finish", "summary": "Vue 3 is a great framework."}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([searchTool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Search for Vue 3',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 10,
      })

      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(2)
      expect(searchTool.execute).toHaveBeenCalledWith({ query: 'Vue 3' })
      expect(result.trajectories[0].action?.toolName).toBe('web_search')
      expect(result.trajectories[0].observation).toContain('Search results')
      expect(result.trajectories[0].status).toBe('success')
    })

    it('should handle tool not found', async () => {
      const adapter = new MockModelAdapter([
        `Thought: Let me try this tool.
Action: {"type": "tool", "tool": "nonexistent", "arguments": {}}`,
        `Thought: Tool not found, let me finish.
Action: {"type": "finish", "summary": "Could not complete."}`,
      ])

      const callbacks = createCallbacks()
      const config = createExecutorConfig(adapter, new Map(), callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Test',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 10,
      })

      expect(result.status).toBe('completed')
      expect(result.trajectories[0].status).toBe('error')
      expect(result.trajectories[0].observation).toContain('not found')
    })

    it('should feed observation back to LLM', async () => {
      const readFileTool = createMockTool('file_read', 'low', {
        isError: false,
        content: 'File content here.',
      })

      const adapter = new MockModelAdapter([
        `Thought: Read the file.
Action: {"type": "tool", "tool": "file_read", "arguments": {"path": "/test.txt"}}`,
        `Thought: Got the content.
Action: {"type": "finish", "summary": "The file contains: File content here."}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([readFileTool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Read /test.txt',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 10,
      })

      expect(result.status).toBe('completed')
      expect(result.summary).toContain('File content here')
    })
  })

  describe('circuit breaker', () => {
    it('should circuit break after 3 consecutive failures', async () => {
      const failingTool = createMockTool('web_search', 'low', {
        isError: true,
        content: 'Network error',
      })

      // LLM keeps calling the failing tool
      const responses: string[] = []
      for (let i = 0; i < 5; i++) {
        responses.push(
          `Thought: Attempt ${i + 1}.
Action: {"type": "tool", "tool": "web_search", "arguments": {"query": "test"}}`,
        )
      }

      const adapter = new MockModelAdapter(responses)
      const callbacks = createCallbacks()
      const tools = createMockToolMap([failingTool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      await expect(
        executor.execute({
          conversationId: 'conv-1',
          userInput: 'Search',
          modelId: 'model-1',
          approvalMode: 'full-auto',
          maxSteps: 10,
        }),
      ).rejects.toThrow('Circuit breaker')

      // Should have been called exactly 3 times before circuit breaking
      expect(failingTool.execute).toHaveBeenCalledTimes(3)
    })

    it('should reset failure counter on success', async () => {
      const searchTool = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Success',
      })
      const scrapeTool = createMockTool('web_scrape', 'low', {
        isError: true,
        content: 'Failed',
      })

      // fail, fail, success, fail, fail, finish
      const adapter = new MockModelAdapter([
        `Thought: 1\nAction: {"type": "tool", "tool": "web_scrape", "arguments": {"url": "x"}}`,
        `Thought: 2\nAction: {"type": "tool", "tool": "web_scrape", "arguments": {"url": "y"}}`,
        `Thought: 3\nAction: {"type": "tool", "tool": "web_search", "arguments": {"query": "z"}}`,
        `Thought: 4\nAction: {"type": "tool", "tool": "web_scrape", "arguments": {"url": "a"}}`,
        `Thought: 5\nAction: {"type": "tool", "tool": "web_scrape", "arguments": {"url": "b"}}`,
        `Thought: Done\nAction: {"type": "finish", "summary": "Done"}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([searchTool, scrapeTool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Test',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 20,
      })

      // Should NOT circuit break because success reset the counter
      expect(result.status).toBe('completed')
    })
  })

  describe('max steps', () => {
    it('should terminate when maxSteps is reached', async () => {
      const tool = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Result',
      })

      // LLM never finishes
      const responses: string[] = []
      for (let i = 0; i < 5; i++) {
        responses.push(
          `Thought: Step ${i + 1}\nAction: {"type": "tool", "tool": "web_search", "arguments": {}}`,
        )
      }

      const adapter = new MockModelAdapter(responses)
      const callbacks = createCallbacks()
      const tools = createMockToolMap([tool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      await expect(
        executor.execute({
          conversationId: 'conv-1',
          userInput: 'Test',
          modelId: 'model-1',
          approvalMode: 'full-auto',
          maxSteps: 3,
        }),
      ).rejects.toThrow('Max steps')
    })
  })

  describe('cancellation', () => {
    it('should cancel execution', async () => {
      // Create a slow adapter that responds after a delay
      class SlowAdapter extends MockModelAdapter {
        override async *streamChat(
          _messages: AdapterMessage[],
          _abortSignal?: AbortSignal,
        ): AsyncGenerator<StreamChunk, void, unknown> {
          await new Promise((resolve) => setTimeout(resolve, 100))
          yield { type: 'text', content: 'Thought: thinking\nAction: {"type":"finish","summary":"done"}' }
          yield { type: 'text', content: '', done: true }
        }
      }
      const adapter = new SlowAdapter([])
      const callbacks = createCallbacks()
      const config = createExecutorConfig(adapter, new Map(), callbacks)
      const executor = new AgentExecutor(config)

      // Start execution
      const executePromise = executor.execute({
        conversationId: 'conv-1',
        userInput: 'Test',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 10,
      })

      // Cancel during execution
      setTimeout(() => executor.cancel(), 10)

      const result = await executePromise

      expect(result.status).toBe('cancelled')
    })
  })

  describe('approval', () => {
    it('should request approval for high-risk tools in auto-edit mode', async () => {
      const mcpTool = createMockTool('mcp_tool', 'high', {
        isError: false,
        content: 'Done',
      })

      const adapter = new MockModelAdapter([
        `Thought: Use MCP tool.
Action: {"type": "tool", "tool": "mcp_tool", "arguments": {}}`,
        `Thought: Done.\nAction: {"type": "finish", "summary": "Completed"}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([mcpTool])
      const config = createExecutorConfig(adapter, tools, callbacks, {
        approvalTimeoutMs: 1000,
      })
      const executor = new AgentExecutor(config)

      // Auto-approve after a short delay
      setTimeout(() => executor.respondApproval(true, 'auto-approved'), 50)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Test',
        modelId: 'model-1',
        approvalMode: 'auto-edit',
        maxSteps: 10,
      })

      expect(callbacks.onApprovalRequest).toHaveBeenCalled()
      expect(result.status).toBe('completed')
    })

    it('should not require approval for low-risk in full-auto mode', async () => {
      const searchTool = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Results',
      })

      const adapter = new MockModelAdapter([
        `Thought: Search.\nAction: {"type": "tool", "tool": "web_search", "arguments": {"query": "test"}}`,
        `Thought: Done.\nAction: {"type": "finish", "summary": "Done"}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([searchTool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Test',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 10,
      })

      expect(callbacks.onApprovalRequest).not.toHaveBeenCalled()
      expect(result.status).toBe('completed')
    })

    it('should continue when approval is rejected', async () => {
      const writeFileTool = createMockTool('file_write', 'medium', {
        isError: false,
        content: 'Written',
      })

      const adapter = new MockModelAdapter([
        `Thought: Write file.
Action: {"type": "tool", "tool": "file_write", "arguments": {"path": "/test", "content": "data"}}`,
        `Thought: Rejected, let me finish.
Action: {"type": "finish", "summary": "Could not write file"}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([writeFileTool])
      const config = createExecutorConfig(adapter, tools, callbacks, {
        approvalTimeoutMs: 1000,
      })
      const executor = new AgentExecutor(config)

      // Reject after short delay
      setTimeout(() => executor.respondApproval(false, 'user rejected'), 50)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Write file',
        modelId: 'model-1',
        approvalMode: 'auto-edit',
        maxSteps: 10,
      })

      expect(result.status).toBe('completed')
      expect(writeFileTool.execute).not.toHaveBeenCalled()
      expect(result.trajectories[0].status).toBe('rejected')
    })
  })

  describe('multi-step execution', () => {
    it('should handle multiple tool calls in sequence', async () => {
      const searchTool = createMockTool('web_search', 'low', {
        isError: false,
        content: 'Found a URL: https://example.com',
      })
      const scrapeTool = createMockTool('web_scrape', 'low', {
        isError: false,
        content: 'Page content: Hello World',
      })

      const adapter = new MockModelAdapter([
        `Thought: Search first.
Action: {"type": "tool", "tool": "web_search", "arguments": {"query": "test"}}`,
        `Thought: Now scrape the URL.
Action: {"type": "tool", "tool": "web_scrape", "arguments": {"url": "https://example.com"}}`,
        `Thought: Done.
Action: {"type": "finish", "summary": "Found: Hello World"}`,
      ])

      const callbacks = createCallbacks()
      const tools = createMockToolMap([searchTool, scrapeTool])
      const config = createExecutorConfig(adapter, tools, callbacks)
      const executor = new AgentExecutor(config)

      const result = await executor.execute({
        conversationId: 'conv-1',
        userInput: 'Search and scrape',
        modelId: 'model-1',
        approvalMode: 'full-auto',
        maxSteps: 10,
      })

      expect(result.status).toBe('completed')
      expect(result.totalSteps).toBe(3)
      expect(searchTool.execute).toHaveBeenCalledTimes(1)
      expect(scrapeTool.execute).toHaveBeenCalledTimes(1)
      expect(result.summary).toContain('Hello World')
    })
  })
})
