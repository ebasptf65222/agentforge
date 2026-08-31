// AgentForge P1-07: OpenAI 模型适配器
// 使用 openai v6 npm 包，stream: true SSE 流式
// timeout 30s, maxRetries 1, backoff 1000ms

import type OpenAI from 'openai'
import type * as OpenAISdkModule from 'openai'
import type { StreamChunk } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { ModelAdapter, type AdapterMessage } from './adapter'

// openai SDK 体积较大，改为首次对话时动态加载，避免拖慢主进程启动
type OpenAISdk = typeof OpenAISdkModule
let openaiSdkPromise: Promise<OpenAISdk> | null = null
function loadOpenAISdk(): Promise<OpenAISdk> {
  if (!openaiSdkPromise) {
    openaiSdkPromise = import('openai')
  }
  return openaiSdkPromise
}

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
  protected baseUrl?: string
  private readonly apiKey: string
  private clientPromise: Promise<{ client: OpenAI; sdk: OpenAISdk }> | null = null

  constructor(config: OpenAIAdapterConfig) {
    super({
      modelId: config.modelId,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    })

    this.baseUrl = config.baseUrl
    this.apiKey = config.apiKey
  }

  /**
   * 惰性获取 openai client（首次调用时才加载 SDK 并创建实例）。
   */
  private getClient(): Promise<{ client: OpenAI; sdk: OpenAISdk }> {
    if (!this.clientPromise) {
      this.clientPromise = loadOpenAISdk().then((sdk) => ({
        client: new sdk.default({
          apiKey: this.apiKey,
          baseURL: this.baseUrl,
          timeout: 30_000,
          maxRetries: 1,
          // openai v6 retry backoff 通过 `maxRetryAfter` 控制，
          // 1000ms backoff 是 SDK 默认行为，无需额外配置
        }),
        sdk,
      }))
    }
    return this.clientPromise
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
    const { client, sdk } = await this.getClient()

    try {
      const stream = await client.chat.completions.create(
        {
          model: this.modelId,
          messages: messages.map((m) => {
            // OpenAI API 要求 role: 'tool' 消息必须携带 tool_call_id 并跟在
            // 带 tool_calls 的 assistant 消息之后。当前 ReAct 架构使用文本格式
            // 解析而非原生 function calling，因此将 tool 消息映射为 user 角色，
            // 避免触发 API 400 错误。这是 SDK 迁移前的临时修复。
            if (m.role === 'tool') {
              return { role: 'user' as const, content: `[Tool Observation]\n${m.content}` }
            }
            return { role: m.role, content: m.content }
          }),
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
      if (error instanceof sdk.APIUserAbortError) {
        return
      }

      // API Key 无效 → MODEL_API_ERROR
      if (error instanceof sdk.AuthenticationError) {
        throw new AppError(
          ErrorCodes.MODEL_API_ERROR,
          'Invalid API key. Please check your API key configuration.',
          { status: 401, provider: 'openai' },
        )
      }

      // 超时 → MODEL_API_ERROR
      if (error instanceof sdk.APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.MODEL_API_ERROR,
          'Request timed out (30s). Please try again.',
          { status: 'timeout', provider: 'openai' },
        )
      }

      // 其他 APIError → MODEL_API_ERROR
      if (error instanceof sdk.APIError) {
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
