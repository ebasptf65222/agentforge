<script setup lang="ts">
// M4: VideoConfig - 视频生成设置页（多厂商）
// 支持 Seedance（火山方舟 ARK）/ Kling（腾讯云 TokenHub）下拉切换，
// 各厂商分别保存 API Key / BaseUrl / 模型，并带连接测试与历史任务列表。

import { computed, onMounted, ref, type WritableComputedRef } from 'vue'
import {
  NCard,
  NInput,
  NButton,
  NForm,
  NFormItem,
  NSpace,
  NInputNumber,
  NEmpty,
  NSpin,
  NSelect,
} from 'naive-ui'
import type { VideoProvider } from '@shared/types'
import { useSettingsStore } from '@/stores/settings'
import { useVideoStore } from '@/stores/video'
import { showToast } from '@/utils/toast'
import VideoTaskCard from '@/components/video/VideoTaskCard.vue'
import SequenceCard from '@/components/video/SequenceCard.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'

const settingsStore = useSettingsStore()
const videoStore = useVideoStore()
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()

// ─── 厂商与表单快照 ───────────────────────────────────────────
const provider = ref<VideoProvider>('seedance')
const maxDuration = ref(10)

// Seedance（火山方舟 ARK）表单快照
const seedanceApiKey = ref('')
const seedanceBaseUrl = ref('https://ark.cn-beijing.volces.com/api/v3')
const seedanceModel = ref('doubao-seedance')

// Kling（腾讯云 TokenHub）表单快照
const klingApiKey = ref('')
const klingBaseUrl = ref('https://tokenhub.tencentmaas.com')
const klingModel = ref('kling-video-v2.6')

// 自定义厂商表单快照
const customApiKey = ref('')
const customBaseUrl = ref('')
const customModel = ref('')
const customProtocol = ref<'ark' | 'kling'>('ark')

const CUSTOM_PROTOCOL_OPTIONS = [
  { label: '火山方舟 ARK 兼容', value: 'ark' } as const,
  { label: '可灵 TokenHub 兼容', value: 'kling' } as const,
]

const providerOptions = [
  { label: 'Seedance（火山方舟 ARK）', value: 'seedance' } as const,
  { label: 'Kling（腾讯云 TokenHub）', value: 'kling' } as const,
  { label: '自定义厂商', value: 'custom' } as const,
]

/** 当前选中的厂商字段（v-model 双向映射到各厂商 ref） */
function fieldFor(
  key: 'apiKey' | 'baseUrl' | 'model',
): WritableComputedRef<string> {
  const map: Record<
    VideoProvider,
    { get: () => string; set: (v: string) => void }
  > = {
    seedance: {
      get: () =>
        key === 'apiKey'
          ? seedanceApiKey.value
          : key === 'baseUrl'
            ? seedanceBaseUrl.value
            : seedanceModel.value,
      set: (v) => {
        if (key === 'apiKey') seedanceApiKey.value = v
        else if (key === 'baseUrl') seedanceBaseUrl.value = v
        else seedanceModel.value = v
      },
    },
    kling: {
      get: () =>
        key === 'apiKey'
          ? klingApiKey.value
          : key === 'baseUrl'
            ? klingBaseUrl.value
            : klingModel.value,
      set: (v) => {
        if (key === 'apiKey') klingApiKey.value = v
        else if (key === 'baseUrl') klingBaseUrl.value = v
        else klingModel.value = v
      },
    },
    custom: {
      get: () =>
        key === 'apiKey'
          ? customApiKey.value
          : key === 'baseUrl'
            ? customBaseUrl.value
            : customModel.value,
      set: (v) => {
        if (key === 'apiKey') customApiKey.value = v
        else if (key === 'baseUrl') customBaseUrl.value = v
        else customModel.value = v
      },
    },
  }
  return computed({
    get: () => map[provider.value].get(),
    set: (v: string) => map[provider.value].set(v),
  })
}

const currentApiKey = fieldFor('apiKey')
const currentBaseUrl = fieldFor('baseUrl')
const currentModel = fieldFor('model')

const apiKeyVisible = ref(false)
const testing = ref(false)

const PROVIDER_LABELS: Record<VideoProvider, string> = {
  seedance: 'Seedance',
  kling: 'Kling',
  custom: '自定义厂商',
}
const providerLabel = computed(() => PROVIDER_LABELS[provider.value])
const configured = computed(() => Boolean(currentApiKey.value))
const apiKeyLabel = computed(() => {
  if (provider.value === 'kling') return 'API Key（腾讯云 TokenHub，safeStorage 加密存储）'
  if (provider.value === 'custom') return 'API Key（自定义厂商，safeStorage 加密存储）'
  return 'API Key（火山方舟 ARK，safeStorage 加密存储）'
})
const apiKeyPlaceholder = computed(() => {
  if (provider.value === 'kling') return '请输入 TokenHub API Key'
  if (provider.value === 'custom') return '请输入自定义厂商 API Key'
  return '请输入 ARK API Key'
})
const baseUrlPlaceholder = computed(() => {
  if (provider.value === 'kling') return 'https://tokenhub.tencentmaas.com'
  if (provider.value === 'custom') return 'https://your-video-api.example.com/v1'
  return 'https://ark.cn-beijing.volces.com/api/v3'
})
const modelPlaceholder = computed(() => {
  if (provider.value === 'kling') return 'kling-video-v2.6'
  if (provider.value === 'custom') return 'your-model-name'
  return 'doubao-seedance'
})

