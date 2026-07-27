// AgentForge MCP Client
// 实现 P2-07: MCPClient - 包装 ITransport，实现 JSON-RPC 2.0 协议
// 生命周期: initialize() → tools/list → tools/call → close()

import type { ITransport, ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 常量 ─────────────────────────────────────────────────────────

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = 10_000

/** MCP 协议版本 */
const MCP_PROTOCOL_VERSION = '2024-11-05'

/** 客户端信息 */
const CLIENT_INFO = { name: 'AgentForge', version: '0.1.0' }

// ─── 致命错误判定 ────────────────────────────────────────────────

/**
 * 致命错误代码集合（Node.js 系统错误码）。
 * 这些错误通常意味着传输通道已损坏，pending 请求无法再收到响应。
 * - EPIPE: 写入已关闭的管道
 * - ECONNRESET: 连接被对端重置
 * - ECONNREFUSED: 连接被拒绝
 * - EHOSTUNREACH: 主机不可达
 * - ENOTFOUND: 域名解析失败
 * - ENOENT: 命令/文件不存在（spawn 失败）
 * - EACCES: 权限不足
 */
const FATAL_ERROR_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ENOENT',
  'EACCES',
  'EOF',
])

/**
 * 判断错误是否为致命错误（连接已不可用）。
 * 通过 Node.js 系统错误码（error.code）或消息内容判定。
 */
function isFatalError(error: Error): boolean {
  const nodeErr = error as NodeJS.ErrnoException
  if (nodeErr.code && FATAL_ERROR_CODES.has(nodeErr.code)) {
    return true
  }
  // 兜底：消息中包含 EPIPE 等关键字
  const msg = error.message
  return [...FATAL_ERROR_CODES].some((code) => msg.includes(code))
}

// ─── JSON-RPC 类型 ────────────────────────────────────────────────

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

/** JSON-RPC 响应 */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** 待处理的请求 */
interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

// ─── MCP Server 返回的原始工具定义 ────────────────────────────────

interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface McpListToolsResult {
  tools: McpToolDefinition[]
}

interface McpCallToolContent {
  type: string
  text?: string
  data?: string
}

interface McpCallToolResult {
  content?: McpCallToolContent[]
  isError?: boolean
}

interface McpInitializeResult {
  protocolVersion?: string
  capabilities?: Record<string, unknown>
  serverInfo?: { name: string; version: string }
}

// ─── MCPClient ────────────────────────────────────────────────────

/**
 * MCP 客户端，包装 ITransport 实现 JSON-RPC 2.0 通信。
 *
 * 生命周期：
 * 1. initialize() - 发送 initialize 请求，交换 capabilities
 * 2. listTools() - 发送 tools/list，获取工具列表
 * 3. callTool(name, args) - 发送 tools/call，执行工具
 * 4. close() - 关闭连接，拒绝所有待处理请求
 *
 * 每个 JSON-RPC 请求有 10s 超时。
 * MCP 工具默认标记为 high 风险等级。
 */
export class MCPClient {
  private nextId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private serverCapabilities: Record<string, unknown> | null = null
  private serverInfo: { name: string; version: string } | null = null

  /**
   * @param transport - 传输层实例（需已实现 ITransport 接口）
   */
  constructor(private readonly transport: ITransport) {
    // 注册消息处理
    this.transport.onMessage((data: string) => {
      this.handleMessage(data)
    })

    // 注册关闭处理
    this.transport.onClose(() => {
      this.handleClose()
    })

    // 注册错误处理
    this.transport.onError((error: Error) => {
      this.handleError(error)
    })
  }

