// AgentForge V1-02: TTS 语音合成服务
// 封装 OpenAI 兼容 TTS API（POST /audio/speech）+ MiMo Chat Completions TTS
// 支持 openai / azure / mimo / custom 提供商
// 返回 ArrayBuffer 格式的音频数据

import type OpenAI from 'openai'
import type * as OpenAIModule from 'openai'
import type { VoiceConfig, TtsOptions, TtsFormat, TtsVoice } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getSettings } from '../db/repos/app-settings'

// openai SDK 体积较大，改为首次调用时动态加载，避免拖慢主进程启动
type OpenAISdk = typeof OpenAIModule
let openaiSdkPromise: Promise<OpenAISdk> | null = null
function loadOpenAI(): Promise<OpenAISdk> {
  if (!openaiSdkPromise) {
    openaiSdkPromise = import('openai')
  }
  return openaiSdkPromise
}

/**
 * TTS 服务。
 * 调用 OpenAI 兼容的语音合成 API，返回音频 ArrayBuffer。
 * MiMo 提供商使用 chat.completions.create + audio 参数。
 */
export class TtsService {
  private client: OpenAI | null = null
  private baseUrl: string = ''
  private apiKey: string = ''

  /**
   * 从 settings 中获取当前 TTS 配置。
   */
  private getConfig(): VoiceConfig['tts'] {
    const settings = getSettings()
    return settings.voice.tts
  }

  /**
   * 确保客户端已初始化。
   * 每次调用前检查配置是否变化，变化则重建客户端。
   */
  private async ensureClient(config: VoiceConfig['tts']): Promise<OpenAI> {
    const baseUrl = this.normalizeBaseUrl(config.baseUrl, config.provider)
    if (this.client && this.baseUrl === baseUrl && this.apiKey === config.apiKey) {
      return this.client
    }
    const { default: OpenAI } = await loadOpenAI()
    this.baseUrl = baseUrl
    this.apiKey = config.apiKey
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: baseUrl,
      timeout: 60_000, // 60s 超时，音频合成可能较慢
      maxRetries: 1,
    })
    return this.client
  }

  /**
   * 根据提供商规范化 base URL。
   */
  private normalizeBaseUrl(baseUrl: string, provider: string): string {
    if (provider === 'openai') {
      return baseUrl || 'https://api.openai.com/v1'
    }
    if (provider === 'azure') {
      return baseUrl
    }
    if (provider === 'mimo') {
      // 自动修正旧的 MiMo URL（api.xiaomimimo.com 已不可用）
      if (!baseUrl || baseUrl.includes('api.xiaomimimo.com')) {
        return 'https://token-plan-cn.xiaomimimo.com/v1'
      }
      return baseUrl
    }
    return baseUrl
  }

  /**
   * MiMo TTS 合成：通过 chat.completions.create + audio 参数。
   * MiMo 不支持 /audio/speech 端点，必须用 chat completions 方式调用。
   */
  private async synthesizeMiMo(
    client: OpenAI,
    text: string,
    voice: string,
    format: TtsFormat,
  ): Promise<ArrayBuffer> {
    const response = await client.chat.completions.create({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: '' },
        { role: 'assistant', content: text },
      ],
      audio: { format: format === 'pcm16' ? 'wav' : format, voice },
      // MiMo 的 audio 参数未包含在 openai 官方类型中，此处经 unknown 双重断言透传
    } as unknown as Parameters<typeof client.chat.completions.create>[0])

    const message = response.choices?.[0]?.message as
      | { audio?: { data?: string } }
      | undefined
    const audioData = message?.audio?.data
    if (!audioData) {
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        'MiMo TTS 返回数据中没有音频内容',
      )
    }

    // MiMo 返回 base64 编码的音频数据
    const buffer = Buffer.from(audioData, 'base64')
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer
  }

  /**
   * OpenAI / Azure / 自定义 TTS 合成：通过 /audio/speech 端点。
   */
  private async synthesizeOpenAI(
    client: OpenAI,
    text: string,
    model: string,
    voice: string,
    speed: number,
    format: TtsFormat,
  ): Promise<ArrayBuffer> {
    const response = await client.audio.speech.create({
      model,
      input: text,
      voice,
      speed,
      response_format: format,
    })
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer
  }

  /**
   * 根据提供商选择合成方式并调用。
   */
  private async doSynthesize(
    client: OpenAI,
    config: VoiceConfig['tts'],
    text: string,
    model: string,
    voice: string,
    speed: number,
    format: TtsFormat,
  ): Promise<ArrayBuffer> {
    if (config.provider === 'mimo') {
      return this.synthesizeMiMo(client, text, voice, format)
    }
    return this.synthesizeOpenAI(client, text, model, voice, speed, format)
  }

  /**
   * 合成语音。
   *
   * @param text - 要合成的文本
   * @param options - 可选的覆盖选项（模型、音色、语速、格式）
   * @returns 音频 ArrayBuffer
   * @throws AppError VOICE_TTS_ERROR - 合成失败
   */
  async synthesize(text: string, options?: TtsOptions): Promise<ArrayBuffer> {
    const config = this.getConfig()

    if (!config.enabled) {
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        'TTS 未启用，请在设置中开启语音播报',
      )
    }

    if (!config.apiKey) {
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        'TTS API Key 未配置，请在设置中填写 API Key',
      )
    }

    if (!text.trim()) {
      throw new AppError(ErrorCodes.VOICE_TTS_ERROR, '合成文本不能为空')
    }

    const client = await this.ensureClient(config)
    const sdk = await loadOpenAI()

    const model = options?.model ?? config.model
    const voice = (options?.voice ?? config.voice) as TtsVoice
    const speed = options?.speed ?? config.speed
    const responseFormat = (options?.format ?? config.format) as TtsFormat

    try {
      return await this.doSynthesize(client, config, text, model, voice, speed, responseFormat)
    } catch (error) {
      if (error instanceof sdk.AuthenticationError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS API Key 无效，请检查配置',
        )
      }
      if (error instanceof sdk.APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS 请求超时，请检查网络连接',
        )
      }
      if (error instanceof sdk.APIError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          `TTS API 错误: ${error.message}`,
          { status: error.status },
        )
      }
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        `语音合成失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 测试 TTS 配置是否有效。
   * 合成一句短文本验证配置正确性。
   *
   * @param config - 要测试的配置
   * @throws AppError VOICE_TTS_ERROR - 配置无效
   */
  async testConfig(config: VoiceConfig['tts']): Promise<ArrayBuffer> {
    if (!config.apiKey) {
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        '请填写 API Key 后再测试',
      )
    }

    const testText = 'AgentForge 语音测试，如果你听到这段声音，说明 TTS 配置正确。'
    const sdk = await loadOpenAI()
    const client = new sdk.default({
      apiKey: config.apiKey,
      baseURL: this.normalizeBaseUrl(config.baseUrl, config.provider),
      timeout: 30_000,
      maxRetries: 0,
    })

    try {
      return await this.doSynthesize(
        client, config, testText,
        config.model, config.voice, config.speed, config.format as TtsFormat,
      )
    } catch (error) {
      if (error instanceof sdk.AuthenticationError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS API Key 无效',
        )
      }
      if (error instanceof sdk.APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS 请求超时，请检查网络或 API 地址',
        )
      }
      if (error instanceof sdk.APIError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          `TTS API 错误 (${error.status}): ${error.message}`,
          { status: error.status },
        )
      }
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        `TTS 测试失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/** 单例实例 */
export const ttsService = new TtsService()
