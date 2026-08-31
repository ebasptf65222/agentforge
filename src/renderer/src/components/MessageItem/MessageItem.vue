<script setup lang="ts">
// P1-17: MessageItem - renders a single chat message
// UI-REDESIGN v0.3: Copilot-style full-width layout
//  - Assistant messages: flat full-width markdown (no bubble/avatar)
//  - User messages: right-aligned light rounded block
//  - Action toolbar floats at top-right on hover

import { computed, ref } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import type { ChatMessage } from '@shared/types'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import VoicePlayButton from './VoicePlayButton.vue'
import VideoMessage from '@/components/video/VideoMessage.vue'
import { useVoiceStore } from '@/stores/voice'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
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
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()
const isUser = computed(() => props.message.role === 'user')

/** 消息关联的视频任务 ID（由 video_generate 工具产出写入 metadata.videoTaskId） */
const videoTaskId = computed<string | null>(() => {
  const metadata = props.message.metadata
  const v = metadata?.videoTaskId
  return typeof v === 'string' && v.length > 0 ? v : null
})

function handleOpenVideo(relativePath: string): void {
  workspaceStore.openFilePreview(relativePath)
  uiStore.openPreviewPanel()
}

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
    <!-- Role label (Copilot style: small text label instead of avatar) -->
    <div class="message-item__role-label">
      {{ isUser ? '你' : 'AgentForge' }}
    </div>

    <div class="message-item__body">
      <!-- Floating action toolbar (top-right, hover reveal) -->
      <div v-if="showToolbar" class="message-item__toolbar">
        <NTooltip placement="top" :delay="500">
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
          <NTooltip placement="top" :delay="500">
            <template #trigger>
              <button class="toolbar-btn" @click="handleEdit">
                <NIcon :size="14"><EditOutlined /></NIcon>
              </button>
            </template>
            <span>编辑</span>
          </NTooltip>
        </template>

        <template v-if="!isUser">
          <NTooltip placement="top" :delay="500">
            <template #trigger>
              <button class="toolbar-btn" @click="handleRetry">
                <NIcon :size="14"><RefreshOutlined /></NIcon>
              </button>
            </template>
            <span>重试</span>
          </NTooltip>
        </template>

        <NTooltip placement="top" :delay="500">
          <template #trigger>
            <button class="toolbar-btn toolbar-btn--danger" @click="handleDelete">
              <NIcon :size="14"><DeleteOutlined /></NIcon>
            </button>
          </template>
          <span>删除</span>
        </NTooltip>
      </div>

      <!-- Message content -->
      <div v-if="isUser" class="message-item__text">{{ message.content }}</div>
      <template v-else>
        <MarkdownRenderer :content="message.content" />
        <!-- M3: AI 视频生成消息 -->
        <VideoMessage
          v-if="videoTaskId"
          :task-id="videoTaskId"
          @open="handleOpenVideo"
        />
        <!-- Streaming cursor (P1-13): blinking block at the end of the assistant message -->
        <span v-if="showCursor" class="message-item__cursor" aria-hidden="true">&#9608;</span>
        <!-- Voice play button (V1-03) -->
        <div v-if="showVoiceButton" class="message-item__voice-actions">
          <VoicePlayButton :message="message" />
        </div>
      </template>

      <!-- Token & duration metadata -->
      <div v-if="!isUser && message.metadata?.tokensUsed" class="message-item__meta">
        <span class="meta-item">
          <span class="meta-label">Token</span>
          <span class="meta-value">{{ message.metadata.tokensUsed.toLocaleString() }}</span>
        </span>
        <span v-if="message.metadata?.duration" class="meta-item">
          <span class="meta-label">耗时</span>
          <span class="meta-value">{{ message.metadata.duration }}ms</span>
        </span>
        <span v-if="message.metadata?.modelId" class="meta-item">
          <span class="meta-label">模型</span>
          <span class="meta-value">{{ message.metadata.modelId }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── Copilot-style full-width row layout ───────────────────── */

.message-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 24px;
  max-width: 100%;
}

/* Role label: small muted text above the message */
.message-item__role-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-tertiary, #94a3b8);
  letter-spacing: 0.3px;
  user-select: none;
}

.message-item--user .message-item__role-label {
  text-align: right;
  color: var(--af-brand, #818cf8);
}

/* Body: full width for assistant, right-aligned block for user */
.message-item__body {
  position: relative;
  min-width: 0;
}

.message-item--assistant .message-item__body {
  max-width: 100%;
}

.message-item--user .message-item__body {
  display: flex;
  justify-content: flex-end;
}

/* User message: light rounded block (right-aligned) */
.message-item__text {
  background-color: var(--af-bg-input, #1f2937);
  color: var(--af-text-primary, #e5e7eb);
  border: 1px solid var(--af-border-light, #1f2937);
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 85%;
}

/* Assistant message: transparent flat markdown, full width */
.message-item--assistant .message-item__body {
  color: var(--af-text-primary, #e5e7eb);
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

/* Message action toolbar: floats top-right, revealed on hover */
.message-item__toolbar {
  position: absolute;
  top: -22px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #334155);
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: 5;
}

.message-item:hover .message-item__toolbar {
  opacity: 1;
  transform: translateY(0);
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

/* Token & duration metadata */
.message-item__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--af-border-subtle, rgba(148, 163, 184, 0.1));
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 1;
}

.meta-label {
  color: var(--af-text-muted, #6b7280);
}

.meta-value {
  color: var(--af-text-secondary, #9ca3af);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}
</style>
