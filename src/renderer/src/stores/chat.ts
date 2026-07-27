// P1-15: ChatStore - Pinia setup store for chat state management
// V1-04: + 流式 TTS 播放集成

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Conversation, ChatMessage, StreamChunk, StreamEndMetadata } from '@shared/types'
import { showToast } from '@/utils/toast'

export const useChatStore = defineStore('chat', () => {
  // ─── State ───────────────────────────────────────────────────

  /** All conversations loaded from electron */
  const conversations = ref<Conversation[]>([])

  /** Currently selected conversation ID */
  const currentConversationId = ref<string | null>(null)

  /** Messages for the current conversation */
  const messages = ref<ChatMessage[]>([])

  /** Whether a streaming generation is in progress */
  const isGenerating = ref(false)

  /** Accumulated content during streaming */
  const streamingContent = ref('')

  /** Whether conversations are being loaded (P1-12 skeleton loading) */
  const loading = ref(false)

  /** Whether knowledge base association is enabled for chat */
  const kbEnabled = ref(false)

  // ─── Getters ─────────────────────────────────────────────────

  /** The currently selected conversation object */
  const currentConversation = computed(() => {
    if (currentConversationId.value === null) return null
    return conversations.value.find((c) => c.id === currentConversationId.value) ?? null
  })

  // ─── Actions ─────────────────────────────────────────────────

  /**
   * Load all conversations from electron.
   * Sets loading=true during the request for skeleton placeholders.
   */
  // OPT2-24: 支持 silent 模式，避免流结束后骨架屏闪烁
  async function loadConversations(options?: { silent?: boolean }): Promise<void> {
    if (!options?.silent) {
      loading.value = true
    }
    try {
      const result = await window.electron.chat.listConversations()
      conversations.value = result as Conversation[]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!options?.silent) {
        showToast(`加载会话失败: ${message}`, 'error')
      }
      console.error('[ChatStore] loadConversations error:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * Select a conversation and load its messages.
   */
  async function selectConversation(id: string): Promise<void> {
    currentConversationId.value = id
    try {
      const result = await window.electron.chat.getMessages(id)
      messages.value = result as ChatMessage[]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`加载消息失败: ${message}`, 'error')
      console.error('[ChatStore] selectConversation error:', error)
      messages.value = []
    }
  }

  /**
   * Create a new conversation, add to list, and select it.
   */
  async function newConversation(modelId: string): Promise<void> {
    try {
      const conv = (await window.electron.chat.createConversation({
        modelId,
      })) as Conversation
      conversations.value.unshift(conv)
      currentConversationId.value = conv.id
      messages.value = []
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`创建会话失败: ${message}`, 'error')
      console.error('[ChatStore] newConversation error:', error)
    }
  }

  /**
   * Rename a conversation title.
   */
  async function renameConversation(id: string, newTitle: string): Promise<void> {
    try {
      const updated = (await window.electron.chat.updateTitle(id, newTitle)) as Conversation
      const idx = conversations.value.findIndex((c) => c.id === id)
      if (idx !== -1) {
        conversations.value[idx] = updated
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`重命名失败: ${message}`, 'error')
      console.error('[ChatStore] renameConversation error:', error)
    }
  }

  /**
   * Delete a conversation and remove from list.
   * If the deleted conversation is current, clear selection.
   */
  async function deleteConversation(id: string): Promise<void> {
    try {
      await window.electron.chat.deleteConversation(id)
      conversations.value = conversations.value.filter((c) => c.id !== id)
      if (currentConversationId.value === id) {
        currentConversationId.value = null
        messages.value = []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`删除会话失败: ${message}`, 'error')
      console.error('[ChatStore] deleteConversation error:', error)
    }
  }

  /**
   * Send a message in the current conversation.
   * Sets isGenerating=true. Returns immediately.
   */
  async function sendMessage(content: string): Promise<void> {
    if (currentConversationId.value === null) return
    const conv = currentConversation.value
    if (!conv) return

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      conversationId: currentConversationId.value,
      role: 'user',
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    messages.value.push(userMessage)

    // Add empty assistant message placeholder for streaming
    const assistantPlaceholder: ChatMessage = {
      id: `temp-assistant-${Date.now()}`,
      conversationId: currentConversationId.value,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    messages.value.push(assistantPlaceholder)

    // Reset streaming state
    streamingContent.value = ''
    isGenerating.value = true

    // V1-04: 启动流式 TTS 播放（如果 TTS 已启用且设置了自动播报）
    const { useVoiceStore } = await import('./voice')
    const { useSettingsStore } = await import('./settings')
    const voiceStore = useVoiceStore()
    const settingsStore = useSettingsStore()
    if (voiceStore.ttsEnabled && settingsStore.settings?.voice.tts.autoPlay) {
      voiceStore.startStream(assistantPlaceholder.id)
    }

    // Call electron to start streaming (fire-and-forget)
    try {
      await window.electron.chat.send(currentConversationId.value, content, conv.modelId, kbEnabled.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`发送消息失败: ${message}`, 'error')
      console.error('[ChatStore] sendMessage error:', error)
      isGenerating.value = false
      // Remove the assistant placeholder on error
      messages.value = messages.value.filter((m) => m.id !== assistantPlaceholder.id)
    }
  }

  /**
   * Stop the current generation.
   */
  async function stopGeneration(): Promise<void> {
    try {
      await window.electron.chat.stop()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`停止生成失败: ${message}`, 'error')
      console.error('[ChatStore] stopGeneration error:', error)
    }
  }

  /**
   * Handle an incoming stream chunk.
   * Called by useChat composable.
   */
  function handleStreamChunk(chunk: StreamChunk): void {
    if (chunk.type === 'text' && chunk.content) {
      streamingContent.value += chunk.content
      // Update the last assistant message content
      const lastMsg = messages.value[messages.value.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = streamingContent.value
      }
      // V1-04: 流式 TTS 播放（异步调用，不阻塞流处理）
      void (async () => {
        const { useVoiceStore } = await import('./voice')
        const voiceStore = useVoiceStore()
        if (voiceStore.streamPlaying) {
          voiceStore.feedStream(chunk.content)
        }
      })()
    }
  }

  /**
   * Handle stream end event.
   * Called by useChat composable.
   */
  async function handleStreamEnd(_meta: StreamEndMetadata): Promise<void> {
    isGenerating.value = false
    streamingContent.value = ''
    // V1-04: 结束流式 TTS 播放
    void (async () => {
      const { useVoiceStore } = await import('./voice')
      const voiceStore = useVoiceStore()
      if (voiceStore.streamPlaying) {
        await voiceStore.endStream()
      }
    })()
    // Reload conversation list to get updated title/message count
    try {
      await loadConversations({ silent: true })
    } catch (error) {
      console.error('[ChatStore] handleStreamEnd reload error:', error)
    }
  }

  /**
   * Handle stream error event.
   * Called by useChat composable.
   */
  function handleStreamError(errorData?: { code?: string; message?: string }): void {
    isGenerating.value = false
    streamingContent.value = ''
    const msg = errorData?.message ?? '流式生成失败，请重试'
    showToast(msg, 'error')
    // V1-04: 取消流式 TTS 播放
    void (async () => {
      const { useVoiceStore } = await import('./voice')
      const voiceStore = useVoiceStore()
      if (voiceStore.streamPlaying) {
        voiceStore.cancelStream()
      }
    })()
  }

  return {
    // State
    conversations,
    currentConversationId,
    messages,
    isGenerating,
    streamingContent,
    loading,
    kbEnabled,
    // Getters
    currentConversation,
    // Actions
    loadConversations,
    selectConversation,
    newConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stopGeneration,
    handleStreamChunk,
    handleStreamEnd,
    handleStreamError,
  }
})
