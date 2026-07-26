<script setup lang="ts">
// P1-17: ChatInput - message input with send/stop controls

import { ref, computed, nextTick } from 'vue'
import AppButton from '@/components/common/AppButton.vue'

const props = defineProps<{
  disabled?: boolean
  isGenerating?: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
  stop: []
}>()

/** Maximum allowed characters in the input (P1-13 spec) */
const MAX_CHARS = 32000

const inputContent = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => {
  return inputContent.value.trim().length > 0 && !props.isGenerating && !props.disabled
})

/** Remaining character count before hitting the limit */
const remainingChars = computed(() => MAX_CHARS - inputContent.value.length)

/** Whether the input is close to the character limit (warn state) */
const isNearLimit = computed(() => remainingChars.value <= 1000)

function handleSend(): void {
  const content = inputContent.value.trim()
  if (!content || props.disabled || props.isGenerating) return
  emit('send', content)
  inputContent.value = ''
  // Reset textarea height after sending
  nextTick(() => {
    autoResize()
  })
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

/**
 * Auto-resize the textarea to fit its content.
 * Grows up to max-height, after which the scrollbar appears.
 * (P1-13 spec)
 */
function autoResize(): void {
  const el = textareaRef.value
  if (!el) return
  // Reset height to recalculate scrollHeight accurately
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function handleInput(): void {
  autoResize()
}
</script>

<template>
  <div class="chat-input">
    <div class="chat-input__wrapper">
      <textarea
        ref="textareaRef"
        v-model="inputContent"
        class="chat-input__textarea"
        placeholder="输入消息... (Shift+Enter 换行)"
        :disabled="disabled"
        :maxlength="MAX_CHARS"
        rows="1"
        @keydown="handleKeydown"
        @input="handleInput"
      />
      <div class="chat-input__actions">
        <AppButton v-if="isGenerating" variant="danger" size="sm" @click="emit('stop')">
          停止生成
        </AppButton>
        <AppButton v-else variant="primary" size="sm" :disabled="!canSend" @click="handleSend">
          发送
        </AppButton>
      </div>
    </div>
    <div
      v-if="isNearLimit"
      class="chat-input__counter"
      :class="{ 'is-warning': remainingChars <= 200 }"
    >
      {{ remainingChars }} / {{ MAX_CHARS }}
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  padding: 12px 16px;
  border-top: 1px solid var(--af-border, #374151);
  background-color: var(--af-bg-surface, #111827);
}

.chat-input__wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius, 8px);
  padding: 8px 12px;
}

.chat-input__textarea {
  flex: 1;
  background: none;
  border: none;
  color: var(--af-text-primary, #e5e7eb);
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  outline: none;
  min-height: 24px;
  max-height: 160px;
  overflow-y: auto;
  font-family: inherit;
}

.chat-input__textarea::placeholder {
  color: var(--af-text-muted, #6b7280);
}

.chat-input__textarea:disabled {
  opacity: 0.5;
}

.chat-input__actions {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Character counter (P1-13) */
.chat-input__counter {
  margin-top: 4px;
  text-align: right;
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

.chat-input__counter.is-warning {
  color: var(--af-warning, #f59e0b);
}
</style>
