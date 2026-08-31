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

const providerOptions = [
  { label: 'Seedance（火山方舟 ARK）', value: 'seedance' } as const,
  { label: 'Kling（腾讯云 TokenHub）', value: 'kling' } as const,
]

// 当前选中的厂商字段（v-model 双向映射到各厂商 ref）
function providerField(
  pick: (v: 'seedance' | 'kling') => { get: () => string; set: (v: string) => void },
): WritableComputedRef<string> {
  const seed = pick('seedance')
  const kling = pick('kling')
  return computed({
    get: () => (provider.value === 'kling' ? kling.get() : seed.get()),
    set: (v: string) => (provider.value === 'kling' ? kling.set(v) : seed.set(v)),
  })
}

const currentApiKey = providerField((p) =>
  p === 'kling'
    ? { get: () => klingApiKey.value, set: (v) => (klingApiKey.value = v) }
    : { get: () => seedanceApiKey.value, set: (v) => (seedanceApiKey.value = v) },
)
const currentBaseUrl = providerField((p) =>
  p === 'kling'
    ? { get: () => klingBaseUrl.value, set: (v) => (klingBaseUrl.value = v) }
    : { get: () => seedanceBaseUrl.value, set: (v) => (seedanceBaseUrl.value = v) },
)
const currentModel = providerField((p) =>
  p === 'kling'
    ? { get: () => klingModel.value, set: (v) => (klingModel.value = v) }
    : { get: () => seedanceModel.value, set: (v) => (seedanceModel.value = v) },
)

const apiKeyVisible = ref(false)
const testing = ref(false)

const providerLabel = computed(() => (provider.value === 'kling' ? 'Kling' : 'Seedance'))
const configured = computed(() => Boolean(currentApiKey.value))
const apiKeyLabel = computed(() =>
  provider.value === 'kling'
    ? 'API Key（腾讯云 TokenHub，safeStorage 加密存储）'
    : 'API Key（火山方舟 ARK，safeStorage 加密存储）',
)
const baseUrlPlaceholder = computed(() =>
  provider.value === 'kling' ? 'https://tokenhub.tencentmaas.com' : 'https://ark.cn-beijing.volces.com/api/v3',
)
const modelPlaceholder = computed(() =>
  provider.value === 'kling' ? 'kling-video-v2.6' : 'doubao-seedance',
)

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

        <NFormItem :label="apiKeyLabel">
          <NInput
            v-model:value="currentApiKey"
            :type="apiKeyVisible ? 'text' : 'password'"
            :placeholder="provider === 'kling' ? '请输入 TokenHub API Key' : '请输入 ARK API Key'"
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