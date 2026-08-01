<script setup lang="ts">
// ThinkingBlock - Enhanced AI reasoning display
// Design principles: progressive disclosure, step status visualization, markdown rendering
// Inspired by: Cursor Plan Mode (step checklist), Codex (reasoning items), Windsurf (timeline)

import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import { ContentCopyOutlined } from '@vicons/material'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

const props = withDefaults(
  defineProps<{
    thought: string
    step?: number
    totalSteps?: number
    defaultOpen?: boolean
    /** Whether this thought is currently being streamed */
    isStreaming?: boolean
    /** Status of this thinking step */
    status?: 'queued' | 'running' | 'waiting-approval' | 'completed' | 'error'
    /** Timestamp when this thought started (ms epoch) */
    startedAt?: number
    /** Timestamp when this thought ended (ms epoch) */
    endedAt?: number
    /** Estimated token count */
    tokenCount?: number
  }>(),
  {
    step: undefined,
    totalSteps: undefined,
    defaultOpen: false,
    isStreaming: false,
    status: 'completed',
    startedAt: undefined,
    endedAt: undefined,
    tokenCount: undefined,
  },
)

const isOpen = ref(props.defaultOpen || props.isStreaming)
const userToggled = ref(false)

/**
 * Auto-expand on streaming start, auto-collapse on streaming end.
 * Respect manual user toggles - once user interacts, don't auto-collapse.
 */
watch(
  () => props.isStreaming,
  (streaming, wasStreaming) => {
    if (streaming && !wasStreaming) {
      isOpen.value = true
      userToggled.value = false
    } else if (!streaming && wasStreaming && !userToggled.value) {
      isOpen.value = false
    }
  },
)

function toggle(): void {
  userToggled.value = true
  isOpen.value = !isOpen.value
}

/** Copy thinking content to clipboard */
async function handleCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.thought)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = props.thought
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

const copied = ref(false)

// ─── Live timer for streaming thoughts ─────────────────────────

const elapsedMs = ref(0)
let timerInterval: ReturnType<typeof setInterval> | null = null

const displayTime = computed(() => {
  if (props.startedAt && props.endedAt) {
    return formatDuration(props.endedAt - props.startedAt)
  }
  if (props.startedAt && props.isStreaming) {
    return formatDuration(elapsedMs.value)
  }
  return null
})

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSec = seconds % 60
  return `${minutes}m ${remainingSec}s`
}

