<script setup lang="ts">
// V1-06: VoiceInputButton - 语音输入按钮
// 点击开始录音，再次点击停止并转写，转写完成后将文本填入输入框并发送
// 显示录音状态、时长、音量波形动画

import { computed } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import { MicOutlined, MicOffOutlined } from '@vicons/material'
import { useVoiceStore } from '@/stores/voice'

const emit = defineEmits<{
  submit: [text: string]
}>()

const voiceStore = useVoiceStore()

// OPT2-25: 移除未使用的 settingsStore、showConfirmModal、transcribedResult

const isRecording = computed(() => voiceStore.sttState === 'recording')
const isTranscribing = computed(() => voiceStore.sttState === 'transcribing')

const tooltipText = computed(() => {
  if (isRecording.value) return '点击停止录音'
  if (isTranscribing.value) return '转写中...'
  return '语音输入'
})

const iconComponent = computed(() => {
  if (isRecording.value) return MicOffOutlined
  return MicOutlined
})

/** 格式化录音时长 mm:ss */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/** 音量条高度百分比 */
const volumeHeight = computed(() => {
  // 0 ~ 1 → 20% ~ 100%
  return Math.max(20, Math.min(100, voiceStore.recordVolume * 100))
})

async function handleClick(): Promise<void> {
  if (isRecording.value) {
    // 停止录音并转写
    const text = await voiceStore.stopRecording()
    if (text.trim()) {
      // 直接发送语音转写结果
      emit('submit', text)
    }
  } else if (isTranscribing.value) {
    // 转写中不响应
    return
  } else {
    // 开始录音
    await voiceStore.startRecording()
  }
}

// OPT2-25: 移除未使用的 watch（transcribedResult 已删除）和 handleCancel
</script>

<template>
  <NTooltip placement="top">
    <template #trigger>
    <button
      class="voice-input-button"
      :class="{
        'voice-input-button--recording': isRecording,
        'voice-input-button--transcribing': isTranscribing,
      }"
      :disabled="isTranscribing"
      @click.stop="handleClick"
    >
      <!-- 录音指示器 -->
      <span v-if="isRecording" class="voice-input-button__indicator">
        <span
          class="voice-input-button__volume-bar"
          :style="{ height: `${volumeHeight}%` }"
        />
      </span>
      <NIcon :size="20">
        <component :is="iconComponent" />
      </NIcon>
      <!-- 录音时长 -->
      <span v-if="isRecording" class="voice-input-button__duration">
        {{ formatDuration(voiceStore.recordDuration) }}
      </span>
    </button>
    </template>
    {{ tooltipText }}
  </NTooltip>
</template>

<style scoped>
.voice-input-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--af-text-muted, #6b7280);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  padding: 0 8px;
  position: relative;
}

.voice-input-button:hover:not(:disabled) {
  background: var(--af-bg-hover, #374151);
  color: var(--af-text-primary, #e5e7eb);
}

.voice-input-button--recording {
  color: var(--af-error, #ef4444);
  background: rgba(239, 68, 68, 0.1);
  width: auto;
  min-width: 100px;
}

.voice-input-button--recording:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  color: var(--af-error, #ef4444);
}

.voice-input-button--transcribing {
  opacity: 0.6;
  cursor: wait;
}

.voice-input-button:disabled {
  cursor: not-allowed;
}

.voice-input-button__indicator {
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  width: 8px;
  height: 20px;
}

.voice-input-button__volume-bar {
  width: 4px;
  border-radius: 2px;
  background: currentColor;
  transition: height 0.1s ease;
}

.voice-input-button__duration {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
</style>
