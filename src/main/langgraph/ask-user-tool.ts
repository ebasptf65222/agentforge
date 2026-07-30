// AgentForge LangGraph 引擎: ask_user 委托工具
//
// 将 Copilot SDK 独有的 ask_user 能力以 LangGraph 工具形式暴露。
// 当 ReAct 循环中 LLM 需要向用户提问时，可通过 Action: copilot_ask_user 调用。
//
// 设计方案 A：直接集成 UserInputManager（不创建完整 Copilot SDK session）
// - 在工具 execute() 内部调用 userInputManager.requestUserInput()
// - 通过 callbacks.onStreamChunk 推送 ask-user chunk 到前端
// - 等待 IPC agent:respond-user-input 响应后返回用户输入
// - 超时返回空字符串（默认 5 分钟）

import type { WrappedTool } from './tool-adapter'
import type { DelegationToolContext } from './types'
import type { UserInputManager } from '../agent/user-input'
import type { UserInputRequest } from '../../shared/types'

/**
 * 创建 ask_user 委托工具。
 *
 * 该工具允许 LangGraph ReAct 循环中的 AI 主动向用户提问并等待回答。
 * 内部使用 UserInputManager 创建 Promise 等待器，
 * 通过 IPC 双向通信获取用户输入。
 *
 * @param ctx - 委托工具上下文
 * @param userInputManager - 用户输入管理器（由 LangGraphAgentBridge 注入）
 * @returns WrappedTool 实例
 */
export function createAskUserTool(
  ctx: DelegationToolContext,
  userInputManager: UserInputManager,
): WrappedTool {
  return {
    name: 'copilot_ask_user',
    description:
      'Ask the user a question and wait for their response. ' +
      'Use this tool when you need clarification, confirmation, or additional information from the user. ' +
      'Arguments: { "question": "the question to ask the user" }',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to present to the user',
        },
      },
      required: ['question'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const question = String(args.question ?? '')
      if (!question) {
        return 'Error: No question provided.'
      }

      try {
        const response = await userInputManager.requestUserInput(
          ctx.executionId,
          question,
          (req: UserInputRequest) => {
            ctx.callbacks.onStreamChunk({
              type: 'ask-user',
              content: JSON.stringify(req),
            })
          },
          ctx.approvalTimeoutMs,
        )

        if (!response) {
          return 'No response received (timeout or cancelled).'
        }
        return response
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return `ask_user error: ${errMsg}`
      }
    },
  }
}
