// LangGraph 引擎: 工具适配层
// 将 AgentForge RegisteredTool 包装为 ReAct 循环可调用的 WrappedTool
// 在 execute 前嵌入审批检查，复用现有 shouldRequireApproval + ApprovalManager

import type { RegisteredTool } from '../tools/types'
import type { AgentEventCallbacks } from '../agent/types'
import type {
  ToolExecutionResult,
  ToolAction,
  ApprovalMode,
  ApprovalRequest,
} from '../../shared/types'
import { shouldRequireApproval, buildToolAction } from '../agent/approval'
import type { ApprovalManager } from '../agent/approval'

/** 工具包装选项 */
export interface ToolWrapOptions {
  approvalMode: ApprovalMode
  approvalManager: ApprovalManager
  approvalTimeoutMs: number
  callbacks: AgentEventCallbacks
  executionId: string
}

/** 包装后的工具 */
export interface WrappedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<string>
}

/**
 * 将单个 RegisteredTool 包装为 LangGraph 可用工具
 * 在执行前嵌入审批检查
 */
export function wrapTool(tool: RegisteredTool, options: ToolWrapOptions): WrappedTool {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    inputSchema: tool.definition.inputSchema,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const toolAction: ToolAction = buildToolAction(
        tool.definition.name,
        args,
        tool.definition.riskLevel,
      )
      const needsApproval = shouldRequireApproval(toolAction, options.approvalMode)

      if (needsApproval) {
        const step = Date.now() // 简化：用时间戳作为 step
        const approvalRequest: ApprovalRequest = {
          executionId: options.executionId,
          step,
          toolAction,
          reason: `Tool "${tool.definition.name}" requires approval (risk: ${toolAction.riskLevel})`,
        }

        const response = await options.approvalManager.requestApproval(
          approvalRequest,
          options.approvalTimeoutMs,
          options.callbacks.onApprovalRequest,
        )

        if (!response.approved) {
          return `Tool execution was ${response.reason === 'TIMEOUT' ? 'timed out' : 'rejected'}.`
        }
      }

      const result: ToolExecutionResult = await tool.execute(args)
      return result.content
    },
  }
}

/** 批量包装所有工具 */
export function wrapAllTools(
  tools: Map<string, RegisteredTool>,
  options: ToolWrapOptions,
): WrappedTool[] {
  const wrapped: WrappedTool[] = []
  for (const tool of tools.values()) {
    wrapped.push(wrapTool(tool, options))
  }
  return wrapped
}
