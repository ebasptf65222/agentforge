<script setup lang="ts">
// P1-17: ChatInput - message input with send/stop controls
// V1-06: + 语音输入按钮

import { ref, computed, nextTick, onMounted } from 'vue'
import { NSelect, NSwitch, NIcon, NTooltip } from 'naive-ui'
import { BookOutlined, CloseOutlined } from '@vicons/material'
import AppButton from '@/components/common/AppButton.vue'
import VoiceInputButton from './VoiceInputButton.vue'
import VoiceModeToggle from './VoiceModeToggle.vue'
import { useSkillStore } from '@/stores/skill'
import { useChatStore } from '@/stores/chat'
import { useVoiceStore } from '@/stores/voice'
import type { Skill } from '@shared/types'

const props = defineProps<{
  disabled?: boolean
  isGenerating?: boolean
}>()

const emit = defineEmits<{
  send: [content: string, skillName?: string]
  stop: []
}>()

const skillStore = useSkillStore()
const chatStore = useChatStore()
const voiceStore = useVoiceStore()

onMounted(() => {
  void skillStore.loadSkills()
})

/** 当前选中的 Skill（null = 普通对话） */
const selectedSkill = ref<string | null>(null)

const skillOptions = computed(() => {
  const manual = skillStore.skills.filter((s) => s.trigger === 'manual')
  return [
    { label: '普通对话', value: null },
    ...manual.map((s: Skill) => ({ label: s.displayName, value: s.name })),
  ]
})

/** Currently selected skill info for the mode banner (OPT-UI-03) */
const selectedSkillInfo = computed(() => {
  if (!selectedSkill.value) return null
  return skillStore.skills.find((s) => s.name === selectedSkill.value) ?? null
})

/** Whether to show the skill mode banner */
const showSkillBanner = computed(() => selectedSkillInfo.value !== null)

function clearSkill(): void {
  selectedSkill.value = null
}

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

/** 是否显示语音输入按钮（STT 启用时显示） */
const showVoiceButton = computed(() => voiceStore.sttEnabled)

function handleSend(): void {
  const content = inputContent.value.trim()
  if (!content || props.disabled || props.isGenerating) return
  emit('send', content, selectedSkill.value ?? undefined)
  inputContent.value = ''
  // Reset textarea height after sending
  nextTick(() => {
    autoResize()
  })
}

/**
 * 语音输入提交：将转写结果直接发送
 */
function handleVoiceSubmit(text: string): void {
  if (!text.trim() || props.disabled || props.isGenerating) return
  emit('send', text.trim(), selectedSkill.value ?? undefined)
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
    <!-- Skill 选择器 + 知识库关联 + 语音模式 -->
    <div class="chat-input__toolbar">
      <div class="chat-input__toolbar-left">
        <NSelect
          v-model:value="selectedSkill"
          :options="skillOptions"
          size="small"
          :consistent-menu-width="false"
          placeholder="普通对话"
          style="width: 160px"
        />
        <div class="kb-toggle" title="关联知识库：开启后 AI 会参考知识库内容回答">
          <BookOutlined class="kb-toggle__icon" />
          <NSwitch
            v-model:value="chatStore.kbEnabled"
            size="small"
          />
        </div>
      </div>
      <div class="chat-input__toolbar-right">
        <VoiceModeToggle />
      </div>
    </div>
    <!-- Skill mode banner (OPT-UI-03) -->
    <div v-if="showSkillBanner" class="skill-mode-banner">
      <span class="skill-mode-banner__text">
        当前模式：<strong>{{ selectedSkillInfo?.displayName }}</strong>
        <span v-if="selectedSkillInfo?.description" class="skill-mode-banner__desc">
          — {{ selectedSkillInfo.description }}
        </span>
      </span>
      <button class="skill-mode-banner__close" title="关闭 Skill 模式" @click="clearSkill">
        <NIcon :size="14"><CloseOutlined /></NIcon>
      </button>
    </div>

    <div class="chat-input__wrapper">
      <textarea
        ref="textareaRef"
        v-model="inputContent"
        class="chat-input__textarea"
        :placeholder="showSkillBanner ? '输入消息，使用当前 Skill 执行...' : '输入消息... (Shift+Enter 换行)'"
        :disabled="disabled"
        :maxlength="MAX_CHARS"
        rows="1"
        @keydown="handleKeydown"
        @input="handleInput"
      />
      <div class="chat-input__actions">
        <VoiceInputButton v-if="showVoiceButton && !isGenerating" @submit="handleVoiceSubmit" />
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
  padding: 8px 16px 12px;
  border-top: 1px solid var(--af-border, #374151);
  background-color: var(--af-bg-surface, #111827);
}

.chat-input__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  justify-content: space-between;
}

.chat-input__toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kb-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.kb-toggle:hover {
  border-color: var(--af-border, #4b5563);
}

.kb-toggle__icon {
  width: 14px;
  height: 14px;
  color: var(--af-text-muted, #6b7280);
}

.chat-input__toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
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

/* Skill mode banner (OPT-UI-03) */
.skill-mode-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--af-brand, #4f46e5) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--af-brand, #4f46e5) 30%, transparent);
  border-radius: 8px;
  font-size: 12px;
  color: var(--af-text-secondary, #d1d5db);
}

.skill-mode-banner__text {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  min-width: 0;
}

.skill-mode-banner__text strong {
  color: var(--af-brand, #818cf8);
  font-weight: 600;
}

.skill-mode-banner__desc {
  color: var(--af-text-muted, #9ca3af);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-mode-banner__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--af-text-muted, #9ca3af);
  cursor: pointer;
  transition: all 0.15s ease;
}

.skill-mode-banner__close:hover {
  color: var(--af-text-primary, #e5e7eb);
  background: var(--af-bg-hover, #374151);
}
</style>
