// AgentForge P2-07: MCPClient 单元测试
// Mock ITransport，验证 JSON-RPC 2.0 协议行为

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ITransport } from '@shared/types'

// ─── Mock Transport ───────────────────────────────────────────────

/**
 * 可控的 mock transport 实现。
 * 记录发送的消息，允许测试模拟接收响应。
 */
class MockTransport implements ITransport {
  sentMessages: string[] = []
  private messageCallbacks: Array<(data: string) => void> = []
  private closeCallbacks: Array<() => void> = []
  private errorCallbacks: Array<(error: Error) => void> = []

  connect = vi.fn().mockResolvedValue(undefined)
  send = vi.fn((msg: string): Promise<void> => {
    this.sentMessages.push(msg)
    return Promise.resolve()
  })
  onMessage = vi.fn((cb: (data: string) => void): void => {
    this.messageCallbacks.push(cb)
  })
  onClose = vi.fn((cb: () => void): void => {
    this.closeCallbacks.push(cb)
  })
  onError = vi.fn((cb: (error: Error) => void): void => {
    this.errorCallbacks.push(cb)
  })
  close = vi.fn().mockResolvedValue(undefined)

  /** 模拟从 server 收到消息 */
  emitMessage(data: string): void {
    for (const cb of this.messageCallbacks) {
      cb(data)
    }
  }

  /** 模拟连接关闭 */
  emitClose(): void {
    for (const cb of this.closeCallbacks) {
      cb()
    }
  }

  /** 模拟错误 */
  emitError(err: Error): void {
    for (const cb of this.errorCallbacks) {
      cb(err)
    }
  }

  /** 获取最后发送的消息（解析为对象） */
  getLastSentMessage(): Record<string, unknown> {
    const last = this.sentMessages[this.sentMessages.length - 1]
    return JSON.parse(last) as Record<string, unknown>
  }
}

// 导入被测模块
const { MCPClient } = await import('./client')

// ─── 辅助函数 ─────────────────────────────────────────────────────

/** 构造 JSON-RPC 响应字符串 */
function makeResponse(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result })
}

/** 构造 JSON-RPC 错误响应字符串 */
function makeErrorResponse(id: number, message: string, code = -32603): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

// ─── 测试 ─────────────────────────────────────────────────────────

