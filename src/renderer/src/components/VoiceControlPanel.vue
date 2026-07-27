<script setup lang="ts">
// V1-08: VoiceControlPanel - 全局语音播放控制面板
// 固定在聊天窗口底部，显示当前播放的消息、进度、控制按钮
// 支持：播放/暂停、停止、音量调节、语速调节

import { computed, ref } from 'vue'
import { NIcon, NTooltip, NSlider } from 'naive-ui'
import {
  PlayArrowOutlined,
  PauseOutlined,
  StopOutlined,
  VolumeUpOutlined,
  VolumeOffOutlined,
} from '@vicons/material'
import { useVoiceStore } from '@/stores/voice'

const voiceStore = useVoiceStore()

const showVolumeSlider = ref(false)
const showSpeedSlider = ref(false)

/** 是否显示控制面板（播放中或暂停中，loading 时不显示） */
const visible = computed(() => {
  const state = voiceStore.ttsState
  return state === 'playing' || state === 'paused'
})

/** 进度百分比 */
const progressPercent = computed(() => {
  if (voiceStore.duration <= 0) return 0
  return (voiceStore.currentTime / voiceStore.duration) * 100
})

/** 格式化时间 mm:ss */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/** 播放/暂停切换 */
function togglePlay(): void {
  voiceStore.togglePlayPause()
}

/** 停止播放 */
function stopPlay(): void {
  voiceStore.stopPlayback()
}

/** 进度条点击跳转 */
function handleProgressClick(event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  const time = percent * voiceStore.duration
  voiceStore.seek(time)
}

/** 音量 */
const volume = computed({
  get: () => voiceStore.volume,
  set: (v: number) => voiceStore.setVolume(v),
})

/** 语速 */
const playbackRate = computed({
  get: () => voiceStore.playbackRate,
  set: (v: number) => voiceStore.setPlaybackRate(v),
})

/** 是否静音 */
const isMuted = computed(() => voiceStore.volume === 0)

/** 静音切换 */
function toggleMute(): void {
  if (isMuted.value) {
    voiceStore.setVolume(0.8)
  } else {
    voiceStore.setVolume(0)
  }
}

/** 截取当前播放文本的前 80 字 */
const displayText = computed(() => {
  const text = voiceStore.currentText
  if (text.length <= 80) return text
  return text.slice(0, 80) + '...'
})
</script>

