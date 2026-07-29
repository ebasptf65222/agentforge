// AgentForge LangGraph 引擎: StateGraph 构建
//
// Phase 1: 简单 ReAct 循环（不使用 StateGraph）
//   由于 LangChain.js 的 createAgent 需要 BaseChatModel 实例，
//   而我们用 ModelWrapper（不继承 BaseChatModel），
//   所以 Phase 1 直接在 react-loop.ts 中实现简单的 ReAct 循环。
//
// Phase 2: 迁移到显式 StateGraph + interrupt
//   使用 LangGraph 的 StateGraph 构建 agent 循环图，
//   包含 agent（调用 LLM）和 tools（执行工具）两个节点，
//   审批通过 interrupt() 暂停/恢复。

import type { WrappedTool } from './tool-adapter'
import type { ModelWrapper } from './model-adapter'
import type { EventConverter } from './event-converter'
import type { AgentContextMessage } from '../agent/types'
import type { AgentExecutionRequest } from '../../shared/types'

/** StateGraph 构建选项（Phase 2 使用） */
export interface GraphBuildOptions {
  model: ModelWrapper
  tools: WrappedTool[]
  eventConverter: EventConverter
  maxSteps: number
  systemPrompt?: string
  skillPrompt?: string
  historyMessages: AgentContextMessage[]
  request: AgentExecutionRequest
}

/**
 * Phase 1: 简单 ReAct 循环（不使用 StateGraph）。
 * Phase 2: 迁移到显式 StateGraph + interrupt。
 */
export { createReactLoop } from './react-loop'
