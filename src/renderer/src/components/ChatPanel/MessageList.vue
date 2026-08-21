<script setup lang="ts">
// P1-17: MessageList - renders all messages with smart auto-scroll
// UI-REDESIGN v0.3: + message enter animation, thinking indicator,
//                    inline permission card + permission banner

import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import type { ApprovalRequest, ChatMessage } from '@shared/types'
import MessageItem from '@/components/MessageItem/MessageItem.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import PermissionInlineCard from './PermissionInlineCard.vue'
import PermissionBanner from './PermissionBanner.vue'

const props = defineProps<{
  messages: ChatMessage[]
  streamingContent: string
  isGenerating: boolean
  /** Pending approval request (rendered inline in the flow) */
  pendingApproval?: ApprovalRequest | null
  /** Resolution feedback for the last approval */
  approvalResolved?: 'approved' | 'rejected' | null
}>()

const emit = defineEmits<{
  copy: [content: string]
  retry: [message: ChatMessage]
  edit: [message: ChatMessage]
  'delete-message': [messageId: string]
  'new-chat': []
  'open-settings': []
  'open-kb': []
  'send-prompt': [prompt: string]
  approve: [remember: boolean]
  reject: [reason?: string]
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
 * Whether to show the thinking indicator: generating but no streamed
 * content has arrived yet (waiting for first token).
 */
const showThinking = computed(
  () => props.isGenerating && props.streamingContent.trim().length === 0,
)

// ─── Inline permission card (UI-REDESIGN v0.3) ──────────────────

/** Anchor element for the inline permission card */
const permCardRef = ref<HTMLElement | null>(null)

/**
 * Scroll the inline permission card into view.
 * Called when the banner is clicked or a new approval arrives.
 */
function locatePermissionCard(): void {
  nextTick(() => {
    permCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

// Auto-locate when a new approval request arrives
watch(
  () => props.pendingApproval,
  (approval) => {
    if (approval && isAtBottom.value) {
      locatePermissionCard()
    }
  },
)

/** Example prompt cards shown in the welcome screen (OPT-UI-01) */
const examplePrompts = [
  '解释 React 的 useEffect 钩子，并给出最佳实践',
  '帮我写一个 Python 脚本，批量重命名文件夹中的图片',
  '分析这段代码的潜在性能瓶颈，并给出优化建议',
  '设计一个 RESTful API，用于用户认证和授权',
]

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

// 使用 passive 滚动监听，消除 Violation 警告
onMounted(() => {
  scrollContainer.value?.addEventListener('scroll', handleScroll, { passive: true })
})
onUnmounted(() => {
  scrollContainer.value?.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="message-list__container">
    <!-- Permission pending banner (non-blocking, above the list) -->
    <PermissionBanner
      v-if="pendingApproval"
      :request="pendingApproval"
      @locate="locatePermissionCard"
    />

    <div ref="scrollContainer" class="message-list">
      <!-- Empty state with welcome screen (OPT-UI-01) -->
      <div v-if="messages.length === 0" class="message-list__welcome">
        <div class="welcome__header">
          <div class="welcome__logo">AgentForge</div>
          <p class="welcome__subtitle">你的 AI 助手，随时待命</p>
        </div>

        <!-- Quick actions -->
        <div class="welcome__actions">
          <button class="welcome__action-btn" @click="emit('new-chat')">
            <span class="welcome__action-icon">+</span>
            <span>新建对话</span>
          </button>
          <button class="welcome__action-btn" @click="emit('open-settings')">
            <span class="welcome__action-icon">⚙</span>
            <span>配置模型</span>
          </button>
          <button class="welcome__action-btn" @click="emit('open-kb')">
            <span class="welcome__action-icon">📚</span>
            <span>导入知识库</span>
          </button>
        </div>

        <!-- Shortcut hints -->
        <div class="welcome__shortcuts">
          <div class="shortcut-item">
            <kbd class="shortcut-key">Ctrl/Cmd + B</kbd>
            <span class="shortcut-desc">切换侧边栏</span>
          </div>
          <div class="shortcut-item">
            <kbd class="shortcut-key">Ctrl/Cmd + N</kbd>
            <span class="shortcut-desc">新建对话</span>
          </div>
          <div class="shortcut-item">
            <kbd class="shortcut-key">Shift + Enter</kbd>
            <span class="shortcut-desc">换行</span>
          </div>
          <div class="shortcut-item">
            <kbd class="shortcut-key">Escape</kbd>
            <span class="shortcut-desc">停止生成</span>
          </div>
        </div>

        <!-- Example prompts -->
        <div class="welcome__prompts">
          <p class="welcome__prompts-title">试试这些示例</p>
          <div class="welcome__prompts-grid">
            <button
              v-for="prompt in examplePrompts"
              :key="prompt"
              class="prompt-card"
              @click="emit('send-prompt', prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>
      </div>

      <!-- Rendered messages (with enter animation) -->
      <template v-else>
        <TransitionGroup name="msg" tag="div">
          <MessageItem
            v-for="msg in displayMessages"
            :key="msg.id"
            :message="msg"
            @copy="emit('copy', $event)"
            @retry="emit('retry', $event)"
            @edit="emit('edit', $event)"
            @delete="emit('delete-message', $event)"
          />
        </TransitionGroup>
        <!-- Thinking indicator: shown while waiting for the first token -->
        <ThinkingIndicator v-if="showThinking" />
        <!-- Inline permission card (UI-REDESIGN v0.3) -->
        <div v-if="pendingApproval" ref="permCardRef" class="message-list__perm-card">
          <PermissionInlineCard
            :request="pendingApproval"
            :resolved="approvalResolved"
            @approve="emit('approve', $event)"
            @reject="emit('reject', $event)"
            @open-settings="emit('open-settings')"
          />
        </div>
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

/* ─── Message enter animation (UI-REDESIGN v0.3) ────────────── */
/* GPU-friendly: only transform + opacity */

.msg-enter-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.18s ease-out;
}

.msg-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.msg-leave-active {
  display: none;
}

/* Inline permission card container */
.message-list__perm-card {
  padding: 0 24px;
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

/* ─── Welcome screen (OPT-UI-01) ────────────────────────────── */
.message-list__welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px 24px;
  gap: 24px;
  color: var(--af-text-primary, #e5e7eb);
  overflow-y: auto;
}

.welcome__header {
  text-align: center;
}

.welcome__logo {
  font-size: 28px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--af-brand, #4f46e5), var(--af-info, #0ea5e9));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 8px;
}

.welcome__subtitle {
  font-size: 14px;
  color: var(--af-text-muted, #9ca3af);
  margin: 0;
}

/* Quick actions */
.welcome__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.welcome__action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #374151);
  border-radius: 10px;
  color: var(--af-text-primary, #e5e7eb);
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    transform 0.1s ease;
}

.welcome__action-btn:hover {
  background-color: var(--af-bg-hover, #374151);
  border-color: var(--af-brand, #4f46e5);
  transform: translateY(-1px);
}

.welcome__action-icon {
  font-size: 16px;
  line-height: 1;
}

/* Shortcut hints */
.welcome__shortcuts {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
}

.shortcut-key {
  display: inline-block;
  padding: 2px 6px;
  background-color: var(--af-bg-hover, #374151);
  border: 1px solid var(--af-border, #4b5563);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--af-text-secondary, #d1d5db);
}

.shortcut-desc {
  font-size: 12px;
}

/* Example prompts */
.welcome__prompts {
  width: 100%;
  max-width: 560px;
}

.welcome__prompts-title {
  text-align: center;
  font-size: 13px;
  color: var(--af-text-muted, #9ca3af);
  margin: 0 0 12px;
}

.welcome__prompts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

.prompt-card {
  padding: 12px 16px;
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #374151);
  border-radius: 10px;
  color: var(--af-text-primary, #e5e7eb);
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    transform 0.1s ease;
}

.prompt-card:hover {
  background-color: var(--af-bg-hover, #374151);
  border-color: var(--af-brand, #4f46e5);
  transform: translateY(-1px);
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
