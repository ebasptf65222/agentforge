<script setup lang="ts">
// M3: VideoConfig - 视频生成设置页
// 配置 Seedance API Key / BaseUrl / 模型 / 时长上限，提供连接测试与历史任务列表。

import { computed, onMounted, ref } from 'vue'
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
} from 'naive-ui'
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

onMounted(async () => {
  await settingsStore.loadSettings()
  videoStore.init()
})

// ─── 本地表单快照 ────────────────────────────────────────────
const apiKey = ref('')
const baseUrl = ref('https://ark.cn-beijing.volces.com/api/v3')
const model = ref('doubao-seedance')
const maxDuration = ref(10)

const apiKeyVisible = ref(false)
const testing = ref(false)

const configured = computed(() => Boolean(apiKey.value))

async function saveConfig(): Promise<void> {
  try {
    await settingsStore.updateSetting('videoApiKey', apiKey.value)
    await settingsStore.updateSetting('videoBaseUrl', baseUrl.value)
    await settingsStore.updateSetting('videoModel', model.value)
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
    const res = await videoStore.getConfig()
    if (res.configured) {
      showToast('连接配置完整，可开始生成视频', 'success')
    } else {
      showToast('尚未配置 API Key', 'warning')
    }
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
        <NFormItem label="API Key（火山方舟 ARK，safeStorage 加密存储）">
          <NInput
            v-model:value="apiKey"
            :type="apiKeyVisible ? 'text' : 'password'"
            placeholder="请输入 ARK API Key（示例：xxxxxxxx-xxxx-xxxx）"
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
          <NInput v-model:value="baseUrl" placeholder="https://ark.cn-beijing.volces.com/api/v3" />
        </NFormItem>

        <NFormItem label="模型">
          <NInput v-model:value="model" placeholder="doubao-seedance" />
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