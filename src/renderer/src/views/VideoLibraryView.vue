<script setup lang="ts">
// M11: VideoLibraryView - 视频资源管理面板（含批量操作 + CSV 批量造片）
// 延续 M10 的多选模式与批量操作条，新增 CSV 批量造片：
//  - 工具栏「批量造片」打开模态：选择本地 CSV → 解析预览（行数 / 跳过明细）→ 受限并发批量提交。
//  - 每行 CSV 即一个单视频任务，成功后经事件推送进入视频库列表。
// 所有批量动作经由 store 调用批量 IPC，成功后本地状态即时同步并汇报成功/失败数。

import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NTooltip,
} from 'naive-ui'
import { RefreshOutlined, DeleteOutlined, CheckBoxOutlined, UploadFileOutlined } from '@vicons/material'
import type { CreateVideoTaskParams, VideoTask, VideoTaskStatus, VideoSequence } from '@shared/types'
import type { VideoCsvParseResult } from '@/types/electron-api'
import { useVideoStore } from '@/stores/video'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { showToast } from '@/utils/toast'
import SequenceCard from '@/components/video/SequenceCard.vue'
import VideoTaskCard from '@/components/video/VideoTaskCard.vue'

type FilterType = 'all' | 'task' | 'sequence'
type StatusFilter = '' | 'active' | VideoTaskStatus

const videoStore = useVideoStore()
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()

const filterType = ref<FilterType>('all')
const statusFilter = ref<StatusFilter>('')
const keyword = ref('')
const selectionMode = ref(false)

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

/** 独立任务：不属于任何现存序列的子任务，视为单独视频 */
const standaloneTasks = computed<VideoTask[]>(() =>
  videoStore.list.filter(
    (t) =>
      filterType.value !== 'sequence' &&
      (!t.sequenceId || !videoStore.getSequence(t.sequenceId)) &&
      matchStatus(t.status) &&
      matchKeyword(t.prompt || ''),
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

function handleRefresh(): void {
  void videoStore.refresh()
  void videoStore.refreshSequences()
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

    <!-- 工具栏 -->
    <div class="video-library__toolbar">
      <NSelect v-model:value="filterType" :options="TYPE_OPTIONS" size="small" class="video-library__type" />
      <NSelect v-model:value="statusFilter" :options="STATUS_OPTIONS" size="small" class="video-library__status" />
      <NInput v-model:value="keyword" size="small" clearable placeholder="搜索提示词 / 标题…" class="video-library__search" />
    </div>

    <!-- 批量操作条（吸附） -->
    <div v-if="selectionMode" class="video-library__batchbar">
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
              删除 {{ videoStore.selectedCount > 0 ? `(${videoStore.selectedCount})` : '' }}
            </NButton>
          </template>
          将删除选中的 {{ videoStore.selectedCount }} 项及其落盘文件，此操作不可恢复，确认删除？
        </NPopconfirm>
        <NButton size="small" quaternary @click="exitSelection">取消</NButton>
      </NSpace>
    </div>

    <!-- 列表区域 -->
    <div class="video-library__body">
      <NSpin :show="videoStore.loading" size="small">
        <div v-if="!hasResults && !videoStore.loading" class="video-library__empty">
          <NEmpty description="暂无匹配的视频资源" />
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
                      @positive-click="handleDeleteSequence(sequence.id)"
                    >
                      <template #trigger>
                        <NButton size="tiny" quaternary>取消</NButton>
                      </template>
                    </NPopconfirm>
                    <NPopconfirm
                      positive-text="删除"
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
                      将删除该序列及其全部视频文件，此操作不可恢复，确认删除？
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
                    <NPopconfirm
                      positive-text="删除"
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
                      将删除该视频及其落盘文件，此操作不可恢复，确认删除？
                    </NPopconfirm>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
      </NSpin>
    </div>

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
  color: var(--af-text-muted, #94a3b8);
  background: var(--af-surface-muted, #1e293b);
  padding: 2px 8px;
  border-radius: 999px;
}

.video-library__stat--seq {
  color: var(--af-brand, #4b3fe3);
}

.video-library__stat--active {
  color: var(--af-warning, #d97706);
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
  background: var(--af-surface-muted, #1e293b);
  border: 1px solid var(--af-border, #334155);
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
  padding: 60px 0;
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
  border-color: var(--af-border, #334155);
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
</style>