  /**
   * 发送 JSON-RPC initialize 请求，交换 capabilities。
   * 完成后发送 notifications/initialized 通知。
   *
   * @throws {AppError} MCP_CONNECT_FAILED - 请求超时或返回错误
   */
  async initialize(): Promise<void> {
    const result = await this.request<McpInitializeResult>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })

    // 保存 Server 信息
    this.serverCapabilities = result.capabilities ?? {}
    this.serverInfo = result.serverInfo ?? null

    // 发送 initialized 通知（无 id，无需等待响应）
    const notification = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    await this.transport.send(notification)
  }

  /**
   * 发送 tools/list 请求，获取 MCP Server 提供的工具列表。
   * MCP 工具默认标记为 high 风险等级。
   *
   * @returns ToolDefinition 数组
   * @throws {AppError} MCP_CONNECT_FAILED - 请求超时或返回错误
   */
  async listTools(): Promise<ToolDefinition[]> {
    const result = await this.request<McpListToolsResult>('tools/list', {})
    const tools = result.tools ?? []

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? {},
      // MCP 工具默认为 high 风险（Spec v0.2 §9.3）
      riskLevel: 'high' as const,
      source: 'mcp' as const,
    }))
  }

  /**
   * 发送 tools/call 请求，执行指定工具。
   *
   * @param name - 工具名称
   * @param args - 工具参数
   * @returns ToolExecutionResult
   * @throws {AppError} MCP_CONNECT_FAILED - 请求超时或返回错误
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const result = await this.request<McpCallToolResult>('tools/call', {
      name,
      arguments: args,
    })

    // 提取文本内容
    const contentParts = (result.content ?? []).map((c) => c.text ?? c.data ?? '')
    const content = contentParts.join('')

    return {
      isError: result.isError ?? false,
      content,
      metadata: result as Record<string, unknown>,
    }
  }

  /**
   * 关闭客户端，终止连接。
   * 拒绝所有待处理请求。
   */
  async close(): Promise<void> {
    this.handleClose()
    await this.transport.close()
  }

  /**
   * 获取 Server capabilities（initialize 后可用）。
   */
  getServerCapabilities(): Record<string, unknown> | null {
    return this.serverCapabilities
  }

  /**
   * 获取 Server 信息（initialize 后可用）。
   */
  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /**
   * 发送 JSON-RPC 请求并等待响应。
   * 每个请求有 10s 超时。
   */
  private request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise<T>((resolve, reject) => {
      // 10s 请求超时
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(
            new AppError(
              ErrorCodes.MCP_CONNECT_FAILED,
              `Request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms.`,
              { method, id },
            ),
          )
        }
      }, REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      })

      this.transport.send(JSON.stringify(message)).catch((err: unknown) => {
        if (this.pendingRequests.has(id)) {
          clearTimeout(timeout)
          this.pendingRequests.delete(id)
          reject(
            err instanceof AppError
              ? err
              : new AppError(
                  ErrorCodes.MCP_CONNECT_FAILED,
                  `Failed to send request "${method}": ${err instanceof Error ? err.message : String(err)}`,
                  { method, id },
                ),
          )
        }
      })
    })
  }

  /**
   * 处理从 transport 收到的消息。
   * 解析 JSON-RPC 响应，匹配 pending 请求。
   */
  private handleMessage(data: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      // 非 JSON 数据，忽略
      return
    }

    const response = parsed as JsonRpcResponse
    if (response.jsonrpc !== '2.0' || response.id === undefined) {
      // 不是有效的 JSON-RPC 响应（可能是通知），忽略
      return
    }

    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      // 没有对应的 pending 请求，忽略
      return
    }

    this.pendingRequests.delete(response.id)
    clearTimeout(pending.timeout)

    if (response.error) {
      pending.reject(
        new AppError(ErrorCodes.MCP_CONNECT_FAILED, response.error.message, {
          jsonRpcErrorCode: response.error.code,
          data: response.error.data,
        }),
      )
    } else {
      pending.resolve(response.result)
    }
  }

  /**
   * 处理连接关闭，拒绝所有待处理请求。
   */
  private handleClose(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(
        new AppError(ErrorCodes.MCP_CONNECT_FAILED, 'MCP server connection closed.', { id }),
      )
    }
    this.pendingRequests.clear()
  }

  /**
   * 处理传输层错误。
   *
   * OPT2-14: 添加 console.error 日志记录错误信息；
   * 对于致命错误（如 EPIPE），拒绝所有 pending 请求，
   * 因为这类错误通常意味着连接已不可用，pending 请求无法再收到响应。
   */
  private handleError(error: Error): void {
    console.error(`[MCP Client] Transport error: ${error.message}`, error)

    // 判断是否为致命错误（连接已不可用，pending 请求无法再完成）
    const isFatal = isFatalError(error)

    if (isFatal && this.pendingRequests.size > 0) {
      const reason = `MCP transport fatal error: ${error.message}`
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout)
        pending.reject(
          new AppError(ErrorCodes.MCP_CONNECT_FAILED, reason, {
            id,
            cause: error.message,
          }),
        )
      }
      this.pendingRequests.clear()
    }
  }
}
