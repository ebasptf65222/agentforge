// AgentForge LangGraph 引擎: LangGraphAgentBridge 核心类
//
// 对标 AgentExecutor (builtin) 和 CopilotAgentBridge (copilot-sdk)：
// - execute(): 接收 AgentExecutionRequest，返回 ExecutionResult
// - cancel(): 中止当前执行（AbortController + ApprovalManager）
// - respondApproval(): 响应审批请求
// - hasPendingApproval(): 查询是否有等待中的审批
//
// Phase 2: 使用 StateGraph + interrupt 替代 Phase 1 的简单 ReAct 循环
// 同时集成 langchain-mcp-adapters 加载 MCP 工具
// 集成 Memory Store 实现跨对话上下文持久化
// 集成 Copilot SDK 编码节点支持复杂编码任务

import type { ExecutionResult } from '../../shared/types'
import { ApprovalManager } from '../agent/approval'
import { ModelWrapper } from './model-adapter'
import { wrapAllTools } from './tool-adapter'
import { EventConverter } from './event-converter'
import { executeWithStateGraph } from './state-graph'
import { loadMcpToolsAsLangChain, convertAllLangChainTools, closeMcpClient } from './mcp-adapter'
import { getCheckpointer } from './checkpointer'
import { getMemoryStore } from './memory-store'
import { createCodingNodeTool } from './coding-node'
import { generateId } from '../utils/id'
import type { LangGraphBridgeConfig, LangGraphExecuteParams } from './types'

/**
 * LangGraph Agent 桥接器。
 *
 * 作为第三引擎（builtin / copilot-sdk / langgraph）的执行入口。
 * 复用现有 ModelAdapter、ToolRegistry、ApprovalManager，
 * 通过 ModelWrapper + WrappedTool + EventConverter + StateGraph
 * 实现完整的 Agent 执行流程。
 *
 * Phase 2 增强：
 * - 使用 LangGraph StateGraph 替代手动 ReAct 循环
 * - 使用 langchain-mcp-adapters 加载 MCP 工具
 * - 使用 MemorySaver checkpointer 支持中断恢复
 * - 使用 MemoryStore 持久化跨对话上下文摘要
 * - 集成 Copilot SDK 编码节点支持复杂编码任务
 */
export class LangGraphAgentBridge {
  private config: LangGraphBridgeConfig
  private approvalManager: ApprovalManager
  private abortController: AbortController | null = null

  constructor(config: LangGraphBridgeConfig) {
    this.config = config
    this.approvalManager = new ApprovalManager()
  }

  /**
   * 执行 Agent 请求。
   *
   * Phase 2 流程：
   * 1. 创建 EventConverter、ModelWrapper
   * 2. 加载跨对话上下文摘要（Memory Store）
   * 3. 加载 MCP 工具（通过 langchain-mcp-adapters）
   * 4. 合并内置工具 + MCP 工具 + 编码节点为 WrappedTool[]
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
    // 从 Memory Store 加载之前的对话摘要，注入到 Skill Prompt 中
    let enhancedSkillPrompt = params.skillPrompt
    try {
      const memoryStore = getMemoryStore()
      const contextPrompt = memoryStore.buildContextPrompt(params.request.conversationId)
      if (contextPrompt) {
        enhancedSkillPrompt = (enhancedSkillPrompt ?? '') + contextPrompt
      }
    } catch (err) {
      // Memory Store 不可用时不阻断执行
      console.warn('[LangGraph Bridge] Memory Store unavailable:', err)
    }

    // ─── 加载工具 ────────────────────────────────────────────
    // 1. 内置工具（来自 ToolRegistry）
    const builtinToolsArray = Array.from(params.tools.values())
    const wrappedBuiltinTools = wrapAllTools(builtinToolsArray, {
      approvalMode: params.request.approvalMode,
      approvalManager: this.approvalManager,
      approvalTimeoutMs: this.config.approvalTimeoutMs,
      callbacks: this.config.callbacks,
      executionId: params.request.conversationId,
    })

    // 2. MCP 工具（通过 langchain-mcp-adapters）
    let wrappedMcpTools: typeof wrappedBuiltinTools = []
    try {
      const mcpLangChainTools = await loadMcpToolsAsLangChain()
      if (mcpLangChainTools.length > 0) {
        wrappedMcpTools = convertAllLangChainTools(mcpLangChainTools, {
          approvalMode: params.request.approvalMode,
          approvalManager: this.approvalManager,
          approvalTimeoutMs: this.config.approvalTimeoutMs,
          callbacks: this.config.callbacks,
          executionId: params.request.conversationId,
        })
      }
    } catch (err) {
      console.error('[LangGraph Bridge] Failed to load MCP tools:', err)
      // MCP 加载失败不阻断执行，降级为仅内置工具
    }

    // 3. Copilot SDK 编码节点（可选工具）
    let codingNodeTool: typeof wrappedBuiltinTools = []
    try {
      const codingTool = createCodingNodeTool({
        callbacks: this.config.callbacks,
        approvalTimeoutMs: this.config.approvalTimeoutMs,
      })
      codingNodeTool = [codingTool]
    } catch (err) {
      console.warn('[LangGraph Bridge] Coding node unavailable:', err)
    }

    // 合并工具
    const allTools = [...wrappedBuiltinTools, ...wrappedMcpTools, ...codingNodeTool]

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
      })

      result = {
        ...result,
        executionId: params.request.conversationId,
      }
    } finally {
      // 清理 MCP 连接
      await closeMcpClient()
    }

    // ─── 保存对话上下文摘要 ──────────────────────────────────
    // 执行完成后，将摘要保存到 Memory Store 供下次对话使用
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
      // Memory Store 保存失败不阻断结果返回
      console.warn('[LangGraph Bridge] Failed to save conversation summary:', err)
    }

    return result
  }

  /**
   * 取消当前执行。
   * 通过 AbortController 中止 LLM 调用，通过 ApprovalManager.cancel() 中止审批等待。
   */
  cancel(): void {
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
