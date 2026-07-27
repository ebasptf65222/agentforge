<script setup lang="ts">
// P1-16: Conversation list in sidebar
// Supports CRUD: Create (via emit), Read (list), Update (rename), Delete

import { ref, computed, nextTick } from 'vue'
import { NIcon, NPopconfirm } from 'naive-ui'
import { CloseOutlined, EditOutlined, CheckOutlined, DeleteOutlined } from '@vicons/material'
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
  rename: [id: string, newTitle: string]
}>()

/** Currently renaming conversation ID (null = not renaming) */
const renamingId = ref<string | null>(null)
const renameValue = ref('')

/** Start inline rename */
function startRename(conv: Conversation, event: Event): void {
  event.stopPropagation()
  renamingId.value = conv.id
  renameValue.value = conv.title
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.conversation-item__rename-input')
    input?.focus()
    input?.select()
  })
}

/** Confirm rename */
function confirmRename(id: string): void {
  const trimmed = renameValue.value.trim()
  if (trimmed && trimmed !== props.conversations.find((c) => c.id === id)?.title) {
    emit('rename', id, trimmed)
  }
  cancelRename()
}

/** Cancel rename */
function cancelRename(): void {
  renamingId.value = null
  renameValue.value = ''
}

/** Handle rename input keydown */
function handleRenameKeydown(event: KeyboardEvent, id: string): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    confirmRename(id)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

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
        @click="renamingId !== conv.id && emit('select', conv.id)"
      >
        <div class="conversation-item__content">
          <!-- Normal title display -->
          <span v-if="renamingId !== conv.id" class="conversation-item__title">
            {{ conv.title }}
          </span>
          <!-- Inline rename input -->
          <input
            v-else
            v-model="renameValue"
            class="conversation-item__rename-input"
            maxlength="100"
            @click.stop
            @keydown="handleRenameKeydown($event, conv.id)"
            @blur="confirmRename(conv.id)"
          />
          <span class="conversation-item__time">
            {{ formatRelativeTime(conv.lastMessageAt ?? conv.updatedAt) }}
          </span>
        </div>
        <div class="conversation-item__actions">
          <!-- Rename button -->
          <button
            v-if="renamingId !== conv.id"
            class="conversation-item__action conversation-item__rename"
            title="重命名"
            @click="startRename(conv, $event)"
          >
            <NIcon :size="14"><EditOutlined /></NIcon>
          </button>
          <!-- Confirm rename button -->
          <button
            v-else
            class="conversation-item__action conversation-item__confirm"
            title="确认"
            @click.stop="confirmRename(conv.id)"
          >
            <NIcon :size="14"><CheckOutlined /></NIcon>
          </button>
          <!-- Delete button with confirmation -->
          <NPopconfirm
            :show-icon="false"
            placement="right"
            @positive-click="emit('delete', conv.id)"
          >
            <template #trigger>
              <button
                class="conversation-item__delete"
                title="删除对话"
                @click.stop
              >
                <NIcon :size="16"><DeleteOutlined /></NIcon>
              </button>
            </template>
            <template #default>
              <div style="max-width: 200px">
                <p style="margin: 0 0 8px; font-weight: 500">删除对话</p>
                <p style="margin: 0; font-size: 13px; color: var(--af-text-muted, #9ca3af)">
                  确定要删除「{{ conv.title }}」吗？此操作不可恢复。
                </p>
              </div>
            </template>
          </NPopconfirm>
        </div>
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

.conversation-item:hover .conversation-item__actions {
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

.conversation-item__rename-input {
  font-size: 13px;
  color: var(--af-text-primary, #e5e7eb);
  background: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-brand, #4f46e5);
  border-radius: 4px;
  padding: 1px 6px;
  outline: none;
  width: 100%;
  font-family: inherit;
}

.conversation-item__time {
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

.conversation-item__actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
  margin-left: 8px;
}

.conversation-item__action,
.conversation-item__delete {
  background: none;
  border: none;
  color: var(--af-text-muted, #6b7280);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.conversation-item__action:hover {
  color: var(--af-info, #0ea5e9);
  background-color: color-mix(in srgb, var(--af-info, #0ea5e9) 10%, transparent);
}

.conversation-item__confirm:hover {
  color: var(--af-success, #10b981);
  background-color: color-mix(in srgb, var(--af-success, #10b981) 10%, transparent);
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