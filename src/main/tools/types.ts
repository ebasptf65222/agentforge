// AgentForge P2-05/P2-06: 工具类型定义
// 与 Spec v0.2 §5.5 工具与 MCP 类型一致

import type { ToolDefinition, ToolExecutionResult, ToolRiskLevel } from '@shared/types'
import type { RegisteredTool as BaseRegisteredTool } from '../agent/types'

export type { ToolDefinition, ToolExecutionResult, ToolRiskLevel }

/**
 * 工具执行函数签名。
 */
export type ToolExecuteFn = (args: Record<string, unknown>) => Promise<ToolExecutionResult>

/**
 * 内置工具接口。
 */
export interface BuiltinTool {
  definition: ToolDefinition
  execute: ToolExecuteFn
}

/**
 * 工具注册条目（扩展基础类型，增加来源标识）。
 * 继承自 agent/types.ts 的 RegisteredTool，添加 source 和 mcpServerId 字段。
 */
export interface RegisteredTool extends BaseRegisteredTool {
  source: 'builtin' | 'mcp'
  mcpServerId?: string
}
