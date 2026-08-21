// AgentForge LangGraph 引擎: Copilot SDK 编码节点 (P2-03)
//
// 将 Copilot SDK 的编码能力封装为 LangGraph 可调用的工具节点。
// 当 LangGraph 引擎需要执行复杂编码任务（文件操作、代码分析、重构等）时，
// 可以将任务委托给 Copilot SDK 引擎处理。
//
// 设计目标：
// - 作为 WrappedTool 注册到 LangGraph 工具列表
// - 接收编码任务描述和工作目录
// - 内部调用 CopilotAgentBridge 执行编码任务
// - 将结果返回给 LangGraph ReAct 循环
// - 复用现有 Copilot SDK 的所有配置（BYOK、MCP、Skills 等）

import type { WrappedTool } from './tool-adapter'
import type { AgentEventCallbacks } from '../agent/types'
import type { AgentExecutionRequest, ExecutionResult } from '../../shared/types'
import type { ModelAdapter } from '../models/adapter'
import { CopilotAgentBridge } from '../copilot/agent-bridge'
import { checkCopilotCliAvailability } from '../copilot/session-manager'
import type { SessionExtras } from '../copilot/types'
import { getSettings } from '../db/repos/app-settings'
import { generateId } from '../utils/id'

// ─── 编码节点选项 ─────────────────────────────────────────────────

export interface CodingNodeOptions {
  /** 工作目录路径 */
  workingDirectory?: string
  /** 模型适配器（用于 Copilot SDK 的 BYOK 配置） */
  modelAdapter?: ModelAdapter
  /** Agent 事件回调（用于流式输出） */
  callbacks?: AgentEventCallbacks
  /** 审批超时时间 */
  approvalTimeoutMs?: number
}

// ─── 编码节点工具 ─────────────────────────────────────────────────

/**
 * 创建 Copilot SDK 编码节点工具。
 *
 * 该工具将 Copilot SDK 的编码能力暴露给 LangGraph 引擎，
 * 当 LangGraph 的 ReAct 循环需要执行复杂编码任务时，
 * 可以通过 Action: copilot_coding 调用此工具。
 *
 * @param options - 编码节点选项
 * @returns WrappedTool 实例
 */
export function createCodingNodeTool(options: CodingNodeOptions): WrappedTool {
  return {
    name: 'copilot_coding',
    description:
      'Delegate a coding task to the Copilot SDK engine. ' +
      'Use this tool when you need to perform complex coding operations ' +
      'such as file editing, code analysis, refactoring, or running code. ' +
      'Arguments: { "task": "description of the coding task", "workingDirectory": "optional path" }',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of the coding task to perform',
        },
        workingDirectory: {
          type: 'string',
          description: 'Working directory for the coding task (optional)',
        },
      },
      required: ['task'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const task = String(args.task ?? '')

      if (!task) {
        return 'Error: No coding task specified.'
      }

      // 预检测 CLI 可用性，避免 30 秒超时等待
      const cliCheck = checkCopilotCliAvailability()
      if (!cliCheck.available) {
        return (
          'Error: Copilot CLI is not available. ' +
          (cliCheck.reason ?? 'Please install @github/copilot to use this feature.')
        )
      }

      try {
        // 创建 Copilot SDK bridge
        const callbacks: AgentEventCallbacks = options.callbacks ?? {
          onTrajectory: () => {},
          onApprovalRequest: () => {},
          onStreamChunk: () => {},
        }

        const settings = getSettings()
        const bridge = new CopilotAgentBridge({
          callbacks,
          approvalTimeoutMs: options.approvalTimeoutMs ?? settings.approvalTimeoutMs,
        })

        // 解析工作目录：工具参数 > 节点选项 > 设置中的工作区路径
        const argDir = args.workingDirectory
        const workingDir =
          typeof argDir === 'string' && argDir.trim() !== ''
            ? argDir.trim()
            : (options.workingDirectory ?? settings.workspace.path ?? undefined)

        // 构建执行请求
        const request: AgentExecutionRequest = {
          conversationId: `coding-${generateId()}`,
          userInput: task,
          modelId: args.modelId ? String(args.modelId) : '',
          approvalMode: 'auto-edit',
          maxSteps: 20,
        }

        // 执行编码任务（传入工作目录，确保文件写入用户工作区）
        const extras: SessionExtras = {}
        if (workingDir) {
          extras.workingDirectory = workingDir
        }
        const result: ExecutionResult = await bridge.execute(request, extras)

        // 返回结果摘要
        if (result.status === 'completed') {
          return result.summary
        } else {
          return `Coding task ${result.status}: ${result.summary}`
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        // 优化错误消息：对 CLI 相关错误提供更友好的提示
        if (errMsg.includes('Timeout waiting for CLI') || errMsg.includes('CLI server')) {
          return (
            'Error: Copilot CLI failed to start. This may be due to:\n' +
            '1. Copilot CLI is not installed\n' +
            '2. Node.js is not in the system PATH\n' +
            '3. The CLI binary is corrupted\n\n' +
            'Please install @github/copilot and ensure Node.js is available.\n' +
            'You can also set COPILOT_CLI_PATH environment variable to specify the CLI path.\n' +
            `Original error: ${errMsg}`
          )
        }
        return `Coding node error: ${errMsg}`
      }
    },
  }
}

// ─── 编码节点管理 ─────────────────────────────────────────────────

/** 当前编码节点实例 */
let codingNodeTool: WrappedTool | null = null

/**
 * 获取或创建编码节点工具（单例）。
 *
 * @param options - 编码节点选项
 * @returns WrappedTool 实例
 */
export function getCodingNodeTool(options: CodingNodeOptions): WrappedTool {
  if (!codingNodeTool) {
    codingNodeTool = createCodingNodeTool(options)
  }
  return codingNodeTool
}

/**
 * 重置编码节点（仅供测试使用）。
 */
export function resetCodingNode(): void {
  codingNodeTool = null
}
