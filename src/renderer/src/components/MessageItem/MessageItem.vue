<script setup lang="ts">
// P1-17: MessageItem - renders a single chat message

import { computed, ref } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import type { ChatMessage } from '@shared/types'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import VoicePlayButton from './VoicePlayButton.vue'
import { useVoiceStore } from '@/stores/voice'
import {
  ContentCopyOutlined,
  RefreshOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@vicons/material'

const props = defineProps<{
  message: ChatMessage
  /** When true and message is assistant, show a blinking cursor at the end (P1-13) */
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  copy: [content: string]
  retry: [message: ChatMessage]
  edit: [message: ChatMessage]
  delete: [messageId: string]
}>()

const voiceStore = useVoiceStore()
const isUser = computed(() => props.message.role === 'user')

/**
 * Whether to show the streaming cursor.
 * Only on the assistant message while streaming is active.
 */
const showCursor = computed(() => !!props.isStreaming && !isUser.value)

/**
 * Whether to show the voice play button.
 * Only on assistant messages when TTS is enabled and message has content.
 */
const showVoiceButton = computed(() =>
  !isUser.value && voiceStore.ttsEnabled && props.message.content.trim().length > 0,
)

/** Whether to show the action toolbar */
const showToolbar = computed(() => !props.isStreaming)

/** Copy message content to clipboard */
async function handleCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = props.message.content
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}

const copied = ref(false)

function handleRetry(): void {
  emit('retry', props.message)
}

function handleEdit(): void {
  emit('edit', props.message)
}

function handleDelete(): void {
  emit('delete', props.message.id)
}
</script>

<template>
  <div
    class="message-item"
    :class="{ 'message-item--user': isUser, 'message-item--assistant': !isUser }"
  >
    <div class="message-item__avatar">
      <span class="message-item__role">{{ isUser ? 'U' : 'A' }}</span>
    </div>
    <div class="message-item__body">
      <!-- Message content -->
      <div v-if="isUser" class="message-item__text">{{ message.content }}</div>
      <template v-else>
        <MarkdownRenderer :content="message.content" />
        <!-- Streaming cursor (P1-13): blinking block at the end of the assistant message -->
        <span v-if="showCursor" class="message-item__cursor" aria-hidden="true">&#9608;</span>
        <!-- Voice play button (V1-03) -->
        <div v-if="showVoiceButton" class="message-item__voice-actions">
          <VoicePlayButton :message="message" />
        </div>
      </template>

      <!-- Message action toolbar (OPT-UI-02) -->
      <div v-if="showToolbar" class="message-item__toolbar">
        <NTooltip placement="bottom" :delay="500">
          <template #trigger>
            <button class="toolbar-btn" @click="handleCopy">
              <NIcon :size="14">
                <ContentCopyOutlined />
              </NIcon>
              <span v-if="copied" class="toolbar-btn__feedback">已复制</span>
            </button>
          </template>
          <span>复制</span>
        </NTooltip>

        <template v-if="isUser">
          <NTooltip placement="bottom" :delay="500">
            <template #trigger>
              <button class="toolbar-btn" @click="handleEdit">
                <NIcon :size="14"><EditOutlined /></NIcon>
              </button>
            </template>
            <span>编辑</span>
          </NTooltip>
        </template>

        <template v-if="!isUser">
          <NTooltip placement="bottom" :delay="500">
            <template #trigger>
              <button class="toolbar-btn" @click="handleRetry">
                <NIcon :size="14"><RefreshOutlined /></NIcon>
              </button>
            </template>
            <span>重试</span>
          </NTooltip>
        </template>

        <NTooltip placement="bottom" :delay="500">
          <template #trigger>
            <button class="toolbar-btn toolbar-btn--danger" @click="handleDelete">
              <NIcon :size="14"><DeleteOutlined /></NIcon>
            </button>
          </template>
          <span>删除</span>
        </NTooltip>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-item {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  max-width: 100%;
}

.message-item--user {
  flex-direction: row-reverse;
}

.message-item--assistant {
  flex-direction: row;
}

.message-item__avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}

.message-item--user .message-item__avatar {
  background-color: var(--af-brand, #4f46e5);
  color: #fff;
}

.message-item--assistant .message-item__avatar {
  background-color: var(--af-bg-hover, #374151);
  color: var(--af-text-secondary, #d1d5db);
}

.message-item__body {
  max-width: 75%;
  min-width: 0;
}

.message-item__text {
  background-color: var(--af-brand, #4f46e5);
  color: #fff;
  padding: 10px 14px;
  border-radius: 12px 12px 4px 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-item--assistant .message-item__body {
  background-color: var(--af-bg-surface, #1e293b);
  color: var(--af-text-primary, #e5e7eb);
  padding: 10px 14px;
  border-radius: 12px 12px 12px 4px;
  font-size: 14px;
}

/* Streaming cursor (P1-13) */
.message-item__cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--af-text-primary, #e5e7eb);
  font-weight: 700;
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* Voice play button (V1-03) */
.message-item__voice-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--af-border-subtle, rgba(148, 163, 184, 0.1));
  align-items: center;
}

/* Message action toolbar (OPT-UI-02) */
.message-item__toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-item:hover .message-item__toolbar {
  opacity: 1;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--af-text-muted, #9ca3af);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.toolbar-btn:hover {
  color: var(--af-text-primary, #e5e7eb);
  background-color: var(--af-bg-hover, #374151);
}

.toolbar-btn--danger:hover {
  color: var(--af-error, #ef4444);
  background-color: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
}

.toolbar-btn__feedback {
  color: var(--af-success, #10b981);
  font-size: 11px;
}
</style>
