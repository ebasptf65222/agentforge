// AgentForge LangGraph 引擎内部类型定义
// 与 langgraph-integration-plan.md Phase 1 一致
// 作为第三引擎（builtin / copilot-sdk / langgraph）并行存在，不改动现有引擎

import type { AgentEventCallbacks, AgentContextMessage } from '../agent/types'
import type { RegisteredTool } from '../tools/types'
import type { ModelAdapter } from '../models/adapter'
import type { AgentExecutionRequest } from '../../shared/types'

/** LangGraph 引擎配置 */
export interface LangGraphBridgeConfig {
  callbacks: AgentEventCallbacks
  approvalTimeoutMs: number
}

/**
 * 委托工具上下文。
 *
 * 提供 ask_user / elicitation 等交互工具所需的共享依赖，
 * 使 LangGraph ReAct 循环中的工具能够与前端进行双向 IPC 通信。
 */
export interface DelegationToolContext {
  /** 当前执行 ID（用于关联 IPC 响应） */
  executionId: string
  /** 事件回调（推送 ask-user / elicitation-request chunk 到前端） */
  callbacks: AgentEventCallbacks
  /** 审批超时时间（同时用作用户输入超时） */
  approvalTimeoutMs: number
}

/** LangGraph 执行参数 */
export interface LangGraphExecuteParams {
  request: AgentExecutionRequest
  adapter: ModelAdapter
  tools: Map<string, RegisteredTool>
  historyMessages: AgentContextMessage[]
  skillPrompt?: string
}
