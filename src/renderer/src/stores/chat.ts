// P1-15: ChatStore - Pinia setup store for chat state management
// V1-04: + 流式 TTS 播放集成

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Conversation, ChatMessage, StreamChunk, StreamEndMetadata } from '@shared/types'
import { showToast } from '@/utils/toast'
import { useContextUsageStore } from '@/stores/context-usage'

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

  /** Search query for conversation filtering */
  const searchQuery = ref('')

  // ─── Getters ─────────────────────────────────────────────────

  /** The currently selected conversation object */
  const currentConversation = computed(() => {
    if (currentConversationId.value === null) return null
    return conversations.value.find((c) => c.id === currentConversationId.value) ?? null
  })

  /** Conversations filtered by search query (title + message content) */
  const filteredConversations = computed(() => {
    if (!searchQuery.value.trim()) return conversations.value
    return conversations.value.filter((c) =>
      c.title.toLowerCase().includes(searchQuery.value.toLowerCase()),
    )
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
    // B8: 切换到不同会话时隐藏上下文使用量进度条（新会话尚无 usage 数据）
    if (currentConversationId.value !== id) {
      useContextUsageStore().hide()
    }
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
   * Update the model bound to a conversation.
   */
  async function updateConversationModel(id: string, modelId: string): Promise<void> {
    try {
      const updated = (await window.electron.chat.updateModel(id, modelId)) as Conversation
      const idx = conversations.value.findIndex((c) => c.id === id)
      if (idx !== -1) {
        conversations.value[idx] = updated
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`切换模型失败: ${message}`, 'error')
      console.error('[ChatStore] updateConversationModel error:', error)
    }
  }

  /**
   * Delete a single message from the current conversation.
   */
  async function deleteMessage(messageId: string): Promise<void> {
    try {
      await window.electron.chat.deleteMessage?.(messageId)
      messages.value = messages.value.filter((m) => m.id !== messageId)
    } catch {
      // Fallback: just remove from local state if API not available
      messages.value = messages.value.filter((m) => m.id !== messageId)
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
   * Clear all messages from a conversation (keep the conversation itself).
   */
  async function clearConversation(id: string): Promise<void> {
    try {
      await window.electron.chat.clearConversation(id)
      if (currentConversationId.value === id) {
        messages.value = []
      }
      // Update local conversation stats
      const idx = conversations.value.findIndex((c) => c.id === id)
      if (idx !== -1) {
        conversations.value[idx] = {
          ...conversations.value[idx],
          messageCount: 0,
          lastMessageAt: null,
        }
      }
      showToast('对话已清空', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`清空对话失败: ${message}`, 'error')
      console.error('[ChatStore] clearConversation error:', error)
    }
  }

  /**
   * Search conversations by keyword (title + message content).
   */
  async function searchConversations(keyword: string): Promise<void> {
    if (!keyword.trim()) {
      await loadConversations({ silent: true })
      return
    }
    try {
      const result = await window.electron.chat.searchConversations(keyword.trim())
      conversations.value = result as Conversation[]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`搜索失败: ${message}`, 'error')
      console.error('[ChatStore] searchConversations error:', error)
    }
  }

  // ─── P3-01: 对话分支 (Fork) ────────────────────────────────────

  /**
   * Fork 当前会话，创建一个新的分支。
   */
  async function forkConversation(messageCount?: number): Promise<Conversation | null> {
    const conv = currentConversation.value
    if (!conv) {
      showToast('没有选中的会话', 'warning')
      return null
    }

    try {
      const forked = (await window.electron.chat.forkConversation(
        conv.id,
        messageCount,
      )) as Conversation
      conversations.value.unshift(forked)
      currentConversationId.value = forked.id
      messages.value = await window.electron.chat.getMessages(forked.id) as ChatMessage[]
      showToast('会话已分支', 'success')
      return forked
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`分支会话失败: ${message}`, 'error')
      console.error('[ChatStore] forkConversation error:', error)
      return null
    }
  }

  /**
   * 获取指定会话的分支树（祖先 + 子分支）。
   */
  async function getConversationTree(id: string): Promise<{
    ancestors: Conversation[]
    children: Conversation[]
  } | null> {
    try {
      return await window.electron.chat.getConversationTree(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`获取分支树失败: ${message}`, 'error')
      console.error('[ChatStore] getConversationTree error:', error)
      return null
    }
  }

  /**
   * Export current conversation messages to Markdown file.
   */
  function exportToMarkdown(): void {
    const conv = currentConversation.value
    if (!conv || messages.value.length === 0) {
      showToast('没有可导出的内容', 'warning')
      return
    }

    const lines: string[] = [`# ${conv.title}\n`, `> 导出时间: ${new Date().toLocaleString('zh-CN')}\n`]

    for (const msg of messages.value) {
      const roleLabel = msg.role === 'user' ? '## 用户' : msg.role === 'assistant' ? '## 助手' : `## ${msg.role}`
      lines.push(`${roleLabel}\n`)
      lines.push(`${msg.content}\n`)
      if (msg.metadata?.tokensUsed) {
        lines.push(`\n> Token: ${msg.metadata.tokensUsed} | 耗时: ${msg.metadata.duration ?? 0}ms\n`)
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv.title.replace(/[^\w\u4e00-\u9fa5]/g, '_')}_${Date.now()}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('导出成功', 'success')
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
    } else if (chunk.type === 'usage-info' && chunk.content) {
      // B8: 更新上下文使用量进度条（SDK session.usage_info 事件）
      try {
        const usage = JSON.parse(chunk.content) as {
          tokenLimit: number
          currentTokens: number
          messagesLength: number
        }
        useContextUsageStore().update(usage)
      } catch {
        // Ignore malformed usage-info payloads
      }
    }
  }

  /**
   * Handle stream end event.
   * Called by useChat composable.
   */
  async function handleStreamEnd(meta: StreamEndMetadata): Promise<void> {
    isGenerating.value = false
    streamingContent.value = ''

    // Update the last assistant message with metadata (tokens, duration, etc.)
    const lastMsg = messages.value[messages.value.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.metadata = {
        ...lastMsg.metadata,
        modelId: meta.modelId,
        tokensUsed: meta.tokensUsed,
        duration: meta.duration,
        stopped: meta.stopped,
      }
    }

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
    searchQuery,
    // Getters
    currentConversation,
    filteredConversations,
    // Actions
    loadConversations,
    selectConversation,
    newConversation,
    deleteConversation,
    renameConversation,
    updateConversationModel,
    clearConversation,
    searchConversations,
    exportToMarkdown,
    deleteMessage,
    sendMessage,
    stopGeneration,
    handleStreamChunk,
    handleStreamEnd,
    handleStreamError,
    // P3-01: Fork
    forkConversation,
    getConversationTree,
  }
})
