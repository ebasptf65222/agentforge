// AgentForge LangGraph 引擎: 斜杠命令委托工具
//
// 将 Copilot SDK 的斜杠命令（commands）能力以工具形式暴露。
// 当 LangGraph ReAct 循环需要执行预定义的斜杠命令时，
// 可通过 Action: copilot_commands 调用。
//
// 设计方案 B：完整委托 Copilot SDK
// - 创建临时 CopilotAgentBridge 实例
// - 将命令名和参数构造成斜杠命令格式的用户输入
// - 传入 commands 配置
// - 执行后将结果返回给 LangGraph ReAct 循环

import type { WrappedTool } from './tool-adapter'
import type { DelegationToolContext } from './types'
import type { AgentExecutionRequest, ExecutionResult } from '../../shared/types'
import type { SessionExtras, SlashCommandConfig } from '../copilot/types'
import { CopilotAgentBridge } from '../copilot/agent-bridge'
import { getSettings } from '../db/repos/app-settings'
import { generateId } from '../utils/id'

/**
 * 创建斜杠命令委托工具。
 *
 * 该工具将 Copilot SDK 的斜杠命令系统暴露给 LangGraph 引擎。
 * 当需要执行预定义的 SDK 命令时使用此工具。
 *
 * @param ctx - 委托工具上下文
 * @param commands - 可用的斜杠命令配置列表
 * @returns WrappedTool 实例
 */
export function createCommandsTool(
  ctx: DelegationToolContext,
  commands?: SlashCommandConfig[],
): WrappedTool {
  return {
    name: 'copilot_commands',
    description:
      'Execute a slash command via the Copilot SDK engine. ' +
      'Use this tool when you need to run a predefined slash command. ' +
      'Arguments: { "command": "command name without /", "args": "optional command arguments" }',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The slash command name (without the leading /)',
        },
        args: {
          type: 'string',
          description: 'Optional arguments for the command',
        },
      },
      required: ['command'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const command = String(args.command ?? '')
      const cmdArgs = args.args ? String(args.args) : ''

      if (!command) {
        return 'Error: No command specified.'
      }

      try {
        const settings = getSettings()
        const bridge = new CopilotAgentBridge({
          callbacks: ctx.callbacks,
          approvalTimeoutMs: ctx.approvalTimeoutMs,
        })

        // 构建 SessionExtras
        const extras: SessionExtras = {
          conversationId: `cmd-${generateId()}`,
        }

        // 传入可用的斜杠命令配置
        const availableCommands: SlashCommandConfig[] = commands ?? []
        if (availableCommands.length > 0) {
          extras.commands = availableCommands
        }

        // 构造斜杠命令格式的用户输入
        const userInput = cmdArgs ? `/${command} ${cmdArgs}` : `/${command}`

        const request: AgentExecutionRequest = {
          conversationId: `cmd-${generateId()}`,
          userInput,
          modelId: '',
          approvalMode: 'auto-edit',
          maxSteps: 5,
        }

        const result: ExecutionResult = await bridge.execute(request, extras)

        if (result.status === 'completed') {
          return result.summary
        }
        return `Command ${result.status}: ${result.summary}`
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return `Commands tool error: ${errMsg}`
      }
    },
  }
}
