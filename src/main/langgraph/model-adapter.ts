// LangGraph 引擎: ModelAdapter 包装层
// 将 AgentForge 的 ModelAdapter.streamChat() 包装为可被 ReAct 循环调用的 ModelWrapper
// 复用现有 BYOK 配置和密钥管理，无需重复实现模型适配器

import type { ModelAdapter, AdapterMessage } from '../models/adapter'
import type { AgentEventCallbacks } from '../agent/types'

/**
 * 轻量级模型包装器：将 AgentForge ModelAdapter 包装为可被 LangGraph 使用的 callable
 * 不继承 LangChain BaseChatModel，避免复杂的序列化要求
 */
export class ModelWrapper {
  constructor(
    private adapter: ModelAdapter,
    private callbacks?: AgentEventCallbacks,
  ) {}

  /**
   * 调用模型，返回完整响应
   *
   * @param messages - 对话消息列表
   * @param abortSignal - 可选的中断信号
   * @returns 累积的完整文本
   */
  async invoke(messages: AdapterMessage[], abortSignal?: AbortSignal): Promise<string> {
    let output = ''
    for await (const chunk of this.adapter.streamChat(messages, abortSignal)) {
      if (chunk.type === 'text') {
        output += chunk.content
        this.callbacks?.onStreamChunk({ type: 'text', content: chunk.content })
      }
    }
    return output
  }
}
