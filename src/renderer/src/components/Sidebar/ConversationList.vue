<script setup lang="ts">
// P1-16: Conversation list in sidebar

import { computed } from 'vue'
import { NIcon } from 'naive-ui'
import { CloseOutlined } from '@vicons/material'
import type { Conversation } from '@shared/types'

const props = defineProps<{
  conversations: Conversation[]
  currentId: string | null
  /** When true, show skeleton placeholders instead of the list (P1-12) */
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  'new-chat': []
  delete: [id: string]
}>()

/**
 * Simple relative time formatter.
 */
function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return ''
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

const sortedConversations = computed(() => {
  return [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
})

/** Skeleton placeholder rows shown during initial load */
const skeletonRows = [0, 1, 2, 3, 4, 5]
</script>

<template>
  <div class="conversation-list">
    <!-- Skeleton loading (P1-12) -->
    <ul v-if="loading" class="conversation-list__items">
      <li v-for="i in skeletonRows" :key="`skeleton-${i}`" class="skeleton-item">
        <div class="skeleton-item__content">
          <div class="skeleton-item__title" />
          <div class="skeleton-item__time" />
        </div>
      </li>
    </ul>

    <!-- Empty state -->
    <div v-else-if="conversations.length === 0" class="conversation-list__empty">
      <p>暂无对话</p>
    </div>

    <!-- Conversation list -->
    <ul v-else class="conversation-list__items">
      <li
        v-for="conv in sortedConversations"
        :key="conv.id"
        class="conversation-item"
        :class="{ 'conversation-item--active': conv.id === currentId }"
        @click="emit('select', conv.id)"
      >
        <div class="conversation-item__content">
          <span class="conversation-item__title">{{ conv.title }}</span>
          <span class="conversation-item__time">
            {{ formatRelativeTime(conv.lastMessageAt ?? conv.updatedAt) }}
          </span>
        </div>
        <button
          class="conversation-item__delete"
          title="删除对话"
          @click.stop="emit('delete', conv.id)"
        >
          <NIcon :size="16"><CloseOutlined /></NIcon>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.conversation-list__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--af-text-muted, #6b7280);
  font-size: 13px;
}

.conversation-list__items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.conversation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  border-left: 3px solid transparent;
}

.conversation-item:hover {
  background-color: var(--af-bg-hover, #1f2937);
}

.conversation-item:hover .conversation-item__delete {
  opacity: 1;
}

.conversation-item--active {
  background-color: var(--af-bg-hover, #1f2937);
  border-left-color: var(--af-brand, #4f46e5);
}

.conversation-item__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}

.conversation-item__title {
  font-size: 13px;
  color: var(--af-text-primary, #e5e7eb);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-item__time {
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

.conversation-item__delete {
  flex-shrink: 0;
  opacity: 0;
  background: none;
  border: none;
  color: var(--af-text-muted, #6b7280);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
  margin-left: 8px;
}

.conversation-item__delete:hover {
  color: var(--af-error, #ef4444);
  background-color: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
}

/* ─── Skeleton placeholders (P1-12) ─────────────────────────── */
.skeleton-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
}

.skeleton-item__content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.skeleton-item__title {
  height: 12px;
  width: 75%;
  border-radius: 4px;
  background-color: var(--af-border, #374151);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-item__time {
  height: 10px;
  width: 45%;
  border-radius: 4px;
  background-color: var(--af-border, #374151);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
</style>
