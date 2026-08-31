<script setup lang="ts">
// M3: VideoTaskCard - 视频任务进度卡
// 展示提交→运行→下载→完成/失败 的完整状态机，支持停止、重试、本地播放。
// 通过 window.electron.workspace.buildFileUrl 将落后本地视频映射为 agentfile:// URL 播放。

import { computed } from 'vue'
import { NButton, NProgress, NTag, NSpace, NIcon, NTooltip } from 'naive-ui'
import { PlayArrowOutlined, StopOutlined, RefreshOutlined, StarBorderOutlined, StarFilled } from '@vicons/material'
import type { VideoTask } from '@shared/types'
import { useVideoStore } from '@/stores/video'

const props = defineProps<{
  task: VideoTask
}>()

const emit = defineEmits<{
  /** 点击「在文件面板打开」 */
  open: [relativePath: string]
}>()

const videoStore = useVideoStore()

const terminal = computed(() =>
  ['succeeded', 'failed', 'cancelled'].includes(props.task.status),
)

const STATUS_LABEL: Record<VideoTask['status'], string> = {
  queued: '排队中',
  submitted: '已提交',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const statusTagType = computed(() => {
  switch (props.task.status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
    case 'submitted':
    case 'queued':
      return 'info'
    default:
      return 'default'
  }
})

/** 仅失败/取消后允许重新生成，避免运行中重复提交 */
const canRetry = computed(() => props.task.status === 'failed' || props.task.status === 'cancelled')

/** 生成参数摘要：模型 · 时长 · 分辨率 · 比例 */
const metaText = computed(
  () => `${props.task.model} · ${props.task.duration} 秒 · ${props.task.resolution} · ${props.task.aspect}`,
)

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本地播放地址（agentfile:///workspace/...） */
const playUrl = computed(() =>
  props.task.status === 'succeeded' && props.task.outputPath
    ? window.electron.workspace.buildFileUrl(props.task.outputPath)
    : '',
)

/** 语言化进度：下载阶段用 indeterminate 转圈，其余用百分比 */
const progressPercent = computed(() => Math.max(0, Math.min(100, props.task.progress)))

async function handleStop(): Promise<void> {
  await videoStore.cancel(props.task.id)
}

/** M14：切换收藏标记 */
function handleToggleFavorite(): void {
  void videoStore.setFavorite(props.task.id, !props.task.favorite)
}

function handleRetry(): void {
  if (!props.task.prompt) return
  void videoStore.generate({
    prompt: props.task.prompt,
    model: props.task.model,
    duration: props.task.duration,
    resolution: props.task.resolution,
    aspect: props.task.aspect,
  })
}

function handleOpen(): void {
  if (props.task.outputPath) emit('open', props.task.outputPath)
}

function fileName(filePath: string | null): string {
  if (!filePath) return ''
  return filePath.split('/').pop() ?? ''
}
</script>

<template>
  <div class="video-task-card" :class="`video-task-card--${task.status}`">
    <div class="video-task-card__head">
      <span class="video-task-card__tags">
        <NTag :type="statusTagType" size="small" :bordered="false">
          {{ STATUS_LABEL[task.status] }}
        </NTag>
        <span class="video-task-card__time" :title="new Date(task.createdAt).toLocaleString()">
          {{ formatRelativeTime(task.createdAt) }}
        </span>
      </span>
      <NSpace :size="4">
        <NTooltip placement="top" :delay="500">
          <template #trigger>
            <NButton
              size="tiny"
              quaternary
              :type="task.favorite ? 'warning' : 'default'"
              @click="handleToggleFavorite"
            >
              <template #icon>
                <NIcon :size="14">
                  <StarFilled v-if="task.favorite" />
                  <StarBorderOutlined v-else />
                </NIcon>
              </template>
            </NButton>
          </template>
          <span>{{ task.favorite ? '取消收藏' : '收藏' }}</span>
        </NTooltip>
        <NTooltip placement="top" :delay="500">
          <template #trigger>
            <NButton v-if="!terminal" size="tiny" quaternary @click="handleStop">
              <template #icon><NIcon :size="14"><StopOutlined /></NIcon></template>
            </NButton>
          </template>
          <span>停止</span>
        </NTooltip>
        <NTooltip placement="top" :delay="500">
          <template #trigger>
            <NButton v-if="canRetry" size="tiny" quaternary @click="handleRetry">
              <template #icon><NIcon :size="14"><RefreshOutlined /></NIcon></template>
            </NButton>
          </template>
          <span>重新生成</span>
        </NTooltip>
      </NSpace>
    </div>

    <!-- 提示词 -->
    <p class="video-task-card__prompt" :title="task.prompt">{{ task.prompt || '视频任务' }}</p>

    <!-- M14：用户标签 -->
    <div v-if="task.tags.length > 0" class="video-task-card__labels">
      <NTag v-for="tag in task.tags" :key="tag" size="tiny" :bordered="false">
        {{ tag }}
      </NTag>
    </div>

    <!-- 生成参数 -->
    <span class="video-task-card__meta">{{ metaText }}</span>

    <!-- 进度 -->
    <div v-if="!terminal" class="video-task-card__progress">
      <NProgress
        :percentage="progressPercent"
        :indicator-placement="'inside'"
        :color="task.status === 'failed' ? 'error' : undefined"
        :status="task.status === 'failed' ? 'error' : 'default'"
      />
      <span v-if="task.status === 'submitted'" class="video-task-card__hint">正在提交厂商任务…</span>
      <span v-else-if="task.status === 'queued'" class="video-task-card__hint">排队等待中…</span>
      <span v-else-if="task.status === 'running'" class="video-task-card__hint">AI 正在生成视频…</span>
    </div>

    <!-- 失败错误 -->
    <div v-if="task.status === 'failed' && task.errorMessage" class="video-task-card__error">
      {{ task.errorMessage }}
    </div>
    <p v-else-if="task.status === 'cancelled'" class="video-task-card__cancelled">
      任务已取消
    </p>

    <!-- 播放器 -->
    <template v-if="playUrl">
      <video
        class="video-task-card__player"
        :src="playUrl"
        controls
        preload="metadata"
      ></video>
      <div class="video-task-card__foot">
        <span class="video-task-card__file">{{ fileName(task.outputPath) }}</span>
        <NButton size="tiny" text type="primary" @click="handleOpen">
          <template #icon><NIcon :size="14"><PlayArrowOutlined /></NIcon></template>
          在文件面板打开
        </NButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.video-task-card {
  border: 1px solid var(--af-border, #334155);
  border-radius: 10px;
  background-color: var(--af-bg-surface, #1e293b);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 100%;
}

.video-task-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.video-task-card__tags {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.video-task-card__time {
  font-size: var(--af-font-xs, 11px);
  color: var(--af-text-muted, #9ca3af);
  white-space: nowrap;
}

.video-task-card__prompt {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--af-text-primary, #e5e7eb);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
  cursor: default;
}

.video-task-card__meta {
  font-size: var(--af-font-xs, 11px);
  color: var(--af-text-muted, #9ca3af);
  font-variant-numeric: tabular-nums;
}

/* M14：用户标签行 */
.video-task-card__labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.video-task-card__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.video-task-card__hint {
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
}

.video-task-card__error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--af-error, #ef4444);
  background: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
  border-radius: var(--af-radius-sm, 6px);
  padding: 8px 10px;
  word-break: break-all;
}

.video-task-card__cancelled {
  margin: 0;
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
}

.video-task-card__player {
  width: 100%;
  max-height: 320px;
  border-radius: 8px;
  background-color: #000;
}

.video-task-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.video-task-card__file {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--af-text-tertiary, #94a3b8);
}
</style>