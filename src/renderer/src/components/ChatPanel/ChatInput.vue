<script setup lang="ts">
// P1-17: ChatInput - message input with send/stop controls
// V1-06: + 语音输入按钮

import { ref, computed, nextTick, onMounted } from 'vue'
import { NSelect, NSwitch, NIcon } from 'naive-ui'
import { BookOutlined, CloseOutlined, ImageOutlined } from '@vicons/material'
import AppButton from '@/components/common/AppButton.vue'
import VoiceInputButton from './VoiceInputButton.vue'
import VoiceModeToggle from './VoiceModeToggle.vue'
import ModelSwitcher from './ModelSwitcher.vue'
import EngineSwitcher from './EngineSwitcher.vue'
import WorkspaceSwitcher from './WorkspaceSwitcher.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useSkillStore } from '@/stores/skill'
import { useChatStore } from '@/stores/chat'
import { useVoiceStore } from '@/stores/voice'
import type { Skill } from '@shared/types'

const props = defineProps<{
  disabled?: boolean
  isGenerating?: boolean
}>()

const emit = defineEmits<{
  send: [content: string, skillName?: string, images?: Array<{ dataUrl: string; name: string; size: number }>]
  stop: []
}>()

const skillStore = useSkillStore()
const chatStore = useChatStore()
const voiceStore = useVoiceStore()

onMounted(() => {
  void skillStore.loadSkills()
})

/** 当前选中的 Skill（null = 普通对话） */
const selectedSkill = ref('')

