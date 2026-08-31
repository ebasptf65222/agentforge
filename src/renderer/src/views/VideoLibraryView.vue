<script setup lang="ts">
// M11: VideoLibraryView - 视频资源管理面板（含批量操作 + CSV 批量造片）
// 延续 M10 的多选模式与批量操作条，新增 CSV 批量造片：
//  - 工具栏「批量造片」打开模态：选择本地 CSV → 解析预览（行数 / 跳过明细）→ 受限并发批量提交。
//  - 每行 CSV 即一个单视频任务，成功后经事件推送进入视频库列表。
// 所有批量动作经由 store 调用批量 IPC，成功后本地状态即时同步并汇报成功/失败数。

import { computed, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NTooltip,
} from 'naive-ui'
import { RefreshOutlined, DeleteOutlined, CheckBoxOutlined, UploadFileOutlined, VideoLibraryOutlined, BarChartOutlined, FileDownloadOutlined, PauseCircleOutlined, PlayCircleOutlined, StarOutlined, LabelOutlined, RestoreFromTrashOutlined, DeleteForeverOutlined, Inventory2Outlined } from '@vicons/material'
import type { CreateVideoTaskParams, VideoTask, VideoTaskStatus, VideoSequence, VideoStatsBucket } from '@shared/types'
import type { VideoCsvParseResult } from '@/types/electron-api'
import { useVideoStore } from '@/stores/video'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { showToast } from '@/utils/toast'
import SequenceCard from '@/components/video/SequenceCard.vue'
import VideoTaskCard from '@/components/video/VideoTaskCard.vue'

type FilterType = 'all' | 'task' | 'sequence'
type StatusFilter = '' | 'active' | VideoTaskStatus
type ViewMode = 'library' | 'trash'

const videoStore = useVideoStore()
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()

const filterType = ref<FilterType>('all')
const statusFilter = ref<StatusFilter>('')
const keyword = ref('')
const selectionMode = ref(false)
// M14：资产库 / 回收站视图与增强筛选
const viewMode = ref<ViewMode>('library')
const favoriteOnly = ref(false)
const activeTag = ref<string | null>(null)

// ─── 筛选选项 ─────────────────────────────────────────────────
const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: '全部状态', value: '' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'succeeded' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '排队中', value: 'queued' },
  { label: '已提交', value: 'submitted' },
]

const TYPE_OPTIONS: { label: string; value: FilterType }[] = [
  { label: '全部', value: 'all' },
  { label: '单视频', value: 'task' },
  { label: '多镜头序列', value: 'sequence' },
]

function isTerminal(status: VideoTaskStatus): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

function canRetry(status: VideoTaskStatus): boolean {
  return status === 'failed' || status === 'cancelled'
}

function matchStatus(status: VideoTaskStatus): boolean {
  if (!statusFilter.value) return true
  if (statusFilter.value === 'active') return !isTerminal(status)
  return status === statusFilter.value
}

function matchKeyword(text: string): boolean {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return true
  return text.toLowerCase().includes(k)
}

/** M14：任务关键词匹配扩展到标签与模型 */
function matchTaskKeyword(task: VideoTask): boolean {
  if (!keyword.value.trim()) return true
  return (
    matchKeyword(task.prompt || '') ||
    matchKeyword(task.model || '') ||
    task.tags.some((tag) => matchKeyword(tag))
  )
}

/** M14：收藏/标签筛选（仅作用于任务） */
function matchTaskMeta(task: VideoTask): boolean {
  if (favoriteOnly.value && !task.favorite) return false
  if (activeTag.value && !task.tags.includes(activeTag.value)) return false
  return true
}