<template>
  <Transition name="slide-up">
    <div v-if="visible" class="voice-control-panel">
      <!-- 文本显示区 -->
      <div class="voice-control-panel__text" :title="voiceStore.currentText">
        <span class="voice-control-panel__text-content">{{ displayText }}</span>
      </div>

      <!-- 进度条 -->
      <div
        class="voice-control-panel__progress" @click="handleProgressClick">
        <div
          class="voice-control-panel__progress-bar"
          :style="{ width: `${progressPercent}%` }"
        />
        <div class="voice-control-panel__progress-time">
          {{ formatTime(voiceStore.currentTime) }} / {{ formatTime(voiceStore.duration) }}
        </div>
      </div>

      <!-- 控制按钮 -->
      <div class="voice-control-panel__controls">
        <!-- 播放/暂停 -->
        <NTooltip placement="top">
          <template #trigger>
          <button class="voice-control-panel__btn" @click="togglePlay">
            <NIcon :size="20">
              <PauseOutlined v-if="voiceStore.ttsState === 'playing'" />
              <PlayArrowOutlined v-else />
            </NIcon>
          </button>
          </template>
          {{ voiceStore.ttsState === 'playing' ? '暂停' : '播放' }}
        </NTooltip>

        <!-- 停止 -->
        <NTooltip placement="top">
          <template #trigger>
          <button class="voice-control-panel__btn" @click="stopPlay">
            <NIcon :size="18"><StopOutlined /></NIcon>
          </button>
          </template>
          停止
        </NTooltip>

        <!-- 分隔线 -->
        <div class="voice-control-panel__divider" />

        <!-- 音量 -->
        <div
          class="voice-control-panel__volume"
          @mouseenter="showVolumeSlider = true"
          @mouseleave="showVolumeSlider = false"
        >
          <NTooltip placement="top">
            <template #trigger>
            <button class="voice-control-panel__btn" @click="toggleMute">
              <NIcon :size="18">
                <VolumeOffOutlined v-if="isMuted" />
                <VolumeUpOutlined v-else />
              </NIcon>
            </button>
            </template>
            {{ isMuted ? '取消静音' : '静音' }}
          </NTooltip>
          <Transition name="fade">
            <div v-show="showVolumeSlider" class="voice-control-panel__slider">
              <NSlider v-model:value="volume" :min="0" :max="1" :step="0.05" />
            </div>
          </Transition>
        </div>

        <!-- 语速 -->
        <div
          class="voice-control-panel__speed"
          @mouseenter="showSpeedSlider = true"
          @mouseleave="showSpeedSlider = false"
        >
          <NTooltip placement="top">
            <template #trigger>
            <button class="voice-control-panel__speed-btn">
              {{ playbackRate.toFixed(1) }}x
            </button>
            </template>
            播放速度
          </NTooltip>
          <Transition name="fade">
            <div v-show="showSpeedSlider" class="voice-control-panel__slider voice-control-panel__slider--wide">
              <NSlider v-model:value="playbackRate" :min="0.5" :max="2.0" :step="0.1" />
              <!-- Speed preset buttons (OPT-UI-08) -->
              <div class="speed-presets">
                <button
                  v-for="rate in [0.75, 1.0, 1.25, 1.5]"
                  :key="rate"
                  class="speed-preset-btn"
                  :class="{ active: Math.abs(playbackRate - rate) < 0.05 }"
                  @click="playbackRate = rate"
                >
                  {{ rate }}x
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.voice-control-panel {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: 420px;
  max-width: calc(100% - 32px);
  background: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #374151);
  border-radius: 10px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 1000;
}

.voice-control-panel__text {
  font-size: 12px;
  color: var(--af-text-primary, #e5e7eb);
  line-height: 1.3;
  max-height: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.voice-control-panel__text-content {
  display: block;
}

.voice-control-panel__progress {
  position: relative;
  height: 4px;
  background: var(--af-bg-input, #1f2937);
  border-radius: 2px;
  cursor: pointer;
  overflow: visible;
}

.voice-control-panel__progress-bar {
  height: 100%;
  background: var(--af-brand, #6366f1);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.voice-control-panel__progress-time {
  position: absolute;
  top: 8px;
  right: 0;
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
  font-variant-numeric: tabular-nums;
}

.voice-control-panel__controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.voice-control-panel__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--af-text-secondary, #d1d5db);
  cursor: pointer;
  transition: all 0.15s ease;
}

.voice-control-panel__btn:hover {
  background: var(--af-bg-hover, #374151);
  color: var(--af-text-primary, #e5e7eb);
}

.voice-control-panel__divider {
  width: 1px;
  height: 20px;
  background: var(--af-border, #374151);
  margin: 0 8px;
}

.voice-control-panel__volume,
.voice-control-panel__speed {
  position: relative;
}

.voice-control-panel__speed-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--af-text-secondary, #d1d5db);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.voice-control-panel__speed-btn:hover {
  background: var(--af-bg-hover, #374151);
  color: var(--af-text-primary, #e5e7eb);
}

.voice-control-panel__slider {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 120px;
  background: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #374151);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.voice-control-panel__slider--wide {
  width: 180px;
}

/* Speed preset buttons (OPT-UI-08) */
.speed-presets {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  justify-content: center;
}

.speed-preset-btn {
  padding: 3px 8px;
  background: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: 4px;
  color: var(--af-text-secondary, #d1d5db);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.speed-preset-btn:hover {
  border-color: var(--af-brand, #6366f1);
  color: var(--af-text-primary, #e5e7eb);
}

.speed-preset-btn.active {
  background: var(--af-brand, #6366f1);
  border-color: var(--af-brand, #6366f1);
  color: #fff;
}

/* Transitions - OPT-11: 恢复被注释的过渡动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.25s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
