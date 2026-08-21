<script setup lang="ts">
// UI-REDESIGN v0.3: PermissionBanner - slim amber banner shown while
// an approval is pending. Non-blocking: sits above the message list,
// clicking it scrolls to the inline permission card.

import { computed } from 'vue'
import { NIcon } from 'naive-ui'
import { ShieldOutlined, KeyboardReturnOutlined } from '@vicons/material'
import type { ApprovalRequest } from '@shared/types'

const props = defineProps<{
  request: ApprovalRequest
}>()

const emit = defineEmits<{
  locate: []
}>()

/** Short label describing the pending action */
const label = computed(() => {
  const a = props.request.toolAction.arguments
  const path =
    (a.path as string) || (a.file_path as string) || (a.filePath as string) || (a.command as string)
  const base = path ? String(path) : props.request.toolAction.toolName
  return base.length > 48 ? base.slice(0, 48) + '…' : base
})
</script>

<template>
  <button class="perm-banner" title="点击定位到权限请求卡片" @click="emit('locate')">
    <NIcon :size="14" class="perm-banner__icon">
      <ShieldOutlined />
    </NIcon>
    <span class="perm-banner__text">
      等待权限批准：<strong>{{ label }}</strong>
    </span>
    <span class="perm-banner__hint">
      <NIcon :size="11"><KeyboardReturnOutlined /></NIcon>
      Ctrl+↵ 快速批准
    </span>
  </button>
</template>

<style scoped>
.perm-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 16px;
  background: color-mix(in srgb, var(--af-warning, #f59e0b) 12%, var(--af-bg-surface, #1e293b));
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--af-warning, #f59e0b) 35%, transparent);
  color: var(--af-warning, #f59e0b);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease;
}

.perm-banner:hover {
  background: color-mix(in srgb, var(--af-warning, #f59e0b) 18%, var(--af-bg-surface, #1e293b));
}

.perm-banner__icon {
  flex-shrink: 0;
}

.perm-banner__text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.perm-banner__text strong {
  font-weight: 600;
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
}

.perm-banner__hint {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  opacity: 0.75;
}
</style>
