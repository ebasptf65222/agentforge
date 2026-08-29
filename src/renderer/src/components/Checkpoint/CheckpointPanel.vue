<script setup lang="ts">
// P2-02: CheckpointPanel - File snapshot timeline & rollback UI
// Displays a vertical timeline of file checkpoints with diff preview and rollback actions.

import { computed, onMounted, ref } from 'vue'
import { NIcon, NModal, NButton, NInput, NSpin, NEmpty, NTag, NPopconfirm } from 'naive-ui'
import {
  HistoryOutlined,
  RefreshOutlined,
  DeleteOutlineOutlined,
  UndoOutlined,
  CloseOutlined,
  FilterListOutlined,
  AutoDeleteOutlined,
} from '@vicons/material'
import type { Checkpoint } from '@shared/types'
import { useCheckpointStore } from '@/stores/checkpoint'
import { useUiStore } from '@/stores/ui'
import CodeDiffPreview from '@/components/Agent/CodeDiffPreview.vue'

const checkpointStore = useCheckpointStore()
const uiStore = useUiStore()

// ─── Local UI State ───────────────────────────────────────────

/** Filter input values (applied on submit) */
const pathFilterInput = ref('')
const execFilterInput = ref('')

/** Whether the filter section is expanded */
const showFilters = ref(false)

/** Whether the cleanup modal is open */
const showCleanupModal = ref(false)

/** Cleanup parameters */
const cleanupRetentionDays = ref(30)
const cleanupKeepPerFile = ref(50)

/** Rollback confirmation target */
const rollbackTarget = ref<Checkpoint | null>(null)

/** Modal visibility controlled by rollbackTarget presence */
const showRollbackModal = computed({
  get: () => !!rollbackTarget.value,
  set: (val) => {
    if (!val) rollbackTarget.value = null
  },
})

// ─── Computed ─────────────────────────────────────────────────

const actionLabels: Record<string, string> = {
  write: '写入',
  delete: '删除',
  rename: '重命名',
}

const actionColors: Record<string, string> = {
  write: 'var(--af-info, #0ea5e9)',
  delete: 'var(--af-error, #ef4444)',
  rename: 'var(--af-warning, #f59e0b)',
}

const actionTagTypes: Record<string, 'info' | 'error' | 'warning'> = {
  write: 'info',
  delete: 'error',
  rename: 'warning',
}

// ─── Lifecycle ────────────────────────────────────────────────

onMounted(async () => {
  await checkpointStore.loadCheckpoints()
})

// ─── Handlers ─────────────────────────────────────────────────

/** Format timestamp to relative time string */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

/** Format timestamp to full date-time string */
function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Get the filename from a relative path */
function getFilename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** Get the directory from a relative path */
function getDirname(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

/** Truncate content for preview */
function truncateContent(content: string | undefined, maxLen: number = 100): string {
  if (!content) return '(无内容)'
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen) + '...'
}

/** Apply filters and reload */
async function handleApplyFilters(): Promise<void> {
  await checkpointStore.applyFilters(pathFilterInput.value, execFilterInput.value)
}

/** Reset filters */
async function handleResetFilters(): Promise<void> {
  pathFilterInput.value = ''
  execFilterInput.value = ''
  await checkpointStore.resetFilters()
}

/** Toggle filter section */
function toggleFilters(): void {
  showFilters.value = !showFilters.value
  if (showFilters.value) {
    pathFilterInput.value = checkpointStore.filterPath
    execFilterInput.value = checkpointStore.filterExecutionId
  }
}

/** View diff for a checkpoint */
async function handleViewDiff(checkpoint: Checkpoint): Promise<void> {
  if (checkpointStore.selectedCheckpointId === checkpoint.id) {
    checkpointStore.clearDiff()
  } else {
    await checkpointStore.loadDiff(checkpoint.id)
  }
}

/** Confirm rollback */
async function handleConfirmRollback(): Promise<void> {
  if (!rollbackTarget.value) return
  await checkpointStore.rollback(rollbackTarget.value.id)
  rollbackTarget.value = null
}

/** Delete a checkpoint */
async function handleDelete(checkpointId: number): Promise<void> {
  await checkpointStore.deleteCheckpoint(checkpointId)
}

/** Perform cleanup */
async function handleCleanup(): Promise<void> {
  await checkpointStore.cleanup(cleanupRetentionDays.value, cleanupKeepPerFile.value)
  showCleanupModal.value = false
}

/** Close the panel */
function handleClose(): void {
  uiStore.setCheckpointPanelVisible(false)
}

/** Load more checkpoints */
async function handleLoadMore(): Promise<void> {
  await checkpointStore.loadMore()
}

