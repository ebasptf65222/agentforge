<script setup lang="ts">
// P1-16: VoiceConfig - voice settings UI (TTS / STT / real-time mode).
// Each field change saves immediately via the settings store.

import { computed, onMounted, ref } from 'vue'
import {
  NCard,
  NSwitch,
  NSelect,
  NInput,
  NSlider,
  NButton,
  NForm,
  NFormItem,
  NModal,
  NSpace,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import type {
  AppSettings,
  VoiceProvider,
  TtsVoice,
  TtsFormat,
  TtsConfig,
  SttConfig,
  VoiceModeConfig,
} from '@shared/types'
import { useSettingsStore } from '@/stores/settings'
import { showToast } from '@/utils/toast'

const settingsStore = useSettingsStore()

onMounted(async () => {
  await settingsStore.loadSettings()
})

// ─── Reactive snapshot ────────────────────────────────────────

const settings = computed<AppSettings | null>(() => settingsStore.settings)
const isLoading = computed(() => settingsStore.loading || settings.value === null)

// ─── Password visibility toggles ──────────────────────────────

const ttsApiKeyVisible = ref(false)
const sttApiKeyVisible = ref(false)

// ─── STT test modal ───────────────────────────────────────────

const showSttTestModal = ref(false)

// ─── Option constants ─────────────────────────────────────────

const PROVIDER_OPTIONS: ReadonlyArray<{ value: VoiceProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure' },
  { value: 'mimo', label: '小米 MiMo' },
  { value: 'custom', label: '自定义' },
]

const OPENAI_VOICE_OPTIONS: ReadonlyArray<{ value: TtsVoice; label: string }> = [
  { value: 'alloy', label: 'alloy' },
  { value: 'echo', label: 'echo' },
  { value: 'fable', label: 'fable' },
  { value: 'onyx', label: 'onyx' },
  { value: 'nova', label: 'nova' },
  { value: 'shimmer', label: 'shimmer' },
]

const MIMO_VOICE_OPTIONS: ReadonlyArray<{ value: TtsVoice; label: string }> = [
  { value: 'mimo_default', label: 'MiMo 默认' },
  { value: '冰糖', label: '冰糖（中文女声）' },
  { value: '茉莉', label: '茉莉（中文女声）' },
  { value: '苏打', label: '苏打（中文男声）' },
  { value: '白桦', label: '白桦（中文男声）' },
  { value: 'Mia', label: 'Mia（英文女声）' },
  { value: 'Chloe', label: 'Chloe（英文女声）' },
  { value: 'Milo', label: 'Milo（英文男声）' },
  { value: 'Dean', label: 'Dean（英文男声）' },
]

const FORMAT_OPTIONS: ReadonlyArray<{ value: TtsFormat; label: string }> = [
  { value: 'mp3', label: 'mp3' },
  { value: 'opus', label: 'opus' },
  { value: 'aac', label: 'aac' },
  { value: 'flac', label: 'flac' },
  { value: 'wav', label: 'wav' },
  { value: 'pcm', label: 'pcm' },
  { value: 'pcm16', label: 'pcm16（MiMo 流式）' },
]

const providerOptions = computed<SelectOption[]>(() =>
  PROVIDER_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)

/** 根据提供商动态切换音色列表 */
const voiceOptions = computed<SelectOption[]>(() => {
  const provider = tts.value.provider
  if (provider === 'mimo') {
    return MIMO_VOICE_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value }))
  }
  return OPENAI_VOICE_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value }))
})

const formatOptions = computed<SelectOption[]>(() =>
  FORMAT_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)

// ─── Default fallbacks ────────────────────────────────────────

const DEFAULT_TTS: TtsConfig = {
  enabled: false,
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'tts-1',
  voice: 'alloy',
  speed: 1.0,
  format: 'mp3',
  autoPlay: false,
}

const DEFAULT_STT: SttConfig = {
  enabled: false,
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'whisper-1',
  language: '',
  temperature: 0.0,
}

const DEFAULT_MODE: VoiceModeConfig = {
  vadSilenceThreshold: 1.5,
  autoAwait: false,
}

