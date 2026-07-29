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

/** LangGraph 执行参数 */
export interface LangGraphExecuteParams {
  request: AgentExecutionRequest
  adapter: ModelAdapter
  tools: Map<string, RegisteredTool>
  historyMessages: AgentContextMessage[]
  skillPrompt?: string
}