/** Refresh */
async function handleRefresh(): Promise<void> {
  await checkpointStore.refresh()
}
</script>

<template>
  <div class="checkpoint-panel">
    <!-- Header -->
    <div class="checkpoint-panel__header">
      <div class="checkpoint-panel__title-row">
        <NIcon :size="18" class="checkpoint-panel__icon">
          <HistoryOutlined />
        </NIcon>
        <h2 class="checkpoint-panel__title">文件快照时间线</h2>
        <span v-if="checkpointStore?.totalCount > 0" class="checkpoint-panel__count">
          {{ checkpointStore.totalCount }}
        </span>
      </div>
      <div class="checkpoint-panel__actions">
        <button
          class="checkpoint-panel__btn"
          title="筛选"
          :class="{ 'checkpoint-panel__btn--active': showFilters }"
          @click="toggleFilters"
        >
          <NIcon :size="16"><FilterListOutlined /></NIcon>
        </button>
        <button
          class="checkpoint-panel__btn"
          title="刷新"
          :disabled="checkpointStore.loading"
          @click="handleRefresh"
        >
          <NIcon :size="16"><RefreshOutlined /></NIcon>
        </button>
        <button
          class="checkpoint-panel__btn"
          title="清理旧快照"
          @click="showCleanupModal = true"
        >
          <NIcon :size="16"><AutoDeleteOutlined /></NIcon>
        </button>
        <button
          class="checkpoint-panel__btn"
          title="关闭"
          @click="handleClose"
        >
          <NIcon :size="16"><CloseOutlined /></NIcon>
        </button>
      </div>
    </div>

    <!-- Filter section -->
    <div v-if="showFilters" class="checkpoint-panel__filters">
      <NInput
        v-model:value="pathFilterInput"
        size="small"
        placeholder="按文件路径筛选..."
        clearable
        @keydown.enter="handleApplyFilters"
      />
      <NInput
        v-model:value="execFilterInput"
        size="small"
        placeholder="按执行 ID 筛选..."
        clearable
        @keydown.enter="handleApplyFilters"
      />
      <div class="checkpoint-panel__filter-actions">
        <NButton size="tiny" type="primary" @click="handleApplyFilters">应用</NButton>
        <NButton size="tiny" @click="handleResetFilters">重置</NButton>
      </div>
    </div>

    <!-- Active filters display -->
    <div
      v-if="checkpointStore.filterPath || checkpointStore.filterExecutionId"
      class="checkpoint-panel__active-filters"
    >
      <NTag
        v-if="checkpointStore.filterPath"
        size="small"
        closable
        @close="pathFilterInput = ''; handleResetFilters()"
      >
        路径: {{ checkpointStore.filterPath }}
      </NTag>
      <NTag
        v-if="checkpointStore.filterExecutionId"
        size="small"
        closable
        @close="execFilterInput = ''; handleResetFilters()"
      >
        执行: {{ checkpointStore.filterExecutionId.slice(0, 8) }}...
      </NTag>
    </div>

    <!-- Timeline list -->
    <div class="checkpoint-panel__list">
      <NSpin v-if="checkpointStore.loading && !checkpointStore.hasCheckpoints" size="small" />
      <NEmpty
        v-else-if="!checkpointStore.hasCheckpoints"
        description="暂无文件快照"
        size="small"
      />
      <template v-else>
        <div
          v-for="checkpoint in checkpointStore.checkpoints"
          :key="checkpoint.id"
          class="checkpoint-item"
          :class="{
            'checkpoint-item--selected': checkpointStore.selectedCheckpointId === checkpoint.id,
          }"
        >
          <!-- Timeline dot and line -->
          <div class="checkpoint-item__timeline">
            <div
              class="checkpoint-item__dot"
              :style="{ backgroundColor: actionColors[checkpoint.action] || '#666' }"
            />
            <div class="checkpoint-item__line" />
          </div>

          <!-- Content -->
          <div class="checkpoint-item__content">
            <div class="checkpoint-item__header">
              <div class="checkpoint-item__file-info">
                <span class="checkpoint-item__filename" :title="checkpoint.relativePath">
                  {{ getFilename(checkpoint.relativePath) }}
                </span>
                <span class="checkpoint-item__dirname" :title="getDirname(checkpoint.relativePath)">
                  {{ getDirname(checkpoint.relativePath) }}
                </span>
              </div>
              <NTag
                size="tiny"
                :type="actionTagTypes[checkpoint.action] || 'default'"
                :bordered="false"
              >
                {{ actionLabels[checkpoint.action] || checkpoint.action }}
              </NTag>
            </div>

            <div class="checkpoint-item__meta">
              <span class="checkpoint-item__id">#{{ checkpoint.id }}</span>
              <span class="checkpoint-item__time" :title="formatDateTime(checkpoint.createdAt)">
                {{ formatRelativeTime(checkpoint.createdAt) }}
              </span>
              <span v-if="checkpoint.executionId" class="checkpoint-item__exec">
                执行: {{ checkpoint.executionId.slice(0, 8) }}...
              </span>
            </div>

            <!-- Content preview -->
            <div class="checkpoint-item__preview">
              <span class="checkpoint-item__preview-label">原始:</span>
              <code class="checkpoint-item__preview-code">{{
                truncateContent(checkpoint.originalContent)
              }}</code>
            </div>

            <!-- Actions -->
            <div class="checkpoint-item__actions">
              <NButton
                size="tiny"
                :type="checkpointStore.selectedCheckpointId === checkpoint.id ? 'primary' : 'default'"
                :loading="checkpointStore.diffLoading && checkpointStore.selectedCheckpointId === checkpoint.id"
                @click="handleViewDiff(checkpoint)"
              >
                <template #icon><NIcon><HistoryOutlined /></NIcon></template>
                差异
              </NButton>
              <NButton
                size="tiny"
                type="warning"
                :loading="checkpointStore.rollingBack && rollbackTarget?.id === checkpoint.id"
                :disabled="checkpoint.action === 'rename'"
                @click="rollbackTarget = checkpoint"
              >
                <template #icon><NIcon><UndoOutlined /></NIcon></template>
                回滚
              </NButton>
              <NPopconfirm @positive-click="handleDelete(checkpoint.id)">
                <template #trigger>
                  <NButton size="tiny" type="error" ghost>
                    <template #icon><NIcon><DeleteOutlineOutlined /></NIcon></template>
                    删除
                  </NButton>
                </template>
                确定删除此快照？此操作不可撤销。
              </NPopconfirm>
            </div>

            <!-- Diff view (inline, expandable) -->
            <div
              v-if="checkpointStore.selectedCheckpointId === checkpoint.id && checkpointStore.diffData"
              class="checkpoint-item__diff"
            >
              <div class="checkpoint-item__diff-header">
                <span>差异对比</span>
                <span v-if="checkpointStore.diffData.hasChanged" class="checkpoint-item__diff-warn">
                  (文件已被再次修改)
                </span>
              </div>
              <CodeDiffPreview
                :old-code="checkpointStore.diffData.originalContent"
                :new-code="checkpointStore.diffData.currentContent"
                :filename="checkpoint.relativePath"
                :max-lines="30"
              />
            </div>
          </div>
        </div>

        <!-- Load more -->
        <div v-if="checkpointStore.hasMore" class="checkpoint-panel__load-more">
          <NButton
            size="small"
            :loading="checkpointStore.loading"
            @click="handleLoadMore"
          >
            加载更多
          </NButton>
        </div>
      </template>
    </div>

    <!-- Rollback confirmation modal -->
    <NModal
      v-model:show="showRollbackModal"
      preset="dialog"
      title="确认回滚"
      positive-text="确认回滚"
      negative-text="取消"
      @positive-click="handleConfirmRollback"
      @negative-click="rollbackTarget = null"
      @close="rollbackTarget = null"
    >
      <div class="checkpoint-panel__rollback-confirm">
        <p>确定要回滚以下快照吗？</p>
        <div class="checkpoint-panel__rollback-info">
          <div><strong>快照 ID:</strong> #{{ rollbackTarget?.id }}</div>
          <div><strong>文件路径:</strong> {{ rollbackTarget?.relativePath }}</div>
          <div><strong>操作类型:</strong> {{ actionLabels[rollbackTarget?.action ?? ''] || rollbackTarget?.action }}</div>
          <div><strong>创建时间:</strong> {{ rollbackTarget ? formatDateTime(rollbackTarget.createdAt) : '' }}</div>
        </div>
        <p class="checkpoint-panel__rollback-warning">
          此操作将恢复文件到快照时的状态，当前文件内容将被覆盖。
        </p>
      </div>
    </NModal>

    <!-- Cleanup modal -->
    <NModal
      v-model:show="showCleanupModal"
      preset="dialog"
      title="清理旧快照"
      positive-text="清理"
      negative-text="取消"
      @positive-click="handleCleanup"
      @negative-click="showCleanupModal = false"
      @close="showCleanupModal = false"
    >
      <div class="checkpoint-panel__cleanup-form">
        <p>清理超过指定天数的旧快照，同时保留每个文件最近的 N 个快照。</p>
        <div class="checkpoint-panel__cleanup-field">
          <label>保留天数:</label>
          <NInput
            v-model:value="cleanupRetentionDays"
            type="text"
            placeholder="30"
            style="width: 80px"
          />
          <span>天</span>
        </div>
        <div class="checkpoint-panel__cleanup-field">
          <label>每文件保留:</label>
          <NInput
            v-model:value="cleanupKeepPerFile"
            type="text"
            placeholder="50"
            style="width: 80px"
          />
          <span>个</span>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.checkpoint-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--af-bg-surface, #111827);
  border-left: 1px solid var(--af-border, #374151);
  overflow: hidden;
}

