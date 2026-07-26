// AgentForge MCP Transport 层
// 实现 P2-07: StdioTransport - 通过子进程 stdin/stdout 进行 JSON-RPC 2.0 通信
// 与 Spec v0.2 §5.5 ITransport 接口一致

import { spawn, type ChildProcess } from 'node:child_process'
import type { ITransport } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 常量 ─────────────────────────────────────────────────────────

/** 命令黑名单：禁止启动危险命令 */
const COMMAND_BLOCKLIST = ['rm', 'del', 'format', 'mkfs'] as const

/** 自动重连最大次数 */
const MAX_RECONNECT_ATTEMPTS = 1

/** 自动重连等待时间（毫秒） */
const RECONNECT_DELAY_MS = 2000

/** 连接超时时间（毫秒）- 等待服务器进程启动 */
const CONNECT_TIMEOUT_MS = 10_000

// ─── StdioTransport ───────────────────────────────────────────────

/**
 * 基于 stdio 的 MCP 传输层实现。
 *
 * 使用 child_process.spawn 启动 MCP Server 子进程，
 * 通过 stdin/stdout 进行 JSON-RPC 2.0 通信。
 *
 * 特性：
 * - 命令黑名单检查（rm, del, format, mkfs）
 * - 进程退出时自动重连 1 次（等待 2000ms）
 * - 10s 连接超时
 * - spawn 失败（如命令不存在）抛出 MCP_SPAWN_FAILED
 */
export class StdioTransport implements ITransport {
  private process: ChildProcess | null = null
  private messageCallbacks: Array<(data: string) => void> = []
  private closeCallbacks: Array<() => void> = []
  private errorCallbacks: Array<(error: Error) => void> = []
  private buffer = ''
  private reconnectAttempts = 0
  private isClosing = false
  private isClosed = false

