<script setup lang="ts">
// ExecutionSummaryBar - 执行状态摘要条（UI-REDESIGN v1.0 批次 B）
// 常驻于消息流底部：状态点 + 步数摘要 + 进度微条，点击展开 ExecutionDrawer。
// 数据源与 ExecutionPanel 共用 agentStore。

import { computed } from 'vue'
import { NIcon } from 'naive-ui'
import { ExpandMoreOutlined } from '@vicons/material'
import { useAgentStore } from '@/stores/agent'

const emit = defineEmits<{
  expand: []
}>()

const agentStore = useAgentStore()

const visible = computed(() => agentStore.status !== 'idle')

const isWaitingApproval = computed(() => !!agentStore.pendingApproval)

const statusColor = computed(() => {
  if (isWaitingApproval.value) return 'var(--af-warning, #f59e0b)'
  switch (agentStore.status) {
    case 'running':
      return 'var(--af-info, #0ea5e9)'
    case 'completed':
      return 'var(--af-success, #10b981)'
    case 'failed':
      return 'var(--af-error, #ef4444)'
    default:
      return 'var(--af-text-muted, #64748b)'
  }
})

const summaryText = computed(() => {
  if (isWaitingApproval.value) {
    const tool = agentStore.pendingApproval?.toolAction?.toolName ?? '工具'
    return `等待审批 · ${tool}`
  }
  switch (agentStore.status) {
    case 'running':
      return `执行中 · 第 ${agentStore.totalSteps} 步`
    case 'completed':
      return `已完成 · 共 ${agentStore.totalSteps} 步`
    case 'failed':
      return '执行失败'
    case 'paused':
      return '已暂停'
    default:
      return ''
  }
})

const progressPercent = computed(() => {
  if (agentStore.trajectories.length === 0) return 0
  const completed = agentStore.trajectories.filter(
    (t) => t.status === 'success' || t.status === 'error',
  ).length
  return Math.round((completed / agentStore.trajectories.length) * 100)
})
</script>

<template>
  <button
    v-if="visible"
    class="exec-bar"
    :class="{ 'exec-bar--approval': isWaitingApproval }"
    title="展开执行详情"
    @click="emit('expand')"
  >
    <span class="exec-bar__dot" :class="{ 'exec-bar__dot--pulse': agentStore.isRunning }" />
    <span class="exec-bar__text">{{ summaryText }}</span>
    <span class="exec-bar__track">
      <span class="exec-bar__fill" :style="{ width: progressPercent + '%', backgroundColor: statusColor }" />
    </span>
    <NIcon :size="14" class="exec-bar__chevron">
      <ExpandMoreOutlined />
    </NIcon>
  </button>
</template>

<style scoped>
.exec-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 var(--af-space-10, 40px) var(--af-space-2, 8px);
  padding: 8px 14px;
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--af-dur-fast, 120ms) var(--af-ease, ease);
}

.exec-bar:hover {
  border-color: var(--af-brand, #818cf8);
}

.exec-bar--approval {
  border-color: var(--af-warning, #f59e0b);
}

.exec-bar__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background-color: var(--af-info, #0ea5e9);
}

.exec-bar--approval .exec-bar__dot {
  background-color: var(--af-warning, #f59e0b);
}

.exec-bar__dot--pulse {
  animation: exec-bar-pulse 1.2s ease-in-out infinite;
}

@keyframes exec-bar-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .exec-bar__dot--pulse {
    animation: none;
  }
}

.exec-bar__text {
  font-size: var(--af-font-sm, 12px);
  color: var(--af-text-secondary, #cbd5e1);
  white-space: nowrap;
}

.exec-bar__track {
  flex: 1;
  height: 4px;
  min-width: 60px;
  background-color: var(--af-bg-input, #1f2937);
  border-radius: 2px;
  overflow: hidden;
}

.exec-bar__fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width var(--af-dur-base, 200ms) var(--af-ease, ease);
}

.exec-bar__chevron {
  color: var(--af-text-muted, #64748b);
}
</style>
