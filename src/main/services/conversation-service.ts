// AgentForge 架构优化批次二 - 任务4: Service 层初步抽象
//
// 当前 IPC handler 直接导入 db/repos（43 处）。本文件做最小化抽象：
// 封装对话相关的消息持久化业务逻辑，供 agent 执行路径使用，
// 降低 engine 层对 db/repos 的直接耦合。
//
// 职责：
// - saveUserMessage:    保存用户输入消息
// - saveAssistantReply: 保存 Agent 执行结果为助手回复
// - saveExecutionError: 保存执行错误为助手回复（透传真实错误信息）

import type { ChatMessage, ExecutionResult } from '@shared/types'
import { createMessage } from '../db/repos/message'
import { updateLastMessageAt } from '../db/repos/conversation'

/**
 * 对话消息持久化服务。
 *
 * 封装消息保存 + 时间戳更新的业务逻辑，
 * 替代 engine 层对 db/repos/message 和 db/repos/conversation 的直接调用。
 */
export class ConversationService {
  /**
   * 保存用户输入消息。
   *
   * @param conversationId - 会话 ID
   * @param content - 用户输入内容
   * @returns 新建的消息实体
   */
  saveUserMessage(conversationId: string, content: string): ChatMessage {
    return createMessage({
      conversationId,
      role: 'user',
      content,
    })
  }

  /**
   * 保存 Agent 执行结果为助手回复消息，并更新会话最后消息时间。
   *
   * 将 ExecutionResult 的 summary 作为消息内容，
   * 将所有轨迹的 thought 拼接为 thinking 字段。
   *
   * @param conversationId - 会话 ID
   * @param result - Agent 执行结果
   * @returns 新建的消息实体
   */
  saveAssistantReply(conversationId: string, result: ExecutionResult): ChatMessage {
    const message = createMessage({
      conversationId,
      role: 'assistant',
      content: result.summary,
      thinking: result.trajectories.map((t) => `Step ${t.step}: ${t.thought}`).join('\n\n'),
    })
    updateLastMessageAt(conversationId)
    return message
  }

  /**
   * 保存执行错误为助手回复消息，并更新会话最后消息时间。
   *
   * 透传真实错误信息（而非吞掉为 "Execution failed"），
   * 使前端能展示具体失败原因。
   *
   * @param conversationId - 会话 ID
   * @param error - 执行过程中抛出的错误
   * @returns 新建的消息实体
   */
  saveExecutionError(conversationId: string, error: unknown): ChatMessage {
    const errorMessage = error instanceof Error ? error.message : 'Execution failed'
    const message = createMessage({
      conversationId,
      role: 'assistant',
      content: errorMessage,
      thinking: undefined,
    })
    updateLastMessageAt(conversationId)
    return message
  }
}

// ─── 单例 ─────────────────────────────────────────────────────────

let conversationServiceInstance: ConversationService | null = null

/**
 * 获取 ConversationService 单例。
 */
export function getConversationService(): ConversationService {
  if (conversationServiceInstance === null) {
    conversationServiceInstance = new ConversationService()
  }
  return conversationServiceInstance
}
