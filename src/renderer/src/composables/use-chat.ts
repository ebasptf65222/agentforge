// P1-15: useChat composable
// Sets up electron stream event listeners and wires them to ChatStore
// FIX: HMR-safe singleton listener registration to prevent duplicate IPC events

import { onMounted, onUnmounted } from 'vue'
import type { StreamChunk, StreamEndMetadata, StreamError } from '@shared/types'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { showToast, showActionToast } from '@/utils/toast'

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

// ─── Permission-related error mapping (UI-REDESIGN v0.3) ────────
// Errors that indicate a permission/access problem get an actionable
// notification with a clear resolution path instead of a plain toast.

const PERMISSION_ERROR_CODES: Record<string, { title: string; actionLabel: string }> = {
  MODEL_API_ERROR: { title: '模型 API 访问失败', actionLabel: '检查模型配置' },
  MODEL_RATE_LIMIT: { title: 'API 请求受限', actionLabel: '查看模型设置' },
  FILE_ACCESS_ERROR: { title: '文件访问被拒绝', actionLabel: '打开工作区设置' },
  SAFE_STORAGE_UNAVAILABLE: { title: '安全存储不可用', actionLabel: '查看安全设置' },
  DECRYPTION_FAILED: { title: '密钥解密失败', actionLabel: '重新配置凭据' },
  MCP_CONNECT_FAILED: { title: 'MCP 连接失败', actionLabel: '检查 MCP 配置' },
  MCP_SPAWN_FAILED: { title: 'MCP 启动失败', actionLabel: '检查 MCP 配置' },
}

/**
 * Handle a stream error: permission-class errors show an actionable
 * notification guiding the user to settings; others show a plain toast.
 */
function handleStreamErrorWithGuidance(
  error: StreamError,
  openSettings: () => void,
): void {
  const mapped = error.code ? PERMISSION_ERROR_CODES[error.code] : undefined

  if (mapped) {
    showActionToast({
      title: mapped.title,
      description: error.message,
      type: 'warning',
      duration: 8000,
      actions: [
        {
          label: mapped.actionLabel,
          onClick: openSettings,
        },
      ],
    })
  } else {
    showToast(error.message, 'error')
  }
}

export function useChat(): void {
  const chatStore = useChatStore()
  const uiStore = useUiStore()

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
      handleStreamErrorWithGuidance(error, () => uiStore.setCurrentView('settings'))
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
