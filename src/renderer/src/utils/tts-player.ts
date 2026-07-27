// AgentForge V1-03: TTS 音频播放器（渲染进程）
// 封装 Web Audio API / HTMLAudioElement，支持播放/暂停/继续/停止/跳转
// 支持音量调节、播放速度调节、进度回调
// 支持音频队列和逐句播放（V1-04 流式播放）

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

/**
 * 将 TTS 格式名转换为正确的浏览器 MIME 类型。
 * 避免 `audio/mp3` 等无效 MIME 导致 Audio 元素无法解码。
 */
function formatToMimeType(format: string): string {
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    opus: 'audio/ogg; codecs=opus',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
    pcm: 'audio/wav',   // PCM 需要 WAV 容器才能播放
    pcm16: 'audio/wav', // 同上
  }
  return map[format] ?? `audio/${format}`
}

/**
 * 判断是否为原始 PCM 格式（需要 WAV 封装才能播放）。
 */
function isPcmFormat(format: string): boolean {
  return format === 'pcm' || format === 'pcm16'
}

/**
 * 将原始 16-bit PCM 数据封装为 WAV 文件。
 * @param pcmData - 原始 PCM ArrayBuffer（16-bit little-endian, mono）
 * @param sampleRate - 采样率，默认 24000（TTS 常用）
 */
function pcmToWav(pcmData: ArrayBuffer, sampleRate = 24000): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcmData.byteLength
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, totalSize - 8, true)
  writeString(view, 8, 'WAVE')

  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)         // sub-chunk size
  view.setUint16(20, 1, true)          // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM samples
  new Uint8Array(buffer, headerSize).set(new Uint8Array(pcmData))

  return buffer
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

export interface PlayerOptions {
  /** 初始音量 0 ~ 1，默认 0.8 */
  volume?: number
  /** 初始播放速度 0.5 ~ 2.0，默认 1.0 */
  playbackRate?: number
  /** 进度变化回调（currentTime, duration） */
  onProgress?: (currentTime: number, duration: number) => void
  /** 状态变化回调 */
  onStateChange?: (state: PlayerState) => void
  /** 播放结束回调 */
  onEnded?: () => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

/**
 * TTS 音频播放器。
 * 使用 HTMLAudioElement 实现，简单可靠，支持常见格式。
 */
export class TtsPlayer {
  private audio: HTMLAudioElement | null = null
  private _state: PlayerState = 'idle'
  private _volume: number
  private _playbackRate: number
  private _currentTime = 0
  private _duration = 0
  private options: PlayerOptions

  /** 待播放的音频队列（用于流式逐句播放） */
  private queue: Array<{ buffer: ArrayBuffer; text: string }> = []
  private isPlayingQueue = false

  constructor(options: PlayerOptions = {}) {
    this._volume = options.volume ?? 0.8
    this._playbackRate = options.playbackRate ?? 1.0
    this.options = options
  }

  /**
   * 播放单个音频。
   * 停止当前播放并开始播放新音频。
   *
   * @param buffer - 音频 ArrayBuffer
   * @param mimeTypeOrFormat - MIME 类型或格式名（如 'mp3'、'audio/mpeg'）
   */
  async play(buffer: ArrayBuffer, mimeTypeOrFormat = 'audio/mpeg'): Promise<void> {
    this.stop()
    this.queue = []
    this.isPlayingQueue = false

    // PCM 格式需要封装为 WAV 才能播放
    let actualBuffer = buffer
    let mimeType: string
    if (!mimeTypeOrFormat.includes('/') && isPcmFormat(mimeTypeOrFormat)) {
      actualBuffer = pcmToWav(buffer)
      mimeType = 'audio/wav'
    } else if (mimeTypeOrFormat.includes('/')) {
      mimeType = mimeTypeOrFormat
    } else {
      mimeType = formatToMimeType(mimeTypeOrFormat)
    }

    await this.playBuffer(actualBuffer, mimeType)
  }

  /**
   * 添加音频到播放队列尾部。
   * 如果当前没有在播放，立即开始播放。
   * （V1-04 流式播放使用）
   */
  enqueue(buffer: ArrayBuffer, text: string, mimeTypeOrFormat = 'audio/mpeg'): void {
    // PCM 格式需要封装为 WAV 才能播放
    let actualBuffer = buffer
    let mimeType: string
    if (!mimeTypeOrFormat.includes('/') && isPcmFormat(mimeTypeOrFormat)) {
      actualBuffer = pcmToWav(buffer)
      mimeType = 'audio/wav'
    } else if (mimeTypeOrFormat.includes('/')) {
      mimeType = mimeTypeOrFormat
    } else {
      mimeType = formatToMimeType(mimeTypeOrFormat)
    }

    this.queue.push({ buffer: actualBuffer, text })
    if (!this.isPlayingQueue && (this._state === 'idle' || this._state === 'finished')) {
      void this.playNextFromQueue(mimeType)
    }
  }