/* ─── Header ─── */
.checkpoint-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.checkpoint-panel__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkpoint-panel__icon {
  color: var(--af-brand, #6366f1);
}

.checkpoint-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--af-text-primary, #f9fafb);
  margin: 0;
}

.checkpoint-panel__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background-color: var(--af-brand, #6366f1);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.checkpoint-panel__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.checkpoint-panel__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-tertiary, #9ca3af);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.checkpoint-panel__btn:hover:not(:disabled) {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.checkpoint-panel__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkpoint-panel__btn--active {
  background-color: var(--af-brand-bg, rgba(99, 102, 241, 0.15));
  color: var(--af-brand, #6366f1);
}

/* ─── Filters ─── */
.checkpoint-panel__filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.checkpoint-panel__filter-actions {
  display: flex;
  gap: 8px;
}

.checkpoint-panel__active-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

/* ─── Timeline List ─── */
.checkpoint-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
}

/* ─── Checkpoint Item ─── */
.checkpoint-item {
  display: flex;
  gap: 0;
  padding: 0 16px;
  transition: background-color 0.15s ease;
}

.checkpoint-item:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.03));
}

.checkpoint-item--selected {
  background-color: var(--af-brand-bg, rgba(99, 102, 241, 0.08));
}

/* Timeline dot + line */
.checkpoint-item__timeline {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 14px;
  width: 16px;
  flex-shrink: 0;
}

