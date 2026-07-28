// V1-03 / V1-06: Voice Store - Pinia store for voice state management
// Manages TTS playback state, STT recording state, and voice mode state

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { TtsPlayState, SttRecordState, VoiceModeState, TtsPlayProgress } from '@shared/types'
import { TtsPlayer } from '@/utils/tts-player'
import { SttRecorder } from '@/utils/stt-recorder'
import { useSettingsStore } from './settings'
import { showToast } from '@/utils/toast'

export const useVoiceStore = defineStore('voice', () => {
  // ─── State ───────────────────────────────────────────────────

  // ─── TTS Playback ───
  const ttsState = ref<TtsPlayState>('idle')
  const currentMessageId = ref<string | null>(null)
  const currentText = ref('')
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(0.8)
  const playbackRate = ref(1.0)
  const ttsError = ref<string | null>(null)

  // ─── STT Recording ───
  const sttState = ref<SttRecordState>('idle')
  const recordDuration = ref(0)
  const recordVolume = ref(0)
  const sttError = ref<string | null>(null)
  /** 录音转写结果文本 */
  const transcribedText = ref('')

  // ─── Voice Mode ───
  const voiceMode = ref<VoiceModeState>('off')

  // ─── Streaming TTS (V1-04) ───
  /** 流式播放是否激活 */
  const streamPlaying = ref(false)
  /** 当前流式消息 ID */
  const streamMessageId = ref<string | null>(null)
  /** 流式累积缓冲区（未合成的不完整句子） */
  let streamBuffer = ''
  /** 流式播放完成回调 */
  let streamEndResolve: (() => void) | null = null
  /** 合成队列：保证按序合成 */
  let synthesisQueue: Array<{ text: string; format: string }> = []
  let synthesisRunning = false

  // ─── Internal ───
  let player: TtsPlayer | null = null
  let recorder: SttRecorder | null = null

  // ─── TTS Audio Cache ───
  /** 消息音频缓存：messageId → ArrayBuffer，避免重复请求 API */
  const audioCache = new Map<string, ArrayBuffer>()

  // ─── Getters ─────────────────────────────────────────────────

  const ttsEnabled = computed(() => {
    const settings = useSettingsStore().settings
    return settings?.voice.tts.enabled ?? false
  })

  const sttEnabled = computed(() => {
    const settings = useSettingsStore().settings
    return settings?.voice.stt.enabled ?? false
  })

  const isPlaying = computed(() => ttsState.value === 'playing')
  const isPaused = computed(() => ttsState.value === 'paused')
  const isRecording = computed(() => sttState.value === 'recording')
  const isVoiceModeOn = computed(() => voiceMode.value !== 'off')

  const progress = computed<TtsPlayProgress>(() => ({
    messageId: currentMessageId.value,
    state: ttsState.value,
    currentTime: currentTime.value,
    duration: duration.value,
    volume: volume.value,
    playbackRate: playbackRate.value,
  }))

  // ─── TTS Actions ─────────────────────────────────────────────

  /**
   * Get or create the TTS player singleton.
   */
  function getPlayer(): TtsPlayer {
    if (!player) {
      player = new TtsPlayer({
        volume: volume.value,
        playbackRate: playbackRate.value,
        onProgress: (time, dur) => {
          currentTime.value = time
          duration.value = dur
        },
        onStateChange: (state) => {
          ttsState.value = state
        },
        onEnded: () => {
          // 流式播放结束检测
          if (streamPlaying.value === false && streamEndResolve) {
            const p = player!
            if (p.queueLength === 0) {
              const resolve = streamEndResolve
              streamEndResolve = null
              streamMessageId.value = null
              resolve()
            }
          }
        },
        onError: (error) => {
          ttsError.value = error.message
        },
      })
    }
    return player
  }

  /**
   * 播放指定消息的语音。
   * 优先使用缓存，缓存未命中时调用 TTS API。
   */
  async function playMessage(messageId: string, text: string): Promise<void> {
    if (!text.trim()) return

    const settingsStore = useSettingsStore()
    const ttsConfig = settingsStore.settings?.voice.tts
    if (!ttsConfig?.enabled) {
      showToast('TTS 未启用，请在设置中开启语音播报', 'warning')
      return
    }

    // 如果正在播放同一条消息，切换暂停/继续
    if (currentMessageId.value === messageId && (ttsState.value === 'playing' || ttsState.value === 'paused')) {
      togglePlayPause()
      return
    }

    // 停止当前播放
    stopPlayback()

    currentMessageId.value = messageId
    currentText.value = text
    ttsError.value = null

    try {
      // 检查缓存
      let audioBuffer = audioCache.get(messageId)

      if (!audioBuffer) {
        // 缓存未命中，调用 API
        ttsState.value = 'loading'
        audioBuffer = await window.electron.voice.synthesize(text, {
          model: ttsConfig.model,
          voice: ttsConfig.voice,
          speed: ttsConfig.speed,
          format: ttsConfig.format,
        })
        // 存入缓存（限制缓存大小，最多 20 条）
        if (audioCache.size >= 20) {
          const firstKey = audioCache.keys().next().value
          if (firstKey) audioCache.delete(firstKey)
        }
        audioCache.set(messageId, audioBuffer)
      }

      const player = getPlayer()
      player.setVolume(volume.value)
      player.setPlaybackRate(playbackRate.value)
      await player.play(audioBuffer, ttsConfig.format)
    } catch (error) {
      console.error('[Voice] playMessage error:', error)
      ttsState.value = 'error'
      ttsError.value = error instanceof Error ? error.message : String(error)
      currentMessageId.value = null
      showToast(`语音播放失败: ${ttsError.value}`, 'error')
    }
  }

  /**
   * 切换播放/暂停。
   */
  function togglePlayPause(): void {
    const player = getPlayer()
    if (player.state === 'playing') {
      player.pause()
    } else if (player.state === 'paused') {
      player.resume()
    }
  }

  /**
   * 停止播放。
   */
  function stopPlayback(): void {
    if (player) {
      player.stop()
    }
    currentMessageId.value = null
    currentTime.value = 0
    duration.value = 0
    ttsState.value = 'idle'
    ttsError.value = null
    // 停止时清空合成队列，避免残留任务继续执行
    synthesisQueue = []
  }

  /**
   * 跳转到指定时间。
   */
  function seek(time: number): void {
    if (player) {
      player.seek(time)
    }
  }

  /**
   * 设置音量（0 ~ 1）。
   */
  function setVolume(v: number): void {
    volume.value = Math.max(0, Math.min(1, v))
    if (player) {
      player.setVolume(volume.value)
    }
  }

  /**
   * 设置播放速度（0.5 ~ 2.0）。
   */
  function setPlaybackRate(rate: number): void {
    playbackRate.value = Math.max(0.5, Math.min(2.0, rate))
    if (player) {
      player.setPlaybackRate(playbackRate.value)
    }
  }

  // ─── Streaming TTS (V1-04) ───────────────────────────────────

  /**
   * 句子结束标点符号（中英文）。
   * 用于在流式文本中切分句子。
   */
  const SENTENCE_ENDERS = /[。！？.!?\n]/

  /**
   * 开始流式播放。
   * 初始化流式缓冲区和队列。
   */
  function startStream(messageId: string): void {
    if (!ttsEnabled.value) return

    // 停止当前播放
    stopPlayback()

    streamMessageId.value = messageId
    currentMessageId.value = messageId
    streamBuffer = ''
    streamPlaying.value = true
    streamEndResolve = null
  }

  /**
   * 处理流式文本 chunk。
   * 累积文本，检测到完整句子时合成并排入队列。
   */
  function feedStream(chunk: string): void {
    if (!streamPlaying.value || !chunk) return

    streamBuffer += chunk

    // 查找句子结束位置
    let lastEnd = -1
    let match: RegExpExecArray | null

    // 使用全局正则逐个查找句子结束符
    const regex = new RegExp(SENTENCE_ENDERS.source, 'g')
    while ((match = regex.exec(streamBuffer)) !== null) {
      lastEnd = match.index
    }

    if (lastEnd >= 0) {
      // 有完整句子，切分并合成
      const sentences = streamBuffer.slice(0, lastEnd + 1)
      streamBuffer = streamBuffer.slice(lastEnd + 1)

      // 将完整句子合成并加入队列
      void synthesizeAndEnqueue(sentences)
    }
  }

  /**
   * 结束流式播放。
   * 处理缓冲区中剩余的文本，等待合成队列和播放队列完毕。
   */
  async function endStream(): Promise<void> {
    if (!streamPlaying.value) return

    // 处理剩余缓冲区
    if (streamBuffer.trim()) {
      await synthesizeAndEnqueue(streamBuffer)
    }

    streamBuffer = ''
    streamPlaying.value = false

    // 等待合成队列清空
    while (synthesisRunning && synthesisQueue.length > 0) {
      await new Promise((r) => setTimeout(r, 100))
    }
    // 再等合成运行中的最后一个任务完成
    while (synthesisRunning) {
      await new Promise((r) => setTimeout(r, 50))
    }

    // 如果队列已空，直接结束
    const p = getPlayer()
    if (p.queueLength === 0 && (p.state === 'idle' || p.state === 'finished')) {
      streamMessageId.value = null
      return
    }

    // 等待播放队列完毕
    return new Promise<void>((resolve) => {
      streamEndResolve = resolve
    })
  }

  /**
   * 取消流式播放。
   * 清空缓冲区、合成队列和播放队列，停止播放。
   */
  function cancelStream(): void {
    streamBuffer = ''
    streamPlaying.value = false
    streamMessageId.value = null
    streamEndResolve = null
    synthesisQueue = []
    synthesisRunning = false
    stopPlayback()
  }

  /**
   * 合成文本并加入播放队列（串行队列，保证顺序）。
   */
  async function synthesizeAndEnqueue(text: string): Promise<void> {
    if (!text.trim()) return

    const settingsStore = useSettingsStore()
    const ttsConfig = settingsStore.settings?.voice.tts
    if (!ttsConfig?.enabled) return

    // 加入合成队列
    synthesisQueue.push({ text, format: ttsConfig.format })

    // 如果没有正在运行的合成任务，启动队列处理
    if (!synthesisRunning) {
      await processSynthesisQueue()
    }
  }

  /**
   * 串行处理合成队列，保证句子按序入队。
   */
  async function processSynthesisQueue(): Promise<void> {
    synthesisRunning = true
    const settingsStore = useSettingsStore()
    const ttsConfig = settingsStore.settings?.voice.tts

    while (synthesisQueue.length > 0 && streamPlaying.value) {
      const item = synthesisQueue.shift()!
      try {
        if (!ttsConfig?.enabled) break
        const audioBuffer = await window.electron.voice.synthesize(item.text, {
          model: ttsConfig.model,
          voice: ttsConfig.voice,
          speed: ttsConfig.speed,
          format: ttsConfig.format,
        })

        const p = getPlayer()
        p.setVolume(volume.value)
        p.setPlaybackRate(playbackRate.value)
        p.enqueue(audioBuffer, item.text, item.format)
      } catch (error) {
        console.error('[Voice] Stream TTS synthesis error:', error)
        // 单句失败不中断整个流式播放
      }
    }
    synthesisRunning = false
  }

  // ─── STT Actions ─────────────────────────────────────────────

  /**
   * Get or create the STT recorder singleton.
   */
  function getRecorder(): SttRecorder {
    if (!recorder) {
      recorder = new SttRecorder({
        onVolume: (v) => {
          recordVolume.value = v
        },
        onDuration: (secs) => {
          recordDuration.value = secs
        },
        onTimeout: () => {
          showToast('录音已达到最大时长，自动停止', 'warning')
        },
      })
    }
    return recorder
  }

  /**
   * 开始录音。
   */
  async function startRecording(): Promise<void> {
    const settingsStore = useSettingsStore()
    const sttConfig = settingsStore.settings?.voice.stt
    if (!sttConfig?.enabled) {
      showToast('请先在设置中启用 STT', 'warning')
      return
    }
    if (!sttConfig.apiKey) {
      showToast('请先在设置中配置 STT API Key', 'warning')
      return
    }

    try {
      const rec = getRecorder()
      recordDuration.value = 0
      recordVolume.value = 0
      sttError.value = null
      transcribedText.value = ''
      await rec.start()
      sttState.value = 'recording'
    } catch (error) {
      sttState.value = 'error'
      sttError.value = error instanceof Error ? error.message : String(error)
      showToast(`无法启动录音: ${sttError.value}`, 'error')
    }
  }

  /**
   * 停止录音并转写。
   *
   * @returns 转写后的文本
   */
  async function stopRecording(): Promise<string> {
    if (sttState.value !== 'recording') return ''

    try {
      const rec = getRecorder()
      const { buffer } = await rec.stop()
      sttState.value = 'transcribing'

      const settingsStore = useSettingsStore()
      const sttConfig = settingsStore.settings?.voice.stt

      const text = await window.electron.voice.transcribe(buffer, {
        model: sttConfig?.model,
        language: sttConfig?.language,
        temperature: sttConfig?.temperature,
      })

      transcribedText.value = text
      sttState.value = 'idle'
      return text
    } catch (error) {
      sttState.value = 'error'
      sttError.value = error instanceof Error ? error.message : String(error)
      showToast(`转写失败: ${sttError.value}`, 'error')
      return ''
    }
  }

  /**
   * 取消录音（不转写）。
   */
  function cancelRecording(): void {
    if (recorder) {
      recorder.cancel()
    }
    sttState.value = 'idle'
    recordDuration.value = 0
    recordVolume.value = 0
  }

  // ─── Voice Mode Actions (V1-07) ─────────────────────────────

  /** VAD 相关状态 */
  let vadActive = false

  /**
   * 切换实时语音模式开关。
   */
  function toggleVoiceMode(): void {
    if (voiceMode.value === 'off') {
      void startVoiceMode()
    } else {
      stopVoiceMode()
    }
  }

  /**
   * 开启实时语音模式。
   * 进入等待说话状态，VAD 开始监听。
   */
  async function startVoiceMode(): Promise<void> {
    const settingsStore = useSettingsStore()
    const ttsEnabled = settingsStore.settings?.voice.tts.enabled
    const sttEnabled = settingsStore.settings?.voice.stt.enabled

    if (!ttsEnabled || !sttEnabled) {
      showToast('请先在设置中启用 TTS 和 STT', 'warning')
      return
    }

    voiceMode.value = 'awaiting'
    // 启动 VAD 监听
    startVadListening()
  }

  /**
   * 关闭实时语音模式。
   * 停止所有录音和播放。
   */
  function stopVoiceMode(): void {
    voiceMode.value = 'off'
    stopVadListening()
    cancelRecording()
    stopPlayback()
    cancelStream()
  }

  /**
   * 启动 VAD 监听（等待说话状态）。
   * 每隔一段时间检测音量，超过阈值则开始录音。
   */
  function startVadListening(): void {
    if (vadActive) return

    const settingsStore = useSettingsStore()
    const vadThreshold = 0.1 // 音量阈值 0 ~ 1
    const silenceThreshold = (settingsStore.settings?.voice.mode.vadSilenceThreshold ?? 1.5) * 1000 // ms

    let consecutiveHigh = 0
    let consecutiveLow = 0
    const requiredHighFrames = 3 // 连续 3 帧高音量才开始
    const requiredLowFrames = Math.ceil(silenceThreshold / 100) // 多少帧低音量才停止

    // 创建一个静默的录音流用于 VAD 检测
    // 注意：这里复用 SttRecorder，但只用于音量检测，不保存数据
    let vadRecorder: SttRecorder | null = null

    async function setupVadRecorder(): Promise<void> {
      try {
        vadRecorder = new SttRecorder({
          volumeIntervalMs: 100,
          onVolume: (volume) => {
            if (voiceMode.value !== 'awaiting' && voiceMode.value !== 'listening') return

            if (volume > vadThreshold) {
              consecutiveHigh++
              consecutiveLow = 0

              // 等待说话 → 检测到声音，开始录音
              if (voiceMode.value === 'awaiting' && consecutiveHigh >= requiredHighFrames) {
                voiceMode.value = 'listening'
                // 停止 VAD 录音，切换到正式录音
                vadRecorder?.cancel()
                vadRecorder = null
                vadActive = false
                // 开始正式录音
                void startVoiceModeRecording()
              }
            } else {
              consecutiveLow++
              consecutiveHigh = 0

              // 录音中 → 检测到静音，停止录音
              if (voiceMode.value === 'listening' && consecutiveLow >= requiredLowFrames) {
                // 停止录音并转写
                void stopVoiceModeRecording()
              }
            }
          },
        })

        await vadRecorder.start()
        vadActive = true
      } catch (error) {
        console.error('[Voice] VAD recorder setup failed:', error)
        if (voiceMode.value !== 'off') {
          showToast('无法访问麦克风，语音模式已关闭', 'error')
          voiceMode.value = 'off'
        }
      }
    }

    void setupVadRecorder()
  }

  /**
   * 停止 VAD 监听。
   */
  function stopVadListening(): void {
    vadActive = false
  }

  /**
   * 开始语音模式下的录音（listening 状态）。
   */
  async function startVoiceModeRecording(): Promise<void> {
    try {
      const rec = getRecorder()
      recordDuration.value = 0
      recordVolume.value = 0
      sttError.value = null
      await rec.start()
      // sttState 会在 recorder 回调中更新
      sttState.value = 'recording'
    } catch (error) {
      sttState.value = 'error'
      sttError.value = error instanceof Error ? error.message : String(error)
      showToast(`录音失败: ${sttError.value}`, 'error')
      // 回到等待状态
      voiceMode.value = 'awaiting'
      startVadListening()
    }
  }

  /**
   * 停止语音模式下的录音，转写并发送。
   */
  async function stopVoiceModeRecording(): Promise<void> {
    if (voiceMode.value !== 'listening') return

    voiceMode.value = 'transcribing'
    sttState.value = 'transcribing'

    try {
      const rec = getRecorder()
      const { buffer } = await rec.stop()

      const settingsStore = useSettingsStore()
      const sttConfig = settingsStore.settings?.voice.stt

      const text = await window.electron.voice.transcribe(buffer, {
        model: sttConfig?.model,
        language: sttConfig?.language,
        temperature: sttConfig?.temperature,
      })

      if (!text.trim()) {
        // 没识别到内容，回到等待状态
        showToast('未识别到语音内容', 'info')
        voiceMode.value = 'awaiting'
        startVadListening()
        return
      }

      transcribedText.value = text
      sttState.value = 'idle'

      // 发送消息到聊天
      voiceMode.value = 'speaking'
      await sendVoiceMessage(text)
    } catch (error) {
      sttState.value = 'error'
      sttError.value = error instanceof Error ? error.message : String(error)
      showToast(`转写失败: ${sttError.value}`, 'error')
      voiceMode.value = 'awaiting'
      startVadListening()
    }
  }

  /**
   * 发送语音消息到聊天。
   * 通过 Agent 路径发送，使 AI 具备工具调用能力。
   */
  async function sendVoiceMessage(text: string): Promise<void> {
    try {
      const { useChatStore } = await import('./chat')
      const { useAgentStore } = await import('./agent')
      const chatStore = useChatStore()
      const agentStore = useAgentStore()

      const conv = chatStore.currentConversation
      if (!conv) return

      // 乐观添加用户消息
      const userMessage = {
        id: `temp-user-${Date.now()}`,
        conversationId: conv.id,
        role: 'user' as const,
        content: text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      chatStore.messages.push(userMessage)

      // 通过 Agent 路径发送（支持工具调用）
      try {
        await agentStore.execute({
          conversationId: conv.id,
          userInput: text,
          modelId: conv.modelId,
          approvalMode: conv.approvalMode,
          maxSteps: 20,
        })
      } finally {
        await chatStore.selectConversation(conv.id)
        await chatStore.loadConversations({ silent: true })
        agentStore.reset()
      }

      // 等待 TTS 播放完毕（流式播放会自动开始）
      // 播放结束后如果 autoAwait 为 true，自动回到等待状态
      const settingsStore = useSettingsStore()
      const autoAwait = settingsStore.settings?.voice.mode.autoAwait ?? true

      if (autoAwait) {
        // 等待流式播放结束
        await waitForStreamEnd()
        voiceMode.value = 'awaiting'
        startVadListening()
      } else {
        voiceMode.value = 'off'
      }
    } catch (error) {
      console.error('[Voice] Send voice message error:', error)
      voiceMode.value = 'awaiting'
      startVadListening()
    }
  }

  /**
   * 等待流式播放结束。
   */
  async function waitForStreamEnd(): Promise<void> {
    const p = getPlayer()
    // 如果已经在播放或队列中有内容，等待结束
    if (p.state === 'playing' || p.state === 'loading' || p.queueLength > 0 || streamPlaying.value) {
      return new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const player = getPlayer()
          if (
            player.state === 'finished' ||
            player.state === 'idle' ||
            player.state === 'error'
          ) {
            if (!streamPlaying.value && player.queueLength === 0) {
              clearInterval(checkInterval)
              resolve()
            }
          }
        }, 500)
      })
    }
  }

  return {
    // State
    ttsState,
    currentMessageId,
    currentText,
    currentTime,
    duration,
    volume,
    playbackRate,
    ttsError,
    sttState,
    recordDuration,
    recordVolume,
    sttError,
    transcribedText,
    voiceMode,
    streamPlaying,
    streamMessageId,
    // Getters
    ttsEnabled,
    sttEnabled,
    isPlaying,
    isPaused,
    isRecording,
    isVoiceModeOn,
    progress,
    // TTS Actions
    playMessage,
    togglePlayPause,
    stopPlayback,
    seek,
    setVolume,
    setPlaybackRate,
    // Streaming TTS
    startStream,
    feedStream,
    endStream,
    cancelStream,
    // STT Actions
    startRecording,
    stopRecording,
    cancelRecording,
    // Voice Mode
    toggleVoiceMode,
  }
})
