<script setup lang="ts">
// P1-17: MessageItem - renders a single chat message

import { computed } from 'vue'
import type { ChatMessage } from '@shared/types'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

const props = defineProps<{
  message: ChatMessage
  /** When true and message is assistant, show a blinking cursor at the end (P1-13) */
  isStreaming?: boolean
}>()

const isUser = computed(() => props.message.role === 'user')

/**
 * Whether to show the streaming cursor.
 * Only on the assistant message while streaming is active.
 */
const showCursor = computed(() => !!props.isStreaming && !isUser.value)
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
      </template>
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
</style>
