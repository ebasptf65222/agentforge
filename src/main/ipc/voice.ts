// AgentForge V1-02/V1-05: 语音 IPC 处理器
// 通道命名: voice:tts-synthesize, voice:tts-test, voice:stt-transcribe, voice:stt-test
// 处理 TTS 合成和 STT 转录请求

import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { VoiceConfig, TtsOptions, SttOptions } from '@shared/types'
import { ttsService } from '../services/tts-service'
import { sttService } from '../services/stt-service'
import { AppError, ErrorCodes } from '../utils/error'
import { assertNonEmptyString } from '../utils/assertions'

// ─── TTS Handlers ──────────────────────────────────────────────

/**
 * voice:tts-synthesize - 合成语音
 * @param text - 要合成的文本
 * @param options - 可选覆盖选项
 * @returns ArrayBuffer - 音频数据
 */
async function handleTtsSynthesize(
  _event: IpcMainInvokeEvent,
  params: { text: string; options?: TtsOptions },
): Promise<ArrayBuffer> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'tts-synthesize params must be an object.')
  }
  const { text, options } = params
  assertNonEmptyString(text, 'text')
  return await ttsService.synthesize(text, options)
}

/**
 * voice:tts-test - 测试 TTS 配置
 * @param config - 要测试的语音配置
 * @returns ArrayBuffer - 测试音频数据
 */
async function handleTtsTest(
  _event: IpcMainInvokeEvent,
  params: { config: VoiceConfig },
): Promise<ArrayBuffer> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'tts-test params must be an object.')
  }
  const { config } = params
  if (config === null || typeof config !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "config" must be an object.')
  }
  return await ttsService.testConfig(config.tts)
}

// ─── STT Handlers ──────────────────────────────────────────────

/**
 * voice:stt-transcribe - 转录音频
 * @param audioBuffer - 音频数据（ArrayBuffer）
 * @param options - 可选覆盖选项
 * @returns string - 识别文本
 */
async function handleSttTranscribe(
  _event: IpcMainInvokeEvent,
  params: { audioBuffer: ArrayBuffer; options?: SttOptions },
): Promise<string> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'stt-transcribe params must be an object.')
  }
  const { audioBuffer, options } = params
  if (!(audioBuffer instanceof ArrayBuffer)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "audioBuffer" must be an ArrayBuffer.')
  }
  if (audioBuffer.byteLength === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, '音频数据不能为空')
  }
  return await sttService.transcribe(audioBuffer, options)
}

/**
 * voice:stt-test - 测试 STT 配置
 * @param config - 要测试的语音配置
 * @returns string - 测试识别文本（mock 或真实）
 */
async function handleSttTest(
  _event: IpcMainInvokeEvent,
  params: { config: VoiceConfig; audioBuffer?: ArrayBuffer },
): Promise<string> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'stt-test params must be an object.')
  }
  const { config, audioBuffer } = params
  if (config === null || typeof config !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "config" must be an object.')
  }
  if (audioBuffer !== undefined && !(audioBuffer instanceof ArrayBuffer)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "audioBuffer" must be an ArrayBuffer.')
  }
  if (audioBuffer && audioBuffer.byteLength > 0) {
    return await sttService.testWithAudio(config.stt, audioBuffer)
  }
  // 没有音频时返回 mock 结果
  return '语音配置测试成功（模拟结果）'
}

// ─── Registration ─────────────────────────────────────────────

export const voiceIpcHandlers = [
  {
    channel: 'voice:tts-synthesize',
    handler: handleTtsSynthesize,
  },
  {
    channel: 'voice:tts-test',
    handler: handleTtsTest,
  },
  {
    channel: 'voice:stt-transcribe',
    handler: handleSttTranscribe,
  },
  {
    channel: 'voice:stt-test',
    handler: handleSttTest,
  },
]

/**
 * 注册所有语音 IPC 处理器。
 * 在主进程启动时调用一次。
 */
// OPT2-29: 统一使用 removeHandler + handle 幂等注册模式
export function registerVoiceHandlers(): void {
  for (const { channel, handler } of voiceIpcHandlers) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
