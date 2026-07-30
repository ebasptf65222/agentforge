// AgentForge LangGraph 引擎: Skills 委托工具
//
// 将 Copilot SDK 的原生技能系统（skillDirectories / enableSkills）以工具形式暴露。
// 当 LangGraph ReAct 循环需要利用 SDK 原生技能能力（磁盘技能发现、加载等）时，
// 可通过 Action: copilot_skills 调用。
//
// 设计方案 B：完整委托 Copilot SDK
// - 创建临时 CopilotAgentBridge 实例
// - 传入 skillDirectories / enableSkills / disabledSkills 等配置
// - 执行后将摘要返回给 LangGraph ReAct 循环

import type { WrappedTool } from './tool-adapter'
import type { DelegationToolContext } from './types'
import type { AgentExecutionRequest, ExecutionResult } from '../../shared/types'
import type { SessionExtras } from '../copilot/types'
import { CopilotAgentBridge } from '../copilot/agent-bridge'
import { getSettings } from '../db/repos/app-settings'
import { generateId } from '../utils/id'

/**
 * 创建 Skills 委托工具。
 *
 * 该工具将 Copilot SDK 的原生技能系统暴露给 LangGraph 引擎。
 * 当需要从磁盘目录自动发现和加载技能时使用此工具。
 *
 * @param ctx - 委托工具上下文
 * @returns WrappedTool 实例
 */
export function createSkillsTool(ctx: DelegationToolContext): WrappedTool {
  return {
    name: 'copilot_skills',
    description:
      'Delegate a skill-based task to the Copilot SDK engine with native skill discovery. ' +
      'Use this tool when you need to leverage SDK native skills from disk directories. ' +
      'Arguments: { "skillName": "optional skill name", "task": "description of the task" }',
    inputSchema: {
      type: 'object',
      properties: {
        skillName: {
          type: 'string',
          description: 'Optional skill name to activate (if not provided, auto-discovery is used)',
        },
        task: {
          type: 'string',
          description: 'Description of the task to execute with the skill',
        },
      },
      required: ['task'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const task = String(args.task ?? '')
      const skillName = args.skillName ? String(args.skillName) : undefined

      if (!task) {
        return 'Error: No task specified.'
      }

      try {
        const settings = getSettings()
        const bridge = new CopilotAgentBridge({
          callbacks: ctx.callbacks,
          approvalTimeoutMs: ctx.approvalTimeoutMs,
        })

        // 构建 SessionExtras，传入技能相关配置
        const extras: SessionExtras = {
          conversationId: `skills-${generateId()}`,
          enableSkills: true,
          enableConfigDiscovery: settings.copilotEnableConfigDiscovery ?? false,
        }

        if (settings.copilotSkillDirectories && settings.copilotSkillDirectories.length > 0) {
          extras.skillDirectories = settings.copilotSkillDirectories
        }
        if (settings.copilotDisabledSkills && settings.copilotDisabledSkills.length > 0) {
          extras.disabledSkills = settings.copilotDisabledSkills
        }
        if (settings.copilotEnableMemory) {
          extras.enableMemory = true
        }

        const request: AgentExecutionRequest = {
          conversationId: `skills-${generateId()}`,
          userInput: task,
          modelId: '',
          approvalMode: 'auto-edit',
          maxSteps: 10,
          skillName,
        }

        const result: ExecutionResult = await bridge.execute(request, extras)

        if (result.status === 'completed') {
          return result.summary
        }
        return `Skills task ${result.status}: ${result.summary}`
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return `Skills tool error: ${errMsg}`
      }
    },
  }
}
