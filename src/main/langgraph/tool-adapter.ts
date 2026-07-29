// LangGraph 引擎: 工具适配层
// 将 AgentForge RegisteredTool 包装为 ReAct 循环可调用的 WrappedTool
// Phase 3: 审批由 StateGraph interrupt() 在图级别处理，工具仅负责执行

import type { RegisteredTool } from '../tools/types'
import type { ToolExecutionResult } from '../../shared/types'
import type { ToolRiskLevel } from '../../shared/types'

/** 包装后的工具 */
export interface WrappedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** 工具风险等级（Phase 3: 用于 StateGraph interrupt 审批决策） */
  riskLevel?: ToolRiskLevel
  execute: (args: Record<string, unknown>) => Promise<string>
}

/**
 * 将 RegisteredTool 转换为 WrappedTool（不含审批检查）。
 *
 * Phase 3: 用于 LangGraph interrupt() 审批模式。
 * 审批由 StateGraph 的 tools 节点通过 interrupt() 处理，
 * 而非嵌入在 tool.execute() 内部。
 *
 * @param tool - 注册的工具
 * @returns 不含审批检查的 WrappedTool（保留 riskLevel）
 */
export function toWrappedTool(tool: RegisteredTool): WrappedTool {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    inputSchema: tool.definition.inputSchema,
    riskLevel: tool.definition.riskLevel,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const result: ToolExecutionResult = await tool.execute(args)
      return result.content
    },
  }
}

/**
 * 批量转换 RegisteredTool 为 WrappedTool（不含审批检查）。
 *
 * @param tools - 工具注册表
 * @returns 不含审批检查的 WrappedTool 数组
 */
export function toWrappedTools(tools: Map<string, RegisteredTool>): WrappedTool[] {
  const wrapped: WrappedTool[] = []
  for (const tool of tools.values()) {
    wrapped.push(toWrappedTool(tool))
  }
  return wrapped
}
