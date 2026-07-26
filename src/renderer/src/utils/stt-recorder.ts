// AgentForge V1-05: STT 录音工具（渲染进程）
// 封装 MediaRecorder API，支持开始/停止/取消录音
// 提供实时音量回调用于波形动画
// 输出 webm/opus 格式的 ArrayBuffer

export type RecorderState = 'idle' | 'recording' | 'stopping' | 'error'

export interface RecorderOptions {
  /** 录音时长上限（毫秒），默认 5 分钟 */
  maxDurationMs?: number
  /** 音量回调间隔（毫秒），默认 100ms */
  volumeIntervalMs?: number
  /** 音量回调，范围 0 ~ 1 */
  onVolume?: (volume: number) => void
  /** 时长回调，每秒调用 */
  onDuration?: (seconds: number) => void
  /** 超时回调，达到最大时长时调用 */
  onTimeout?: () => void
}

/**
 * 语音录音器。
 * 使用 MediaRecorder API + Web Audio API 实现录音和音量检测。
 */
export class SttRecorder {
  private state: RecorderState = 'idle'
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private chunks: Blob[] = []
  private startTime = 0
  private durationTimer: number | null = null
  private volumeTimer: number | null = null
  private maxDurationMs: number
  private volumeIntervalMs: number
  private options: RecorderOptions

  constructor(options: RecorderOptions = {}) {
    this.maxDurationMs = options.maxDurationMs ?? 5 * 60 * 1000 // 5 分钟
    this.volumeIntervalMs = options.volumeIntervalMs ?? 100
    this.options = options
  }

  /**
   * 开始录音。
   *
   * @throws DOMException - 麦克风权限被拒绝时抛出
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('录音器未处于空闲状态')
    }

    try {
      // 获取麦克风流
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // 创建 MediaRecorder
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ]
      const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t))
      if (!mimeType) {
        throw new Error('当前浏览器不支持任何可用的音频录制格式')
      }

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType })
      this.chunks = []

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data)
        }
      }

      // 设置音频分析器用于音量检测
      this.setupAudioAnalyser()

      // 开始录制
      this.mediaRecorder.start()
      this.state = 'recording'
      this.startTime = Date.now()

      // 启动计时器
      this.startTimers()
    } catch (error) {
      this.cleanup()
      this.state = 'error'
      throw error
    }
  }

  /**
   * 停止录音并返回音频数据。
   *
   * @returns 录音的 ArrayBuffer 和 MIME 类型
   */
  async stop(): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
    if (this.state !== 'recording') {
      throw new Error('当前未在录音')
    }

    this.state = 'stopping'

    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('录音器未初始化'))
        return
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType ?? 'audio/webm' })
        const reader = new FileReader()
        reader.onload = () => {
          const buffer = reader.result as ArrayBuffer
          this.cleanup()
          this.state = 'idle'
          resolve({ buffer, mimeType: blob.type })
        }
        reader.onerror = () => {
          this.cleanup()
          this.state = 'error'
          reject(new Error('读取录音数据失败'))
        }
        reader.readAsArrayBuffer(blob)
      }

      this.mediaRecorder.onerror = () => {
        this.cleanup()
        this.state = 'error'
        reject(new Error('录音失败'))
      }

      this.stopTimers()
      this.mediaRecorder.stop()
    })
  }

  /**
   * 取消录音（不保存数据）。
   */
  cancel(): void {
    if (this.state === 'idle') return

    this.stopTimers()

    if (this.mediaRecorder && this.state === 'recording') {
      this.mediaRecorder.onstop = () => {
        this.cleanup()
        this.state = 'idle'
      }
      this.mediaRecorder.stop()
    } else {
      this.cleanup()
      this.state = 'idle'
    }
  }

  /**
   * 获取当前录音状态。
   */
  getState(): RecorderState {
    return this.state
  }

  /**
   * 获取当前录音时长（秒）。
   */
  getDuration(): number {
    if (this.state === 'idle' || this.state === 'error') return 0
    return (Date.now() - this.startTime) / 1000
  }

  // ─── 内部方法 ──────────────────────────────────────────────────

  private setupAudioAnalyser(): void {
    if (!this.stream) return

    try {
      this.audioContext = new AudioContext()
      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 256
      source.connect(this.analyser)
    } catch {
      // 音量检测失败不影响录音
      this.analyser = null
    }
  }

  private startTimers(): void {
    // 音量检测
    if (this.options.onVolume && this.analyser) {
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
      this.volumeTimer = window.setInterval(() => {
        if (!this.analyser || this.state !== 'recording') return
        this.analyser.getByteFrequencyData(dataArray)
        // 计算平均音量（0 ~ 255 → 0 ~ 1）
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length / 255
        this.options.onVolume?.(avg)
      }, this.volumeIntervalMs)
    }

    // 时长计时
    if (this.options.onDuration) {
      this.durationTimer = window.setInterval(() => {
        const secs = Math.floor((Date.now() - this.startTime) / 1000)
        this.options.onDuration?.(secs)
      }, 1000)
    }

    // 超时检查
    if (this.maxDurationMs > 0) {
      setTimeout(() => {
        if (this.state === 'recording') {
          this.options.onTimeout?.()
          void this.stop()
        }
      }, this.maxDurationMs)
    }
  }

  private stopTimers(): void {
    if (this.volumeTimer !== null) {
      clearInterval(this.volumeTimer)
      this.volumeTimer = null
    }
    if (this.durationTimer !== null) {
      clearInterval(this.durationTimer)
      this.durationTimer = null
    }
  }

  private cleanup(): void {
    this.stopTimers()

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }

    if (this.audioContext) {
      void this.audioContext.close()
      this.audioContext = null
    }

    this.analyser = null
    this.mediaRecorder = null
    this.chunks = []
  }
}
