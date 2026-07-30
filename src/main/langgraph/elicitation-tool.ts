// AgentForge LangGraph 引擎: elicitation 委托工具
//
// 将 Copilot SDK 独有的 elicitation（表单交互）能力以 LangGraph 工具形式暴露。
// 当 ReAct 循环中 LLM 需要收集结构化用户输入时，可通过 Action: copilot_elicitation 调用。
//
// 设计方案 A：直接集成 UserInputManager（不创建完整 Copilot SDK session）
// - 在工具 execute() 内部调用 userInputManager.requestElicitation()
// - 通过 callbacks.onStreamChunk 推送 elicitation-request chunk 到前端
// - 等待 IPC agent:respond-elicitation 响应后返回表单数据
// - 超时返回空 JSON 对象（默认 5 分钟）

import type { WrappedTool } from './tool-adapter'
import type { DelegationToolContext } from './types'
import type { UserInputManager } from '../agent/user-input'
import type { ElicitationRequest } from '../../shared/types'

/**
 * 创建 elicitation 委托工具。
 *
 * 该工具允许 LangGraph ReAct 循环中的 AI 向用户展示结构化表单并收集输入。
 * 内部使用 UserInputManager 创建 Promise 等待器，
 * 通过 IPC 双向通信获取用户提交的表单数据。
 *
 * @param ctx - 委托工具上下文
 * @param userInputManager - 用户输入管理器（由 LangGraphAgentBridge 注入）
 * @returns WrappedTool 实例
 */
export function createElicitationTool(
  ctx: DelegationToolContext,
  userInputManager: UserInputManager,
): WrappedTool {
  return {
    name: 'copilot_elicitation',
    description:
      'Present a structured form to the user and collect their input. ' +
      'Use this tool when you need structured data (e.g., configuration options, file paths, selections). ' +
      'Arguments: { "message": "prompt message", "form": { "field1": { "type": "string", "label": "..." } } }',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'A prompt message to display above the form',
        },
        form: {
          type: 'object',
          description: 'Form field definitions (JSON Schema-like structure)',
        },
      },
      required: ['message'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const message = String(args.message ?? '')
      const form = (args.form as Record<string, unknown>) ?? {}

      if (!message) {
        return 'Error: No message provided.'
      }

      try {
        const response = await userInputManager.requestElicitation(
          ctx.executionId,
          message,
          form,
          (req: ElicitationRequest) => {
            ctx.callbacks.onStreamChunk({
              type: 'elicitation-request',
              content: JSON.stringify(req),
            })
          },
          ctx.approvalTimeoutMs,
        )

        const keys = Object.keys(response)
        if (keys.length === 0) {
          return 'No form data received (timeout or cancelled).'
        }
        return JSON.stringify(response)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return `elicitation error: ${errMsg}`
      }
    },
  }
}