describe('MCPClient', () => {
  let transport: MockTransport

  beforeEach(() => {
    transport = new MockTransport()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── initialize ───────────────────────────────────────────────

  describe('initialize', () => {
    it('should send initialize request with correct params', async () => {
      const client = new MCPClient(transport)

      const initPromise = client.initialize()

      // 验证发送了 initialize 请求
      const sent = transport.getLastSentMessage()
      expect(sent['jsonrpc']).toBe('2.0')
      expect(sent['method']).toBe('initialize')
      expect(sent['params']).toEqual(
        expect.objectContaining({
          protocolVersion: expect.any(String),
          clientInfo: expect.objectContaining({ name: 'AgentForge' }),
        }),
      )

      // 模拟 server 响应
      const requestId = sent['id'] as number
      transport.emitMessage(
        makeResponse(requestId, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'test-server', version: '1.0.0' },
        }),
      )

      await initPromise

      // 验证发送了 initialized 通知
      const lastSent = transport.getLastSentMessage()
      expect(lastSent['method']).toBe('notifications/initialized')
      expect(lastSent['id']).toBeUndefined()
    })

    it('should store server capabilities and info', async () => {
      const client = new MCPClient(transport)

      const initPromise = client.initialize()

      const sent = transport.getLastSentMessage()
      const requestId = sent['id'] as number
      transport.emitMessage(
        makeResponse(requestId, {
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'my-server', version: '2.0.0' },
        }),
      )

      await initPromise

      expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: true } })
      expect(client.getServerInfo()).toEqual({ name: 'my-server', version: '2.0.0' })
    })

    it('should throw on initialize error response', async () => {
      const client = new MCPClient(transport)

      const initPromise = client.initialize()

      const sent = transport.getLastSentMessage()
      const requestId = sent['id'] as number
      transport.emitMessage(makeErrorResponse(requestId, 'Invalid protocol'))

      await expect(initPromise).rejects.toThrow(/Invalid protocol/i)
    })
  })

  // ─── listTools ────────────────────────────────────────────────

  describe('listTools', () => {
    it('should return tools with high risk level and mcp source', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      const sent = transport.getLastSentMessage()
      expect(sent['method']).toBe('tools/list')

      const requestId = sent['id'] as number
      transport.emitMessage(
        makeResponse(requestId, {
          tools: [
            {
              name: 'search',
              description: 'Search the web',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'fetch',
              description: 'Fetch a URL',
              inputSchema: { type: 'object' },
            },
          ],
        }),
      )

      const tools = await listPromise

      expect(tools).toHaveLength(2)
      expect(tools[0].name).toBe('search')
      expect(tools[0].description).toBe('Search the web')
      expect(tools[0].riskLevel).toBe('high')
      expect(tools[0].source).toBe('mcp')
      expect(tools[1].name).toBe('fetch')
      expect(tools[1].riskLevel).toBe('high')
    })

    it('should handle empty tools list', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      const sent = transport.getLastSentMessage()
      transport.emitMessage(makeResponse(sent['id'] as number, { tools: [] }))

      const tools = await listPromise
      expect(tools).toEqual([])
    })

    it('should handle missing tools field in response', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      const sent = transport.getLastSentMessage()
      transport.emitMessage(makeResponse(sent['id'] as number, {}))

      const tools = await listPromise
      expect(tools).toEqual([])
    })

    it('should use empty string for missing description', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      const sent = transport.getLastSentMessage()
      transport.emitMessage(
        makeResponse(sent['id'] as number, {
          tools: [{ name: 'no-desc' }],
        }),
      )

      const tools = await listPromise
      expect(tools[0].description).toBe('')
    })
  })

  // ─── callTool ─────────────────────────────────────────────────

  describe('callTool', () => {
    it('should send tools/call with name and arguments', async () => {
      const client = new MCPClient(transport)

      const callPromise = client.callTool('search', { query: 'test' })

      const sent = transport.getLastSentMessage()
      expect(sent['method']).toBe('tools/call')
      expect(sent['params']).toEqual({
        name: 'search',
        arguments: { query: 'test' },
      })

      const requestId = sent['id'] as number
      transport.emitMessage(
        makeResponse(requestId, {
          content: [{ type: 'text', text: 'Search results' }],
          isError: false,
        }),
      )

      const result = await callPromise
      expect(result.isError).toBe(false)
      expect(result.content).toBe('Search results')
    })

    it('should join multiple content parts', async () => {
      const client = new MCPClient(transport)

      const callPromise = client.callTool('multi', {})

      const sent = transport.getLastSentMessage()
      const requestId = sent['id'] as number
      transport.emitMessage(
        makeResponse(requestId, {
          content: [
            { type: 'text', text: 'Part 1. ' },
            { type: 'text', text: 'Part 2.' },
          ],
        }),
      )

      const result = await callPromise
      expect(result.content).toBe('Part 1. Part 2.')
    })

    it('should handle error result from tool', async () => {
      const client = new MCPClient(transport)

      const callPromise = client.callTool('failing', {})

      const sent = transport.getLastSentMessage()
      const requestId = sent['id'] as number
      transport.emitMessage(
        makeResponse(requestId, {
          content: [{ type: 'text', text: 'Tool failed' }],
          isError: true,
        }),
      )

      const result = await callPromise
      expect(result.isError).toBe(true)
      expect(result.content).toBe('Tool failed')
    })

    it('should handle missing content field', async () => {
      const client = new MCPClient(transport)

      const callPromise = client.callTool('empty', {})

      const sent = transport.getLastSentMessage()
      const requestId = sent['id'] as number
      transport.emitMessage(makeResponse(requestId, {}))

      const result = await callPromise
      expect(result.isError).toBe(false)
      expect(result.content).toBe('')
    })
  })

  // ─── 请求超时 ─────────────────────────────────────────────────

  describe('request timeout', () => {
    it('should timeout after 10s if no response', async () => {
      vi.useFakeTimers()

      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      // 先附加 rejection 处理器，避免 unhandled rejection
      const expectation = expect(listPromise).rejects.toThrow(/timed out/i)

      // 不发送响应，等待超时
      await vi.advanceTimersByTimeAsync(10_000)

      await expectation
    })

    it('should clear timeout when response received', async () => {
      vi.useFakeTimers()

      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      const sent = transport.getLastSentMessage()
      transport.emitMessage(makeResponse(sent['id'] as number, { tools: [] }))

      const tools = await listPromise
      expect(tools).toEqual([])

      // 确保超时不会触发 reject（promise 已 resolved）
      await vi.advanceTimersByTimeAsync(10_000)

      // 如果到这里没有 unhandled rejection，说明超时已清除
      expect(tools).toEqual([])
    })
  })

  // ─── close ────────────────────────────────────────────────────

  describe('close', () => {
    it('should call transport.close()', async () => {
      const client = new MCPClient(transport)

      await client.close()

      expect(transport.close).toHaveBeenCalled()
    })

    it('should reject pending requests on close', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      // 关闭连接，不发送响应
      await client.close()

      await expect(listPromise).rejects.toThrow(/closed/i)
    })
  })

  // ─── 消息处理 ─────────────────────────────────────────────────

  describe('message handling', () => {
    it('should ignore non-JSON messages', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      // 发送非 JSON 数据
      transport.emitMessage('not json at all')

      const sent = transport.getLastSentMessage()
      transport.emitMessage(makeResponse(sent['id'] as number, { tools: [] }))

      // 应正常 resolve
      const tools = await listPromise
      expect(tools).toEqual([])
    })

    it('should ignore notifications (no id)', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      // 发送通知（无 id）
      transport.emitMessage(JSON.stringify({ jsonrpc: '2.0', method: 'progress' }))

      const sent = transport.getLastSentMessage()
      transport.emitMessage(makeResponse(sent['id'] as number, { tools: [] }))

      const tools = await listPromise
      expect(tools).toEqual([])
    })

    it('should ignore responses with unknown id', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      // 发送未知 id 的响应
      transport.emitMessage(makeResponse(99999, { tools: [] }))

      const sent = transport.getLastSentMessage()
      transport.emitMessage(makeResponse(sent['id'] as number, { tools: [] }))

      const tools = await listPromise
      expect(tools).toEqual([])
    })

    it('should handle multiple concurrent requests', async () => {
      const client = new MCPClient(transport)

      // 发起两个并发请求
      const listPromise = client.listTools()
      const callPromise = client.callTool('tool1', {})

      // 按相反顺序响应
      // listTools 是第一个发起的，但 callTool 是第二个
      // 实际上 listTools 先发起 -> id=1, callTool -> id=2
      transport.emitMessage(makeResponse(2, { content: [{ type: 'text', text: 'result' }] }))
      transport.emitMessage(makeResponse(1, { tools: [{ name: 't' }] }))

      const tools = await listPromise
      const result = await callPromise

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('t')
      expect(result.content).toBe('result')
    })
  })

  // ─── 连接关闭 ─────────────────────────────────────────────────

  describe('connection close', () => {
    it('should reject pending requests when transport closes', async () => {
      const client = new MCPClient(transport)

      const listPromise = client.listTools()

      // 模拟 transport 关闭
      transport.emitClose()

      await expect(listPromise).rejects.toThrow(/closed/i)
    })
  })
})
