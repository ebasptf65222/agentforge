// B8: ContextUsageStore - 上下文窗口使用量状态管理
// 接收 SDK session.usage_info 事件推送的 token 使用量，驱动 ContextUsageBar 进度条

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/** 上下文使用量数据（由 SDK usage-info chunk 推送） */
interface ContextUsageData {
  tokenLimit: number
  currentTokens: number
  messagesLength: number
}

export const useContextUsageStore = defineStore('contextUsage', () => {
  // ─── State ───────────────────────────────────────────────────

  /** 上下文窗口 token 上限 */
  const tokenLimit = ref(0)
  /** 当前已使用 token 数 */
  const currentTokens = ref(0)
  /** 当前消息数量 */
  const messagesLength = ref(0)
  /** 是否显示进度条 */
  const isVisible = ref(false)

  // ─── Getters ─────────────────────────────────────────────────

  /** 使用百分比（0-100），上限为 100 */
  const percentage = computed(() => {
    if (tokenLimit.value === 0) return 0
    return Math.min(100, Math.round((currentTokens.value / tokenLimit.value) * 100))
  })

  /** 是否达到警告阈值（>= 80%） */
  const isWarning = computed(() => percentage.value >= 80)

  // ─── Actions ─────────────────────────────────────────────────

  /** 更新上下文使用量数据并显示进度条 */
  function update(data: ContextUsageData): void {
    tokenLimit.value = data.tokenLimit
    currentTokens.value = data.currentTokens
    messagesLength.value = data.messagesLength
    isVisible.value = true
  }

  /** 隐藏进度条（切换会话时调用） */
  function hide(): void {
    isVisible.value = false
  }

  return {
    tokenLimit,
    currentTokens,
    messagesLength,
    isVisible,
    percentage,
    isWarning,
    update,
    hide,
  }
})
