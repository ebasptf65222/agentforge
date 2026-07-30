// AgentForge 共享类型定义 - 工具与 MCP 类型
// 与 Spec v0.2 §5.5 一致

import type { ToolRiskLevel, TransportType } from './enums'

// ─── 5.5 工具与 MCP 类型 ───────────────────────────────────────────

/** 工具定义 */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  riskLevel: ToolRiskLevel
  source: 'builtin' | 'mcp'
}

/** 工具执行结果 */
export interface ToolExecutionResult {
  isError: boolean
  content: string
  metadata?: Record<string, unknown>
}

/** MCP Server 配置 */
export interface MCPServerConfig {
  id: string
  name: string
  transport: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** MCP 传输层接口 */
export interface ITransport {
  connect(): Promise<void>
  send(message: string): Promise<void>
  onMessage(callback: (data: string) => void): void
  onClose(callback: () => void): void
  onError(callback: (error: Error) => void): void
  close(): Promise<void>
}
