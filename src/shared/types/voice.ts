// AgentForge 共享类型定义 - 语音类型
// 与 Spec v0.2 §5.6 一致

import type {
  VoiceProvider,
  TtsVoice,
  TtsFormat,
  TtsPlayState,
  SttRecordState,
  VoiceModeState,
} from './enums'

// ─── 5.6 语音类型 ────────────────────────────────────────────────

/** TTS 配置 */
export interface TtsConfig {
  /** 是否启用 TTS */
  enabled: boolean
  /** 服务提供商 */
  provider: VoiceProvider
  /** API Base URL */
  baseUrl: string
  /** API Key */
  apiKey: string
  /** 模型名称，如 tts-1, tts-1-hd */
  model: string
  /** 音色 */
  voice: TtsVoice
  /** 语速 0.25 ~ 4.0 */
  speed: number
  /** 音频格式 */
  format: TtsFormat
  /** 是否自动播报回复 */
  autoPlay: boolean
}

/** STT 配置 */
export interface SttConfig {
  /** 是否启用 STT */
  enabled: boolean
  /** 服务提供商 */
  provider: VoiceProvider
  /** API Base URL */
  baseUrl: string
  /** API Key */
  apiKey: string
  /** 模型名称，如 whisper-1 */
  model: string
  /** 语言代码，空=自动检测 */
  language: string
  /** 温度 0.0 ~ 1.0 */
  temperature: number
}

/** 实时语音模式配置 */
export interface VoiceModeConfig {
  /** VAD 静音阈值（秒）1.0 ~ 3.0 */
  vadSilenceThreshold: number
  /** 播报完毕是否自动进入等待说话状态 */
  autoAwait: boolean
}

/** 完整语音配置 */
export interface VoiceConfig {
  tts: TtsConfig
  stt: SttConfig
  mode: VoiceModeConfig
}

/** TTS 合成选项（单次调用覆盖默认配置） */
export interface TtsOptions {
  model?: string
  voice?: TtsVoice
  speed?: number
  format?: TtsFormat
}

/** STT 转录选项（单次调用覆盖默认配置） */
export interface SttOptions {
  model?: string
  language?: string
  temperature?: number
}

/** 语音播放进度信息 */
export interface TtsPlayProgress {
  messageId: string | null
  state: TtsPlayState
  currentTime: number
  duration: number
  volume: number
  playbackRate: number
}

/** 语音录音进度信息 */
export interface SttRecordProgress {
  state: SttRecordState
  duration: number
  volume: number
  error?: string
}
