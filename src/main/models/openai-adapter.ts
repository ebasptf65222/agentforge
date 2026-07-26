// AgentForge P1-07: OpenAI 模型适配器
// 使用 openai v6 npm 包，stream: true SSE 流式
// timeout 30s, maxRetries 1, backoff 1000ms

import OpenAI from 'openai'
import { APIError, AuthenticationError, APIConnectionTimeoutError, APIUserAbortError } from 'openai'
import type { StreamChunk } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { ModelAdapter, type AdapterMessage } from './adapter'

/**
 * OpenAI 适配器配置。
 */
export interface OpenAIAdapterConfig {
  modelId: string
  apiKey: string
  baseUrl?: string
  temperature: number
  maxTokens: number
}

/**
 * OpenAI 模型适配器。
 * 使用 openai v6 SDK 的 stream: true 模式进行 SSE 流式对话。
 */
export class OpenAIAdapter extends ModelAdapter {
  protected readonly client: OpenAI
  protected readonly baseUrl?: string

  constructor(config: OpenAIAdapterConfig) {
    super({
      modelId: config.modelId,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    })

    this.baseUrl = config.baseUrl

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: 30_000,
      maxRetries: 1,
      // openai v6 retry backoff 通过 `maxRetryAfter` 控制，
      // 1000ms backoff 是 SDK 默认行为，无需额外配置
    })
  }

  /**
   * 流式对话。
   * - 使用 openai v6 `client.chat.completions.create({ stream: true })` 返回 AsyncIterable
   * - AbortSignal 通过 RequestOptions.signal 传入
   * - API Key 无效 (401) 抛出 AppError('MODEL_API_ERROR')
   * - 超时、网络错误也统一为 MODEL_API_ERROR
   */
  async *streamChat(
    messages: AdapterMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.modelId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          stream: true,
        },
        abortSignal ? { signal: abortSignal } : undefined,
      )

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          yield { type: 'text', content } as StreamChunk
        }

        // 检查是否结束
        const finishReason = chunk.choices[0]?.finish_reason
        if (finishReason) {
          yield { type: 'text', content: '', done: true } as StreamChunk
        }
      }
    } catch (error) {
      // 用户主动中断，静默结束
      if (error instanceof APIUserAbortError) {
        return
      }

      // API Key 无效 → MODEL_API_ERROR
      if (error instanceof AuthenticationError) {
        throw new AppError(
          ErrorCodes.MODEL_API_ERROR,
          'Invalid API key. Please check your API key configuration.',
          { status: 401, provider: 'openai' },
        )
      }

      // 超时 → MODEL_API_ERROR
      if (error instanceof APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.MODEL_API_ERROR,
          'Request timed out (30s). Please try again.',
          { status: 'timeout', provider: 'openai' },
        )
      }

      // 其他 APIError → MODEL_API_ERROR
      if (error instanceof APIError) {
        throw new AppError(ErrorCodes.MODEL_API_ERROR, `API error: ${error.message}`, {
          status: error.status,
          provider: 'openai',
          code: error.code,
        })
      }

      // 未知错误包装
      throw new AppError(
        ErrorCodes.MODEL_API_ERROR,
        error instanceof Error ? error.message : 'Unknown model error',
        { provider: 'openai' },
      )
    }
  }
}
