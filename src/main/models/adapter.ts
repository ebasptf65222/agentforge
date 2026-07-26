// AgentForge P1-07: 模型适配器抽象基类
// 与 Spec v0.2 P1-07 一致

import type { StreamChunk } from '@shared/types'

/** 适配器接收的消息格式 */
export interface AdapterMessage {
  role: string
  content: string
}

/**
 * 模型适配器抽象基类。
 * 所有模型提供商适配器（OpenAI、DeepSeek 等）必须继承此类。
 */
export abstract class ModelAdapter {
  protected readonly modelId: string
  protected readonly temperature: number
  protected readonly maxTokens: number

  constructor(config: { modelId: string; temperature: number; maxTokens: number }) {
    this.modelId = config.modelId
    this.temperature = config.temperature
    this.maxTokens = config.maxTokens
  }

  /**
   * 流式对话。
   * @param messages - 对话消息列表
   * @param abortSignal - 可选的 AbortSignal，用于中断流式生成
   * @returns AsyncGenerator 产生 StreamChunk
   */
  abstract streamChat(
    messages: AdapterMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamChunk, void, unknown>
}