  /**
   * 暂停播放。
   */
  pause(): void {
    if (this.audio && this._state === 'playing') {
      this.audio.pause()
      this.setState('paused')
    }
  }

  /**
   * 继续播放。
   */
  resume(): void {
    if (this.audio && this._state === 'paused') {
      void this.audio.play()
      this.setState('playing')
    }
  }

  /**
   * 停止播放并清空队列。
   */
  stop(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.src = ''
      this.audio = null
    }
    this.queue = []
    this.isPlayingQueue = false
    this._currentTime = 0
    this._duration = 0
    this.setState('idle')
  }

  /**
   * 跳转到指定时间（秒）。
   */
  seek(time: number): void {
    if (this.audio && this._duration > 0) {
      this.audio.currentTime = Math.max(0, Math.min(time, this._duration))
    }
  }

  /**
   * 设置音量（0 ~ 1）。
   */
  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume))
    if (this.audio) {
      this.audio.volume = this._volume
    }
  }

  /**
   * 设置播放速度（0.5 ~ 2.0）。
   */
  setPlaybackRate(rate: number): void {
    this._playbackRate = Math.max(0.5, Math.min(2.0, rate))
    if (this.audio) {
      this.audio.playbackRate = this._playbackRate
    }
  }

  /** 当前播放状态 */
  get state(): PlayerState {
    return this._state
  }

  /** 当前播放时间（秒） */
  get currentTime(): number {
    return this._currentTime
  }

  /** 音频总时长（秒） */
  get duration(): number {
    return this._duration
  }

  /** 当前音量 */
  get volume(): number {
    return this._volume
  }

  /** 当前播放速度 */
  get playbackRate(): number {
    return this._playbackRate
  }

  /** 队列中剩余的句子数 */
  get queueLength(): number {
    return this.queue.length
  }

  // ─── 内部方法 ────────────────────────────────────────────────

  private setState(state: PlayerState): void {
    if (this._state !== state) {
      this._state = state
      this.options.onStateChange?.(state)
    }
  }

  private async playBuffer(buffer: ArrayBuffer, mimeType: string): Promise<void> {
    this.setState('loading')

    let audio: HTMLAudioElement | null = null
    let url: string | null = null

    try {
      const blob = new Blob([buffer], { type: mimeType })
      url = URL.createObjectURL(blob)

      audio = new Audio()
      audio.preload = 'auto'
      audio.src = url
      audio.volume = this._volume
      audio.playbackRate = this._playbackRate

      // 用 Promise 包装音频事件，确保 error 能正确 reject
      await new Promise<void>((resolve, reject) => {
        let settled = false

        audio!.onloadedmetadata = () => {
          this._duration = audio!.duration
        }

        audio!.ontimeupdate = () => {
          this._currentTime = audio!.currentTime
          this.options.onProgress?.(audio!.currentTime, this._duration)
        }

        audio!.onended = () => {
          if (url) URL.revokeObjectURL(url)
          this._currentTime = this._duration
          this.options.onProgress?.(this._duration, this._duration)

          if (this.isPlayingQueue && this.queue.length > 0) {
            void this.playNextFromQueue(mimeType)
          } else {
            this.isPlayingQueue = false
            this.setState('finished')
            this.options.onEnded?.()
          }
        }

        audio!.onerror = () => {
          if (settled) return
          settled = true
          const mediaError = audio!.error
          const errMsg = mediaError
            ? `音频播放失败 (code ${mediaError.code}): ${mediaError.message}`
            : '音频播放失败'
          console.error('[TtsPlayer]', errMsg)
          if (url) URL.revokeObjectURL(url)
          this.setState('error')
          reject(new Error(errMsg))
        }

        // play() 返回 Promise，成功或失败都标记 settled
        audio!.play().then(() => {
          if (settled) return
          settled = true
          resolve()
        }).catch((err) => {
          if (settled) return
          settled = true
          reject(err)
        })
      })

      this.audio = audio
      this.setState('playing')
    } catch (error) {
      if (url) {
        URL.revokeObjectURL(url)
      }
      this.setState('error')
      const err = error instanceof Error ? error : new Error(String(error))
      this.options.onError?.(err)
      throw err
    }
  }

  private async playNextFromQueue(mimeType: string): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlayingQueue = false
      this.setState('finished')
      this.options.onEnded?.()
      return
    }

    this.isPlayingQueue = true
    const next = this.queue.shift()!
    await this.playBuffer(next.buffer, mimeType)
  }
}
