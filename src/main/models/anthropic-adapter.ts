// AgentForge: Anthropic 模型适配器
// 使用 @anthropic-ai/sdk，支持 Claude 系列模型流式对话

import type Anthropic from '@anthropic-ai/sdk'
import type * as AnthropicSdkModule from '@anthropic-ai/sdk'
import type { StreamChunk } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { ModelAdapter, type AdapterMessage } from './adapter'

// @anthropic-ai/sdk 体积较大，改为首次对话时动态加载，避免拖慢主进程启动
type AnthropicSdk = typeof AnthropicSdkModule
let anthropicSdkPromise: Promise<AnthropicSdk> | null = null
function loadAnthropicSdk(): Promise<AnthropicSdk> {
  if (!anthropicSdkPromise) {
    anthropicSdkPromise = import('@anthropic-ai/sdk')
  }
  return anthropicSdkPromise
}

/**
 * Anthropic 适配器配置。
 */
export interface AnthropicAdapterConfig {
  modelId: string
  apiKey: string
  baseUrl?: string
  temperature: number
  maxTokens: number
}

/**
 * Anthropic 模型适配器。
 * 使用 @anthropic-ai/sdk 的 streaming API 进行流式对话。
 * 默认 baseURL 为 https://api.anthropic.com。
 */
export class AnthropicAdapter extends ModelAdapter {
  private readonly apiKey: string
  private readonly baseUrl: string
  private clientPromise: Promise<{ client: Anthropic; sdk: AnthropicSdk }> | null = null

  constructor(config: AnthropicAdapterConfig) {
    super({
      modelId: config.modelId,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    })

    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com'
  }

  /**
   * 惰性获取 Anthropic client（首次调用时才加载 SDK 并创建实例）。
   */
  private getClient(): Promise<{ client: Anthropic; sdk: AnthropicSdk }> {
    if (!this.clientPromise) {
      this.clientPromise = loadAnthropicSdk().then((sdk) => ({
        client: new sdk.default({
          apiKey: this.apiKey,
          baseURL: this.baseUrl,
          timeout: 60_000,
          maxRetries: 1,
        }),
        sdk,
      }))
    }
    return this.clientPromise
  }

  /**
   * 流式对话。
   * - 使用 Anthropic Messages API stream: true
   * - 将 AdapterMessage[] 转换为 Anthropic 消息格式
   * - 系统消息通过 system 参数传入
   * - AbortSignal 通过 signal 参数传入
   */
  async *streamChat(
    messages: AdapterMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const { client, sdk } = await this.getClient()

    try {
      // 分离系统消息和对话消息
      const systemMessages = messages.filter((m) => m.role === 'system')
      const chatMessages = messages.filter((m) => m.role !== 'system')

      const systemPrompt = systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n\n')
        : undefined

      // 转换为 Anthropic 消息格式
      const anthropicMessages = chatMessages.map((m) => {
        const role = m.role === 'assistant' ? 'assistant' : 'user'
        return {
          role: role as 'user' | 'assistant',
          content: m.content,
        }
      })

      const stream = client.messages.stream(
        {
          model: this.modelId,
          messages: anthropicMessages,
          system: systemPrompt,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        },
        abortSignal ? { signal: abortSignal } : undefined,
      )

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', content: event.delta.text } as StreamChunk
        }

        if (event.type === 'message_stop') {
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
          'Invalid API key. Please check your Anthropic API key configuration.',
          { status: 401, provider: 'anthropic' },
        )
      }

      // 超时 → MODEL_API_ERROR
      if (error instanceof sdk.APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.MODEL_API_ERROR,
          'Request timed out (60s). Please try again.',
          { status: 'timeout', provider: 'anthropic' },
        )
      }

      // 其他 APIError → MODEL_API_ERROR
      if (error instanceof sdk.APIError) {
        throw new AppError(ErrorCodes.MODEL_API_ERROR, `Anthropic API error: ${error.message}`, {
          status: error.status,
          provider: 'anthropic',
        })
      }

      // 未知错误包装
      throw new AppError(
        ErrorCodes.MODEL_API_ERROR,
        error instanceof Error ? error.message : 'Unknown model error',
        { provider: 'anthropic' },
      )
    }
  }
}