onMounted(async () => {
  await settingsStore.loadSettings()
  videoStore.init()
  try {
    const cfg = await videoStore.getConfig()
    provider.value = cfg.defaultProvider
    seedanceBaseUrl.value = cfg.providers.seedance.baseUrl
    seedanceModel.value = cfg.providers.seedance.model
    klingBaseUrl.value = cfg.providers.kling.baseUrl
    klingModel.value = cfg.providers.kling.model
    customBaseUrl.value = cfg.providers.custom.baseUrl
    customModel.value = cfg.providers.custom.model
    customProtocol.value = cfg.providers.custom.protocol ?? 'ark'
    maxDuration.value = cfg.maxDuration
  } catch {
    // 配置读取失败时保留默认值
    showToast('读取视频配置失败', 'warning')
  }
})

async function saveConfig(): Promise<void> {
  try {
    await settingsStore.updateSetting('videoProvider', provider.value)
    // API Key 仅在用户填写时写入，避免覆盖已有但未回显的密钥
    if (seedanceApiKey.value) {
      await settingsStore.updateSetting('videoApiKey', seedanceApiKey.value)
    }
    await settingsStore.updateSetting('videoBaseUrl', seedanceBaseUrl.value)
    await settingsStore.updateSetting('videoModel', seedanceModel.value)
    if (klingApiKey.value) {
      await settingsStore.updateSetting('videoKlingApiKey', klingApiKey.value)
    }
    await settingsStore.updateSetting('videoKlingBaseUrl', klingBaseUrl.value)
    await settingsStore.updateSetting('videoKlingModel', klingModel.value)
    if (customApiKey.value) {
      await settingsStore.updateSetting('videoCustomApiKey', customApiKey.value)
    }
    await settingsStore.updateSetting('videoCustomBaseUrl', customBaseUrl.value)
    await settingsStore.updateSetting('videoCustomModel', customModel.value)
    await settingsStore.updateSetting('videoCustomProtocol', customProtocol.value)
    await settingsStore.updateSetting('videoMaxDuration', maxDuration.value)
    showToast('视频配置已保存', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function testConfig(): Promise<void> {
  testing.value = true
  try {
    await saveConfig()
    await videoStore.testConfig(provider.value)
    showToast(`${providerLabel.value} 连接配置完整，可开始生成视频`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`测试失败: ${message}`, 'error')
  } finally {
    testing.value = false
  }
}

function handleOpenVideo(relativePath: string): void {
  workspaceStore.openFilePreview(relativePath)
  uiStore.openPreviewPanel()
}
</script>

<template>
  <div class="video-config">
    <NCard title="视频生成" size="small" class="video-config__card" :bordered="false">
      <NForm label-placement="top" :show-feedback="false">
        <NFormItem label="生成厂商">
          <NSelect
            v-model:value="provider"
            :options="providerOptions"
            class="video-config__provider"
          />
        </NFormItem>

        <NFormItem v-if="provider === 'custom'" label="API 协议">
          <NSelect
            v-model:value="customProtocol"
            :options="CUSTOM_PROTOCOL_OPTIONS"
            placeholder="选择自定义接口兼容的协议"
          />
        </NFormItem>

        <NFormItem :label="apiKeyLabel">
          <NInput
            v-model:value="currentApiKey"
            :type="apiKeyVisible ? 'text' : 'password'"
            :placeholder="apiKeyPlaceholder"
            :show-password-on="'click'"
          >
            <template #suffix>
              <span
                class="video-config__eye"
                @click="apiKeyVisible = !apiKeyVisible"
              >{{ apiKeyVisible ? '隐藏' : '显示' }}</span>
            </template>
          </NInput>
        </NFormItem>

        <NFormItem label="Base URL">
          <NInput v-model:value="currentBaseUrl" :placeholder="baseUrlPlaceholder" />
        </NFormItem>

        <NFormItem label="模型">
          <NInput v-model:value="currentModel" :placeholder="modelPlaceholder" />
        </NFormItem>

        <NFormItem label="时长上限（秒）">
          <NInputNumber v-model:value="maxDuration" :min="4" :max="15" style="width: 160px" />
        </NFormItem>

        <NSpace>
          <NButton type="primary" @click="saveConfig">保存配置</NButton>
          <NButton :loading="testing" :disabled="!configured" @click="testConfig">
            测试连接
          </NButton>
        </NSpace>
      </NForm>
    </NCard>

    <NCard title="多镜头序列" size="small" class="video-config__card" :bordered="false">
      <div v-if="videoStore.loading" class="video-config__loading">
        <NSpin size="small" />
      </div>
      <NEmpty
        v-else-if="videoStore.sequenceList.length === 0"
        description="暂无多镜头序列"
        class="video-config__empty"
      />
      <div v-else class="video-config__tasks">
        <SequenceCard
          v-for="sequence in videoStore.sequenceList"
          :key="sequence.id"
          :sequence="sequence"
          @open="handleOpenVideo"
        />
      </div>
    </NCard>

    <NCard title="任务历史" size="small" class="video-config__card" :bordered="false">
      <div v-if="videoStore.loading" class="video-config__loading">
        <NSpin size="small" />
      </div>
      <NEmpty v-else-if="videoStore.list.length === 0" description="暂无视频任务" class="video-config__empty" />
      <div v-else class="video-config__tasks">
        <VideoTaskCard
          v-for="task in videoStore.list"
          :key="task.id"
          :task="task"
          @open="handleOpenVideo"
        />
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.video-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
}

.video-config__card {
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #334155);
  border-radius: 12px;
}

.video-config__provider {
  width: 100%;
}

.video-config__eye {
  cursor: pointer;
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
  user-select: none;
  padding: 2px 4px;
}

.video-config__loading {
  display: flex;
  justify-content: center;
  padding: 24px;
}

.video-config__empty {
  padding: 24px 0;
}

.video-config__tasks {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>