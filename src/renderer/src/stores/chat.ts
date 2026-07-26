// P1-15: ChatStore - Pinia setup store for chat state management

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Conversation, ChatMessage, StreamChunk, StreamEndMetadata } from '@shared/types'

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
  async function loadConversations(): Promise<void> {
    loading.value = true
    try {
      const result = await window.electron.chat.listConversations()
      conversations.value = result as Conversation[]
    } finally {
      loading.value = false
    }
  }

  /**
   * Select a conversation and load its messages.
   */
  async function selectConversation(id: string): Promise<void> {
    currentConversationId.value = id
    const result = await window.electron.chat.getMessages(id)
    messages.value = result as ChatMessage[]
  }

  /**
   * Create a new conversation, add to list, and select it.
   */
  async function newConversation(modelId: string): Promise<void> {
    const conv = (await window.electron.chat.createConversation({
      modelId,
    })) as Conversation
    conversations.value.unshift(conv)
    currentConversationId.value = conv.id
    messages.value = []
  }

  /**
   * Delete a conversation and remove from list.
   * If the deleted conversation is current, clear selection.
   */
  async function deleteConversation(id: string): Promise<void> {
    await window.electron.chat.deleteConversation(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (currentConversationId.value === id) {
      currentConversationId.value = null
      messages.value = []
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

    // Call electron to start streaming (fire-and-forget)
    await window.electron.chat.send(currentConversationId.value, content, conv.modelId)
  }

  /**
   * Stop the current generation.
   */
  async function stopGeneration(): Promise<void> {
    await window.electron.chat.stop()
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
    }
  }

  /**
   * Handle stream end event.
   * Called by useChat composable.
   */
  async function handleStreamEnd(_meta: StreamEndMetadata): Promise<void> {
    isGenerating.value = false
    streamingContent.value = ''
    // Reload conversation list to get updated title/message count
    await loadConversations()
  }

  /**
   * Handle stream error event.
   * Called by useChat composable.
   */
  function handleStreamError(): void {
    isGenerating.value = false
    streamingContent.value = ''
  }

  return {
    // State
    conversations,
    currentConversationId,
    messages,
    isGenerating,
    streamingContent,
    loading,
    // Getters
    currentConversation,
    // Actions
    loadConversations,
    selectConversation,
    newConversation,
    deleteConversation,
    sendMessage,
    stopGeneration,
    handleStreamChunk,
    handleStreamEnd,
    handleStreamError,
  }
})
