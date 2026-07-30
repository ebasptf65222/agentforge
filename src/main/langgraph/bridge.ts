// AgentForge LangGraph 引擎: LangGraphAgentBridge 核心类
//
// 对标 AgentExecutor (builtin) 和 CopilotAgentBridge (copilot-sdk)：
// - execute(): 接收 AgentExecutionRequest，返回 ExecutionResult
// - cancel(): 中止当前执行（AbortController + ApprovalManager + UserInputManager）
// - respondApproval(): 响应审批请求
// - respondToUserInput(): 响应 ask_user 请求（委托工具集成）
// - respondToElicitation(): 响应 elicitation 请求（委托工具集成）
// - hasPendingApproval(): 查询是否有等待中的审批
//
// Phase 2: 使用 StateGraph + interrupt 替代 Phase 1 的简单 ReAct 循环
// 同时集成 langchain-mcp-adapters 加载 MCP 工具
// 集成 Memory Store 实现跨对话上下文持久化
// 集成 Copilot SDK 编码节点支持复杂编码任务
//
// 委托工具集成：
// - copilot_coding: 编码任务委托（已有）
// - copilot_ask_user: 用户提问（方案 A：直接集成 UserInputManager）
// - copilot_elicitation: 表单交互（方案 A：直接集成 UserInputManager）
// - copilot_skills: 技能调用（方案 B：委托 Copilot SDK）
// - copilot_commands: 斜杠命令（方案 B：委托 Copilot SDK）

import type { ExecutionResult } from '../../shared/types'
import { ApprovalManager } from '../agent/approval'
import { UserInputManager } from '../agent/user-input'
import { ModelWrapper } from './model-adapter'
import { toWrappedTools } from './tool-adapter'
import { EventConverter } from './event-converter'
import { executeWithStateGraph } from './state-graph'
import { loadMcpToolsAsLangChain, convertAllLangChainToolsRaw, closeMcpClient } from './mcp-adapter'
import { getCheckpointer } from './checkpointer'
import { getMemoryStore } from './memory-store'
import { createCodingNodeTool } from './coding-node'
import { createAskUserTool } from './ask-user-tool'
import { createElicitationTool } from './elicitation-tool'
import { createSkillsTool } from './skills-tool'
import { createCommandsTool } from './commands-tool'
import { getModelContextWindow } from '../agent/context-manager'
import { generateId } from '../utils/id'
import type { LangGraphBridgeConfig, LangGraphExecuteParams, DelegationToolContext } from './types'

/**
 * LangGraph Agent 桥接器。
 *
 * 作为第三引擎（builtin / copilot-sdk / langgraph）的执行入口。
 * 复用现有 ModelAdapter、ToolRegistry、ApprovalManager、UserInputManager，
 * 通过 ModelWrapper + WrappedTool + EventConverter + StateGraph
 * 实现完整的 Agent 执行流程。
 *
 * 委托工具集成：
 * - ask_user / elicitation: 直接集成 UserInputManager（方案 A）
 * - skills / commands: 完整委托 CopilotAgentBridge（方案 B）
 * - coding: 完整委托 CopilotAgentBridge（已有）
 */
export class LangGraphAgentBridge {
  private config: LangGraphBridgeConfig
  private approvalManager: ApprovalManager
  private userInputManager: UserInputManager
  private abortController: AbortController | null = null

  constructor(config: LangGraphBridgeConfig) {
    this.config = config
    this.approvalManager = new ApprovalManager()
    this.userInputManager = new UserInputManager()
  }

