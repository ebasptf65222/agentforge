<script setup lang="ts">
// 视频任务卡 - 三种形态（variant）
//  - grid : 封面网格卡（16:9 大封面、悬浮静音预览、IntersectionObserver 惰性加载）
//  - list : 列表行卡（160×90 缩略图 + 信息列，点击缩略图走预览面板）
//  - chat : 聊天内紧凑卡（保留内嵌播放器，默认形态，向后兼容）
// 状态机展示 提交→运行→下载→完成/失败；agentfile:// URL 本地播放。

import { computed, ref } from 'vue'
import {
  NButton,
  NCheckbox,
  NDropdown,
  NIcon,
  NProgress,
  NTag,
  NTooltip,
  useDialog,
} from 'naive-ui'
import {
  PlayArrowOutlined,
  StopOutlined,
  RefreshOutlined,
  StarBorderOutlined,
  StarFilled,
  MoreHorizOutlined,
  VideoLibraryOutlined,
} from '@vicons/material'
import { useIntersectionObserver, usePreferredReducedMotion } from '@vueuse/core'
import type { VideoTask, VideoRoutingStrategy, VideoProvider } from '@shared/types'
import { useVideoStore } from '@/stores/video'

const props = withDefaults(
  defineProps<{
    task: VideoTask
    /** 展示形态：grid 封面网格卡 / list 列表行卡 / chat 聊天紧凑卡 */
    variant?: 'grid' | 'list' | 'chat'
    /** grid 形态：多选模式（显示选择框） */
    selectionMode?: boolean
    selected?: boolean
    /** 是否显示「编辑标签」入口（标签模态由父级承载） */
    showTagAction?: boolean
  }>(),
  { variant: 'chat', selectionMode: false, selected: false, showTagAction: true },
)

const emit = defineEmits<{
  /** 点击封面/「在文件面板打开」 */
  open: [relativePath: string]
  /** grid：切换选中态 */
  'toggle-select': []
  /** list：请求编辑标签（模态由父级提供） */
  'edit-tags': []
}>()

const videoStore = useVideoStore()
const dialog = useDialog()

function routeStrategyLabel(strategy: VideoRoutingStrategy): string {
  if (strategy === 'cost-optimized') return '成本优先'
  if (strategy === 'quality-first') return '质量优先'
  return '固定厂商'
}

function routeProviderLabel(provider: VideoProvider): string {
  if (provider === 'kling') return 'Kling'
  if (provider === 'custom') return '自定义厂商'
  return 'Seedance'
}

/** M16：参考图角色中文标签 */
function refRoleLabel(role: string): string {
  if (role === 'style') return '风格参考图'
  if (role === 'last_frame') return '尾帧'
  return '首帧'
}

// ─── 状态机 ───────────────────────────────────────────────────

