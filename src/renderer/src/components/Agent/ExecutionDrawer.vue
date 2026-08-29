<script setup lang="ts">
// ExecutionDrawer - 执行详情抽屉（UI-REDESIGN v1.0 批次 B）
// 右侧可停靠抽屉，承载原常驻 ExecutionPanel 与 AuditReportPanel（Tab 切换）。
// Esc 或点击遮罩关闭抽屉，但执行不中断。

import { watch, onUnmounted } from 'vue'
import { useAgentStore } from '@/stores/agent'
import ExecutionPanel from './ExecutionPanel.vue'
import AuditReportPanel from './AuditReportPanel.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const agentStore = useAgentStore()

function close(): void {
  emit('update:open', false)
}

// Esc 关闭抽屉（不中断执行）
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    // 若正在等待审批，Esc 优先留给「停止生成」逻辑，不关抽屉
    if (!agentStore.pendingApproval) close()
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', handleKeydown)
    else window.removeEventListener('keydown', handleKeydown)
  },
)

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="drawer-scrim" @click="close" />
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="open" class="drawer" role="dialog" aria-label="执行详情">
        <header class="drawer__head">
          <span class="drawer__title">执行详情</span>
          <button class="drawer__close" title="关闭 (Esc)" @click="close">✕</button>
        </header>
        <div class="drawer__body">
          <ExecutionPanel />
          <AuditReportPanel />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-scrim {
  position: fixed;
  inset: 0;
  z-index: 90;
  background-color: var(--af-overlay, rgba(0, 0, 0, 0.5));
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--af-panel-drawer, min(480px, 40vw));
  max-width: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background-color: var(--af-bg-surface, #1e293b);
  border-left: 1px solid var(--af-border, #334155);
  box-shadow: var(--af-shadow-2, 0 4px 16px rgba(0, 0, 0, 0.4));
}

.drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--af-space-3, 12px) var(--af-space-5, 20px);
  border-bottom: 1px solid var(--af-border-light, #1f2937);
  flex-shrink: 0;
}

.drawer__title {
  font-size: var(--af-font-base, 14px);
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
}

.drawer__close {
  border: none;
  background: transparent;
  color: var(--af-text-muted, #64748b);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: var(--af-radius-sm, 6px);
}

.drawer__close:hover {
  background-color: var(--af-bg-hover, #334155);
  color: var(--af-text-primary, #f1f5f9);
}

.drawer__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--af-space-4, 16px) var(--af-space-5, 20px);
}

/* 过渡 */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity var(--af-dur-base, 200ms) var(--af-ease, ease);
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active {
  transition: transform var(--af-dur-slow, 320ms) var(--af-ease-out, ease-out);
}

.drawer-slide-leave-active {
  transition: transform var(--af-dur-base, 200ms) var(--af-ease, ease);
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(105%);
}

@media (prefers-reduced-motion: reduce) {
  .drawer-fade-enter-active,
  .drawer-fade-leave-active,
  .drawer-slide-enter-active,
  .drawer-slide-leave-active {
    transition: none;
  }
}
</style>
