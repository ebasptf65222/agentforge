<script setup lang="ts">
// P1-17: MessageList - renders all messages with smart auto-scroll

import { ref, watch, nextTick, computed } from 'vue'
import type { ChatMessage } from '@shared/types'
import MessageItem from '@/components/MessageItem/MessageItem.vue'

const props = defineProps<{
  messages: ChatMessage[]
  streamingContent: string
  isGenerating: boolean
}>()

const scrollContainer = ref<HTMLElement | null>(null)

/**
 * Whether the user is currently "following" the bottom of the list.
 * Starts true; becomes false when the user scrolls up past the threshold.
 */
const isAtBottom = ref(true)

/** Distance (in px) from the bottom within which we consider the user "at bottom" */
const SCROLL_BOTTOM_THRESHOLD = 100

/**
 * Get the effective messages to display.
 * If streaming and last message is assistant, show it with streaming content.
 */
const displayMessages = computed<ChatMessage[]>(() => {
  if (props.isGenerating && props.messages.length > 0) {
    const last = props.messages[props.messages.length - 1]
    if (last.role === 'assistant') {
      return props.messages.slice(0, -1)
    }
  }
  return props.messages
})

/**
 * Get the streaming assistant message (if any).
 */
const streamingMessage = computed<ChatMessage | null>(() => {
  if (props.isGenerating && props.messages.length > 0) {
    const last = props.messages[props.messages.length - 1]
    if (last.role === 'assistant') {
      return { ...last, content: props.streamingContent }
    }
  }
  return null
})

/** Whether to show the "back to bottom" floating button */
const showScrollToBottom = computed(() => !isAtBottom.value && props.messages.length > 0)

/**
 * Check if the scroll container is near the bottom.
 * Called on scroll events to update the follow state.
 */
function handleScroll(): void {
  const el = scrollContainer.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isAtBottom.value = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD
}

/**
 * Scroll the container to the very bottom.
 */
function scrollToBottom(): void {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      isAtBottom.value = true
    }
  })
}

/**
 * User clicked the "回到底部" button.
 * Scroll to bottom and resume auto-following.
 */
function handleScrollToBottomClick(): void {
  scrollToBottom()
}

// Watch for new messages: auto-scroll only if the user is following the bottom
watch(
  () => props.messages.length,
  () => {
    if (isAtBottom.value) {
      scrollToBottom()
    }
  },
)

// Watch for streaming content changes: auto-scroll only if the user is following the bottom
watch(
  () => props.streamingContent,
  () => {
    if (isAtBottom.value) {
      scrollToBottom()
    }
  },
)

// When switching to a new conversation (messages emptied then refilled),
// reset follow state and jump to bottom.
watch(
  () => props.messages,
  () => {
    isAtBottom.value = true
    scrollToBottom()
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="message-list__container">
    <div ref="scrollContainer" class="message-list" @scroll="handleScroll">
      <!-- Empty state -->
      <div v-if="messages.length === 0" class="message-list__empty">
        <div class="message-list__empty-icon">💬</div>
        <p class="message-list__empty-text">开始一段新对话</p>
      </div>

      <!-- Rendered messages -->
      <template v-else>
        <MessageItem v-for="msg in displayMessages" :key="msg.id" :message="msg" />
        <!-- Streaming message (shown separately for reactivity) -->
        <MessageItem
          v-if="streamingMessage"
          :key="streamingMessage.id"
          :message="streamingMessage"
          :is-streaming="true"
        />
      </template>
    </div>

    <!-- "回到底部" floating button (P1-13) -->
    <Transition name="scroll-btn">
      <button
        v-if="showScrollToBottom"
        class="message-list__scroll-bottom"
        title="回到底部"
        @click="handleScrollToBottomClick"
      >
        回到底部
        <span class="message-list__scroll-bottom-arrow">↓</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.message-list__container {
  flex: 1;
  position: relative;
  display: flex;
  min-height: 0;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}

.message-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6b7280;
  gap: 12px;
}

.message-list__empty-icon {
  font-size: 48px;
  opacity: 0.3;
}

.message-list__empty-text {
  font-size: 15px;
  margin: 0;
}

/* "回到底部" floating button (P1-13) */
.message-list__scroll-bottom {
  position: absolute;
  bottom: 16px;
  right: 24px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background-color: #1f2937;
  color: #e5e7eb;
  border: 1px solid #374151;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
  z-index: 10;
}

.message-list__scroll-bottom:hover {
  background-color: #374151;
  border-color: #4b5563;
}

.message-list__scroll-bottom-arrow {
  font-size: 14px;
  line-height: 1;
}

/* Transition for the scroll-to-bottom button */
.scroll-btn-enter-active,
.scroll-btn-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.scroll-btn-enter-from,
.scroll-btn-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