const tts = computed<TtsConfig>(() => settings.value?.voice?.tts ?? DEFAULT_TTS)
const stt = computed<SttConfig>(() => settings.value?.voice?.stt ?? DEFAULT_STT)
const mode = computed<VoiceModeConfig>(() => settings.value?.voice?.mode ?? DEFAULT_MODE)

// ─── Update helpers ───────────────────────────────────────────

/**
 * Update a subset of the voice config.
 * Accepts a partial voice object (e.g. { tts: { ...partialTts } }).
 */
async function updateVoice(patch: Partial<{ tts: Partial<TtsConfig>; stt: Partial<SttConfig>; mode: Partial<VoiceModeConfig> }>): Promise<void> {
  try {
    await settingsStore.updateVoice(patch)
    showToast('设置已保存', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

// ─── TTS field handlers ───────────────────────────────────────

async function updateTtsEnabled(value: boolean): Promise<void> {
  await updateVoice({ tts: { enabled: value } })
}

/**
 * 切换 TTS 提供商时，自动填充推荐的默认值。
 */
async function updateTtsProvider(value: VoiceProvider): Promise<void> {
  const patch: Partial<TtsConfig> = { provider: value }
  if (value === 'mimo') {
    patch.model = 'mimo-v2.5-tts'
    patch.voice = 'mimo_default'
    patch.format = 'wav'
    patch.baseUrl = 'https://token-plan-cn.xiaomimimo.com/v1'
  } else if (value === 'openai') {
    patch.model = 'tts-1'
    patch.voice = 'alloy'
    patch.format = 'mp3'
    patch.baseUrl = ''
  }
  await updateVoice({ tts: patch })
}

async function updateTtsBaseUrl(value: string): Promise<void> {
  await updateVoice({ tts: { baseUrl: value } })
}

async function updateTtsApiKey(value: string): Promise<void> {
  await updateVoice({ tts: { apiKey: value } })
}

async function updateTtsModel(value: string): Promise<void> {
  await updateVoice({ tts: { model: value } })
}

async function updateTtsVoice(value: TtsVoice): Promise<void> {
  await updateVoice({ tts: { voice: value } })
}

async function updateTtsSpeed(value: number): Promise<void> {
  await updateVoice({ tts: { speed: value } })
}

async function updateTtsFormat(value: TtsFormat): Promise<void> {
  await updateVoice({ tts: { format: value } })
}

async function updateTtsAutoPlay(value: boolean): Promise<void> {
  await updateVoice({ tts: { autoPlay: value } })
}

// ─── STT field handlers ───────────────────────────────────────

async function updateSttEnabled(value: boolean): Promise<void> {
  await updateVoice({ stt: { enabled: value } })
}

async function updateSttProvider(value: VoiceProvider): Promise<void> {
  await updateVoice({ stt: { provider: value } })
}

async function updateSttBaseUrl(value: string): Promise<void> {
  await updateVoice({ stt: { baseUrl: value } })
}

async function updateSttApiKey(value: string): Promise<void> {
  await updateVoice({ stt: { apiKey: value } })
}

async function updateSttModel(value: string): Promise<void> {
  await updateVoice({ stt: { model: value } })
}

async function updateSttLanguage(value: string): Promise<void> {
  await updateVoice({ stt: { language: value } })
}

async function updateSttTemperature(value: number): Promise<void> {
  await updateVoice({ stt: { temperature: value } })
}

// ─── Voice mode field handlers ────────────────────────────────

async function updateVadSilenceThreshold(value: number): Promise<void> {
  await updateVoice({ mode: { vadSilenceThreshold: value } })
}

async function updateAutoAwait(value: boolean): Promise<void> {
  await updateVoice({ mode: { autoAwait: value } })
}

// ─── Test buttons ─────────────────────────────────────────────

const ttsTesting = ref(false)
const sttTesting = ref(false)

async function handleTtsTest(): Promise<void> {
  if (!settings.value?.voice.tts.apiKey) {
    showToast('请先填写 TTS API Key', 'warning')
    return
  }
  ttsTesting.value = true
  try {
    const audioBuffer = await window.electron.voice.testTts(settings.value.voice)
    // 播放测试音频
    const blob = new Blob([audioBuffer], { type: `audio/${settings.value.voice.tts.format}` })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => URL.revokeObjectURL(url)
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      showToast('TTS 测试音频播放失败', 'error')
    }
    await audio.play()
    showToast('TTS 测试语音已播放', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`TTS 测试失败: ${message}`, 'error')
  } finally {
    ttsTesting.value = false
  }
}

function handleSttTest(): void {
  showSttTestModal.value = true
}

function handleSttTestConfirm(): void {
  showSttTestModal.value = false
  // STT 测试需要录音，在 V1-06 中实现完整的录音流程
  // 此处暂时显示提示
  showToast('STT 测试功能将在语音输入中集成', 'info')
}
</script>

<template>
  <div class="voice-config">
    <div class="voice-config__header">
      <h2 class="voice-config__title">语音设置</h2>
      <p class="voice-config__subtitle">配置语音播报（TTS）、语音输入（STT）和实时语音模式</p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="voice-config__loading">
      <div class="setting-skeleton" />
      <div class="setting-skeleton" />
      <div class="setting-skeleton" />
    </div>

    <!-- Form -->
    <div v-else class="voice-config__sections">
      <!-- ==================== TTS 配置 ==================== -->
      <NCard title="语音播报（TTS）" class="voice-card">
        <NForm label-placement="left" label-width="100">
          <NFormItem label="启用 TTS">
            <NSwitch :value="tts.enabled" @update:value="updateTtsEnabled" />
          </NFormItem>

          <NFormItem label="提供商">
            <NSelect
              :value="tts.provider"
              :options="providerOptions"
              @update:value="(v) => updateTtsProvider(v as VoiceProvider)"
            />
          </NFormItem>

          <NFormItem label="API 地址">
            <NInput
              :value="tts.baseUrl"
              placeholder="https://api.openai.com/v1"
              @update:value="updateTtsBaseUrl"
            />
          </NFormItem>

          <NFormItem label="API Key">
            <NInput
              :value="tts.apiKey"
              :type="ttsApiKeyVisible ? 'text' : 'password'"
              placeholder="sk-..."
              @update:value="updateTtsApiKey"
            >
              <template #suffix>
                <span
                  class="eye-toggle"
                  @click="ttsApiKeyVisible = !ttsApiKeyVisible"
                >
                  {{ ttsApiKeyVisible ? '隐藏' : '显示' }}
                </span>
              </template>
            </NInput>
          </NFormItem>

          <NFormItem label="模型">
            <NInput
              :value="tts.model"
              placeholder="tts-1"
              @update:value="updateTtsModel"
            />
          </NFormItem>

          <NFormItem label="音色">
            <NSelect
              :value="tts.voice"
              :options="voiceOptions"
              @update:value="(v) => updateTtsVoice(v)"
            />
          </NFormItem>

          <NFormItem label="语速">
            <div class="slider-row">
              <NSlider
                :value="tts.speed"
                :min="0.25"
                :max="4.0"
                :step="0.25"
                @update:value="updateTtsSpeed"
              />
              <span class="slider-value">{{ tts.speed.toFixed(2) }}</span>
            </div>
          </NFormItem>

          <NFormItem label="格式">
            <NSelect
              :value="tts.format"
              :options="formatOptions"
              @update:value="(v) => updateTtsFormat(v as TtsFormat)"
            />
          </NFormItem>

          <NFormItem label="自动播报">
            <NSwitch :value="tts.autoPlay" @update:value="updateTtsAutoPlay" />
          </NFormItem>

          <NFormItem label="测试">
            <NButton type="primary" :loading="ttsTesting" @click="handleTtsTest">播放测试语音</NButton>
          </NFormItem>
        </NForm>
      </NCard>

      <!-- ==================== STT 配置 ==================== -->
      <NCard title="语音输入（STT）" class="voice-card">
        <NForm label-placement="left" label-width="100">
          <NFormItem label="启用 STT">
            <NSwitch :value="stt.enabled" @update:value="updateSttEnabled" />
          </NFormItem>

          <NFormItem label="提供商">
            <NSelect
              :value="stt.provider"
              :options="providerOptions"
              @update:value="(v) => updateSttProvider(v as VoiceProvider)"
            />
          </NFormItem>

          <NFormItem label="API 地址">
            <NInput
              :value="stt.baseUrl"
              placeholder="https://api.openai.com/v1"
              @update:value="updateSttBaseUrl"
            />
          </NFormItem>

          <NFormItem label="API Key">
            <NInput
              :value="stt.apiKey"
              :type="sttApiKeyVisible ? 'text' : 'password'"
              placeholder="sk-..."
              @update:value="updateSttApiKey"
            >
              <template #suffix>
                <span
                  class="eye-toggle"
                  @click="sttApiKeyVisible = !sttApiKeyVisible"
                >
                  {{ sttApiKeyVisible ? '隐藏' : '显示' }}
                </span>
              </template>
            </NInput>
          </NFormItem>

          <NFormItem label="模型">
            <NInput
              :value="stt.model"
              placeholder="whisper-1"
              @update:value="updateSttModel"
            />
          </NFormItem>

          <NFormItem label="语言">
            <NInput
              :value="stt.language"
              placeholder="自动检测"
              @update:value="updateSttLanguage"
            />
          </NFormItem>

          <NFormItem label="温度">
            <div class="slider-row">
              <NSlider
                :value="stt.temperature"
                :min="0.0"
                :max="1.0"
                :step="0.1"
                @update:value="updateSttTemperature"
              />
              <span class="slider-value">{{ stt.temperature.toFixed(1) }}</span>
            </div>
          </NFormItem>

          <NFormItem label="测试">
            <NButton type="primary" @click="handleSttTest">录制并识别</NButton>
          </NFormItem>
        </NForm>
      </NCard>

      <!-- ==================== 实时语音模式 ==================== -->
      <NCard title="实时语音模式" class="voice-card">
        <NForm label-placement="left" label-width="100">
          <NFormItem label="VAD 静音阈值">
            <div class="slider-row">
              <NSlider
                :value="mode.vadSilenceThreshold"
                :min="1.0"
                :max="3.0"
                :step="0.1"
                @update:value="updateVadSilenceThreshold"
              />
              <span class="slider-value">{{ mode.vadSilenceThreshold.toFixed(1) }} s</span>
            </div>
          </NFormItem>

          <NFormItem label="自动进入等待">
            <NSwitch :value="mode.autoAwait" @update:value="updateAutoAwait" />
          </NFormItem>
        </NForm>
      </NCard>
    </div>

    <!-- STT 测试确认弹窗 -->
    <NModal
      v-model:show="showSttTestModal"
      :mask-closable="false"
      preset="dialog"
      title="STT 测试"
      content="录制 3 秒后识别"
      positive-text="开始录制"
      negative-text="取消"
      @positive-click="handleSttTestConfirm"
    />
  </div>
</template>

<style scoped>
.voice-config {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.voice-config__header {
  padding: 4px 0 20px;
  border-bottom: 1px solid var(--af-border, #334155);
  margin-bottom: 16px;
}

.voice-config__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
}

.voice-config__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
}

.voice-config__loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-skeleton {
  height: 200px;
  border-radius: var(--af-radius, 8px);
  background-color: var(--af-bg-input, #1f2937);
  animation: voice-skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes voice-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.voice-config__sections {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
  overflow-y: auto;
}

.voice-card {
  border-radius: var(--af-radius, 8px);
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slider-row :deep(.n-slider) {
  flex: 1;
}

.slider-value {
  min-width: 56px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--af-text-secondary, #cbd5e1);
}

.eye-toggle {
  cursor: pointer;
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  user-select: none;
}

.eye-toggle:hover {
  color: var(--af-text-secondary, #cbd5e1);
}
</style>
