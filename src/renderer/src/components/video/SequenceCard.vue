<script setup lang="ts">
// M7: SequenceCard - 多镜头序列展示卡
// 头部展示序列标题/状态/聚合进度；展开后按镜头序号列出子任务各自的
// 状态、进度与生成结果（可播放）。点击镜头可跳转到文件预览面板。

import { computed, ref } from 'vue'
import { NButton, NCollapseTransition, NIcon, NProgress, NTag, NTooltip } from 'naive-ui'
import { ExpandMoreOutlined, PlayArrowOutlined } from '@vicons/material'
import type { VideoSequence, VideoTask, VideoTaskStatus } from '@shared/types'
import { useVideoStore } from '@/stores/video'

const props = defineProps<{
  sequence: VideoSequence
}>()

const emit = defineEmits<{
  /** 点击镜头「打开」的相对路径 */
  open: [relativePath: string]
}>()

const videoStore = useVideoStore()

const expanded = ref(false)
const shots = ref<VideoTask[] | null>(null)

const STATUS_LABEL: Record<VideoTaskStatus, string> = {
  queued: '排队',
  submitted: '已提交',
  running: '生成中',
  succeeded: '完成',
  failed: '失败',
  cancelled: '已取消',
}

function statusType(status: VideoTaskStatus): 'success' | 'error' | 'info' | 'default' {
  switch (status) {
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
}

/** 序列状态圆点色（语义 token） */
const statusDotColor = computed(() => {
  switch (props.sequence.status) {
    case 'succeeded':
      return 'var(--af-state-success, #10b981)'
    case 'failed':
      return 'var(--af-state-error, #ef4444)'
    case 'cancelled':
      return 'var(--af-text-muted, #8494ad)'
    default:
      return 'var(--af-state-running, #f59e0b)'
  }
})

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

/** 聚合进度 = 已结束镜头数 / 总数 */
const aggregatePercent = computed(() => {
  const s = props.sequence
  if (s.totalCount === 0) return 0
  return Math.round(((s.succeededCount + s.failedCount + s.cancelledCount) / s.totalCount) * 100)
})

const summary = computed(() => {
  const s = props.sequence
  const parts: string[] = [`${s.succeededCount}/${s.totalCount} 成功`]
  if (s.failedCount > 0) parts.push(`${s.failedCount} 失败`)
  if (s.cancelledCount > 0) parts.push(`${s.cancelledCount} 取消`)
  return parts.join(' · ')
})

function playUrl(task: VideoTask): string {
  return task.status === 'succeeded' && task.outputPath
    ? window.electron.workspace.buildFileUrl(task.outputPath)
    : ''
}

function fileName(task: VideoTask): string {
  return task.outputPath?.split('/').pop() ?? ''
}

function handleOpen(task: VideoTask): void {
  if (task.outputPath) emit('open', task.outputPath)
}

async function toggle(): Promise<void> {
  expanded.value = !expanded.value
  // 首次展开时惰性加载镜头明细
  if (expanded.value && shots.value === null) {
    const detail = await videoStore.getSequenceDetail(props.sequence.id)
    shots.value = detail?.tasks ?? []
  }
}

function isTerminal(status: VideoTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
</script>

<template>
  <div class="sequence-card" :class="`sequence-card--${sequence.status}`">
    <div
      class="sequence-card__head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      @click="toggle"
      @keydown.enter="toggle"
      @keydown.space.prevent="toggle"
    >
      <NIcon :size="18" class="sequence-card__arrow" :class="{ 'is-expanded': expanded }">
        <ExpandMoreOutlined />
      </NIcon>
      <span class="sequence-card__title">
        <span class="sequence-card__status">
          <span class="sequence-card__dot" :style="{ background: statusDotColor }"></span>
          {{ STATUS_LABEL[sequence.status] }}
        </span>
        <span class="sequence-card__name">{{ sequence.title || '多镜头序列' }}</span>
        <NTag v-if="sequence.continuity" type="success" size="tiny" :bordered="false">
          顺序衔接
        </NTag>
      </span>
      <span class="sequence-card__summary">
        <NTooltip placement="left" :delay="500">
          <template #trigger>
            <span class="sequence-card__summary-text">
              {{ sequence.totalCount }} 镜头 · {{ summary }} · {{ formatRelativeTime(sequence.createdAt) }}
            </span>
          </template>
          <span>点击展开各镜头进度</span>
        </NTooltip>
      </span>
    </div>

    <div class="sequence-card__progress">
      <NProgress
        :percentage="aggregatePercent"
        :indicator-placement="'inside'"
        :status="sequence.status === 'failed' ? 'error' : sequence.status === 'cancelled' ? 'warning' : 'default'"
        :color="sequence.status === 'failed' ? 'var(--af-error, #ef4444)' : undefined"
      />
    </div>

    <NCollapseTransition :show="expanded">
      <div v-if="shots === null" class="sequence-card__loading">加载镜头中…</div>
      <div v-else-if="shots.length === 0" class="sequence-card__empty">该序列暂无镜头子任务</div>
      <div v-else class="sequence-card__shots">
        <div v-for="(task, index) in shots" :key="task.id" class="shot-row">
          <div class="shot-row__main">
            <span class="shot-row__index">镜头 {{ index + 1 }}</span>
            <NTag size="tiny" :type="statusType(task.status)" :bordered="false">
              {{ STATUS_LABEL[task.status] }}
            </NTag>
            <span
              v-if="task.isChained"
              class="shot-row__chain"
              title="以上一镜头尾帧自动截取作为首帧"
            >
              ⇣ 衔接
            </span>
            <span class="shot-row__prompt">{{ task.prompt }}</span>
          </div>

          <div v-if="!isTerminal(task.status)" class="shot-row__progress">
            <NProgress
              :percentage="Math.max(0, Math.min(100, task.progress))"
              :indicator-placement="'inside'"
              :status="task.status === 'failed' ? 'error' : 'default'"
            />
          </div>
          <p v-else-if="task.status === 'failed' && task.errorMessage" class="shot-row__error">
            {{ task.errorMessage }}
          </p>

          <template v-if="playUrl(task)">
            <div class="shot-row__media">
              <video
                class="shot-row__thumb"
                :src="playUrl(task)"
                muted
                playsinline
                preload="metadata"
                @click="handleOpen(task)"
              ></video>
              <div class="shot-row__media-info">
                <span class="shot-row__file">{{ fileName(task) }}</span>
                <NButton size="tiny" text type="primary" @click="handleOpen(task)">
                  <template #icon><NIcon :size="14"><PlayArrowOutlined /></NIcon></template>
                  打开
                </NButton>
              </div>
            </div>
          </template>
        </div>
      </div>
    </NCollapseTransition>
  </div>
</template>

<style scoped>
.sequence-card {
  border: 1px solid var(--af-border, #334155);
  border-radius: 10px;
  background-color: var(--af-bg-surface, #1e293b);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sequence-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  border-radius: var(--af-radius-sm, 6px);
  outline: none;
}

.sequence-card__head:hover .sequence-card__name {
  color: var(--af-brand, #818cf8);
}

.sequence-card__head:focus-visible {
  box-shadow: 0 0 0 2px var(--af-brand-dim, rgba(129, 140, 248, 0.12));
}

.sequence-card__arrow {
  color: var(--af-text-muted, #9ca3af);
  transition: transform 0.15s ease;
}

.sequence-card__arrow.is-expanded {
  transform: rotate(180deg);
}

.sequence-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sequence-card__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--af-text-secondary, #cbd5e1);
  white-space: nowrap;
  flex-shrink: 0;
}

.sequence-card__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
}

.sequence-card__name {
  font-size: 13px;
  color: var(--af-text-primary, #e5e7eb);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.sequence-card__summary {
  margin-left: auto;
}

.sequence-card__summary-text {
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
}

.sequence-card__loading,
.sequence-card__empty {
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
  padding: 4px 2px;
}

.sequence-card__shots {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px dashed var(--af-border, #334155);
  padding-top: 10px;
}

.shot-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shot-row__main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.shot-row__index {
  font-size: 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: var(--af-text-tertiary, #94a3b8);
  flex-shrink: 0;
}

.shot-row__chain {
  font-size: 11px;
  color: var(--af-success-text, #22c55e);
  background-color: color-mix(in srgb, var(--af-success-text, #22c55e) 14%, transparent);
  border-radius: 4px;
  padding: 0 5px;
  line-height: 1.5;
  flex-shrink: 0;
}

.shot-row__prompt {
  font-size: 12px;
  line-height: 1.55;
  color: var(--af-text-secondary, #cbd5e1);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.shot-row__progress {
  max-width: 60%;
}

.shot-row__error {
  margin: 0;
  font-size: 12px;
  color: var(--af-error, #ef4444);
}

.shot-row__media {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.shot-row__thumb {
  flex: none;
  width: 96px;
  aspect-ratio: 16 / 9;
  border-radius: var(--af-radius-sm, 6px);
  background-color: #000;
  object-fit: contain;
  cursor: pointer;
}

.shot-row__media-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.shot-row__file {
  font-size: 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: var(--af-text-tertiary, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .sequence-card__arrow {
    transition: none;
  }
}
</style>