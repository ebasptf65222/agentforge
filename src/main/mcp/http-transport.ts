// AgentForge MCP HTTP Transport 层
// 实现基于 HTTP + SSE 的 JSON-RPC 2.0 通信
// 用于连接远程 MCP Server（如通过 URL 暴露的 MCP 服务）

import type { ITransport } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

/** 连接超时时间（毫秒） */
const CONNECT_TIMEOUT_MS = 15_000

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * 基于 HTTP 的 MCP 传输层实现。
 *
 * 使用 fetch + SSE 进行 JSON-RPC 2.0 通信：
 * - POST 请求发送 JSON-RPC 消息
 * - SSE 端点接收服务端推送（可选）
 * - 支持 AbortController 用于取消请求
 *
 * 特性：
 * - 连接超时 15s
 * - 请求超时 30s
 * - 自动重连（最多 3 次）
 */
export class HttpTransport implements ITransport {
  private messageCallbacks: Array<(data: string) => void> = []
  private closeCallbacks: Array<() => void> = []
  private errorCallbacks: Array<(error: Error) => void> = []
  private isClosed = false
  private abortController: AbortController | null = null
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 3
  private readonly reconnectDelay = 2000

  /**
   * 重连成功回调。
   * 当 send() 中检测到连接失败并成功重连后触发，
   * 供 MCPServerManager 重新执行 MCP 协议握手。
   */
  onReconnect?: () => void | Promise<void>

  /**
   * @param url - MCP Server 的 HTTP 端点 URL
   * @param headers - 额外的 HTTP 请求头（如 Authorization）
   */
  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  /**
   * 建立 HTTP 连接（验证端点可达性）。
   *
   * @throws {AppError} MCP_CONNECT_FAILED - 连接超时或端点不可达
   */
  async connect(): Promise<void> {
    this.isClosed = false
    this.reconnectAttempts = 0
    this.abortController = new AbortController()

    try {
      // 验证端点可达性（发送一个空的 JSON-RPC 通知）
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 0 }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new AppError(
          ErrorCodes.MCP_CONNECT_FAILED,
          `MCP HTTP server returned status ${response.status}: ${response.statusText}`,
          { url: this.url, status: response.status },
        )
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.MCP_CONNECT_FAILED,
        `Failed to connect to MCP HTTP server: ${error instanceof Error ? error.message : String(error)}`,
        { url: this.url },
      )
    }
  }

  /**
   * 发送 JSON-RPC 消息到 HTTP 端点。
   *
   * 支持 MCP Streamable HTTP transport（2025-03-26 规范）:
   * - POST 请求带 Accept: application/json, text/event-stream
   * - 如果响应 Content-Type 为 text/event-stream，逐事件解析 SSE 流
   * - 否则按普通 JSON 响应处理
   *
   * @param message - JSON-RPC 消息字符串
   * @throws {AppError} MCP_CONNECT_FAILED - 未连接或请求失败
   */
  async send(message: string): Promise<void> {
    if (this.isClosed) {
      throw new AppError(
        ErrorCodes.MCP_CONNECT_FAILED,
        'MCP HTTP transport is closed. Cannot send message.',
        { url: this.url },
      )
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...this.headers,
        },
        body: message,
        signal: this.abortController
          ? AbortSignal.any([this.abortController.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new AppError(
          ErrorCodes.MCP_CONNECT_FAILED,
          `MCP HTTP request failed with status ${response.status}`,
          { url: this.url, status: response.status },
        )
      }

      const contentType = response.headers.get('content-type') ?? ''

      // 如果响应是 SSE 流，逐事件解析
      if (contentType.includes('text/event-stream')) {
        await this.consumeSseStream(response)
      } else {
        // 普通 JSON 响应
        const text = await response.text()
        if (text.trim()) {
          for (const cb of this.messageCallbacks) {
            cb(text.trim())
          }
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error

      // 连接失败，尝试重连
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay))
        if (!this.isClosed) {
          try {
            await this.connect()
            // 重连成功后，先通知 manager 重新执行 MCP 协议握手，
            // 再重试发送原始消息
            if (this.onReconnect) {
              try {
                await this.onReconnect()
              } catch (reconnectErr) {
                console.warn('[MCP HttpTransport] onReconnect callback failed:', reconnectErr)
              }
            }
            return this.send(message)
          } catch {
            // 重连失败，继续抛出
          }
        }
      }

      this.isClosed = true
      this.emitClose()
      throw new AppError(
        ErrorCodes.MCP_CONNECT_FAILED,
        `Failed to send message to MCP HTTP server: ${error instanceof Error ? error.message : String(error)}`,
        { url: this.url },
      )
    }
  }

  /**
   * 消费 SSE 流，逐事件解析并触发消息回调。
   *
   * SSE 事件格式：
   * event: message
   * data: {"jsonrpc":"2.0",...}
   *
   * 事件之间以双换行符（\n\n）分隔。
   */
  private async consumeSseStream(response: Response): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE 事件以双换行符分隔
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventBlock of events) {
          const dataLines = eventBlock
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())

          if (dataLines.length > 0) {
            const data = dataLines.join('\n')
            if (data.trim()) {
              for (const cb of this.messageCallbacks) {
                cb(data.trim())
              }
            }
          }
        }
      }

      // 处理 buffer 中剩余的数据
      if (buffer.trim()) {
        const dataLines = buffer
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())

        if (dataLines.length > 0) {
          const data = dataLines.join('\n')
          if (data.trim()) {
            for (const cb of this.messageCallbacks) {
              cb(data.trim())
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 注册消息回调。当收到服务端响应时调用。
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
   * 关闭传输层，取消所有进行中的请求。
   */
  async close(): Promise<void> {
    this.isClosed = true
    this.abortController?.abort()
    this.abortController = null
    this.emitClose()
  }

  // ─── 内部辅助方法 ─────────────────────────────────────────────

  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) {
      cb(error)
    }
  }

  private emitClose(): void {
    for (const cb of this.closeCallbacks) {
      cb()
    }
  }
}