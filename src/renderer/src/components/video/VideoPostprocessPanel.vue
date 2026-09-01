<script setup lang="ts">
// M18: VideoPostprocessPanel - 成片后处理面板
//  - 对已完成（succeeded）的成片执行：字幕烧录、水印叠加、拼接、重命名、归档。
//  - 展示后处理执行记录。

import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NEmpty,
  NInput,
  NSelect,
  NSpace,
  NTab,
  NTabs,
  NTag,
  NText,
} from 'naive-ui'
import {
  ImageOutlined,
  HistoryOutlined,
} from '@vicons/material'
import type { VideoPostprocessRun, VideoTask } from '@shared/types'
import { useVideoStore } from '@/stores/video'
import { showToast } from '@/utils/toast'

const videoStore = useVideoStore()

type OpType = 'subtitle' | 'watermark' | 'concat' | 'rename' | 'archive'
const opType = ref<OpType>('subtitle')

/** 可被后处理选择的已完成任务 */
const succeededTasks = computed<VideoTask[]>(() =>
  videoStore.list.filter((t) => t.status === 'succeeded' && !t.sequenceId),
)

/** 单选任务（字幕/水印/重命名） */
const singleTaskId = ref<string | null>(null)
const singleTaskOptions = computed(() =>
  succeededTasks.value.map((t) => ({
    label: t.prompt.slice(0, 40) + (t.prompt.length > 40 ? '…' : ''),
    value: t.id,
  })),
)

/** 多选任务（拼接/归档） */
const multiTaskIds = ref<string[]>([])
const multiTaskOptions = computed(() =>
  succeededTasks.value.map((t) => ({
    label: t.prompt.slice(0, 40) + (t.prompt.length > 40 ? '…' : ''),
    value: t.id,
  })),
)

function resetSelection(): void {
  singleTaskId.value = singleTaskOptions.value.length > 0 ? singleTaskOptions.value[0].value : null
  multiTaskIds.value = []
}

// ─── 字幕 ─────────────────────────────────────────────────────
const subtitleContent = ref('')
async function doSubtitle(): Promise<void> {
  if (!singleTaskId.value) {
    showToast('请先选择一个成片', 'warning')
    return
  }
  if (!subtitleContent.value.trim()) {
    showToast('请填写字幕内容（SRT 格式）', 'warning')
    return
  }
  await videoStore.postprocessSubtitle({
    taskId: singleTaskId.value,
    content: subtitleContent.value.trim(),
  })
}

// ─── 水印 ─────────────────────────────────────────────────────
const watermarkImage = ref('')
const watermarkPosition = ref('bottom-right')
const POSITION_OPTIONS = [
  { label: '左上', value: 'top-left' },
  { label: '右上', value: 'top-right' },
  { label: '左下', value: 'bottom-left' },
  { label: '右下', value: 'bottom-right' },
  { label: '居中', value: 'center' },
]

