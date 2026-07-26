// AgentForge P2-05/P2-06: 工具类型定义
// 与 Spec v0.2 §5.5 工具与 MCP 类型一致

import type { ToolDefinition, ToolExecutionResult, ToolRiskLevel } from '@shared/types'

export type { ToolDefinition, ToolExecutionResult, ToolRiskLevel }

/**
 * 工具执行函数签名。
 */
export type ToolExecuteFn = (
  args: Record<string, unknown>,
) => Promise<ToolExecutionResult>

/**
 * 内置工具接口。
 */
export interface BuiltinTool {
  definition: ToolDefinition
  execute: ToolExecuteFn
}

/**
 * 工具注册条目。
 */
export interface RegisteredTool {
  definition: ToolDefinition
  execute: ToolExecuteFn
  source: 'builtin' | 'mcp'
  mcpServerId?: string
}
