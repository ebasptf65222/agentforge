// P1-15: useChat composable
// Sets up electron stream event listeners and wires them to ChatStore
// FIX: HMR-safe singleton listener registration to prevent duplicate IPC events

import { onMounted, onUnmounted } from 'vue'
import type { StreamChunk, StreamEndMetadata, StreamError } from '@shared/types'
import { useChatStore } from '@/stores/chat'
import { showToast } from '@/utils/toast'

/**
 * Module-level cleanup storage on window to survive HMR module re-evaluation.
 * Without this, HMR can cause onMounted to fire without onUnmounted,
 * leading to duplicate IPC listeners and tripled streaming text.
 */
const HMR_KEY = '__af_chat_cleanup__'

interface ChatCleanupFns {
  chunk?: () => void
  end?: () => void
  error?: () => void
}

function getPrevCleanup(): ChatCleanupFns {
  return ((window as Record<string, unknown>)[HMR_KEY] as ChatCleanupFns) || {}
}

function setPrevCleanup(fns: ChatCleanupFns): void {
  (window as Record<string, unknown>)[HMR_KEY] = fns
}

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
    if (!window.electron?.chat) return

    // HMR safety: clean up any lingering listeners from previous module evaluation
    const prev = getPrevCleanup()
    prev.chunk?.()
    prev.end?.()
    prev.error?.()

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

    // Store cleanup functions globally so HMR re-evaluation can clean them up
    setPrevCleanup({
      chunk: cleanupChunk,
      end: cleanupEnd,
      error: cleanupError,
    })
  })

  onUnmounted(() => {
    cleanupChunk?.()
    cleanupEnd?.()
    cleanupError?.()
    setPrevCleanup({})
  })
}
