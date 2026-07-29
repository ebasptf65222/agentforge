// AgentForge LangGraph 引擎: LangGraphAgentBridge 核心类
//
// 对标 AgentExecutor (builtin) 和 CopilotAgentBridge (copilot-sdk)：
// - execute(): 接收 AgentExecutionRequest，返回 ExecutionResult
// - cancel(): 中止当前执行（AbortController + ApprovalManager）
// - respondApproval(): 响应审批请求
// - hasPendingApproval(): 查询是否有等待中的审批
//
// Phase 1: 使用简单 ReAct 循环（createReactLoop）
// Phase 2: 迁移到 StateGraph + interrupt

import type { ExecutionResult } from '../../shared/types'
import { ApprovalManager } from '../agent/approval'
import { ModelWrapper } from './model-adapter'
import { wrapAllTools } from './tool-adapter'
import { EventConverter } from './event-converter'
import { createReactLoop } from './react-loop'
import type { LangGraphBridgeConfig, LangGraphExecuteParams } from './types'

/**
 * LangGraph Agent 桥接器。
 *
 * 作为第三引擎（builtin / copilot-sdk / langgraph）的执行入口。
 * 复用现有 ModelAdapter、ToolRegistry、ApprovalManager，
 * 通过 ModelWrapper + WrappedTool + EventConverter + createReactLoop
 * 实现完整的 ReAct 执行流程。
 */
export class LangGraphAgentBridge {
  private config: LangGraphBridgeConfig
  private approvalManager: ApprovalManager
  private abortController: AbortController | null = null
  private cancelled = false

  constructor(config: LangGraphBridgeConfig) {
    this.config = config
    this.approvalManager = new ApprovalManager()
  }

  /**
   * 执行 Agent 请求。
   *
   * 1. 创建 EventConverter、ModelWrapper、WrappedTool[]
   * 2. 调用 createReactLoop 执行 ReAct 循环
   * 3. 返回 ExecutionResult
   *
   * @param params - 执行参数（请求、适配器、工具、历史消息、Skill 提示词）
   * @returns 执行结果
   */
  async execute(params: LangGraphExecuteParams): Promise<ExecutionResult> {
    this.cancelled = false
    this.abortController = new AbortController()
    const eventConverter = new EventConverter(this.config.callbacks)

    const modelWrapper = new ModelWrapper(params.adapter, this.config.callbacks)
    const toolsArray = Array.from(params.tools.values())
    const wrappedTools = wrapAllTools(toolsArray, {
      approvalMode: params.request.approvalMode,
      approvalManager: this.approvalManager,
      approvalTimeoutMs: this.config.approvalTimeoutMs,
      callbacks: this.config.callbacks,
      executionId: params.request.conversationId,
    })

    const result = await createReactLoop({
      model: modelWrapper,
      tools: wrappedTools,
      eventConverter,
      maxSteps: params.request.maxSteps,
      skillPrompt: params.skillPrompt,
      historyMessages: params.historyMessages,
      request: params.request,
      abortSignal: this.abortController.signal,
    })

    return {
      ...result,
      executionId: params.request.conversationId,
    }
  }

  /**
   * 取消当前执行。
   * 通过 AbortController 中止 LLM 调用，通过 ApprovalManager.cancel() 中止审批等待。
   */
  cancel(): void {
    this.cancelled = true
    this.abortController?.abort()
    this.approvalManager.cancel()
  }

  /**
   * 响应当前审批请求。
   *
   * @param approved - 是否批准
   * @param reason - 可选的审批理由
   */
  respondApproval(approved: boolean, reason?: string): void {
    this.approvalManager.respond(approved, reason)
  }

  /**
   * 是否有等待中的审批。
   *
   * @returns 是否有等待中的审批
   */
  hasPendingApproval(): boolean {
    return this.approvalManager.hasPendingApproval()
  }
}
