// AgentForge V1-03: TTS 音频播放器（渲染进程）
// 封装 Web Audio API / HTMLAudioElement，支持播放/暂停/继续/停止/跳转
// 支持音量调节、播放速度调节、进度回调
// 支持音频队列和逐句播放（V1-04 流式播放）

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

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
   * @param mimeType - MIME 类型，默认 audio/mpeg
   */
  async play(buffer: ArrayBuffer, mimeType = 'audio/mpeg'): Promise<void> {
    this.stop()
    this.queue = []
    this.isPlayingQueue = false

    await this.playBuffer(buffer, mimeType)
  }

  /**
   * 添加音频到播放队列尾部。
   * 如果当前没有在播放，立即开始播放。
   * （V1-04 流式播放使用）
   */
  enqueue(buffer: ArrayBuffer, text: string, mimeType = 'audio/mpeg'): void {
    this.queue.push({ buffer, text })
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

    try {
      const blob = new Blob([buffer], { type: mimeType })
      const url = URL.createObjectURL(blob)

      const audio = new Audio()
      audio.src = url
      audio.volume = this._volume
      audio.playbackRate = this._playbackRate

      audio.onloadedmetadata = () => {
        this._duration = audio.duration
      }

      audio.ontimeupdate = () => {
        this._currentTime = audio.currentTime
        this.options.onProgress?.(audio.currentTime, this._duration)
      }

      audio.onended = () => {
        URL.revokeObjectURL(url)
        this._currentTime = this._duration
        this.options.onProgress?.(this._duration, this._duration)

        if (this.isPlayingQueue && this.queue.length > 0) {
          // 播放队列下一句
          void this.playNextFromQueue(mimeType)
        } else {
          this.isPlayingQueue = false
          this.setState('finished')
          this.options.onEnded?.()
        }
      }

      audio.onerror = () => {
        URL.revokeObjectURL(url)
        this.setState('error')
        this.options.onError?.(new Error('音频播放失败'))
      }

      this.audio = audio
      await audio.play()
      this.setState('playing')
    } catch (error) {
      // OPT2-23: play() 失败时清理 Object URL，避免内存泄漏
      if (audio) {
        URL.revokeObjectURL(audio.src)
      }
      this.setState('error')
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
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