const STATUS_LABEL: Record<VideoTask['status'], string> = {
  queued: '排队中',
  submitted: '已提交',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const terminal = computed(() =>
  ['succeeded', 'failed', 'cancelled'].includes(props.task.status),
)

/** 状态圆点色（语义 token） */
const statusDotColor = computed(() => {
  switch (props.task.status) {
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

// ─── 播放与惰性封面 ──────────────────────────────────────────

/** 本地播放地址（agentfile:///workspace/...） */
const playUrl = computed(() =>
  props.task.status === 'succeeded' && props.task.outputPath
    ? window.electron.workspace.buildFileUrl(props.task.outputPath)
    : '',
)

/** 语言化进度 */
const progressPercent = computed(() => Math.max(0, Math.min(100, props.task.progress)))

const coverRef = ref<HTMLElement | null>(null)
const coverVisible = ref(false)
useIntersectionObserver(coverRef, ([entry]) => {
  if (entry?.isIntersecting) coverVisible.value = true
})

const reducedMotion = usePreferredReducedMotion()
const videoEl = ref<HTMLVideoElement | null>(null)

function onCoverEnter(): void {
  if (reducedMotion.value === 'reduce') return
  void videoEl.value?.play().catch(() => {})
}

function onCoverLeave(): void {
  const el = videoEl.value
  if (!el) return
  el.pause()
  try {
    el.currentTime = 0
  } catch {
    // 部分编解码下 seek 可能失败，忽略
  }
}

// ─── 操作 ────────────────────────────────────────────────────

async function handleStop(): Promise<void> {
  await videoStore.cancel(props.task.id)
}

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

function confirmDelete(): void {
  dialog.warning({
    title: '移入回收站',
    content: '将把该视频移入回收站（保留文件，可恢复），确认？',
    positiveText: '移入回收站',
    negativeText: '取消',
    onPositiveClick: () => {
      void videoStore.deleteTask(props.task.id)
    },
  })
}

const moreOptions = computed(() => {
  const opts: { label: string; key: string }[] = []
  if (props.showTagAction) opts.push({ label: '编辑标签', key: 'tags' })
  opts.push({ label: '移入回收站', key: 'delete' })
  return opts
})

function handleMoreAction(key: string | number): void {
  if (key === 'tags') emit('edit-tags')
  else if (key === 'delete') confirmDelete()
}

function fileName(filePath: string | null): string {
  if (!filePath) return ''
  return filePath.split('/').pop() ?? ''
}
</script>

<template>
  <!-- ══════════ grid：封面网格卡 ══════════ -->
  <div
    v-if="variant === 'grid'"
    class="vgrid"
    :class="{ 'vgrid--selected': selectionMode && selected }"
  >
    <div
      ref="coverRef"
      class="vgrid__cover"
      :class="{ 'vgrid__cover--clickable': Boolean(playUrl) }"
      role="button"
      :tabindex="playUrl ? 0 : -1"
      :aria-label="task.prompt ? `打开视频：${task.prompt.slice(0, 30)}` : '打开视频'"
      @click="handleOpen"
      @keydown.enter="handleOpen"
      @mouseenter="onCoverEnter"
      @mouseleave="onCoverLeave"
    >
      <!-- 惰性封面：进入视口才挂载 video -->
      <video
        v-if="coverVisible && playUrl"
        ref="videoEl"
        class="vgrid__video"
        :src="playUrl"
        muted
        playsinline
        preload="metadata"
      ></video>
      <div v-else class="vgrid__fallback">
        <NIcon :size="28" class="vgrid__fallback-icon">
          <VideoLibraryOutlined />
        </NIcon>
      </div>

      <div v-if="playUrl" class="vgrid__scrim" aria-hidden="true"></div>

      <!-- 左上：多选框（选中模式）或状态角标 -->
      <NCheckbox
        v-if="selectionMode"
        class="vgrid__select"
        :checked="selected"
        @click.stop
        @update:checked="emit('toggle-select')"
      />
      <span v-else-if="!terminal" class="vgrid__status">
        <span class="vgrid__dot" :style="{ background: statusDotColor }"></span>
        {{ STATUS_LABEL[task.status] }}
      </span>

      <!-- 右上：悬浮操作（收藏/停止/重试） -->
      <div v-if="!selectionMode" class="vgrid__actions">
        <NTooltip placement="top" :delay="400">
          <template #trigger>
            <button
              class="vgrid__icon-btn"
              :class="{ 'is-on': task.favorite }"
              type="button"
              :aria-label="task.favorite ? '取消收藏' : '收藏'"
              @click.stop="handleToggleFavorite"
            >
              <NIcon :size="15"><StarFilled v-if="task.favorite" /><StarBorderOutlined v-else /></NIcon>
            </button>
          </template>
          <span>{{ task.favorite ? '取消收藏' : '收藏' }}</span>
        </NTooltip>
        <button
          v-if="!terminal"
          class="vgrid__icon-btn"
          type="button"
          aria-label="停止"
          @click.stop="handleStop"
        >
          <NIcon :size="15"><StopOutlined /></NIcon>
        </button>
        <button
          v-if="canRetry"
          class="vgrid__icon-btn"
          type="button"
          aria-label="重新生成"
          @click.stop="handleRetry"
        >
          <NIcon :size="15"><RefreshOutlined /></NIcon>
        </button>
      </div>

      <!-- 底部：提示词 + 参数（scrim 上白字） -->
      <div class="vgrid__overlay">
        <p class="vgrid__prompt">{{ task.prompt || '视频任务' }}</p>
        <span class="vgrid__meta">{{ metaText }}</span>
      </div>

      <!-- 底部进度条（进行中） -->
      <NProgress
        v-if="!terminal"
        class="vgrid__progress"
        type="line"
        :percentage="progressPercent"
        :show-indicator="false"
        :height="3"
        :border-radius="0"
        :color="'var(--af-brand, #818cf8)'"
        :rail-color="'rgba(255, 255, 255, 0.18)'"
      />
    </div>
    <p v-if="task.status === 'failed' && task.errorMessage" class="vgrid__error" :title="task.errorMessage">
      {{ task.errorMessage }}
    </p>
  </div>

  <!-- ══════════ list：列表行卡（缩略图 + 信息列） ══════════ -->
  <div v-else-if="variant === 'list'" class="vrow">
    <div
      ref="coverRef"
      class="vrow__thumb"
      :class="{ 'vrow__thumb--clickable': Boolean(playUrl) }"
      role="button"
      :tabindex="playUrl ? 0 : -1"
      @click="handleOpen"
      @keydown.enter="handleOpen"
      @mouseenter="onCoverEnter"
      @mouseleave="onCoverLeave"
    >
      <video
        v-if="coverVisible && playUrl"
        ref="videoEl"
        class="vrow__video"
        :src="playUrl"
        muted
        playsinline
        preload="metadata"
      ></video>
      <div v-else class="vrow__thumb-fallback">
        <NIcon v-if="terminal" :size="20"><VideoLibraryOutlined /></NIcon>
        <span v-else class="vrow__thumb-dot" :style="{ background: statusDotColor }"></span>
      </div>
      <span v-if="playUrl" class="vrow__play-hint" aria-hidden="true">
        <NIcon :size="16"><PlayArrowOutlined /></NIcon>
      </span>
    </div>

    <div class="vrow__body">
      <div class="vrow__head">
        <span class="vrow__status">
          <span class="vrow__dot" :style="{ background: statusDotColor }"></span>
          {{ STATUS_LABEL[task.status] }}
        </span>
        <span class="vrow__time" :title="new Date(task.createdAt).toLocaleString()">
          {{ formatRelativeTime(task.createdAt) }}
        </span>
        <span class="vrow__spacer"></span>
        <NTooltip placement="top" :delay="400">
          <template #trigger>
            <NButton size="tiny" quaternary :type="task.favorite ? 'warning' : 'default'" @click="handleToggleFavorite">
              <template #icon>
                <NIcon :size="14"><StarFilled v-if="task.favorite" /><StarBorderOutlined v-else /></NIcon>
              </template>
            </NButton>
          </template>
          <span>{{ task.favorite ? '取消收藏' : '收藏' }}</span>
        </NTooltip>
        <NTooltip v-if="!terminal" placement="top" :delay="400">
          <template #trigger>
            <NButton size="tiny" quaternary @click="handleStop">
              <template #icon><NIcon :size="14"><StopOutlined /></NIcon></template>
            </NButton>
          </template>
          <span>停止</span>
        </NTooltip>
        <NTooltip v-if="canRetry" placement="top" :delay="400">
          <template #trigger>
            <NButton size="tiny" quaternary @click="handleRetry">
              <template #icon><NIcon :size="14"><RefreshOutlined /></NIcon></template>
            </NButton>
          </template>
          <span>重新生成</span>
        </NTooltip>
        <NDropdown
          trigger="click"
          :options="moreOptions"
          @select="handleMoreAction"
        >
          <NButton size="tiny" quaternary aria-label="更多操作">
            <template #icon><NIcon :size="14"><MoreHorizOutlined /></NIcon></template>
          </NButton>
        </NDropdown>
      </div>

      <p class="vrow__prompt" :title="task.prompt">{{ task.prompt || '视频任务' }}</p>

      <div v-if="task.tags.length > 0 || (task.imageRefs && task.imageRefs.length > 0)" class="vrow__labels">
        <NTag v-for="tag in task.tags" :key="tag" size="tiny" :bordered="false">{{ tag }}</NTag>
        <NTag
          v-for="(imgRef, index) in task.imageRefs"
          :key="`ref-${index}`"
          size="tiny"
          :bordered="false"
          :type="imgRef.role === 'style' ? 'warning' : 'info'"
          :title="imgRef.path"
        >
          {{ refRoleLabel(imgRef.role) }}
        </NTag>
      </div>

      <div class="vrow__meta-row">
        <span class="vrow__meta">{{ metaText }}</span>
        <span v-if="task.routing" class="vrow__route" :title="task.routing.reason">
          {{ routeStrategyLabel(task.routing.strategy) }} → {{ routeProviderLabel(task.routing.selectedProvider) }}
        </span>
      </div>

      <div v-if="!terminal" class="vrow__progress">
        <NProgress
          :percentage="progressPercent"
          :indicator-placement="'inside'"
          :status="task.status === 'failed' ? 'error' : 'default'"
        />
      </div>
      <div v-if="task.status === 'failed' && task.errorMessage" class="vrow__error" :title="task.errorMessage">
        {{ task.errorMessage }}
      </div>
      <p v-else-if="task.status === 'cancelled'" class="vrow__cancelled">任务已取消</p>
    </div>
  </div>

  <!-- ══════════ chat：聊天内紧凑卡（保留内嵌播放器） ══════════ -->
  <div v-else class="video-task-card">
    <div class="video-task-card__head">
      <span class="video-task-card__tags">
        <NTag :type="task.status === 'succeeded' ? 'success' : task.status === 'failed' ? 'error' : 'info'" size="small" :bordered="false">
          {{ STATUS_LABEL[task.status] }}
        </NTag>
        <span class="video-task-card__time" :title="new Date(task.createdAt).toLocaleString()">
          {{ formatRelativeTime(task.createdAt) }}
        </span>
      </span>
      <NTooltip placement="top" :delay="500">
        <template #trigger>
          <NButton size="tiny" quaternary :type="task.favorite ? 'warning' : 'default'" @click="handleToggleFavorite">
            <template #icon>
              <NIcon :size="14"><StarFilled v-if="task.favorite" /><StarBorderOutlined v-else /></NIcon>
            </template>
          </NButton>
        </template>
        <span>{{ task.favorite ? '取消收藏' : '收藏' }}</span>
      </NTooltip>
      <NTooltip v-if="!terminal" placement="top" :delay="500">
        <template #trigger>
          <NButton size="tiny" quaternary @click="handleStop">
            <template #icon><NIcon :size="14"><StopOutlined /></NIcon></template>
          </NButton>
        </template>
        <span>停止</span>
      </NTooltip>
      <NTooltip v-if="canRetry" placement="top" :delay="500">
        <template #trigger>
          <NButton size="tiny" quaternary @click="handleRetry">
            <template #icon><NIcon :size="14"><RefreshOutlined /></NIcon></template>
          </NButton>
        </template>
        <span>重新生成</span>
      </NTooltip>
    </div>

    <p class="video-task-card__prompt" :title="task.prompt">{{ task.prompt || '视频任务' }}</p>

    <div v-if="task.tags.length > 0" class="video-task-card__labels">
      <NTag v-for="tag in task.tags" :key="tag" size="tiny" :bordered="false">{{ tag }}</NTag>
    </div>

    <div v-if="task.imageRefs && task.imageRefs.length > 0" class="video-task-card__labels">
      <NTag
        v-for="(imgRef, index) in task.imageRefs"
        :key="index"
        size="tiny"
        :bordered="false"
        :type="imgRef.role === 'style' ? 'warning' : 'info'"
        :title="imgRef.path"
      >
        {{ refRoleLabel(imgRef.role) }}
      </NTag>
    </div>

    <span class="video-task-card__meta">{{ metaText }}</span>

    <div v-if="task.routing" class="video-task-card__route">
      <NTag size="tiny" :bordered="false">{{ routeStrategyLabel(task.routing.strategy) }}</NTag>
      <span>路由 → {{ routeProviderLabel(task.routing.selectedProvider) }}：{{ task.routing.reason }}</span>
    </div>

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

    <div v-if="task.status === 'failed' && task.errorMessage" class="video-task-card__error">
      {{ task.errorMessage }}
    </div>
    <p v-else-if="task.status === 'cancelled'" class="video-task-card__cancelled">任务已取消</p>

    <template v-if="playUrl">
      <video class="video-task-card__player" :src="playUrl" controls preload="metadata"></video>
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
/* ══════════ grid 形态 ══════════ */
.vgrid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.vgrid__cover {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--af-video-cover-radius, 12px);
  background: var(--af-bg-input, #1f2937);
  overflow: hidden;
  outline: none;
  transition: transform var(--af-dur-base, 200ms) var(--af-ease-out, cubic-bezier(0, 0, 0.2, 1)),
    box-shadow var(--af-dur-base, 200ms) var(--af-ease-out, cubic-bezier(0, 0, 0.2, 1));
}

.vgrid__cover--clickable {
  cursor: pointer;
}

.vgrid__cover--clickable:hover,
.vgrid__cover--clickable:focus-visible {
  transform: translateY(-2px);
  box-shadow: var(--af-video-card-hover-shadow, 0 8px 24px rgba(0, 0, 0, 0.5));
}

.vgrid__cover:focus-visible {
  box-shadow: 0 0 0 2px var(--af-brand-dim, rgba(129, 140, 248, 0.12));
}

.vgrid--selected .vgrid__cover {
  box-shadow: 0 0 0 2px var(--af-brand, #818cf8);
}

.vgrid__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.vgrid__fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--af-text-muted, #8494ad);
  background:
    radial-gradient(circle at 50% 42%, var(--af-brand-dim, rgba(129, 140, 248, 0.12)), transparent 60%);
}

.vgrid__fallback-icon {
  opacity: 0.55;
}

.vgrid__scrim {
  position: absolute;
  inset: 0;
  background: var(--af-scrim, linear-gradient(180deg, transparent 40%, rgba(2, 6, 23, 0.85) 100%));
  pointer-events: none;
}

.vgrid__select {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
}

.vgrid__status {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #fff;
  background: rgba(2, 6, 23, 0.55);
  padding: 2px 8px;
  border-radius: var(--af-radius-full, 999px);
  backdrop-filter: blur(4px);
}

.vgrid__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex: none;
}

.vgrid__actions {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 3;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--af-dur-fast, 120ms) var(--af-ease-out, cubic-bezier(0, 0, 0.2, 1));
}

.vgrid__cover:hover .vgrid__actions,
.vgrid__cover:focus-within .vgrid__actions {
  opacity: 1;
}

.vgrid__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--af-radius-full, 999px);
  background: rgba(2, 6, 23, 0.55);
  color: #e2e8f0;
  cursor: pointer;
  transition: background var(--af-dur-fast, 120ms) ease, color var(--af-dur-fast, 120ms) ease;
}