async function pickWatermarkImage(): Promise<void> {
  const path = await window.electron.file.selectFile({
    title: '选择水印图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  })
  if (path) watermarkImage.value = path
}

async function doWatermark(): Promise<void> {
  if (!singleTaskId.value) {
    showToast('请先选择一个成片', 'warning')
    return
  }
  if (!watermarkImage.value.trim()) {
    showToast('请选择水印图片', 'warning')
    return
  }
  await videoStore.postprocessWatermark({
    taskId: singleTaskId.value,
    imagePath: watermarkImage.value.trim(),
    position: watermarkPosition.value as never,
  })
}

// ─── 拼接 ─────────────────────────────────────────────────────
async function doConcat(): Promise<void> {
  if (multiTaskIds.value.length < 2) {
    showToast('拼接至少需要选择 2 个成片', 'warning')
    return
  }
  await videoStore.postprocessConcat({ taskIds: [...multiTaskIds.value] })
  multiTaskIds.value = []
  void videoStore.fetchPostprocessRuns()
}

// ─── 重命名（就地表单） ───────────────────────────────────────
const renameNewName = ref('')
async function doRename(): Promise<void> {
  if (!singleTaskId.value) {
    showToast('请先选择一个成片', 'warning')
    return
  }
  if (!renameNewName.value.trim()) {
    showToast('请输入新的文件名', 'warning')
    return
  }
  const ok = await videoStore.postprocessRename({
    taskId: singleTaskId.value,
    newName: renameNewName.value.trim(),
  })
  if (ok) {
    renameNewName.value = ''
    void videoStore.refresh()
    void videoStore.fetchPostprocessRuns()
  }
}

// ─── 归档 ─────────────────────────────────────────────────────
async function doArchive(): Promise<void> {
  if (multiTaskIds.value.length === 0) {
    showToast('请至少选择一个要归档的成片', 'warning')
    return
  }
  const ok = await videoStore.postprocessArchive([...multiTaskIds.value])
  if (ok) {
    multiTaskIds.value = []
    void videoStore.refresh()
    void videoStore.fetchPostprocessRuns()
  }
}

const postprocessLoading = computed(() => videoStore.postprocessing)

const TYPE_LABEL: Record<VideoPostprocessRun['type'], string> = {
  subtitle: '字幕',
  watermark: '水印',
  concat: '拼接',
  rename: '重命名',
  archive: '归档',
}

const OPERATIONS: { value: OpType; label: string }[] = [
  { value: 'subtitle', label: '字幕烧录' },
  { value: 'watermark', label: '水印叠加' },
  { value: 'concat', label: '成片拼接' },
  { value: 'rename', label: '重命名' },
  { value: 'archive', label: '归档' },
]

onMounted(() => {
  void videoStore.fetchPostprocessRuns()
  resetSelection()
})
</script>

<template>
  <div class="postprocess-panel">
    <div class="postprocess-panel__header">
      <h3 class="postprocess-panel__title">
        <HistoryOutlined class="postprocess-panel__title-icon" />
        成片后处理
      </h3>
      <NButton size="small" secondary @click="videoStore.fetchPostprocessRuns()">刷新记录</NButton>
    </div>

    <NSpace vertical :size="14">
      <!-- 操作类型切换 -->
      <NTabs
        :value="opType"
        type="segment"
        size="small"
        class="postprocess-panel__ops"
        @update:value="(v: string | number) => (opType = v as OpType)"
      >
        <NTab v-for="op in OPERATIONS" :key="op.value" :name="op.value">
          {{ op.label }}
        </NTab>
      </NTabs>

      <NCard size="small" :bordered="true">
        <template v-if="succeededTasks.length === 0">
          <NEmpty description="暂无已完成的成片（需先成功生成视频）" style="padding: 16px 0" />
        </template>
        <template v-else>
          <!-- 选择目的：单选/多选 -->
          <div v-if="['concat', 'archive'].includes(opType)" class="postprocess-panel__field">
            <NText depth="3" class="postprocess-panel__label">
              选择成片（{{ opType === 'concat' ? '至少 2 个' : '可多个' }}）
            </NText>
            <NSelect
              v-model:value="multiTaskIds"
              multiple
              :options="multiTaskOptions"
              placeholder="搜索并选择成片"
            />
          </div>
          <div v-else class="postprocess-panel__field">
            <NText depth="3" class="postprocess-panel__label">选择成片</NText>
            <NSelect v-model:value="singleTaskId" :options="singleTaskOptions" />
          </div>

          <!-- 字幕 -->
          <div v-if="opType === 'subtitle'" class="postprocess-panel__field">
            <NText depth="3" class="postprocess-panel__label">字幕内容（SRT 格式）</NText>
            <NInput
              v-model:value="subtitleContent"
              type="textarea"
              :rows="6"
              placeholder="1&#10;00:00:00,000 --> 00:00:03,000&#10;你好，这是字幕文本"
            />
          </div>

          <!-- 水印 -->
          <div v-if="opType === 'watermark'" class="postprocess-panel__field">
            <NText depth="3" class="postprocess-panel__label">水印图片</NText>
            <NSpace>
              <NInput v-model:value="watermarkImage" placeholder="选择或输入水印图片路径" />
              <NButton secondary @click="pickWatermarkImage">
                <template #icon><ImageOutlined /></template>
                选择
              </NButton>
            </NSpace>
            <NText depth="3" class="postprocess-panel__label">位置</NText>
            <NSelect v-model:value="watermarkPosition" :options="POSITION_OPTIONS" />
          </div>

          <!-- 重命名（就地表单） -->
          <div v-if="opType === 'rename'" class="postprocess-panel__field">
            <NText depth="3" class="postprocess-panel__label">新文件名（不含扩展名）</NText>
            <NSpace>
              <NInput
                v-model:value="renameNewName"
                placeholder="输入新的文件名"
                style="width: 280px"
                @keydown.enter="doRename"
              />
              <NButton type="primary" :loading="postprocessLoading" @click="doRename">
                重命名
              </NButton>
            </NSpace>
          </div>

          <!-- 操作按钮 -->
          <div class="postprocess-panel__action">
            <NButton
              v-if="opType === 'subtitle'"
              type="primary"
              :loading="postprocessLoading"
              @click="doSubtitle"
            >
              烧录字幕
            </NButton>
            <NButton
              v-if="opType === 'watermark'"
              type="primary"
              :loading="postprocessLoading"
              @click="doWatermark"
            >
              叠加水印
            </NButton>
            <NButton
              v-if="opType === 'concat'"
              type="primary"
              :loading="postprocessLoading"
              :disabled="multiTaskIds.length < 2"
              @click="doConcat"
            >
              拼接成片
            </NButton>
            <NButton
              v-if="opType === 'archive'"
              type="primary"
              :loading="postprocessLoading"
              :disabled="multiTaskIds.length === 0"
              @click="doArchive"
            >
              归档到成片库
            </NButton>
          </div>
        </template>
      </NCard>

      <!-- 执行记录 -->
      <div class="postprocess-panel__runs">
        <h4 class="postprocess-panel__runs-title">执行记录</h4>
        <NEmpty
          v-if="videoStore.postprocessRuns.length === 0"
          description="暂无后处理记录"
          style="padding: 16px 0"
        />
        <div v-else class="postprocess-panel__runs-list">
          <NCard
            v-for="run in videoStore.postprocessRuns"
            :key="run.id"
            size="small"
            :bordered="true"
            class="postprocess-run"
          >
            <div class="postprocess-run__head">
              <NTag size="tiny" :type="run.status === 'ok' ? 'success' : run.status === 'error' ? 'error' : 'info'">
                {{ run.status === 'ok' ? '成功' : run.status === 'error' ? '失败' : '执行中' }}
              </NTag>
              <NText depth="2">{{ TYPE_LABEL[run.type] }}</NText>
              <NText depth="3">
                {{ run.taskIds.length }} 个源任务 ·
                {{ new Date(run.createdAt).toLocaleString() }}
              </NText>
            </div>
            <NText v-if="run.message" depth="3" class="postprocess-run__msg">
              {{ run.message }}
            </NText>
          </NCard>
        </div>
      </div>
    </NSpace>
  </div>
</template>

<style scoped>
.postprocess-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.postprocess-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
}
.postprocess-panel__ops {
  margin-bottom: 2px;
}
.postprocess-panel__field {
  margin-top: 12px;
}
.postprocess-panel__label {
  font-size: 12px;
  display: block;
  margin-bottom: 6px;
}
.postprocess-panel__action {
  margin-top: 16px;
}
.postprocess-panel__runs-title {
  margin: 0 0 8px;
  font-size: 14px;
}
.postprocess-panel__runs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.postprocess-run__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.postprocess-run__msg {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  word-break: break-all;
}
</style>