.checkpoint-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--af-bg-surface, #111827);
  flex-shrink: 0;
  z-index: 1;
}

.checkpoint-item__line {
  width: 2px;
  flex: 1;
  background-color: var(--af-border, #374151);
  margin-top: 2px;
}

.checkpoint-item:last-child .checkpoint-item__line {
  display: none;
}

/* Content */
.checkpoint-item__content {
  flex: 1;
  padding: 12px 0 12px 12px;
  min-width: 0;
}

.checkpoint-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.checkpoint-item__file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.checkpoint-item__filename {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-primary, #e5e7eb);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.checkpoint-item__dirname {
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.checkpoint-item__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

.checkpoint-item__id {
  font-weight: 600;
  color: var(--af-text-secondary, #9ca3af);
}

.checkpoint-item__exec {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
}

/* Content preview */
.checkpoint-item__preview {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
}

.checkpoint-item__preview-label {
  color: var(--af-text-muted, #6b7280);
  flex-shrink: 0;
}

.checkpoint-item__preview-code {
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  color: var(--af-text-secondary, #9ca3af);
  background-color: var(--af-bg-input, #1f2937);
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Actions */
.checkpoint-item__actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

/* Diff view */
.checkpoint-item__diff {
  margin-top: 10px;
}

.checkpoint-item__diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-primary, #e5e7eb);
  margin-bottom: 6px;
}

.checkpoint-item__diff-warn {
  color: var(--af-warning, #f59e0b);
  font-weight: 400;
  font-size: 11px;
}

/* ─── Load More ─── */
.checkpoint-panel__load-more {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

/* ─── Rollback Confirm Modal ─── */
.checkpoint-panel__rollback-confirm {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkpoint-panel__rollback-confirm p {
  margin: 0;
  font-size: 14px;
  color: var(--af-text-primary, #e5e7eb);
}

.checkpoint-panel__rollback-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background-color: var(--af-bg-input, #1f2937);
  border-radius: var(--af-radius-sm, 6px);
  font-size: 13px;
}

.checkpoint-panel__rollback-info div {
  color: var(--af-text-secondary, #9ca3af);
}

.checkpoint-panel__rollback-info strong {
  color: var(--af-text-primary, #e5e7eb);
}

.checkpoint-panel__rollback-warning {
  color: var(--af-warning, #f59e0b) !important;
  font-size: 12px !important;
}

/* ─── Cleanup Modal ─── */
.checkpoint-panel__cleanup-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkpoint-panel__cleanup-form p {
  margin: 0;
  font-size: 13px;
  color: var(--af-text-secondary, #9ca3af);
}

.checkpoint-panel__cleanup-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--af-text-primary, #e5e7eb);
}

.checkpoint-panel__cleanup-field label {
  min-width: 80px;
}
</style>