/** M14：库内全部标签（去重，按名称排序） */
const allTags = computed<string[]>(() => {
  const set = new Set<string>()
  for (const task of videoStore.list) {
    for (const tag of task.tags) set.add(tag)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

const TAG_OPTIONS = computed(() => allTags.value.map((tag) => ({ label: tag, value: tag })))

/** 独立任务：不属于任何现存序列的子任务，视为单独视频 */
const standaloneTasks = computed<VideoTask[]>(() =>
  videoStore.list.filter(
    (t) =>
      filterType.value !== 'sequence' &&
      (!t.sequenceId || !videoStore.getSequence(t.sequenceId)) &&
      matchStatus(t.status) &&
      matchTaskMeta(t) &&
      matchTaskKeyword(t),
  ),
)

const sequences = computed<VideoSequence[]>(() =>
  videoStore.sequenceList.filter(
    (s) =>
      filterType.value !== 'task' &&
      matchStatus(s.status) &&
      matchKeyword(s.title || ''),
  ),
)

const hasResults = computed(
  () => standaloneTasks.value.length > 0 || sequences.value.length > 0,
)

/** 库内是否已有任何数据（不受筛选影响） */
const hasAnyData = computed(
  () => videoStore.list.length > 0 || videoStore.sequenceList.length > 0,
)

/** 是否处于筛选/搜索状态 */
const hasActiveFilters = computed(
  () =>
    filterType.value !== 'all' ||
    statusFilter.value !== '' ||
    keyword.value.trim() !== '' ||
    favoriteOnly.value ||
    activeTag.value !== null,
)

function clearFilters(): void {
  filterType.value = 'all'
  statusFilter.value = ''
  keyword.value = ''
  favoriteOnly.value = false
  activeTag.value = null
}

/** 去对话页生成视频 */
function goChat(): void {
  uiStore.setCurrentView('chat')
}

const stats = computed(() => ({
  total: videoStore.sequenceList.length + videoStore.list.length,
  sequences: videoStore.sequenceList.length,
  tasks: videoStore.list.length,
  active: videoStore.activeCount,
}))

// ─── M10: 选择派生状态 ───────────────────────────────────────
const selectedTasks = computed<VideoTask[]>(() =>
  videoStore.selectedTaskIds
    .map((id) => videoStore.getTask(id))
    .filter((t): t is VideoTask => Boolean(t)),
)
const selectedSequences = computed<VideoSequence[]>(() =>
  videoStore.selectedSequenceIds
    .map((id) => videoStore.getSequence(id))
    .filter((s): s is VideoSequence => Boolean(s)),
)
const retryableSelected = computed<VideoTask[]>(() =>
  selectedTasks.value.filter((t) => canRetry(t.status)),
)
const runningSelectedSequences = computed<VideoSequence[]>(() =>
  selectedSequences.value.filter((s) => !isTerminal(s.status)),
)

const allVisibleTaskIds = computed(() => standaloneTasks.value.map((t) => t.id))
const allVisibleSequenceIds = computed(() => sequences.value.map((s) => s.id))
const allVisibleSelected = computed(
  () =>
    allVisibleTaskIds.value.length > 0 &&
    allVisibleSequenceIds.value.length > 0 &&
    allVisibleTaskIds.value.every((id) => videoStore.isTaskSelected(id)) &&
    allVisibleSequenceIds.value.every((id) => videoStore.isSequenceSelected(id)),
)
const someVisibleSelected = computed(() =>
  [...allVisibleTaskIds.value, ...allVisibleSequenceIds.value].some((id) =>
    videoStore.selectedTaskIds.includes(id) || videoStore.selectedSequenceIds.includes(id),
  ),
)

function toggleSelectAllVisible(): void {
  if (allVisibleSelected.value) {
    videoStore.deselectTasks(allVisibleTaskIds.value)
    videoStore.deselectSequences(allVisibleSequenceIds.value)
  } else {
    videoStore.selectAllTasks(allVisibleTaskIds.value)
    videoStore.selectAllSequences(allVisibleSequenceIds.value)
  }
}

function exitSelection(): void {
  selectionMode.value = false
  videoStore.clearSelection()
}

// ─── 操作 ─────────────────────────────────────────────────────
function handleRetry(taskId: string): void {
  void videoStore.retry(taskId)
}

function handleDeleteTask(taskId: string): void {
  void videoStore.deleteTask(taskId)
}

function handleDeleteSequence(sequenceId: string): void {
  void videoStore.deleteSequence(sequenceId)
}

function handleCancelSequence(sequenceId: string): void {
  void videoStore.cancelSequence(sequenceId)
}

function handleOpenVideo(relativePath: string): void {
  workspaceStore.openFilePreview(relativePath)
  uiStore.openPreviewPanel()
}

// ─── M10: 批量动作 ───────────────────────────────────────────
function handleBatchRetry(): void {
  void videoStore.batchRetry(retryableSelected.value.map((t) => t.id))
}

function handleBatchCancelSequences(): void {
  void videoStore.batchCancelSequences(runningSelectedSequences.value.map((s) => s.id))
}

function handleBatchDelete(): void {
  void videoStore.batchDeleteTasks(videoStore.selectedTaskIds)
  void videoStore.batchDeleteSequences(videoStore.selectedSequenceIds)
}

/** M14：批量导出选中的成品视频 */
function handleBatchExport(): void {
  void videoStore.exportAssets(videoStore.selectedTaskIds, videoStore.selectedSequenceIds)
}

// ─── M14: 标签编辑模态 ───────────────────────────────────────

const showTagModal = ref(false)
const tagEditTask = ref<VideoTask | null>(null)
const tagEditValue = ref('')
/** 单个标签最大长度与数量上限 */
const TAG_MAX_LENGTH = 24
const TAG_MAX_COUNT = 10

function openTagModal(task: VideoTask): void {
  tagEditTask.value = task
  tagEditValue.value = task.tags.join(', ')
  showTagModal.value = true
}

function closeTagModal(): void {
  showTagModal.value = false
  tagEditTask.value = null
  tagEditValue.value = ''
}

/** 解析输入框中的标签：逗号/顿号/空格分隔，去空去重，超限截断 */
function parseTagInput(raw: string): string[] {
  const parsed = raw
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  const deduped: string[] = []
  for (const tag of parsed) {
    const clipped = tag.slice(0, TAG_MAX_LENGTH)
    if (!deduped.includes(clipped)) deduped.push(clipped)
  }
  return deduped.slice(0, TAG_MAX_COUNT)
}

async function confirmTagEdit(): Promise<void> {
  const task = tagEditTask.value
  if (!task) return
  try {
    await videoStore.setTags(task.id, parseTagInput(tagEditValue.value))
    closeTagModal()
  } catch {
    // store 已 toast 错误，保持模态开启便于修改
  }
}

// ─── M14: 回收站 ─────────────────────────────────────────────

const trashHasItems = computed(
  () => videoStore.trashTasks.length > 0 || videoStore.trashSequences.length > 0,
)

/** 切到回收站时按需拉取快照 */
watch(viewMode, (mode) => {
  if (mode === 'trash' && !videoStore.trashLoading && !trashHasItems.value) {
    void videoStore.fetchTrash()
  }
  if (mode === 'trash' && selectionMode.value) {
    exitSelection()
  }
})

function handleRefresh(): void {
  if (viewMode.value === 'trash') {
    void videoStore.fetchTrash()
    return
  }
  void videoStore.refresh()
  void videoStore.refreshSequences()
}

function handleRestore(type: 'task' | 'sequence', id: string): void {
  void videoStore.restore(type, id)
}

function handlePurge(type: 'task' | 'sequence', id: string): void {
  void videoStore.purge(type, id)
}

function handleEmptyTrash(): void {
  void videoStore.emptyTrash()
}

/** 删除时间格式化（MM-DD HH:mm） */
function formatDeletedAt(timestamp: number | null): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── M11: CSV 批量造片 ───────────────────────────────────────

/** 模态可见性 */
const showCsvModal = ref(false)
/** 选择的 CSV 文件路径 */
const csvFilePath = ref('')
/** 文件名（仅展示） */
const csvFileName = ref('')
/** 解析预览结果 */
const csvResult = ref<VideoCsvParseResult | null>(null)
/** 解析中 */
const csvParsing = ref(false)
/** 批量提交中 */
const batchRunning = ref(false)

/** 预览前 8 行（超出折叠，避免长列表撑爆模态） */
const previewRows = computed<CreateVideoTaskParams[]>(() => csvResult.value?.rows.slice(0, 8) ?? [])

/** 可提交判定：已解析且至少有一行合法任务 */
const canRunBatch = computed(
  () => !csvParsing.value && (csvResult.value?.rows.length ?? 0) > 0,
)

function openCsvModal(): void {
  showCsvModal.value = true
}

function closeCsvModal(): void {
  if (batchRunning.value) return
  showCsvModal.value = false
  csvFilePath.value = ''
  csvFileName.value = ''
  csvResult.value = null
}

/** 选择本地 CSV 并立即解析预览 */
async function handleSelectCsv(): Promise<void> {
  const path = await window.electron.file.selectFile({
    title: '选择批量造片 CSV',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!path || typeof path !== 'string') return

  csvFilePath.value = path
  const parts = path.replace(/\\/g, '/').split('/')
  csvFileName.value = parts[parts.length - 1] || path
  csvResult.value = null
  csvParsing.value = true
  try {
    const result = await videoStore.parseCsv(path)
    csvResult.value = result
    if (result.headerMissingPrompt) {
      showToast('CSV 表头缺少 prompt 列', 'error')
    }
  } catch {
    // store 已 toast 具体错误，这里仅保持空预览
  } finally {
    csvParsing.value = false
  }
}

/** 确认批量生成：提交全部合法行，完成后关闭模态 */
async function handleRunBatchGenerate(): Promise<void> {
  const rows = csvResult.value?.rows ?? []
  if (rows.length === 0) return
  batchRunning.value = true
  try {
    await videoStore.batchGenerate(rows)
    showCsvModal.value = false
    csvFilePath.value = ''
    csvFileName.value = ''
    csvResult.value = null
  } catch {
    // store 已 toast 错误，保持模态开启便于重试
  } finally {
    batchRunning.value = false
  }
}

// ─── M12: 生成历史统计 ───────────────────────────────────────

/** 统计模态可见性 */
const showStatsModal = ref(false)
/** 时间范围选项（天） */
const STATS_RANGE_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
]
/** 统计范围变化中标记（避免重复请求） */
const statsRangeChanging = ref(false)

function openStatsModal(): void {
  showStatsModal.value = true
  if (!videoStore.stats) void refreshStats()
}

/** 切换时间范围并重新拉取 */
async function handleStatsRangeChange(days: number): Promise<void> {
  if (statsRangeChanging.value) return
  statsRangeChanging.value = true
  try {
    await videoStore.fetchStats(days)
  } finally {
    statsRangeChanging.value = false
  }
}

function refreshStats(): Promise<void> {
  return videoStore.fetchStats().then(() => undefined)
}

function handleExportStats(): void {
  void videoStore.exportStatsCsv()
}

/** 秒数转可读时长（秒 → "x 分 y 秒" / "x 秒"） */
function formatElapsed(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds} 秒`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

/** 汇总指标卡 */
const summaryCards = computed(() => {
  const s = videoStore.stats
  return [
    { label: '任务总数', value: s ? String(s.total) : '—' },
    { label: '成功', value: s ? String(s.succeeded) : '—' },
    { label: '失败', value: s ? String(s.failed) : '—' },
    { label: '取消', value: s ? String(s.cancelled) : '—' },
    { label: '进行中', value: s ? String(s.active) : '—' },
    { label: '成功率', value: s ? `${s.successRate}%` : '—' },
    { label: '失败率', value: s ? `${s.failureRate}%` : '—' },
    { label: '平均耗时', value: s ? formatElapsed(s.avgElapsedSeconds) : '—' },
    { label: '用量（视频时长）', value: s ? formatElapsed(s.videoSeconds) : '—' },
  ]
})

/** 分桶明细表结构（按厂商 / 模型 / 天） */
const bucketTables = computed<{ title: string; buckets: VideoStatsBucket[] }[]>(() => {
  const s = videoStore.stats
  if (!s) return []
  return [
    { title: '按厂商', buckets: s.byProvider },
    { title: '按模型', buckets: s.byModel },
    { title: '按天', buckets: s.byDay },
  ]
})

// ─── M13: 生成队列面板 ───────────────────────────────────────

/** 队列面板是否展开 */
const queueExpanded = ref(false)

/** 队列是否可见：有排队任务或处于暂停态 */
const queueVisible = computed(() => {
  const q = videoStore.queue
  return Boolean(q && (q.items.length > 0 || q.paused))
})

/** 并发上限选项（1–5，内部支持 1–10） */
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ label: `${n}`, value: n }))

async function handleQueueTogglePause(): Promise<void> {
  const q = videoStore.queue
  if (!q) return
  if (q.paused) await videoStore.resumeQueue()
  else await videoStore.pauseQueue()
}

function handleConcurrencyChange(limit: number): void {
  void videoStore.setQueueConcurrency(limit)
}

function handleCancelQueued(taskId: string): void {
  void videoStore.cancel(taskId)
}

onMounted(() => {
  videoStore.init()
})
</script>

<template>
  <div class="video-library">
    <header class="video-library__header">
      <div class="video-library__titles">
        <h2 class="video-library__title">视频库</h2>
        <span class="video-library__stats">
          <NTooltip placement="bottom" :delay="400">
            <template #trigger><span class="video-library__stat">{{ stats.total }} 项</span></template>
            <span>任务 + 序列总数</span>
          </NTooltip>
          <NTooltip placement="bottom" :delay="400">
            <template #trigger><span class="video-library__stat video-library__stat--seq">{{ stats.sequences }} 序列</span></template>
            <span>多镜头序列</span>
          </NTooltip>
          <NTooltip placement="bottom" :delay="400">
            <template #trigger><span class="video-library__stat video-library__stat--active">{{ stats.active }} 进行中</span></template>
            <span>未到终态的任务</span>
          </NTooltip>
        </span>
      </div>
      <div class="video-library__header-actions">
        <!-- M14：资产库 / 回收站视图切换 -->
        <div class="video-library__views">
          <NButton
            size="small"
            :secondary="viewMode === 'library'"
            :quaternary="viewMode !== 'library'"
            :type="viewMode === 'library' ? 'primary' : 'default'"
            round
            @click="viewMode = 'library'"
          >
            <template #icon><VideoLibraryOutlined :size="15" /></template>
            资产库
          </NButton>
          <NButton
            size="small"
            :secondary="viewMode === 'trash'"
            :quaternary="viewMode !== 'trash'"
            :type="viewMode === 'trash' ? 'primary' : 'default'"
            round
            @click="viewMode = 'trash'"
          >
            <template #icon><Inventory2Outlined :size="15" /></template>
            回收站
          </NButton>
        </div>
        <NTooltip placement="left" :delay="400">
          <template #trigger>
            <NButton size="small" quaternary round type="primary" @click="openStatsModal">
              <template #icon><BarChartOutlined :size="16" /></template>
              统计
            </NButton>
          </template>
          <span>生成历史统计与 CSV 报表导出（M12）</span>
        </NTooltip>
        <NTooltip placement="left" :delay="400">
          <template #trigger>
            <NButton size="small" quaternary round type="primary" @click="openCsvModal">
              <template #icon><UploadFileOutlined :size="16" /></template>
              批量造片
            </NButton>
          </template>
          <span>从 CSV 批量导入提示词生成视频（M11）</span>
        </NTooltip>
        <NTooltip placement="left" :delay="400">
          <template #trigger>
            <NButton
              size="small"
              quaternary
              circle
              :type="selectionMode ? 'primary' : 'default'"
              @click="selectionMode = !selectionMode"
            >
              <template #icon><CheckBoxOutlined /></template>
            </NButton>
          </template>
          <span>{{ selectionMode ? '退出选择' : '进入选择' }}</span>
        </NTooltip>
        <NTooltip placement="left" :delay="400">
          <template #trigger>
            <NButton size="small" quaternary circle @click="handleRefresh">
              <template #icon><RefreshOutlined /></template>
            </NButton>
          </template>
          <span>刷新</span>
        </NTooltip>
      </div>
    </header>

    <!-- 工具栏（资产库） -->
    <div v-if="viewMode === 'library'" class="video-library__toolbar">
      <NSelect v-model:value="filterType" :options="TYPE_OPTIONS" size="small" class="video-library__type" />
      <NSelect v-model:value="statusFilter" :options="STATUS_OPTIONS" size="small" class="video-library__status" />
      <NSelect
        v-model:value="activeTag"
        :options="TAG_OPTIONS"
        size="small"
        clearable
        placeholder="按标签筛选"
        class="video-library__tag"
      />
      <NInput v-model:value="keyword" size="small" clearable placeholder="搜索提示词 / 标题 / 标签 / 模型…" class="video-library__search" />
      <NTooltip placement="top" :delay="400">
        <template #trigger>
          <NButton
            size="small"
            :quaternary="!favoriteOnly"
            :secondary="favoriteOnly"
            :type="favoriteOnly ? 'warning' : 'default'"
            circle
            @click="favoriteOnly = !favoriteOnly"
          >
            <template #icon><StarOutlined :size="15" /></template>
          </NButton>
        </template>
        <span>只看收藏</span>
      </NTooltip>
    </div>

    <!-- M14：回收站工具条 -->
    <div v-else class="video-library__toolbar">
      <span class="video-library__trash-hint">
        回收站中的内容保留文件，可恢复或彻底删除
      </span>
      <NSpace justify="end">
        <NPopconfirm
          positive-text="清空"
          negative-text="取消"
          :positive-button-props="{ type: 'error' }"
          :negative-button-props="{ type: 'default' }"
          @positive-click="handleEmptyTrash"
        >
          <template #trigger>
            <NButton size="small" type="error" tertiary :disabled="!trashHasItems">
              <template #icon><DeleteForeverOutlined :size="15" /></template>
              清空回收站
            </NButton>
          </template>
          将彻底删除回收站中的全部内容及其落盘文件，不可恢复，确认清空？
        </NPopconfirm>
      </NSpace>
    </div>

    <!-- M13: 生成队列面板（仅资产库视图） -->
    <div v-if="viewMode === 'library' && queueVisible && videoStore.queue" class="video-library__queue" :class="{ 'video-library__queue--paused': videoStore.queue.paused }">
      <div class="video-library__queue-head">
        <button
          class="video-library__queue-toggle"
          @click="queueExpanded = !queueExpanded"
        >
          <NTag size="small" :type="videoStore.queue.paused ? 'warning' : 'primary'" :bordered="false">
            {{ videoStore.queue.paused ? '已暂停' : '队列中' }}
          </NTag>
          <span class="video-library__queue-summary">
            进行中 {{ videoStore.queue.activeCount }} / 上限 {{ videoStore.queue.maxConcurrent }}
            <template v-if="videoStore.queue.items.length > 0">
              ，排队 {{ videoStore.queue.items.length }}
            </template>
          </span>
        </button>
        <div class="video-library__queue-actions">
          <NSelect
            :value="videoStore.queue.maxConcurrent"
            :options="CONCURRENCY_OPTIONS"
            size="tiny"
            class="video-library__queue-concurrency"
            @update:value="handleConcurrencyChange"
          />
          <NTooltip placement="left" :delay="400">
            <template #trigger>
              <NButton size="tiny" quaternary @click="handleQueueTogglePause">
                <template #icon>
                  <PlayCircleOutlined v-if="videoStore.queue.paused" :size="14" />
                  <PauseCircleOutlined v-else :size="14" />
                </template>
                {{ videoStore.queue.paused ? '恢复' : '暂停' }}
              </NButton>
            </template>
            <span>{{ videoStore.queue.paused ? '恢复出队提交' : '暂停出队（进行中任务不受影响）' }}</span>
          </NTooltip>
        </div>
      </div>
      <div v-if="queueExpanded && videoStore.queue.items.length > 0" class="video-library__queue-list">
        <div
          v-for="item in videoStore.queue.items"
          :key="item.task.id"
          class="video-library__queue-item"
        >
          <span class="video-library__queue-position">{{ item.position }}</span>
          <span class="video-library__queue-prompt" :title="item.task.prompt">{{ item.task.prompt }}</span>
          <NButton size="tiny" quaternary type="error" @click="handleCancelQueued(item.task.id)">
            取消
          </NButton>
        </div>
      </div>
    </div>

    <!-- 批量操作条（吸附，仅资产库视图） -->
    <div v-if="selectionMode && viewMode === 'library'" class="video-library__batchbar">
      <div class="video-library__batchbar-left">
        <NCheckbox
          :checked="allVisibleSelected"
          :indeterminate="!allVisibleSelected && someVisibleSelected"
          @update:checked="toggleSelectAllVisible"
        >
          全选当前筛选
        </NCheckbox>
        <span class="video-library__selected-count">已选 {{ videoStore.selectedCount }} 项</span>
      </div>
      <NSpace size="small">
        <NButton
          size="small"
          :disabled="retryableSelected.length === 0"
          tertiary
          :type="retryableSelected.length > 0 ? 'primary' : 'default'"
          @click="handleBatchRetry"
        >
          重试 {{ retryableSelected.length > 0 ? `(${retryableSelected.length})` : '' }}
        </NButton>
        <NButton
          size="small"
          :disabled="runningSelectedSequences.length === 0"
          tertiary
          :type="runningSelectedSequences.length > 0 ? 'warning' : 'default'"
          @click="handleBatchCancelSequences"
        >
          取消序列 {{ runningSelectedSequences.length > 0 ? `(${runningSelectedSequences.length})` : '' }}
        </NButton>
        <NButton
          size="small"
          :disabled="videoStore.selectedCount === 0"
          tertiary
          @click="handleBatchExport"
        >
          <template #icon><FileDownloadOutlined :size="16" /></template>
          导出资产
        </NButton>
        <NPopconfirm
          :positive-button-props="{ type: 'error' }"
          :negative-button-props="{ type: 'default' }"
          @positive-click="handleBatchDelete"
        >
          <template #trigger>
            <NButton
              size="small"
              :disabled="videoStore.selectedCount === 0"
              type="error"
              tertiary
            >
              <template #icon><DeleteOutlined :size="16" /></template>
              移入回收站 {{ videoStore.selectedCount > 0 ? `(${videoStore.selectedCount})` : '' }}
            </NButton>
          </template>
          将把选中的 {{ videoStore.selectedCount }} 项移入回收站（保留文件，可恢复），确认？
        </NPopconfirm>
        <NButton size="small" quaternary @click="exitSelection">取消</NButton>
      </NSpace>
    </div>

    <!-- 列表区域 -->
    <div class="video-library__body">
      <!-- 资产库视图 -->
      <NSpin v-if="viewMode === 'library'" :show="videoStore.loading" size="small">
        <div v-if="!hasResults && !videoStore.loading" class="video-library__empty">
          <!-- 库为空：引导生成 -->
          <template v-if="!hasAnyData">
            <div class="video-library__empty-icon">
              <NIcon :size="44"><VideoLibraryOutlined /></NIcon>
            </div>
            <p class="video-library__empty-title">视频库还是空的</p>
            <p class="video-library__empty-desc">
              在对话中让 AI 生成视频，或通过 CSV 批量导入提示词一次生成多个视频
            </p>
            <div class="video-library__empty-actions">
              <NButton size="small" type="primary" @click="goChat">去对话生成</NButton>
              <NButton size="small" tertiary @click="openCsvModal">
                <template #icon><UploadFileOutlined :size="16" /></template>
                批量造片
              </NButton>
            </div>
          </template>
          <!-- 有数据但筛选无结果 -->
          <template v-else>
            <NEmpty description="没有匹配的视频资源">
              <template #extra>
                <NButton v-if="hasActiveFilters" size="small" tertiary @click="clearFilters">
                  清除筛选
                </NButton>
              </template>
            </NEmpty>
          </template>
        </div>

        <template v-else>
          <!-- 多镜头序列 -->
          <section v-if="sequences.length > 0" class="video-library__section">
            <h3 class="video-library__section-title">
              多镜头序列
              <span class="video-library__section-count">{{ sequences.length }}</span>
            </h3>
            <div class="video-library__list">
              <div v-for="sequence in sequences" :key="sequence.id" class="video-library__row">
                <NCheckbox
                  v-if="selectionMode"
                  class="video-library__check"
                  :checked="videoStore.isSequenceSelected(sequence.id)"
                  @update:checked="videoStore.toggleSelectSequence(sequence.id)"
                />
                <div class="video-library__item">
                  <SequenceCard :sequence="sequence" @open="handleOpenVideo" />
                  <div v-if="!selectionMode" class="video-library__actions">
                    <NPopconfirm
                      v-if="!isTerminal(sequence.status)"
                      title="取消该序列的全部进行中镜头？"
                      positive-text="取消生成"
                      negative-text="再想想"
                      @positive-click="handleCancelSequence(sequence.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" quaternary>取消</NButton>
                      </template>
                    </NPopconfirm>
                    <NPopconfirm
                      positive-text="移入回收站"
                      negative-text="取消"
                      :positive-button-props="{ type: 'error' }"
                      :negative-button-props="{ type: 'default' }"
                      @positive-click="handleDeleteSequence(sequence.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" quaternary type="error">
                          <template #icon><DeleteOutlined :size="14" /></template>
                          删除
                        </NButton>
                      </template>
                      将把该序列及其全部镜头移入回收站（保留文件，可恢复），确认？
                    </NPopconfirm>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 单视频 -->
          <section
            v-if="standaloneTasks.length > 0"
            class="video-library__section"
            :class="{ 'video-library__section--gap': sequences.length > 0 }"
          >
            <h3 class="video-library__section-title">
              单视频
              <span class="video-library__section-count">{{ standaloneTasks.length }}</span>
            </h3>
            <div class="video-library__list">
              <div v-for="task in standaloneTasks" :key="task.id" class="video-library__row">
                <NCheckbox
                  v-if="selectionMode"
                  class="video-library__check"
                  :checked="videoStore.isTaskSelected(task.id)"
                  @update:checked="videoStore.toggleSelectTask(task.id)"
                />
                <div class="video-library__item">
                  <VideoTaskCard :task="task" @open="handleOpenVideo" />
                  <div v-if="!selectionMode" class="video-library__actions">
                    <NButton
                      v-if="canRetry(task.status)"
                      size="tiny"
                      quaternary
                      @click="handleRetry(task.id)"
                    >
                      重试
                    </NButton>
                    <NButton size="tiny" quaternary @click="openTagModal(task)">
                      <template #icon><LabelOutlined :size="14" /></template>
                      标签
                    </NButton>
                    <NPopconfirm
                      positive-text="移入回收站"
                      negative-text="取消"
                      :positive-button-props="{ type: 'error' }"
                      :negative-button-props="{ type: 'default' }"
                      @positive-click="handleDeleteTask(task.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" quaternary type="error">
                          <template #icon><DeleteOutlined :size="14" /></template>
                          删除
                        </NButton>
                      </template>
                      将把该视频移入回收站（保留文件，可恢复），确认？
                    </NPopconfirm>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
      </NSpin>

      <!-- M14：回收站视图 -->
      <NSpin v-else :show="videoStore.trashLoading" size="small">
        <div v-if="!trashHasItems && !videoStore.trashLoading" class="video-library__empty">
          <div class="video-library__empty-icon">
            <NIcon :size="44"><Inventory2Outlined /></NIcon>
          </div>
          <p class="video-library__empty-title">回收站是空的</p>
          <p class="video-library__empty-desc">
            移入回收站的内容会保留落盘文件，可随时恢复或彻底删除
          </p>
        </div>
        <template v-else>
          <!-- 回收站：多镜头序列 -->
          <section v-if="videoStore.trashSequences.length > 0" class="video-library__section">
            <h3 class="video-library__section-title">
              多镜头序列
              <span class="video-library__section-count">{{ videoStore.trashSequences.length }}</span>
            </h3>
            <div class="video-library__list">
              <div
                v-for="sequence in videoStore.trashSequences"
                :key="sequence.id"
                class="video-library__row"
              >
                <div class="video-library__trash-item">
                  <div class="video-library__trash-main">
                    <span class="video-library__trash-title" :title="sequence.title">
                      {{ sequence.title }}
                    </span>
                    <span class="video-library__trash-meta">
                      {{ sequence.totalCount }} 个镜头 · {{ formatDeletedAt(sequence.deletedAt) }} 删除
                    </span>
                  </div>
                  <div class="video-library__trash-actions">
                    <NButton
                      size="tiny"
                      quaternary
                      type="primary"
                      @click="handleRestore('sequence', sequence.id)"
                    >
                      <template #icon><RestoreFromTrashOutlined :size="14" /></template>
                      恢复
                    </NButton>
                    <NPopconfirm
                      positive-text="彻底删除"
                      negative-text="取消"
                      :positive-button-props="{ type: 'error' }"
                      :negative-button-props="{ type: 'default' }"
                      @positive-click="handlePurge('sequence', sequence.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" quaternary type="error">
                          <template #icon><DeleteForeverOutlined :size="14" /></template>
                          彻底删除
                        </NButton>
                      </template>
                      将彻底删除该序列及其全部镜头与落盘文件，不可恢复，确认？
                    </NPopconfirm>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 回收站：单视频 -->
          <section
            v-if="videoStore.trashTasks.length > 0"
            class="video-library__section"
            :class="{ 'video-library__section--gap': videoStore.trashSequences.length > 0 }"
          >
            <h3 class="video-library__section-title">
              单视频
              <span class="video-library__section-count">{{ videoStore.trashTasks.length }}</span>
            </h3>
            <div class="video-library__list">
              <div
                v-for="task in videoStore.trashTasks"
                :key="task.id"
                class="video-library__row"
              >
                <div class="video-library__trash-item">
                  <div class="video-library__trash-main">
                    <span class="video-library__trash-title" :title="task.prompt">
                      {{ task.prompt || '视频任务' }}
                    </span>
                    <span class="video-library__trash-meta">
                      {{ task.model }} · {{ task.duration }} 秒 · {{ formatDeletedAt(task.deletedAt) }} 删除
                    </span>
                  </div>
                  <div class="video-library__trash-actions">
                    <NButton
                      size="tiny"
                      quaternary
                      type="primary"
                      @click="handleRestore('task', task.id)"
                    >
                      <template #icon><RestoreFromTrashOutlined :size="14" /></template>
                      恢复
                    </NButton>
                    <NPopconfirm
                      positive-text="彻底删除"
                      negative-text="取消"
                      :positive-button-props="{ type: 'error' }"
                      :negative-button-props="{ type: 'default' }"
                      @positive-click="handlePurge('task', task.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" quaternary type="error">
                          <template #icon><DeleteForeverOutlined :size="14" /></template>
                          彻底删除
                        </NButton>
                      </template>
                      将彻底删除该视频及其落盘文件，不可恢复，确认？
                    </NPopconfirm>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
      </NSpin>
    </div>

    <!-- M14：标签编辑模态 -->
    <NModal
      :show="showTagModal"
      preset="card"
      title="编辑标签"
      :bordered="false"
      :style="{ width: '440px', maxWidth: '92vw' }"
      @update:show="(v: boolean) => { if (!v) closeTagModal() }"
    >
      <NSpace vertical :size="12">
        <NInput
          v-model:value="tagEditValue"
          type="textarea"
          :rows="2"
          placeholder="输入标签，用逗号或空格分隔，最多 10 个"
        />
        <span class="video-library__tag-hint">
          {{ parseTagInput(tagEditValue).length }} / {{ TAG_MAX_COUNT }} 个标签（逗号 / 空格分隔）
        </span>
        <div class="video-library__csv-actions">
          <NButton size="small" quaternary @click="closeTagModal">取消</NButton>
          <NButton size="small" type="primary" @click="confirmTagEdit">保存</NButton>
        </div>
      </NSpace>
    </NModal>

    <!-- M11: CSV 批量造片模态 -->
    <NModal
      :show="showCsvModal"
      preset="card"
      title="CSV 批量造片"
      :bordered="false"
      :mask-closable="!batchRunning"
      :style="{ width: '560px', maxWidth: '92vw' }"
      @update:show="(v: boolean) => { if (!v) closeCsvModal() }"
    >
      <NSpace vertical :size="14">
        <!-- 步骤 1：选择文件 -->
        <div class="video-library__csv-step">
          <span class="video-library__csv-label">1. 选择 CSV 文件（UTF-8）</span>
          <div class="video-library__csv-file">
            <NButton size="small" tertiary :loading="csvParsing" @click="handleSelectCsv">
              <template #icon><UploadFileOutlined :size="16" /></template>
              选择文件
            </NButton>
            <span v-if="csvFileName" class="video-library__csv-filename" :title="csvFilePath">
              {{ csvFileName }}
            </span>
          </div>
        </div>

        <!-- 步骤 2：解析预览 -->
        <div class="video-library__csv-step">
          <span class="video-library__csv-label">2. 解析预览</span>
          <NSpin :show="csvParsing" size="small">
            <div v-if="csvResult" class="video-library__csv-preview">
              <div v-if="csvResult.headerMissingPrompt" class="video-library__csv-error">
                表头缺少 prompt 列：请在 CSV 首行加入 prompt（可选 duration / resolution / aspect）。
              </div>
              <template v-else>
                <div class="video-library__csv-summary">
                  <NTag size="small" type="success">可提交 {{ csvResult.rows.length }} 行</NTag>
                  <NTag v-if="csvResult.skipped.length > 0" size="small" type="warning">
                    跳过 {{ csvResult.skipped.length }} 行
                  </NTag>
                </div>
                <div v-if="previewRows.length > 0" class="video-library__csv-rows">
                  <div
                    v-for="(row, index) in previewRows"
                    :key="index"
                    class="video-library__csv-row"
                  >
                    <span class="video-library__csv-row-index">{{ index + 1 }}</span>
                    <span class="video-library__csv-row-prompt">{{ row.prompt }}</span>
                  </div>
                  <div
                    v-if="csvResult.rows.length > previewRows.length"
                    class="video-library__csv-more"
                  >
                    …其余 {{ csvResult.rows.length - previewRows.length }} 行
                  </div>
                </div>
                <div v-if="csvResult.skipped.length > 0" class="video-library__csv-skipped">
                  <div
                    v-for="item in csvResult.skipped.slice(0, 5)"
                    :key="item.line"
                    class="video-library__csv-skip-item"
                  >
                    第 {{ item.line }} 行：{{ item.reason }}
                  </div>
                  <div v-if="csvResult.skipped.length > 5" class="video-library__csv-more">
                    …其余 {{ csvResult.skipped.length - 5 }} 条跳过明细
                  </div>
                </div>
              </template>
            </div>
            <div v-else class="video-library__csv-hint">
              尚未选择文件。CSV 首行为表头，prompt 必填；可选列：duration（秒）、resolution（480P/720P/1080P）、aspect（16:9/9:16/4:3/3:4/1:1）。
            </div>
          </NSpin>
        </div>

        <!-- 步骤 3：提交 -->
        <div class="video-library__csv-actions">
          <NButton size="small" quaternary :disabled="batchRunning" @click="closeCsvModal">
            取消
          </NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!canRunBatch"
            :loading="batchRunning"
            @click="handleRunBatchGenerate"
          >
            开始生成{{ csvResult && csvResult.rows.length > 0 ? `（${csvResult.rows.length} 项）` : '' }}
          </NButton>
        </div>
      </NSpace>
    </NModal>

    <!-- M12: 生成历史统计模态 -->
    <NModal
      :show="showStatsModal"
      preset="card"
      title="生成统计"
      :bordered="false"
      :style="{ width: '680px', maxWidth: '94vw' }"
      @update:show="(v: boolean) => { showStatsModal = v }"
    >
      <NSpace vertical :size="14">
        <div class="video-library__stats-toolbar">
          <NSelect
            :value="videoStore.statsDays"
            :options="STATS_RANGE_OPTIONS"
            size="small"
            class="video-library__stats-range"
            @update:value="handleStatsRangeChange"
          />
          <NButton size="small" quaternary :loading="videoStore.statsLoading" @click="refreshStats">
            刷新
          </NButton>
          <NButton
            size="small"
            tertiary
            type="primary"
            :disabled="!videoStore.stats"
            @click="handleExportStats"
          >
            <template #icon><FileDownloadOutlined :size="16" /></template>
            导出 CSV
          </NButton>
        </div>

        <NSpin :show="videoStore.statsLoading" size="small">
          <div v-if="videoStore.stats" class="video-library__stats-body">
            <!-- 汇总指标卡 -->
            <div class="video-library__stats-cards">
              <div
                v-for="card in summaryCards"
                :key="card.label"
                class="video-library__stats-card"
              >
                <span class="video-library__stats-card-value">{{ card.value }}</span>
                <span class="video-library__stats-card-label">{{ card.label }}</span>
              </div>
            </div>

            <!-- 分桶明细 -->
            <div
              v-for="table in bucketTables"
              :key="table.title"
              class="video-library__stats-table"
            >
              <h4 class="video-library__stats-table-title">{{ table.title }}</h4>
              <template v-if="table.buckets.length > 0">
                <div class="video-library__stats-row video-library__stats-row--head">
                  <span>维度</span><span>总数</span><span>成功</span><span>失败</span>
                  <span>成功率</span><span>失败率</span><span>平均耗时</span><span>用量(秒)</span>
                </div>
                <div
                  v-for="bucket in table.buckets"
                  :key="bucket.key"
                  class="video-library__stats-row"
                >
                  <span :title="bucket.key" class="video-library__stats-key">{{ bucket.key }}</span>
                  <span>{{ bucket.total }}</span>
                  <span>{{ bucket.succeeded }}</span>
                  <span>{{ bucket.failed }}</span>
                  <span>{{ bucket.successRate }}%</span>
                  <span>{{ bucket.failureRate }}%</span>
                  <span>{{ formatElapsed(bucket.avgElapsedSeconds) }}</span>
                  <span>{{ bucket.videoSeconds }}</span>
                </div>
              </template>
              <div v-else class="video-library__stats-empty">该范围内暂无数据</div>
            </div>
          </div>
          <div v-else class="video-library__stats-empty">加载中…</div>
        </NSpin>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.video-library {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 20px 24px;
  overflow: hidden;
}

.video-library__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.video-library__titles {
  display: flex;
  align-items: center;
  gap: 12px;
}

.video-library__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
}

.video-library__stats {
  display: inline-flex;
  gap: 8px;
}

.video-library__stat {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  background: var(--af-bg-input, #1f2937);
  padding: 2px 10px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.video-library__stat--seq {
  color: var(--af-brand, #818cf8);
  background: var(--af-brand-dim, rgba(129, 140, 248, 0.12));
}

.video-library__stat--active {
  color: var(--af-warning, #f59e0b);
  background: color-mix(in srgb, var(--af-warning, #f59e0b) 14%, transparent);
}

.video-library__header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.video-library__toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.video-library__type {
  width: 130px;
  flex-shrink: 0;
}

.video-library__status {
  width: 130px;
  flex-shrink: 0;
}

.video-library__search {
  flex: 1;
  min-width: 140px;
}

/* ─── M14: 视图切换 / 收藏筛选 / 标签筛选 / 回收站 ──────── */

.video-library__views {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 6px;
}

.video-library__tag {
  width: 130px;
  flex-shrink: 0;
}

.video-library__tag-hint {
  font-size: 12px;
  color: var(--af-text-muted, #94a3b8);
}

.video-library__trash-hint {
  font-size: 12px;
  color: var(--af-text-muted, #94a3b8);
}

.video-library__trash-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--af-border, #334155);
  border-radius: 10px;
  background-color: var(--af-bg-surface, #1e293b);
  padding: 12px 14px;
}

.video-library__trash-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.video-library__trash-title {
  font-size: 13px;
  color: var(--af-text-primary, #e5e7eb);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-library__trash-meta {
  font-size: var(--af-font-xs, 11px);
  color: var(--af-text-muted, #9ca3af);
  font-variant-numeric: tabular-nums;
}

.video-library__trash-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* ─── M13: 生成队列面板 ─────────────────────────────────── */

.video-library__queue {
  margin-bottom: 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--af-brand, #818cf8) 30%, transparent);
  background: var(--af-brand-dim, rgba(129, 140, 248, 0.12));
}

.video-library__queue--paused {
  border-color: color-mix(in srgb, var(--af-warning, #f59e0b) 40%, transparent);
}

.video-library__queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
}

.video-library__queue-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  min-width: 0;
}

.video-library__queue-summary {
  font-size: 12px;
  color: var(--af-text-secondary, #cbd5e1);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-library__queue-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.video-library__queue-concurrency {
  width: 64px;
}

.video-library__queue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 10px 8px;
}

.video-library__queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 3px 4px;
  border-radius: 6px;
}

.video-library__queue-item:hover {
  background: color-mix(in srgb, var(--af-brand, #818cf8) 10%, transparent);
}

.video-library__queue-position {
  flex: none;
  width: 18px;
  text-align: center;
  color: var(--af-text-muted, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.video-library__queue-prompt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--af-text-primary, #f1f5f9);
}

/* 批量操作条 */
.video-library__batchbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: var(--af-brand-dim, rgba(129, 140, 248, 0.12));
  border: 1px solid color-mix(in srgb, var(--af-brand, #818cf8) 30%, transparent);
}

.video-library__batchbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.video-library__selected-count {
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
}

.video-library__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.video-library__empty {
  padding: 56px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.video-library__empty-icon {
  width: 88px;
  height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--af-brand, #818cf8);
  background: var(--af-brand-dim, rgba(129, 140, 248, 0.12));
}

.video-library__empty-title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
}

.video-library__empty-desc {
  margin: 0;
  max-width: 340px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--af-text-muted, #94a3b8);
}

.video-library__empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.video-library__section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 分组标题的品牌色竖条 */
.video-library__section-title::before {
  content: '';
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--af-brand, #818cf8);
}

.video-library__section--gap {
  margin-top: 24px;
}

.video-library__section-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--af-text-muted, #94a3b8);
}

.video-library__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.video-library__row {
  display: flex;
  align-items: stretch;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  transition: border-color 0.15s ease;
}

.video-library__row:hover {
  border-color: color-mix(in srgb, var(--af-brand, #818cf8) 35%, transparent);
  background: color-mix(in srgb, var(--af-brand, #818cf8) 4%, transparent);
}

.video-library__check {
  align-self: flex-start;
  margin-top: 14px;
}

.video-library__item {
  flex: 1;
  min-width: 0;
}

.video-library__actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  padding: 4px 6px 0;
}

/* ─── M11: CSV 批量造片模态 ─────────────────────────────── */

.video-library__csv-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.video-library__csv-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
}

.video-library__csv-file {
  display: flex;
  align-items: center;
  gap: 10px;
}

.video-library__csv-filename {
  font-size: 12px;
  color: var(--af-text-muted, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.video-library__csv-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 60px;
}

.video-library__csv-error {
  font-size: 12px;
  color: var(--af-danger, #ef4444);
  background: var(--af-surface-muted, #1e293b);
  border-radius: 8px;
  padding: 10px 12px;
}

.video-library__csv-summary {
  display: flex;
  gap: 8px;
}

.video-library__csv-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--af-surface-muted, #1e293b);
  border-radius: 8px;
  padding: 8px 10px;
}

.video-library__csv-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.video-library__csv-row-index {
  flex: none;
  color: var(--af-text-muted, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.video-library__csv-row-prompt {
  color: var(--af-text-primary, #f1f5f9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-library__csv-skipped {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.video-library__csv-skip-item {
  font-size: 11px;
  color: var(--af-warning, #f59e0b);
}

.video-library__csv-more {
  font-size: 11px;
  color: var(--af-text-muted, #94a3b8);
}

.video-library__csv-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--af-text-muted, #94a3b8);
  background: var(--af-surface-muted, #1e293b);
  border-radius: 8px;
  padding: 10px 12px;
}

.video-library__csv-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ─── M12: 生成历史统计模态 ─────────────────────────────── */

.video-library__stats-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.video-library__stats-range {
  width: 130px;
  flex-shrink: 0;
}

.video-library__stats-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.video-library__stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}

.video-library__stats-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border-radius: 10px;
  background: var(--af-surface-muted, #1e293b);
}

.video-library__stats-card-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
  font-variant-numeric: tabular-nums;
}

.video-library__stats-card-label {
  font-size: 11px;
  color: var(--af-text-muted, #94a3b8);
  white-space: nowrap;
}

.video-library__stats-table-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
  display: flex;
  align-items: center;
  gap: 8px;
}

.video-library__stats-table-title::before {
  content: '';
  width: 3px;
  height: 12px;
  border-radius: 2px;
  background: var(--af-brand, #818cf8);
}

.video-library__stats-row {
  display: grid;
  grid-template-columns: minmax(90px, 1.6fr) repeat(7, minmax(52px, 1fr));
  gap: 6px;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 6px;
  color: var(--af-text-secondary, #cbd5e1);
  font-variant-numeric: tabular-nums;
}

.video-library__stats-row:nth-child(even) {
  background: var(--af-surface-muted, #1e293b);
}

.video-library__stats-row--head {
  color: var(--af-text-muted, #94a3b8);
  font-weight: 600;
}

.video-library__stats-key {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--af-text-primary, #f1f5f9);
}

.video-library__stats-empty {
  font-size: 12px;
  color: var(--af-text-muted, #94a3b8);
  padding: 8px 0;
}

</style>