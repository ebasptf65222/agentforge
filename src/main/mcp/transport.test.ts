// AgentForge P2-07: StdioTransport 单元测试
// Mock node:child_process，验证传输层行为

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// ─── Mock child_process ──────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// 在 mock 设置完成后导入被测模块
const { StdioTransport } = await import('./transport')
const childProcess = await import('node:child_process')
const mockSpawn = vi.mocked(childProcess.spawn)

// ─── 辅助：创建 mock 子进程 ───────────────────────────────────────

function createMockChild(): EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
  killed: boolean
  pid: number
} {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
    killed: boolean
    pid: number
  }

  child.stdin = {
    write: vi.fn((_data: string, cb?: (err?: Error | null) => void) => {
      if (cb) cb()
      return true
    }),
    end: vi.fn(),
  }

  const stdout = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stdout.setEncoding = vi.fn()
  child.stdout = stdout

  const stderr = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stderr.setEncoding = vi.fn()
  child.stderr = stderr

  child.kill = vi.fn()
  child.killed = false
  child.pid = 12345

  return child
}

// ─── 测试 ─────────────────────────────────────────────────────────

describe('StdioTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── 命令黑名单 ───────────────────────────────────────────────

  describe('command blocklist', () => {
    it.each(['rm', 'del', 'format', 'mkfs'])(
      'should reject blocked command "%s" in constructor',
      (cmd) => {
        expect(() => new StdioTransport(cmd, [])).toThrow(/MCP_SPAWN_FAILED|blocked/i)
      },
    )

    it('should reject blocked commands case-insensitively', () => {
      expect(() => new StdioTransport('RM', [])).toThrow(/blocked/i)
      expect(() => new StdioTransport('Format', [])).toThrow(/blocked/i)
    })

    it('should allow safe commands', () => {
      expect(() => new StdioTransport('node', ['server.js'])).not.toThrow()
      expect(() => new StdioTransport('python', ['-m', 'server'])).not.toThrow()
    })
  })

  // ─── connect ──────────────────────────────────────────────────

  describe('connect', () => {
    it('should resolve when process emits spawn event', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', ['server.js'])
      const connectPromise = transport.connect()

      mockChild.emit('spawn')
      await expect(connectPromise).resolves.toBeUndefined()

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['server.js'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      )
    })

    it('should merge env variables with process.env', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [], { MCP_PORT: '3000' })
      const connectPromise = transport.connect()

      mockChild.emit('spawn')
      await connectPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            MCP_PORT: '3000',
          }),
        }),
      )
    })

    it('should throw MCP_SPAWN_FAILED when spawn emits error (ENOENT)', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('nonexistent-cmd', [])
      const connectPromise = transport.connect()

      mockChild.emit('error', new Error('spawn nonexistent-cmd ENOENT'))

      await expect(connectPromise).rejects.toThrow(/MCP_SPAWN_FAILED|spawn/i)
    })

    it('should throw MCP_SPAWN_FAILED when spawn throws synchronously', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Invalid command')
      })

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()

      await expect(connectPromise).rejects.toThrow(/MCP_SPAWN_FAILED|spawn/i)
    })

    it('should timeout if server does not start within 10s', async () => {
      vi.useFakeTimers()

      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()

      // 先附加 rejection 处理器，避免 unhandled rejection
      const expectation = expect(connectPromise).rejects.toThrow(/timeout|did not start/i)

      // 不 emit 'spawn'，等待超时
      await vi.advanceTimersByTimeAsync(10_000)

      await expectation
    })
  })

  // ─── send ─────────────────────────────────────────────────────

  describe('send', () => {
    it('should write message to stdin with newline', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', ['server.js'])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      const message = '{"jsonrpc":"2.0","id":1,"method":"test"}'
      await transport.send(message)

      expect(mockChild.stdin.write).toHaveBeenCalledWith(message + '\n', expect.any(Function))
    })

    it('should throw when not connected', async () => {
      const transport = new StdioTransport('node', [])

      await expect(transport.send('test')).rejects.toThrow(/not connected/i)
    })

    it('should throw MCP_CONNECT_FAILED when stdin write fails', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      // 模拟写入失败
      mockChild.stdin.write = vi.fn((_data: string, cb?: (err?: Error | null) => void) => {
        if (cb) cb(new Error('EPIPE'))
        return false
      })

      await expect(transport.send('test')).rejects.toThrow(/send message|MCP_CONNECT_FAILED/i)
    })
  })

  // ─── onMessage ────────────────────────────────────────────────

  describe('onMessage', () => {
    it('should call message callback for each newline-delimited message', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      const messages: string[] = []
      transport.onMessage((data) => messages.push(data))

      // 发送两条消息（换行分隔）
      mockChild.stdout.emit('data', '{"id":1}\n{"id":2}\n')

      expect(messages).toEqual(['{"id":1}', '{"id":2}'])
    })

    it('should buffer partial messages across data events', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      const messages: string[] = []
      transport.onMessage((data) => messages.push(data))

      // 分两次发送一条消息
      mockChild.stdout.emit('data', '{"id":1,"resu')
      mockChild.stdout.emit('data', 'lt":{}}\n')

      expect(messages).toEqual(['{"id":1,"result":{}}'])
    })

    it('should ignore empty lines', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      const messages: string[] = []
      transport.onMessage((data) => messages.push(data))

      mockChild.stdout.emit('data', '\n\n{"id":1}\n\n')

      expect(messages).toEqual(['{"id":1}'])
    })
  })

  // ─── close ────────────────────────────────────────────────────

  describe('close', () => {
    it('should kill the process on close', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      await transport.close()

      expect(mockChild.kill).toHaveBeenCalled()
    })

    it('should call close callback on close', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      let closeCalled = false
      transport.onClose(() => {
        closeCalled = true
      })

      await transport.close()
      expect(closeCalled).toBe(true)
    })

    it('should not trigger reconnect on manual close', async () => {
      vi.useFakeTimers()

      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const _connectPromise = transport.connect()
      mockChild.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)

      await transport.close()

      // 模拟 exit 事件（手动关闭后）
      mockChild.emit('exit', 0, null)
      await vi.advanceTimersByTimeAsync(3000)

      // spawn 不应被再次调用
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })
  })

  // ─── 自动重连 ─────────────────────────────────────────────────

  describe('auto-reconnect', () => {
    it('should attempt reconnect once after unexpected exit', async () => {
      vi.useFakeTimers()

      const mockChild1 = createMockChild()
      const mockChild2 = createMockChild()
      mockSpawn.mockReturnValueOnce(mockChild1).mockReturnValueOnce(mockChild2)

      const transport = new StdioTransport('node', [])
      const _connectPromise = transport.connect()
      mockChild1.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)

      // 模拟意外退出
      mockChild1.emit('exit', 1, null)

      // 等待重连延迟 (2000ms)
      await vi.advanceTimersByTimeAsync(2000)

      // spawn 应被再次调用
      expect(mockSpawn).toHaveBeenCalledTimes(2)

      // 第二个进程启动后，重连成功
      mockChild2.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)
    })

    it('should wait 2000ms before reconnecting', async () => {
      vi.useFakeTimers()

      const mockChild1 = createMockChild()
      const mockChild2 = createMockChild()
      mockSpawn.mockReturnValueOnce(mockChild1).mockReturnValueOnce(mockChild2)

      const transport = new StdioTransport('node', [])
      const _connectPromise = transport.connect()
      mockChild1.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)

      mockChild1.emit('exit', 1, null)

      // 在 2000ms 之前，spawn 不应被再次调用
      await vi.advanceTimersByTimeAsync(1999)
      expect(mockSpawn).toHaveBeenCalledTimes(1)

      // 到 2000ms 时，spawn 被调用
      await vi.advanceTimersByTimeAsync(1)
      expect(mockSpawn).toHaveBeenCalledTimes(2)

      mockChild2.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)
    })

    it('should emit close after max reconnect attempts', async () => {
      vi.useFakeTimers()

      const mockChild1 = createMockChild()
      const mockChild2 = createMockChild()
      mockSpawn.mockReturnValueOnce(mockChild1).mockReturnValueOnce(mockChild2)

      let closeCalled = false
      const transport = new StdioTransport('node', [])
      transport.onClose(() => {
        closeCalled = true
      })

      // 初始连接
      const _connectPromise = transport.connect()
      mockChild1.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)

      // 第一次意外退出 -> 重连
      mockChild1.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(2000)
      mockChild2.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)

      expect(closeCalled).toBe(false)

      // 第二次意外退出 -> 达到重连上限 -> close
      mockChild2.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(3000)

      expect(closeCalled).toBe(true)
    })

    it('should emit close when reconnect spawn fails', async () => {
      vi.useFakeTimers()

      const mockChild1 = createMockChild()
      const mockChild2 = createMockChild()
      mockSpawn.mockReturnValueOnce(mockChild1).mockReturnValueOnce(mockChild2)

      let closeCalled = false
      const transport = new StdioTransport('node', [])
      transport.onClose(() => {
        closeCalled = true
      })

      // 初始连接
      const _connectPromise = transport.connect()
      mockChild1.emit('spawn')
      await vi.advanceTimersByTimeAsync(0)

      // 意外退出 -> 重连尝试
      mockChild1.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(2000)

      // 重连 spawn 失败
      mockChild2.emit('error', new Error('spawn ENOENT'))
      await vi.advanceTimersByTimeAsync(0)

      expect(closeCalled).toBe(true)
    })
  })

  // ─── onError ──────────────────────────────────────────────────

  describe('onError', () => {
    it('should call error callback for runtime errors after connect', async () => {
      const mockChild = createMockChild()
      mockSpawn.mockReturnValue(mockChild)

      const transport = new StdioTransport('node', [])
      const connectPromise = transport.connect()
      mockChild.emit('spawn')
      await connectPromise

      const errors: Error[] = []
      transport.onError((err) => errors.push(err))

      // 连接后发生运行时错误
      mockChild.emit('error', new Error('Runtime error'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('Runtime error')
    })
  })
})
