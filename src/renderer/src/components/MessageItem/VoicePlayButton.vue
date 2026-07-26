<script setup lang="ts">
// V1-03: VoicePlayButton - 消息气泡语音播放按钮
// 点击播放/暂停语音，支持四种状态：未播放 / 播放中 / 暂停 / 错误

import { computed } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import { PlayArrowOutlined, PauseOutlined, ReplayOutlined, ErrorOutlined } from '@vicons/material'
import { useVoiceStore } from '@/stores/voice'
import type { ChatMessage } from '@shared/types'

const props = defineProps<{
  message: ChatMessage
}>()

const voiceStore = useVoiceStore()

const isCurrentMessage = computed(() => voiceStore.currentMessageId === props.message.id)

const buttonState = computed(() => {
  if (!isCurrentMessage.value) return 'idle'
  return voiceStore.ttsState
})

const tooltipText = computed(() => {
  switch (buttonState.value) {
    case 'playing':
      return '暂停'
    case 'paused':
      return '继续播放'
    case 'finished':
      return '重新播放'
    case 'error':
      return `播放错误：${voiceStore.ttsError ?? '点击重试'}`
    case 'loading':
      return '合成中...'
    default:
      return '播放语音'
  }
})

const iconComponent = computed(() => {
  switch (buttonState.value) {
    case 'playing':
      return PauseOutlined
    case 'paused':
    case 'finished':
      return ReplayOutlined
    case 'error':
      return ErrorOutlined
    case 'loading':
      return PlayArrowOutlined
    default:
      return PlayArrowOutlined
  }
})

async function handleClick(): Promise<void> {
  if (props.message.role !== 'assistant') return
  await voiceStore.playMessage(props.message.id, props.message.content)
}
</script>

<template>
  <NTooltip :content="tooltipText" placement="top">
    <button
      class="voice-play-button"
      :class="{
        'voice-play-button--playing': buttonState === 'playing',
        'voice-play-button--error': buttonState === 'error',
        'voice-play-button--loading': buttonState === 'loading',
      }"
      :disabled="buttonState === 'loading'"
      @click.stop="handleClick"
    >
      <NIcon :size="16">
        <component :is="iconComponent" />
      </NIcon>
    </button>
  </NTooltip>
</template>

<style scoped>
.voice-play-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--af-text-muted, #6b7280);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.voice-play-button:hover:not(:disabled) {
  background: var(--af-bg-hover, #374151);
  color: var(--af-text-primary, #e5e7eb);
}

.voice-play-button--playing {
  color: var(--af-brand, #6366f1);
}

.voice-play-button--playing:hover:not(:disabled) {
  color: var(--af-brand, #818cf8);
}

.voice-play-button--error {
  color: var(--af-error, #ef4444);
}

.voice-play-button--loading {
  opacity: 0.6;
  cursor: wait;
}

.voice-play-button:disabled {
  cursor: not-allowed;
}
</style>
