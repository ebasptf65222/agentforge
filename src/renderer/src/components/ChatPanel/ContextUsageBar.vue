<script setup lang="ts">
// B8: ContextUsageBar - 上下文窗口使用量进度条
// 监听 useContextUsageStore，在 ChatView 中展示当前会话的 token 使用进度

import { computed } from 'vue'
import { useContextUsageStore } from '@/stores/context-usage'

const usageStore = useContextUsageStore()

/** 进度条颜色：>=95% 红色，>=80% 橙色，否则绿色 */
const barColor = computed(() => {
  if (usageStore.percentage >= 95) return 'var(--af-error, #ef4444)'
  if (usageStore.percentage >= 80) return 'var(--af-warning, #f59e0b)'
  return 'var(--af-success, #10b981)'
})
</script>

<template>
  <div v-if="usageStore.isVisible && usageStore.tokenLimit > 0" class="context-usage-bar">
    <div class="context-usage-bar__track">
      <div
        class="context-usage-bar__fill"
        :style="{ width: `${usageStore.percentage}%`, backgroundColor: barColor }"
      />
    </div>
    <span class="context-usage-bar__text">
      {{ usageStore.currentTokens.toLocaleString() }} / {{ usageStore.tokenLimit.toLocaleString() }} tokens
      <span v-if="usageStore.isWarning" class="context-usage-bar__warning">
        ({{ usageStore.percentage }}%)
      </span>
    </span>
  </div>
</template>

<style scoped>
.context-usage-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  background: var(--af-bg-surface, #1e293b);
  border-bottom: 1px solid var(--af-border, #334155);
  font-size: 11px;
  color: var(--af-text-muted, #9ca3af);
}

.context-usage-bar__track {
  flex: 1;
  height: 4px;
  background: var(--af-bg-input, #1f2937);
  border-radius: 2px;
  overflow: hidden;
  max-width: 200px;
}

.context-usage-bar__fill {
  height: 100%;
  border-radius: 2px;
  transition:
    width 0.3s ease,
    background-color 0.3s ease;
}

.context-usage-bar__text {
  white-space: nowrap;
}

.context-usage-bar__warning {
  color: var(--af-warning, #f59e0b);
  font-weight: 600;
}
</style>