const skillOptions = computed(() => {
  const manual = skillStore.skills.filter((s) => s.trigger === 'manual')
  return [
    { label: '普通对话', value: '' },
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
  selectedSkill.value = ''
}

// ─── Slash command menu (UI-REDESIGN v0.3) ──────────────────────

/** Whether the "/" skill menu is open */
const showSlashMenu = ref(false)

/** Text typed after "/" used as filter */
const slashFilter = ref('')

const slashMenuRef = ref<InstanceType<typeof SlashCommandMenu> | null>(null)

/** Manual skills available for slash selection */
const manualSkills = computed(() => skillStore.skills.filter((s) => s.trigger === 'manual'))

/**
 * Detect "/" trigger at the start of input (or after whitespace).
 * Updates menu visibility and filter text.
 */
function updateSlashState(): void {
  const value = inputContent.value
  if (value.startsWith('/')) {
    showSlashMenu.value = true
    slashFilter.value = value.slice(1)
  } else {
    showSlashMenu.value = false
    slashFilter.value = ''
  }
}

/** User picked a skill from the slash menu */
function handleSlashSelect(skill: Skill): void {
  selectedSkill.value = skill.name
  inputContent.value = ''
  showSlashMenu.value = false
  slashFilter.value = ''
  nextTick(() => {
    textareaRef.value?.focus()
    autoResize()
  })
}

function closeSlashMenu(): void {
  showSlashMenu.value = false
  slashFilter.value = ''
}

/** Maximum allowed characters in the input (P1-13 spec) */
const MAX_CHARS = 32000

const inputContent = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// 图片附件状态
const attachedImages = ref<Array<{ dataUrl: string; name: string; size: number }>>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_IMAGES = 5

const canSend = computed(() => {
  return (inputContent.value.trim().length > 0 || attachedImages.value.length > 0) && !props.isGenerating && !props.disabled
})

/** Remaining character count before hitting the limit */
const remainingChars = computed(() => MAX_CHARS - inputContent.value.length)

/** Whether the input is close to the character limit (warn state) */
const isNearLimit = computed(() => remainingChars.value <= 1000)

/** 是否显示语音输入按钮（STT 启用时显示） */
const showVoiceButton = computed(() => voiceStore.sttEnabled)

function handleSend(): void {
  const content = inputContent.value.trim()
  const images = [...attachedImages.value]
  if ((!content && images.length === 0) || props.disabled || props.isGenerating) return
  emit('send', content, selectedSkill.value || undefined, images.length > 0 ? images : undefined)
  inputContent.value = ''
  attachedImages.value = []
  closeSlashMenu()
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
  emit('send', text.trim(), selectedSkill.value || undefined)
}

function handleKeydown(event: KeyboardEvent): void {
  // Slash menu keyboard navigation takes priority when open
  if (showSlashMenu.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      slashMenuRef.value?.moveDown()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      slashMenuRef.value?.moveUp()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      slashMenuRef.value?.confirmActive()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSlashMenu()
      return
    }
  }

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
  updateSlashState()
}

function handleImageSelect(event: Event): void {
  const target = event.target as HTMLInputElement
  if (!target.files) return
  for (const file of Array.from(target.files)) {
    if (attachedImages.value.length >= MAX_IMAGES) break
    if (!file.type.startsWith('image/')) continue
    if (file.size > MAX_IMAGE_SIZE) continue
    const reader = new FileReader()
    reader.onload = () => {
      attachedImages.value.push({
        dataUrl: reader.result as string,
        name: file.name,
        size: file.size,
      })
    }
    reader.readAsDataURL(file)
  }
  target.value = ''
}

function removeImage(index: number): void {
  attachedImages.value.splice(index, 1)
}

function handlePaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file || attachedImages.value.length >= MAX_IMAGES) continue
      if (file.size > MAX_IMAGE_SIZE) continue
      const reader = new FileReader()
      reader.onload = () => {
        attachedImages.value.push({
          dataUrl: reader.result as string,
          name: `pasted-${Date.now()}.png`,
          size: file.size,
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (!files) return
  for (const file of Array.from(files)) {
    if (attachedImages.value.length >= MAX_IMAGES) break
    if (!file.type.startsWith('image/')) continue
    if (file.size > MAX_IMAGE_SIZE) continue
    const reader = new FileReader()
    reader.onload = () => {
      attachedImages.value.push({
        dataUrl: reader.result as string,
        name: file.name,
        size: file.size,
      })
    }
    reader.readAsDataURL(file)
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault()
  isDragging.value = false
}
</script>

<template>
  <div class="chat-input">
    <!-- Unified rounded container (Copilot style): textarea + inline toolbar -->
    <div class="chat-input__shell" :class="{ 'is-dragging': isDragging }">
      <!-- Slash command menu (positioned above the shell) -->
      <SlashCommandMenu
        v-if="showSlashMenu && manualSkills.length > 0"
        ref="slashMenuRef"
        :skills="manualSkills"
        :filter="slashFilter"
        @select="handleSlashSelect"
        @close="closeSlashMenu"
      />
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

      <!-- Image attachments preview -->
      <div v-if="attachedImages.length > 0" class="chat-input__images">
        <div v-for="(img, idx) in attachedImages" :key="idx" class="image-thumb">
          <img :src="img.dataUrl" :alt="img.name" />
          <button class="image-thumb__remove" title="移除" @click="removeImage(idx)">
            <NIcon :size="12"><CloseOutlined /></NIcon>
          </button>
        </div>
      </div>

      <textarea
        ref="textareaRef"
        v-model="inputContent"
        class="chat-input__textarea"
        :placeholder="showSkillBanner ? '输入消息，使用当前 Skill 执行... (Shift+Enter 换行)' : '输入消息... (Shift+Enter 换行)'"
        :disabled="disabled"
        :maxlength="MAX_CHARS"
        rows="1"
        @keydown="handleKeydown"
        @input="handleInput"
        @paste="handlePaste"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
      />

      <!-- Inline bottom toolbar: selectors left, actions right -->
      <div class="chat-input__inline-toolbar">
        <div class="chat-input__inline-toolbar-left">
          <NSelect
            v-model:value="selectedSkill"
            :options="skillOptions"
            size="tiny"
            :consistent-menu-width="false"
            placeholder="普通对话"
            style="width: 130px"
          />
          <EngineSwitcher />
          <WorkspaceSwitcher />
          <div class="kb-toggle" title="关联知识库：开启后 AI 会参考知识库内容回答">
            <BookOutlined class="kb-toggle__icon" />
            <NSwitch
              v-model:value="chatStore.kbEnabled"
              size="small"
            />
          </div>
        </div>
        <div class="chat-input__inline-toolbar-right">
          <ModelSwitcher />
          <VoiceModeToggle />
          <button
            class="chat-input__image-btn"
            title="添加图片"
            :disabled="attachedImages.length >= 5"
            @click="fileInputRef?.click()"
          >
            <NIcon :size="18"><ImageOutlined /></NIcon>
          </button>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            multiple
            style="display: none"
            @change="handleImageSelect"
          />
          <VoiceInputButton v-if="showVoiceButton && !isGenerating" @submit="handleVoiceSubmit" />
          <AppButton v-if="isGenerating" variant="danger" size="sm" @click="emit('stop')">
            停止生成
          </AppButton>
          <AppButton v-else variant="primary" size="sm" :disabled="!canSend" @click="handleSend">
            发送
          </AppButton>
        </div>
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
  flex-shrink: 0;
  padding: 8px 16px 12px;
  background-color: var(--af-bg, #0f172a);
}

/* ─── Unified rounded shell (Copilot style) ─────────────────── */

.chat-input__shell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-lg, 12px);
  padding: 10px 12px 8px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.chat-input__shell:focus-within {
  border-color: var(--af-brand, #6366f1);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--af-brand, #6366f1) 15%, transparent);
}

/* Inline bottom toolbar */
.chat-input__inline-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.chat-input__inline-toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.chat-input__inline-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.kb-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background-color: var(--af-bg-surface, #1e293b);
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
  padding: 2px 0;
}

.chat-input__textarea::placeholder {
  color: var(--af-text-muted, #6b7280);
}

.chat-input__textarea:disabled {
  opacity: 0.5;
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

.chat-input__image-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  color: var(--af-text-muted, #6b7280);
  cursor: pointer;
  border-radius: var(--af-radius-sm, 6px);
  transition: all 0.15s ease;
}

.chat-input__image-btn:hover:not(:disabled) {
  color: var(--af-brand, #818cf8);
  background: var(--af-bg-hover, #374151);
}

.chat-input__image-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-input__images {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 0;
  flex-basis: 100%;
}

.image-thumb {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: var(--af-radius-sm, 6px);
  overflow: hidden;
  border: 1px solid var(--af-border, #374151);
}

.image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-thumb__remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  padding: 0;
}

.image-thumb__remove:hover {
  background: rgba(239, 68, 68, 0.8);
}

.chat-input__wrapper.is-dragging,
.chat-input__shell.is-dragging {
  border-color: var(--af-brand, #4f46e5);
  background-color: color-mix(in srgb, var(--af-brand, #4f46e5) 5%, var(--af-bg-input, #1f2937));
}

/* Responsive: narrow screens hide text labels, keep icons */
@media (max-width: 720px) {
  .chat-input__inline-toolbar-left {
    gap: 4px;
  }

  .kb-toggle {
    padding: 2px 4px;
  }
}
</style>
