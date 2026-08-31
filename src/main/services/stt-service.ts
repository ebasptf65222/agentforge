// AgentForge V1-05: STT 语音识别服务
// 封装 OpenAI 兼容 STT API（POST /audio/transcriptions）
// 支持 openai / azure / custom 提供商

import type OpenAI from 'openai'
import type * as OpenAIModule from 'openai'
import type { VoiceConfig, SttOptions } from '@shared/types'
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
 * STT 服务。
 * 调用 OpenAI 兼容的语音转录 API，返回识别文本。
 */
export class SttService {
  private client: OpenAI | null = null
  private baseUrl: string = ''
  private apiKey: string = ''

  /**
   * 从 settings 中获取当前 STT 配置。
   */
  private getConfig(): VoiceConfig['stt'] {
    const settings = getSettings()
    return settings.voice.stt
  }

  /**
   * 确保客户端已初始化。
   */
  private async ensureClient(config: VoiceConfig['stt']): Promise<OpenAI> {
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
      timeout: 120_000, // 2min 超时，长音频可能较慢
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
    return baseUrl
  }

  /**
   * 转录音频为文本。
   *
   * @param audioBuffer - 音频数据（ArrayBuffer）
   * @param options - 可选的覆盖选项（模型、语言、温度）
   * @returns 识别的文本
   * @throws AppError VOICE_STT_ERROR - 识别失败
   */
  async transcribe(audioBuffer: ArrayBuffer, options?: SttOptions): Promise<string> {
    const config = this.getConfig()

    if (!config.enabled) {
      throw new AppError(
        ErrorCodes.VOICE_STT_ERROR,
        'STT 未启用，请在设置中开启语音输入',
      )
    }

    if (!config.apiKey) {
      throw new AppError(
        ErrorCodes.VOICE_STT_ERROR,
        'STT API Key 未配置，请在设置中填写 API Key',
      )
    }

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      throw new AppError(ErrorCodes.VOICE_STT_ERROR, '音频数据不能为空')
    }

    const client = await this.ensureClient(config)
    const sdk = await loadOpenAI()

    const model = options?.model ?? config.model
    const language = (options?.language ?? config.language) || undefined
    const temperature = options?.temperature ?? config.temperature

    try {
      // 将 ArrayBuffer 转为 File 对象供 SDK 使用
      const buffer = Buffer.from(audioBuffer)
      const file = new File([buffer], 'audio.webm', { type: 'audio/webm' })

      const transcription = await client.audio.transcriptions.create({
        file,
        model,
        language,
        temperature,
        response_format: 'text',
      })

      // 当 response_format 为 'text' 时，SDK 返回 string
      const text = typeof transcription === 'string' ? transcription : (transcription as unknown as { text: string }).text
      return text.trim()
    } catch (error) {
      if (error instanceof sdk.AuthenticationError) {
        throw new AppError(
          ErrorCodes.VOICE_STT_ERROR,
          'STT API Key 无效，请检查配置',
        )
      }
      if (error instanceof sdk.APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.VOICE_STT_ERROR,
          'STT 请求超时，请检查网络连接',
        )
      }
      if (error instanceof sdk.APIError) {
        throw new AppError(
          ErrorCodes.VOICE_STT_ERROR,
          `STT API 错误: ${error.message}`,
          { status: error.status },
        )
      }
      throw new AppError(
        ErrorCodes.VOICE_STT_ERROR,
        `语音识别失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 使用指定音频测试 STT 配置。
   *
   * @param config - 要测试的 STT 配置
   * @param audioBuffer - 测试音频
   * @returns 识别的文本
   */
  async testWithAudio(config: VoiceConfig['stt'], audioBuffer: ArrayBuffer): Promise<string> {
    if (!config.apiKey) {
      throw new AppError(
        ErrorCodes.VOICE_STT_ERROR,
        '请填写 API Key 后再测试',
      )
    }

    const sdk = await loadOpenAI()
    const client = new sdk.default({
      apiKey: config.apiKey,
      baseURL: this.normalizeBaseUrl(config.baseUrl, config.provider),
      timeout: 60_000,
      maxRetries: 0,
    })

    try {
      const buffer = Buffer.from(audioBuffer)
      const file = new File([buffer], 'test-audio.webm', { type: 'audio/webm' })

      const transcription = await client.audio.transcriptions.create({
        file,
        model: config.model,
        language: config.language || undefined,
        temperature: config.temperature,
        response_format: 'text',
      })

      const text = typeof transcription === 'string' ? transcription : (transcription as unknown as { text: string }).text
      return text.trim()
    } catch (error) {
      if (error instanceof sdk.AuthenticationError) {
        throw new AppError(
          ErrorCodes.VOICE_STT_ERROR,
          'STT API Key 无效',
        )
      }
      if (error instanceof sdk.APIConnectionTimeoutError) {
        throw new AppError(
          ErrorCodes.VOICE_STT_ERROR,
          'STT 请求超时，请检查网络或 API 地址',
        )
      }
      if (error instanceof sdk.APIError) {
        throw new AppError(
          ErrorCodes.VOICE_STT_ERROR,
          `STT API 错误 (${error.status}): ${error.message}`,
          { status: error.status },
        )
      }
      throw new AppError(
        ErrorCodes.VOICE_STT_ERROR,
        `STT 测试失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/** 单例实例 */
export const sttService = new SttService()