  /**
   * 执行 Agent 请求。
   *
   * 流程：
   * 1. 创建 EventConverter、ModelWrapper
   * 2. 加载跨对话上下文摘要（Memory Store）
   * 3. 加载 MCP 工具（通过 langchain-mcp-adapters）
   * 4. 合并内置工具 + MCP 工具 + 委托工具为 WrappedTool[]
   * 5. 调用 executeWithStateGraph 执行 StateGraph
   * 6. 保存对话上下文摘要
   * 7. 返回 ExecutionResult
   *
   * @param params - 执行参数（请求、适配器、工具、历史消息、Skill 提示词）
   * @returns 执行结果
   */
  async execute(params: LangGraphExecuteParams): Promise<ExecutionResult> {
    this.abortController = new AbortController()
    const eventConverter = new EventConverter(this.config.callbacks)

    const modelWrapper = new ModelWrapper(params.adapter, this.config.callbacks)

    // ─── 加载跨对话上下文摘要 ────────────────────────────────
    let enhancedSkillPrompt = params.skillPrompt
    try {
      const memoryStore = getMemoryStore()
      const contextPrompt = memoryStore.buildContextPrompt(params.request.conversationId)
      if (contextPrompt) {
        enhancedSkillPrompt = (enhancedSkillPrompt ?? '') + contextPrompt
      }
    } catch (err) {
      console.warn('[LangGraph Bridge] Memory Store unavailable:', err)
    }

    // ─── 构建委托工具上下文 ────────────────────────────────
    const delegationCtx: DelegationToolContext = {
      executionId: params.request.conversationId,
      callbacks: this.config.callbacks,
      approvalTimeoutMs: this.config.approvalTimeoutMs,
    }

    // ─── 加载工具 ────────────────────────────────────────────
    // 1. 内置工具（不含审批检查，审批由 StateGraph interrupt() 处理）
    const wrappedBuiltinTools = toWrappedTools(params.tools)

    // 2. MCP 工具（通过 langchain-mcp-adapters）
    let wrappedMcpTools: typeof wrappedBuiltinTools = []
    try {
      const mcpLangChainTools = await loadMcpToolsAsLangChain()
      if (mcpLangChainTools.length > 0) {
        wrappedMcpTools = convertAllLangChainToolsRaw(mcpLangChainTools)
      }
    } catch (err) {
      console.error('[LangGraph Bridge] Failed to load MCP tools:', err)
    }

    // 3. 委托工具集（Copilot SDK 功能集成）
    const delegationTools: typeof wrappedBuiltinTools = []

    // 3a. 编码节点（委托 Copilot SDK）
    try {
      const codingTool = createCodingNodeTool({
        callbacks: this.config.callbacks,
        approvalTimeoutMs: this.config.approvalTimeoutMs,
      })
      delegationTools.push(codingTool)
    } catch (err) {
      console.warn('[LangGraph Bridge] Coding node unavailable:', err)
    }

    // 3b. ask_user（直接集成 UserInputManager）
    try {
      const askUserTool = createAskUserTool(delegationCtx, this.userInputManager)
      delegationTools.push(askUserTool)
    } catch (err) {
      console.warn('[LangGraph Bridge] ask_user tool unavailable:', err)
    }

    // 3c. elicitation（直接集成 UserInputManager）
    try {
      const elicitationTool = createElicitationTool(delegationCtx, this.userInputManager)
      delegationTools.push(elicitationTool)
    } catch (err) {
      console.warn('[LangGraph Bridge] elicitation tool unavailable:', err)
    }

    // 3d. skills（委托 Copilot SDK）
    try {
      const skillsTool = createSkillsTool(delegationCtx)
      delegationTools.push(skillsTool)
    } catch (err) {
      console.warn('[LangGraph Bridge] skills tool unavailable:', err)
    }

    // 3e. commands（委托 Copilot SDK）
    try {
      const commandsTool = createCommandsTool(
        delegationCtx,
        params.request.commands,
      )
      delegationTools.push(commandsTool)
    } catch (err) {
      console.warn('[LangGraph Bridge] commands tool unavailable:', err)
    }

    // 合并所有工具
    const allTools = [...wrappedBuiltinTools, ...wrappedMcpTools, ...delegationTools]

    // ─── 执行 StateGraph ──────────────────────────────────────
    const checkpointer = getCheckpointer()
    const threadId = `${params.request.conversationId}-${generateId()}`

    let result: ExecutionResult
    try {
      result = await executeWithStateGraph({
        model: modelWrapper,
        tools: allTools,
        eventConverter,
        maxSteps: params.request.maxSteps,
        skillPrompt: enhancedSkillPrompt,
        historyMessages: params.historyMessages,
        request: params.request,
        abortSignal: this.abortController.signal,
        approvalManager: this.approvalManager,
        approvalMode: params.request.approvalMode,
        approvalTimeoutMs: this.config.approvalTimeoutMs,
        checkpointer,
        threadId,
        callbacks: this.config.callbacks,
        maxContextLength: getModelContextWindow(params.request.modelId),
      })

      result = {
        ...result,
        executionId: params.request.conversationId,
      }
    } finally {
      // 清理 MCP 连接
      try {
        await closeMcpClient()
      } catch (err) {
        console.warn('[LangGraph Bridge] Failed to close MCP client:', err)
      }
      this.abortController = null
    }

    // ─── 保存对话上下文摘要 ──────────────────────────────────
    try {
      const memoryStore = getMemoryStore()
      if (result.status === 'completed' && result.summary) {
        memoryStore.saveConversationSummary(
          params.request.conversationId,
          result.summary,
          {
            totalSteps: result.totalSteps,
            duration: result.duration,
            tokensUsed: result.tokensUsed,
            timestamp: Date.now(),
          },
        )
      }
    } catch (err) {
      console.warn('[LangGraph Bridge] Failed to save conversation summary:', err)
    }

    return result
  }

  /**
   * 取消当前执行。
   * 通过 AbortController 中止 LLM 调用，
   * 通过 ApprovalManager.cancel() 中止审批等待，
   * 通过 UserInputManager.cancel() 中止用户输入等待。
   */
  cancel(): void {
    this.abortController?.abort()
    this.approvalManager.cancel()
    this.userInputManager.cancel()
  }

  /**
   * 响应当前审批请求。
   *
   * @param approved - 是否批准
   * @param reason - 可选的审批理由
   * @param executionId - 可选的执行 ID，用于校验响应是否对应当前等待中的审批
   */
  respondApproval(approved: boolean, reason?: string, executionId?: string): void {
    this.approvalManager.respond(approved, reason, executionId)
  }

  /**
   * 响应当前的 ask_user 请求。
   *
   * 由 IPC handler agent:respond-user-input 调用。
   * 当 LangGraph 引擎中 copilot_ask_user 工具触发后，
   * 前端通过 IPC 回复用户输入，此方法将响应传递给 UserInputManager。
   *
   * @param requestId - 请求 ID
   * @param response - 用户输入的文本
   * @returns 是否成功响应
   */
  respondToUserInput(requestId: string, response: string): boolean {
    return this.userInputManager.respondToUserInput(requestId, response)
  }

  /**
   * 响应当前的 elicitation 请求。
   *
   * 由 IPC handler agent:respond-elicitation 调用。
   * 当 LangGraph 引擎中 copilot_elicitation 工具触发后，
   * 前端通过 IPC 回复表单数据，此方法将响应传递给 UserInputManager。
   *
   * @param requestId - 请求 ID
   * @param response - 用户提交的表单数据
   * @returns 是否成功响应
   */
  respondToElicitation(requestId: string, response: Record<string, unknown>): boolean {
    return this.userInputManager.respondToElicitation(requestId, response)
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