  /**
   * @param command - 要执行的命令（如 'node'、'python'）
   * @param args - 命令参数
   * @param env - 环境变量（会与 process.env 合并）
   */
  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {},
  ) {
    const baseCmd = command.toLowerCase().trim()
    if ((COMMAND_BLOCKLIST as readonly string[]).includes(baseCmd)) {
      throw new AppError(
        ErrorCodes.MCP_SPAWN_FAILED,
        `Command "${command}" is blocked for security reasons.`,
        { command, blocklist: COMMAND_BLOCKLIST },
      )
    }
  }

  /**
   * 启动 MCP Server 子进程并建立连接。
   *
   * @throws {AppError} MCP_SPAWN_FAILED - spawn 失败（命令不存在等）
   * @throws {AppError} MCP_CONNECT_FAILED - 连接超时
   */
  async connect(): Promise<void> {
    this.isClosing = false
    this.isClosed = false
    this.reconnectAttempts = 0
    await this.spawnProcess()
  }

  /**
   * 内部方法：spawn 子进程并等待启动。
   */
  private spawnProcess(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false

      // 10s 连接超时
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(
            new AppError(
              ErrorCodes.MCP_CONNECT_FAILED,
              `MCP server did not start within ${CONNECT_TIMEOUT_MS}ms.`,
              { command: this.command },
            ),
          )
        }
      }, CONNECT_TIMEOUT_MS)

      let child: ChildProcess
      try {
        child = spawn(this.command, this.args, {
          env: { ...process.env, ...this.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        settled = true
        clearTimeout(timeout)
        reject(
          new AppError(
            ErrorCodes.MCP_SPAWN_FAILED,
            `Failed to spawn MCP server: ${err instanceof Error ? err.message : String(err)}`,
            { command: this.command },
          ),
        )
        return
      }

      this.process = child

      // 进程成功启动
      child.once('spawn', () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve()
        }
      })

      // spawn 失败（如 ENOENT: command not found）
      child.on('error', (err: Error) => {
        if (!settled) {
          // connect 阶段失败
          settled = true
          clearTimeout(timeout)
          reject(
            new AppError(
              ErrorCodes.MCP_SPAWN_FAILED,
              `Failed to spawn MCP server: ${err.message}`,
              { command: this.command, cause: err.message },
            ),
          )
        } else {
          // 已连接后的运行时错误
          this.emitError(err)
        }
      })

      // 进程退出
      child.on('exit', (code: number | null, signal: string | null) => {
        this.process = null
        if (this.isClosing || this.isClosed) return
        void this.handleUnexpectedExit(code, signal)
      })

      // stdout 数据 - JSON-RPC 响应
      child.stdout?.setEncoding('utf-8')
      child.stdout?.on('data', (data: string) => {
        this.handleData(data)
      })

      // stderr 数据 - 日志输出（不视为错误）
      child.stderr?.setEncoding('utf-8')
      child.stderr?.on('data', (data: string) => {
        console.error(`[MCP Server stderr] ${data}`)
      })
    })
  }

  /**
   * 处理进程意外退出，尝试自动重连。
   * - 最多重连 1 次，等待 2000ms
   * - 重连失败或达到上限后标记为已断开
   */
  private async handleUnexpectedExit(_code: number | null, _signal: string | null): Promise<void> {
    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS))

      // 等待期间可能已被手动关闭
      if (this.isClosing || this.isClosed) return

      try {
        await this.spawnProcess()
        // 重连成功
      } catch {
        this.isClosed = true
        this.emitClose()
      }
    } else {
      this.isClosed = true
      this.emitClose()
    }
  }

  /**
   * 发送 JSON-RPC 消息到子进程 stdin。
   * 自动追加换行符作为消息分隔符。
   *
   * @param message - JSON-RPC 消息字符串
   * @throws {AppError} MCP_CONNECT_FAILED - 未连接或写入失败
   */
  async send(message: string): Promise<void> {
    if (this.isClosed || !this.process?.stdin) {
      throw new AppError(
        ErrorCodes.MCP_CONNECT_FAILED,
        'MCP server is not connected. Cannot send message.',
        { command: this.command },
      )
    }

    return new Promise<void>((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(
          new AppError(
            ErrorCodes.MCP_CONNECT_FAILED,
            'MCP server process stdin is not available',
          ),
        )
        return
      }
      this.process.stdin.write(message + '\n', (err?: Error | null) => {
        if (err) {
          reject(
            new AppError(
              ErrorCodes.MCP_CONNECT_FAILED,
              `Failed to send message to MCP server: ${err.message}`,
              { command: this.command },
            ),
          )
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * 注册消息回调。当从 stdout 收到完整 JSON-RPC 消息时调用。
   */
  onMessage(callback: (data: string) => void): void {
    this.messageCallbacks.push(callback)
  }

  /**
   * 注册关闭回调。当连接断开且无法重连时调用。
   */
  onClose(callback: () => void): void {
    this.closeCallbacks.push(callback)
  }

  /**
   * 注册错误回调。当发生运行时错误时调用。
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback)
  }

  /**
   * 关闭传输层，终止子进程。
   * 不会触发自动重连。
   */
  async close(): Promise<void> {
    this.isClosing = true
    this.isClosed = true

    if (this.process) {
      try {
        this.process.kill()
      } catch {
        // 进程可能已退出，忽略错误
      }
      this.process = null
    }

    this.buffer = ''
    this.emitClose()
  }

  // ─── 内部辅助方法 ─────────────────────────────────────────────

  /**
   * 处理 stdout 数据，按换行符分割完整消息。
   */
  private handleData(data: string): void {
    this.buffer += data
    const lines = this.buffer.split('\n')
    // 最后一段可能不完整，保留在 buffer 中
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        for (const cb of this.messageCallbacks) {
          cb(trimmed)
        }
      }
    }
  }

  /**
   * 触发所有错误回调。
   */
  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) {
      cb(error)
    }
  }

  /**
   * 触发所有关闭回调。
   */
  private emitClose(): void {
    for (const cb of this.closeCallbacks) {
      cb()
    }
  }
}