.vgrid__icon-btn:hover {
  background: rgba(2, 6, 23, 0.8);
  color: #fff;
}

.vgrid__icon-btn.is-on {
  color: var(--af-warning, #f59e0b);
  opacity: 1;
}

.vgrid__cover .vgrid__icon-btn.is-on {
  opacity: 1;
}

.vgrid__actions .vgrid__icon-btn {
  opacity: 0.95;
}

.vgrid__cover:not(:hover) .vgrid__icon-btn.is-on {
  opacity: 1;
}

.vgrid__overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 26px 12px 10px;
  pointer-events: none;
}

.vgrid__prompt {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #f1f5f9;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.vgrid__meta {
  font-size: 11px;
  color: rgba(241, 245, 249, 0.78);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vgrid__progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
}

.vgrid__error {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--af-error, #ef4444);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}

/* ══════════ list 形态 ══════════ */
.vrow {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.vrow__thumb {
  position: relative;
  flex: none;
  width: 160px;
  aspect-ratio: 16 / 9;
  border-radius: var(--af-radius, 8px);
  background: var(--af-bg-input, #1f2937);
  overflow: hidden;
  outline: none;
}

.vrow__thumb--clickable {
  cursor: pointer;
}

.vrow__thumb:focus-visible {
  box-shadow: 0 0 0 2px var(--af-brand-dim, rgba(129, 140, 248, 0.12));
}

.vrow__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.vrow__thumb-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--af-text-muted, #8494ad);
}

.vrow__thumb-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.vrow__play-hint {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--af-radius-full, 999px);
  background: rgba(2, 6, 23, 0.6);
  color: #fff;
  opacity: 0;
  transition: opacity var(--af-dur-fast, 120ms) ease;
  pointer-events: none;
}

.vrow__thumb:hover .vrow__play-hint {
  opacity: 1;
}

.vrow__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vrow__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vrow__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--af-text-secondary, #cbd5e1);
  white-space: nowrap;
}

