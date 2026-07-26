// AgentForge V1-02: TTS 语音合成服务
// 封装 OpenAI 兼容 TTS API（POST /audio/speech）
// 支持 openai / azure / custom 提供商
// 返回 ArrayBuffer 格式的音频数据

import OpenAI from 'openai'
import { APIError, AuthenticationError, APIConnectionTimeoutError } from 'openai'
import type { VoiceConfig, TtsOptions, TtsFormat, TtsVoice } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getSettings } from '../db/repos/app-settings'

/**
 * TTS 服务。
 * 调用 OpenAI 兼容的语音合成 API，返回音频 ArrayBuffer。
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
  private ensureClient(config: VoiceConfig['tts']): OpenAI {
    const baseUrl = this.normalizeBaseUrl(config.baseUrl, config.provider)
    if (!this.client || this.baseUrl !== baseUrl || this.apiKey !== config.apiKey) {
      this.baseUrl = baseUrl
      this.apiKey = config.apiKey
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: baseUrl,
        timeout: 60_000, // 60s 超时，音频合成可能较慢
        maxRetries: 1,
      })
    }
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
      // Azure OpenAI 格式：https://{resource}.openai.azure.com/
      // SDK 会自动处理部署路径
      return baseUrl
    }
    // custom: 直接使用用户提供的 URL
    return baseUrl
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

    const client = this.ensureClient(config)

    const model = options?.model ?? config.model
    const voice = (options?.voice ?? config.voice) as TtsVoice
    const speed = options?.speed ?? config.speed
    const responseFormat = (options?.format ?? config.format) as TtsFormat

    try {
      const response = await client.audio.speech.create({
        model,
        input: text,
        voice,
        speed,
        response_format: responseFormat,
      })

      const buffer = Buffer.from(await response.arrayBuffer())
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS API Key 无效，请检查配置',
          { cause: error },
        )
      }
      if (error instanceof APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS 请求超时，请检查网络连接',
          { cause: error },
        )
      }
      if (error instanceof APIError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          `TTS API 错误: ${error.message}`,
          { status: error.status, cause: error },
        )
      }
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        `语音合成失败: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
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
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: this.normalizeBaseUrl(config.baseUrl, config.provider),
      timeout: 30_000,
      maxRetries: 0,
    })

    try {
      const response = await client.audio.speech.create({
        model: config.model,
        input: testText,
        voice: config.voice,
        speed: config.speed,
        response_format: config.format as TtsFormat,
      })
      const buffer = Buffer.from(await response.arrayBuffer())
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS API Key 无效',
          { cause: error },
        )
      }
      if (error instanceof APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          'TTS 请求超时，请检查网络或 API 地址',
          { cause: error },
        )
      }
      if (error instanceof APIError) {
        throw new AppError(
          ErrorCodes.VOICE_TTS_ERROR,
          `TTS API 错误 (${error.status}): ${error.message}`,
          { status: error.status, cause: error },
        )
      }
      throw new AppError(
        ErrorCodes.VOICE_TTS_ERROR,
        `TTS 测试失败: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
}

/** 单例实例 */
export const ttsService = new TtsService()
