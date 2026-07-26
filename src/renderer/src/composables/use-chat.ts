// P1-15: useChat composable
// Sets up electron stream event listeners and wires them to ChatStore

import { onMounted, onUnmounted } from 'vue'
import type { StreamChunk, StreamEndMetadata, StreamError } from '@shared/types'
import { useChatStore } from '@/stores/chat'
import { showToast } from '@/utils/toast'

/**
 * Composable that sets up electron stream event listeners.
 * Must be called in a component's setup() that has ChatStore access.
 * Listeners are cleaned up on component unmount.
 */
export function useChat(): void {
  const chatStore = useChatStore()

  let cleanupChunk: (() => void) | undefined
  let cleanupEnd: (() => void) | undefined
  let cleanupError: (() => void) | undefined

  onMounted(() => {
    // Stream chunk listener
    cleanupChunk = window.electron.chat.onStreamChunk((chunk: StreamChunk) => {
      chatStore.handleStreamChunk(chunk)
    })

    // Stream end listener
    cleanupEnd = window.electron.chat.onStreamEnd((meta: StreamEndMetadata) => {
      chatStore.handleStreamEnd(meta)
    })

    // Stream error listener
    cleanupError = window.electron.chat.onStreamError((error: StreamError) => {
      showToast(error.message, 'error')
      chatStore.handleStreamError()
    })
  })

  onUnmounted(() => {
    cleanupChunk?.()
    cleanupEnd?.()
    cleanupError?.()
  })
}
