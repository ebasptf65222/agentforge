// AgentForge 架构优化批次二 - 任务2: 三引擎共用代码提取
//
// 三个引擎（builtin / copilot-sdk / langgraph）存在大量重复代码：
// - 历史消息加载 + manageContext（builtin & langgraph 重复）
// - 结果保存模式（三处重复）
// - 错误保存模式（三处重复）
//
// 本文件将这些共用逻辑提取为独立函数，供 engine-dispatcher.ts 使用。

import type { ExecutionResult } from '@shared/types'
import { getMessagesByConversationId } from '../db/repos/message'
import {
  manageContext,
  chatMessagesToContext,
  type ContextManagementResult,
} from './context-manager'
import { getConversationService } from '../services/conversation-service'

/**
 * 加载历史对话消息并进行上下文窗口截断。
 *
 * 在保存当前用户消息之前调用，避免重复包含当前输入。
 * 如果发生截断，记录一条 info 日志。
 *
 * @param conversationId - 会话 ID
 * @param contextWindow - 模型上下文窗口大小（tokens）
 * @param logTag - 日志标签（如 '[Agent Builtin]'），用于截断日志
 * @returns 上下文管理结果（含截断后的消息列表）
 */
export function loadHistoryAndTruncate(
  conversationId: string,
  contextWindow: number,
  logTag = '[Agent]',
): ContextManagementResult {
  const rawHistory = getMessagesByConversationId(conversationId)
  const historyContext = chatMessagesToContext(rawHistory)
  const contextResult = manageContext(historyContext, {
    maxContextTokens: contextWindow,
  })
  if (contextResult.truncated) {
    console.info(
      `${logTag} Context truncated: ${contextResult.originalCount} -> ${contextResult.retainedCount} messages, ~${contextResult.estimatedTokens} tokens`,
    )
  }
  return contextResult
}

/**
 * 保存 Agent 执行结果为助手回复消息，并更新会话最后消息时间。
 *
 * 将 ExecutionResult 的 summary 作为消息内容，
 * 将所有轨迹的 thought 拼接为 thinking 字段。
 * 委托给 ConversationService 完成持久化。
 *
 * @param conversationId - 会话 ID
 * @param result - Agent 执行结果
 */
export function saveAgentResult(conversationId: string, result: ExecutionResult): void {
  getConversationService().saveAssistantReply(conversationId, result)
}

/**
 * 保存执行错误为助手回复消息，并更新会话最后消息时间。
 *
 * 透传真实错误信息（而非吞掉为 "Execution failed"）。
 * 委托给 ConversationService 完成持久化。
 *
 * @param conversationId - 会话 ID
 * @param error - 执行过程中抛出的错误
 */
export function saveAgentError(conversationId: string, error: unknown): void {
  getConversationService().saveExecutionError(conversationId, error)
}