function startTimer(): void {
  stopTimer()
  const startTime = props.startedAt
  if (startTime !== undefined && props.isStreaming) {
    timerInterval = setInterval(() => {
      elapsedMs.value = Date.now() - startTime
    }, 1000)
  }
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

onMounted(() => {
  startTimer()
})

onUnmounted(() => {
  stopTimer()
})

watch(
  () => props.isStreaming,
  (streaming) => {
    if (streaming) {
      startTimer()
    } else {
      stopTimer()
    }
  },
)

// ─── Status indicators ──────────────────────────────────────────

const statusConfig = computed(() => {
  const configs: Record<string, { icon: string; color: string; label: string; animate?: boolean }> = {
    queued: { icon: '○', color: 'var(--af-text-muted, #64748b)', label: '排队中' },
    running: { icon: '●', color: 'var(--af-info, #0ea5e9)', label: '思考中', animate: true },
    'waiting-approval': {
      icon: '⏸',
      color: 'var(--af-warning, #f59e0b)',
      label: '等待审批',
    },
    completed: { icon: '✓', color: 'var(--af-success, #10b981)', label: '已完成' },
    error: { icon: '✕', color: 'var(--af-error, #ef4444)', label: '出错' },
  }
  return configs[props.status] || configs.completed
})

// ─── Progress display ───────────────────────────────────────────

const progressText = computed(() => {
  if (props.step && props.totalSteps) {
    return `步骤 ${props.step}/${props.totalSteps}`
  }
  if (props.step) {
    return `步骤 ${props.step}`
  }
  return null
})

/** Truncate very long thinking for collapsed preview */
const previewText = computed(() => {
  if (!props.thought) return ''
  const firstLine = props.thought.split('\n')[0]
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine
})

/** Detect thinking phase from content keywords */
const thinkingPhase = computed(() => {
  const text = props.thought.toLowerCase()
  if (text.includes('分析') || text.includes('analyz')) return { label: '分析中', icon: '🔍' }
  if (text.includes('计划') || text.includes('plan')) return { label: '规划中', icon: '📋' }
  if (text.includes('执行') || text.includes('execut') || text.includes('实施'))
    return { label: '执行中', icon: '⚡' }
  if (text.includes('验证') || text.includes('verify') || text.includes('检查'))
    return { label: '验证中', icon: '✔' }
  return null
})
</script>

<template>
  <div
    class="thinking-block"
    :class="{
      'thinking-block--streaming': isStreaming,
      'thinking-block--error': status === 'error',
      'thinking-block--completed': status === 'completed' && !isStreaming,
    }"
  >
    <!-- Header bar -->
    <button class="thinking-header" @click="toggle">
      <div class="thinking-header__left">
        <!-- Status indicator -->
        <span
          class="thinking-status-icon"
          :class="{ 'thinking-status-icon--animate': statusConfig.animate }"
          :style="{ color: statusConfig.color }"
        >
          {{ statusConfig.icon }}
        </span>

        <!-- Chevron -->
        <span class="thinking-chevron" :class="{ open: isOpen }">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M3.5 2L7 5L3.5 8"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>

        <!-- Label -->
        <span class="thinking-label" :style="{ color: statusConfig.color }">
          <template v-if="isStreaming">
            {{ thinkingPhase ? thinkingPhase.label : '思考中' }}
            <span class="thinking-dots">
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
            </span>
          </template>
          <template v-else>{{ statusConfig.label }}</template>
        </span>
      </div>

      <!-- Right side meta -->
      <div class="thinking-header__right">
        <span v-if="progressText" class="thinking-meta thinking-meta--step">
          {{ progressText }}
        </span>
        <span v-if="displayTime" class="thinking-meta thinking-meta--time">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" class="thinking-meta-icon">
            <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1" />
            <path d="M6 3V6L8 7.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
          </svg>
          {{ displayTime }}
        </span>
        <span v-if="tokenCount" class="thinking-meta thinking-meta--tokens">
          {{ tokenCount > 1000 ? (tokenCount / 1000).toFixed(1) + 'k' : tokenCount }} tok
        </span>
      </div>
    </button>

    <!-- Collapsed preview -->
    <div v-if="!isOpen && previewText" class="thinking-preview">
      {{ previewText }}
    </div>

    <!-- Expanded content -->
    <Transition name="thinking-collapse">
      <div v-show="isOpen" class="thinking-content">
        <!-- Phase badge (if detected) -->
        <div v-if="thinkingPhase && isStreaming" class="thinking-phase-badge">
          <span class="thinking-phase-icon">{{ thinkingPhase.icon }}</span>
          <span>{{ thinkingPhase.label }}</span>
        </div>

        <!-- Markdown-rendered thought content -->
        <div class="thinking-content__body">
          <MarkdownRenderer :content="thought || '（无思考内容）'" />
        </div>

        <!-- Action bar -->
        <div class="thinking-content__actions">
          <NTooltip placement="top" :delay="400">
            <template #trigger>
              <button class="thinking-action-btn" :class="{ 'thinking-action-btn--copied': copied }" @click.stop="handleCopy">
                <NIcon :size="13">
                  <ContentCopyOutlined />
                </NIcon>
                <span>{{ copied ? '已复制' : '复制' }}</span>
              </button>
            </template>
            <span>复制思考过程</span>
          </NTooltip>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.thinking-block {
  border: 1px solid var(--af-border, #334155);
  border-left: 3px solid var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  margin: 6px 0;
  overflow: hidden;
  background: var(--af-bg-surface, #1e293b);
  transition: border-color 0.2s ease;
}

/* Streaming state - blue left border accent */
.thinking-block--streaming {
  border-left-color: var(--af-info, #0ea5e9);
  border-color: color-mix(in srgb, var(--af-info, #0ea5e9) 30%, var(--af-border, #334155));
}

/* Completed state - green accent */
.thinking-block--completed {
  border-left-color: var(--af-success, #10b981);
}

/* Error state - red accent */
.thinking-block--error {
  border-left-color: var(--af-error, #ef4444);
  border-color: color-mix(in srgb, var(--af-error, #ef4444) 30%, var(--af-border, #334155));
}

/* ─── Header ──────────────────────────────────────────────── */

.thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  transition: background 0.15s ease;
}

.thinking-header:hover {
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.4));
}

.thinking-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.thinking-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Status icon */
.thinking-status-icon {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.thinking-status-icon--animate {
  animation: thinking-pulse 1.5s ease-in-out infinite;
}

@keyframes thinking-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.15);
  }
}

/* Chevron */
.thinking-chevron {
  display: flex;
  align-items: center;
  transition: transform 0.2s ease;
  color: var(--af-text-muted, #64748b);
  flex-shrink: 0;
}

.thinking-chevron.open {
  transform: rotate(90deg);
}

/* Label */
.thinking-label {
  font-weight: 600;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

/* Animated dots for streaming */
.thinking-dots {
  display: inline-flex;
  gap: 2px;
  margin-left: 2px;
}

.thinking-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  animation: thinking-dot-bounce 1.4s ease-in-out infinite;
}

.thinking-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes thinking-dot-bounce {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

/* Meta info */
.thinking-meta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 500;
  color: var(--af-text-muted, #64748b);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.3));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.thinking-meta-icon {
  opacity: 0.8;
}

.thinking-meta--step {
  color: var(--af-info, #0ea5e9);
}

.thinking-meta--time {
  color: var(--af-text-tertiary, #94a3b8);
}

.thinking-meta--tokens {
  color: var(--af-text-tertiary, #94a3b8);
}

/* ─── Collapsed preview ──────────────────────────────────── */

.thinking-preview {
  padding: 0 12px 7px 37px;
  font-size: 12px;
  color: var(--af-text-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Expanded content ───────────────────────────────────── */

.thinking-content {
  border-top: 1px solid var(--af-border, rgba(51, 65, 85, 0.5));
}

/* Phase badge */
.thinking-phase-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  margin: 8px 12px 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--af-info, #0ea5e9) 10%, transparent);
  color: var(--af-info, #0ea5e9);
  font-size: 11px;
  font-weight: 600;
}

.thinking-phase-icon {
  font-size: 12px;
}

/* Markdown content body */
.thinking-content__body {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--af-text-secondary, #cbd5e1);
}

/* Override markdown styles for thinking context - more compact */
.thinking-content__body :deep(p) {
  margin: 0 0 6px;
  font-size: 13px;
}

.thinking-content__body :deep(p:last-child) {
  margin-bottom: 0;
}

.thinking-content__body :deep(ul),
.thinking-content__body :deep(ol) {
  padding-left: 18px;
  margin: 4px 0;
}

.thinking-content__body :deep(li) {
  margin: 2px 0;
  font-size: 13px;
}

.thinking-content__body :deep(code) {
  font-size: 12px;
}

.thinking-content__body :deep(pre) {
  padding: 8px 10px;
  font-size: 12px;
}

.thinking-content__body :deep(blockquote) {
  margin: 4px 0;
  padding-left: 10px;
  font-size: 12px;
}

/* Action bar */
.thinking-content__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 6px;
  border-top: 1px solid var(--af-border-subtle, rgba(51, 65, 85, 0.3));
}

.thinking-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--af-text-muted, #64748b);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.thinking-action-btn:hover {
  color: var(--af-text-primary, #e5e7eb);
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.4));
}

.thinking-action-btn--copied {
  color: var(--af-success, #10b981);
}

/* ─── Collapse transition ─────────────────────────────────── */

.thinking-collapse-enter-active,
.thinking-collapse-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.thinking-collapse-enter-from,
.thinking-collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.thinking-collapse-enter-to,
.thinking-collapse-leave-from {
  opacity: 1;
  max-height: 800px;
}

/* ─── Shimmer effect for streaming border ─────────────────── */

.thinking-block--streaming::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  background: linear-gradient(
    to bottom,
    transparent,
    var(--af-info, #0ea5e9),
    transparent
  );
  background-size: 100% 200%;
  animation: thinking-shimmer 2s linear infinite;
}

@keyframes thinking-shimmer {
  0% {
    background-position: 0 -100%;
  }
  100% {
    background-position: 0 200%;
  }
}

.thinking-block {
  position: relative;
}
</style>
