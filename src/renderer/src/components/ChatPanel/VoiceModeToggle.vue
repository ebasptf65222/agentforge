<script setup lang="ts">
// V1-07: VoiceModeToggle - 实时语音模式开关按钮
// 显示在聊天输入框工具栏，点击开启/关闭实时语音模式
// 不同状态显示不同的图标和颜色

import { computed } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import { MicOutlined, MicOffOutlined, HeadphonesOutlined } from '@vicons/material'
import { useVoiceStore } from '@/stores/voice'
import { useSettingsStore } from '@/stores/settings'

const voiceStore = useVoiceStore()
const settingsStore = useSettingsStore()

const mode = computed(() => voiceStore.voiceMode)
const isOn = computed(() => mode.value !== 'off')

const canUse = computed(() => {
  const s = settingsStore.settings
  return s?.voice.tts.enabled && s?.voice.stt.enabled
})

const tooltipText = computed(() => {
  if (!canUse.value) return '请先在设置中启用 TTS 和 STT'
  switch (mode.value) {
    case 'off':
      return '开启实时语音模式'
    case 'awaiting':
      return '等待说话...'
    case 'listening':
      return '正在听...'
    case 'transcribing':
      return '识别中...'
    case 'speaking':
      return 'AI 正在说话...'
    default:
      return '实时语音模式'
  }
})

const statusText = computed(() => {
  switch (mode.value) {
    case 'awaiting':
      return '等待中'
    case 'listening':
      return '聆听中'
    case 'transcribing':
      return '识别中'
    case 'speaking':
      return '播报中'
    default:
      return ''
  }
})

function handleClick(): void {
  if (!canUse.value) return
  voiceStore.toggleVoiceMode()
}
</script>

<template>
  <NTooltip placement="top">
    <template #trigger>
    <button
      class="voice-mode-toggle"
      :class="{
        'voice-mode-toggle--on': isOn,
        'voice-mode-toggle--listening': mode === 'listening',
        'voice-mode-toggle--speaking': mode === 'speaking',
        'voice-mode-toggle--disabled': !canUse,
      }"
      :disabled="!canUse"
      @click.stop="handleClick"
    >
      <NIcon :size="18">
        <HeadphonesOutlined v-if="mode === 'speaking'" />
        <MicOffOutlined v-else-if="mode === 'off'" />
        <MicOutlined v-else />
      </NIcon>
      <span v-if="isOn" class="voice-mode-toggle__label">{{ statusText }}</span>
      <span v-else class="voice-mode-toggle__label">语音模式</span>
    </button>
    </template>
    {{ tooltipText }}
  </NTooltip>
</template>

<style scoped>
.voice-mode-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--af-border, #374151);
  border-radius: 8px;
  background: transparent;
  color: var(--af-text-muted, #6b7280);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.voice-mode-toggle:hover:not(:disabled) {
  background: var(--af-bg-hover, #374151);
  color: var(--af-text-primary, #e5e7eb);
  border-color: var(--af-border-hover, #4b5563);
}

.voice-mode-toggle--on {
  color: var(--af-brand, #818cf8);
  border-color: var(--af-brand, #6366f1);
  background: rgba(99, 102, 241, 0.1);
}

.voice-mode-toggle--on:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  color: var(--af-brand, #a5b4fc);
}

.voice-mode-toggle--listening {
  color: var(--af-error, #f87171);
  border-color: var(--af-error, #ef4444);
  background: rgba(239, 68, 68, 0.1);
  animation: pulse 1.5s ease-in-out infinite;
}

.voice-mode-toggle--listening:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  color: var(--af-error, #fca5a5);
}

.voice-mode-toggle--speaking {
  color: var(--af-success, #34d399);
  border-color: var(--af-success, #10b981);
  background: rgba(16, 185, 129, 0.1);
}

.voice-mode-toggle--speaking:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
  color: var(--af-success, #6ee7b7);
}

.voice-mode-toggle--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.voice-mode-toggle__label {
  white-space: nowrap;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