.vrow__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
}

.vrow__time {
  font-size: var(--af-font-xs, 11px);
  color: var(--af-text-muted, #8494ad);
  white-space: nowrap;
}

.vrow__spacer {
  flex: 1;
}

.vrow__prompt {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--af-text-primary, #f1f5f9);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
  cursor: default;
}

.vrow__labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.vrow__meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.vrow__meta {
  font-size: var(--af-font-xs, 11px);
  color: var(--af-text-muted, #8494ad);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vrow__route {
  font-size: 11px;
  color: var(--af-text-muted, #8494ad);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vrow__progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vrow__error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--af-error, #ef4444);
  background: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
  border-radius: var(--af-radius-sm, 6px);
  padding: 8px 10px;
  word-break: break-all;
}

.vrow__cancelled {
  margin: 0;
  font-size: 12px;
  color: var(--af-text-muted, #8494ad);
}

/* ══════════ chat 形态（原紧凑卡） ══════════ */
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
  color: var(--af-text-muted, #8494ad);
  white-space: nowrap;
}

.video-task-card__prompt {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--af-text-primary, #f1f5f9);
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
  color: var(--af-text-muted, #8494ad);
  font-variant-numeric: tabular-nums;
}

.video-task-card__route {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--af-text-muted, #8494ad);
}

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
  color: var(--af-text-muted, #8494ad);
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
  color: var(--af-text-muted, #8494ad);
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

/* ══════════ 动效降级 ══════════ */
@media (prefers-reduced-motion: reduce) {
  .vgrid__cover,
  .vgrid__actions,
  .vrow__play-hint {
    transition: none;
  }

  .vgrid__cover--clickable:hover {
    transform: none;
  }
}
</style>
