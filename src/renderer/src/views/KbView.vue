<script setup lang="ts">
// P5-04: KbView - Knowledge base management view.
// Provides document import, list, search, and indexing operations.

import { onMounted, ref, computed, h } from 'vue'
import {
  NButton,
  NIcon,
  NDataTable,
  NModal,
  NSelect,
  NInput,
  NInputNumber,
  NTag,
  NSpace,
  NEmpty,
  NSpin,
  type DataTableColumns,
} from 'naive-ui'
import {
  ArrowLeftOutlined,
  AddOutlined,
  SearchOutlined,
  RefreshOutlined,
  ListOutlined,
  SyncOutlined,
  DeleteOutlined,
} from '@vicons/material'
import { useKbStore } from '@/stores/kb'
import { useUiStore } from '@/stores/ui'
import type { KbDocument } from '@shared/types'
import type { ChunkingOptions } from '@shared/types'

const kbStore = useKbStore()
const uiStore = useUiStore()

// ─── View State ──────────────────────────────────────────────

const showImportDialog = ref(false)
const showSearchPanel = ref(false)
const searchQuery = ref('')

// ─── Import Dialog State ─────────────────────────────────────

const importFilePath = ref('')
const importFileName = ref('')
const importFileType = ref<KbDocument['fileType']>('markdown')
const chunkStrategy = ref<'fixed' | 'paragraph'>('fixed')
const chunkSize = ref(500)
const overlap = ref(50)

const FILE_TYPE_OPTIONS: Array<{ value: KbDocument['fileType']; label: string }> = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'xlsx', label: 'XLSX' },
  { value: 'txt', label: 'TXT' },
  { value: 'csv', label: 'CSV' },
]

const CHUNK_STRATEGY_OPTIONS: Array<{ value: 'fixed' | 'paragraph'; label: string }> = [
  { value: 'fixed', label: '固定大小' },
  { value: 'paragraph', label: '按段落' },
]

// ─── Computed ────────────────────────────────────────────────

const statsText = computed(() => {
  const s = kbStore.stats
  if (!s) return ''
  return `${s.totalDocs} 文档 / ${s.totalChunks} 分块 / ${s.embeddedChunks} 已索引`
})

const hasDocuments = computed(() => kbStore.documents.length > 0)

// ─── Lifecycle ──────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([kbStore.loadDocuments(), kbStore.loadStats()])
})

// ─── Handlers ───────────────────────────────────────────────

function handleBack(): void {
  uiStore.setCurrentView('chat')
}

async function handleSelectFile(): Promise<void> {
  const filters = [{ name: 'Documents', extensions: ['md', 'txt', 'pdf', 'docx', 'xlsx', 'csv'] }]
  const result = await window.electron.file.selectFile({ filters, title: '选择要导入的文档' })
  if (result && typeof result === 'string') {
    importFilePath.value = result
    // Extract filename from path
    const parts = result.replace(/\\/g, '/').split('/')
    importFileName.value = parts[parts.length - 1] || result
    // Auto-detect file type
    const ext = importFileName.value.split('.').pop()?.toLowerCase() ?? ''
    const typeMap: Record<string, KbDocument['fileType']> = {
      md: 'markdown',
      txt: 'txt',
      pdf: 'pdf',
      docx: 'docx',
      xlsx: 'xlsx',
      csv: 'csv',
    }
    if (typeMap[ext]) {
      importFileType.value = typeMap[ext]
    }
  }
}

async function handleImport(): Promise<void> {
  if (!importFilePath.value || !importFileName.value) return

  const chunking: ChunkingOptions = {
    strategy: chunkStrategy.value,
    chunkSize: chunkSize.value,
    overlap: overlap.value,
  }

  const result = await kbStore.importDocument({
    filePath: importFilePath.value,
    fileName: importFileName.value,
    fileType: importFileType.value,
    chunking,
  })

  if (result) {
    showImportDialog.value = false
    // Reset form
    importFilePath.value = ''
    importFileName.value = ''
  }
}

async function handleDelete(id: string): Promise<void> {
  await kbStore.deleteDocument(id)
}

async function handleReimport(id: string): Promise<void> {
  await kbStore.reimportDocument(id)
}

async function handleIndex(id: string): Promise<void> {
  await kbStore.indexDocument(id)
}

async function handleReindex(id: string): Promise<void> {
  await kbStore.reindexDocument(id)
}

async function handleSearch(): Promise<void> {
  if (!searchQuery.value.trim()) return
  await kbStore.search({ query: searchQuery.value, topK: 10 })
}

function handleToggleSearch(): void {
  showSearchPanel.value = !showSearchPanel.value
  if (!showSearchPanel.value) {
    kbStore.clearSearch()
    searchQuery.value = ''
  }
}

// ─── Helpers ────────────────────────────────────────────────

function formatStatus(status: KbDocument['status']): string {
  switch (status) {
    case 'ready':
      return '就绪'
    case 'indexing':
      return '索引中'
    case 'error':
      return '错误'
    default:
      return status
  }
}

function fileTypeLabel(type: KbDocument['fileType']): string {
  return type.toUpperCase()
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

// ─── DataTable Columns ───────────────────────────────────────

const columns = computed<DataTableColumns<KbDocument>>(() => [
  {
    title: '文件名',
    key: 'fileName',
    ellipsis: { tooltip: true },
  },
  {
    title: '类型',
    key: 'fileType',
    render(row) {
      return h(
        NTag,
        { size: 'small', bordered: false },
        { default: () => fileTypeLabel(row.fileType) },
      )
    },
  },
  {
    title: '分块',
    key: 'chunkCount',
  },
  {
    title: '状态',
    key: 'status',
    render(row) {
      const tagType =
        row.status === 'ready' ? 'success' : row.status === 'indexing' ? 'warning' : 'error'
      const children = [
        h(
          NTag,
          { type: tagType, size: 'small', bordered: false },
          { default: () => formatStatus(row.status) },
        ),
      ]
      if (row.errorMessage) {
        children.push(
          h('div', { class: 'kb-status__error-msg', title: row.errorMessage }, row.errorMessage),
        )
      }
      return h('div', null, children)
    },
  },
  {
    title: '导入时间',
    key: 'createdAt',
    render(row) {
      return formatDate(row.createdAt)
    },
  },
  {
    title: '操作',
    key: 'actions',
    render(row) {
      return h(
        NSpace,
        { size: 4, align: 'center', wrap: false },
        {
          default: () => [
            h(
              NButton,
              {
                quaternary: true,
                circle: true,
                size: 'tiny',
                title: '重新导入',
                disabled: kbStore.importing,
                onClick: () => handleReimport(row.id),
              },
              { icon: () => h(NIcon, null, { default: () => h(RefreshOutlined) }) },
            ),
            h(
              NButton,
              {
                quaternary: true,
                circle: true,
                size: 'tiny',
                title: '生成嵌入',
                disabled: kbStore.isIndexing(row.id) || row.status !== 'ready',
                onClick: () => handleIndex(row.id),
              },
              { icon: () => h(NIcon, null, { default: () => h(ListOutlined) }) },
            ),
            h(
              NButton,
              {
                quaternary: true,
                circle: true,
                size: 'tiny',
                title: '重新索引',
                disabled: kbStore.isIndexing(row.id) || row.status !== 'ready',
                onClick: () => handleReindex(row.id),
              },
              { icon: () => h(NIcon, null, { default: () => h(SyncOutlined) }) },
            ),
            h(
              NButton,
              {
                quaternary: true,
                circle: true,
                size: 'tiny',
                type: 'error',
                title: '删除',
                onClick: () => handleDelete(row.id),
              },
              { icon: () => h(NIcon, null, { default: () => h(DeleteOutlined) }) },
            ),
          ],
        },
      )
    },
  },
])
</script>

<template>
  <div class="kb-view">
    <!-- Header -->
    <header class="kb-view__header">
      <NButton circle quaternary size="small" title="返回对话" @click="handleBack">
        <template #icon>
          <NIcon>
            <ArrowLeftOutlined />
          </NIcon>
        </template>
      </NButton>
      <h1 class="kb-view__title">知识库管理</h1>
      <span v-if="statsText" class="kb-view__stats">{{ statsText }}</span>
    </header>

    <!-- Toolbar -->
    <div class="kb-view__toolbar">
      <NButton type="primary" :disabled="kbStore.importing" @click="showImportDialog = true">
        <template #icon>
          <NIcon>
            <AddOutlined />
          </NIcon>
        </template>
        {{ kbStore.importing ? '导入中...' : '导入文档' }}
      </NButton>
      <NButton :type="showSearchPanel ? 'primary' : 'default'" @click="handleToggleSearch">
        <template #icon>
          <NIcon>
            <SearchOutlined />
          </NIcon>
        </template>
        {{ showSearchPanel ? '收起搜索' : '语义搜索' }}
      </NButton>
    </div>

    <!-- Search Panel -->
    <div v-if="showSearchPanel" class="kb-search">
      <div class="kb-search__input-row">
        <NInput
          v-model:value="searchQuery"
          placeholder="输入搜索内容..."
          @keydown.enter="handleSearch"
        />
        <NButton
          type="primary"
          :disabled="kbStore.searching || !searchQuery.trim()"
          @click="handleSearch"
        >
          {{ kbStore.searching ? '搜索中...' : '搜索' }}
        </NButton>
      </div>
      <div v-if="kbStore.searchResults.length > 0" class="kb-search__results">
        <div v-for="(result, idx) in kbStore.searchResults" :key="idx" class="kb-search__result">
          <div class="kb-search__result-header">
            <span class="kb-search__result-file">{{ result.fileName }}</span>
            <span class="kb-search__result-score">{{ formatScore(result.score) }}</span>
          </div>
          <p class="kb-search__result-content">{{ result.content }}</p>
        </div>
      </div>
      <div v-else-if="!kbStore.searching && searchQuery" class="kb-search__empty">无搜索结果。请确认文档已完成索引（嵌入生成）。</div>
    </div>

    <!-- Document List -->
    <div class="kb-view__content">
      <div v-if="kbStore.loading" class="kb-view__center">
        <NSpin size="medium" />
      </div>
      <div v-else-if="!hasDocuments" class="kb-view__center">
        <NEmpty description="知识库为空">
          <template #extra>
            <span class="kb-view__empty-hint">点击"导入文档"添加文件</span>
          </template>
        </NEmpty>
      </div>
      <NDataTable
        v-else
        class="kb-view__table"
        :columns="columns"
        :data="kbStore.documents"
        :pagination="false"
        :bordered="false"
        :row-key="(row: KbDocument) => row.id"
      />
    </div>

    <!-- Import Dialog -->
    <NModal
      :show="showImportDialog"
      preset="card"
      title="导入文档"
      :bordered="false"
      :mask-closable="true"
      :style="{ width: '480px', maxWidth: '90vw' }"
      @update:show="showImportDialog = $event"
    >
      <NSpace vertical :size="16">
        <!-- File Selection -->
        <div class="kb-form-group">
          <span class="kb-form-label">文件路径</span>
          <div class="kb-form-file-row">
            <NInput v-model:value="importFilePath" placeholder="点击右侧按钮选择文件" readonly />
            <NButton @click="handleSelectFile">选择</NButton>
          </div>
        </div>

        <!-- File Name -->
        <div class="kb-form-group">
          <span class="kb-form-label">文件名称</span>
          <NInput v-model:value="importFileName" placeholder="文件名称" />
        </div>

        <!-- File Type -->
        <div class="kb-form-group">
          <span class="kb-form-label">文件类型</span>
          <NSelect v-model:value="importFileType" :options="FILE_TYPE_OPTIONS" />
        </div>

        <!-- Chunking Strategy -->
        <div class="kb-form-group">
          <span class="kb-form-label">分块策略</span>
          <NSelect v-model:value="chunkStrategy" :options="CHUNK_STRATEGY_OPTIONS" />
        </div>

        <!-- Chunk Size / Overlap -->
        <div class="kb-form-row">
          <div class="kb-form-group">
            <span class="kb-form-label">分块大小 (tokens)</span>
            <NInputNumber v-model:value="chunkSize" :min="50" :max="2000" :step="50" />
          </div>
          <div class="kb-form-group">
            <span class="kb-form-label">重叠大小 (tokens)</span>
            <NInputNumber v-model:value="overlap" :min="0" :max="500" :step="10" />
          </div>
        </div>
      </NSpace>

      <template #footer>
        <NSpace justify="end" :size="8">
          <NButton @click="showImportDialog = false">取消</NButton>
          <NButton
            type="primary"
            :disabled="!importFilePath || !importFileName || kbStore.importing"
            @click="handleImport"
          >
            {{ kbStore.importing ? '导入中...' : '导入' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.kb-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--af-bg, #0f172a);
  overflow: hidden;
}

/* ─── Header ──────────────────────────────────── */

.kb-view__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--af-border, #334155);
  background-color: var(--af-bg-surface, #1e293b);
  flex-shrink: 0;
}

.kb-view__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
  margin: 0;
  flex: 1;
}

.kb-view__stats {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  white-space: nowrap;
}

/* ─── Toolbar ─────────────────────────────────── */

.kb-view__toolbar {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--af-border-light, #1f2937);
  flex-shrink: 0;
}

/* ─── Search Panel ────────────────────────────── */

.kb-search {
  padding: 12px 20px;
  border-bottom: 1px solid var(--af-border-light, #1f2937);
  background-color: var(--af-bg-surface, #1e293b);
  flex-shrink: 0;
}

.kb-search__input-row {
  display: flex;
  gap: 8px;
}

.kb-search__results {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.kb-search__result {
  padding: 10px 12px;
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius-sm, 6px);
  background-color: var(--af-bg, #0f172a);
}

.kb-search__result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.kb-search__result-file {
  font-size: 12px;
  font-weight: 600;
  color: var(--af-brand, #818cf8);
}

.kb-search__result-score {
  font-size: 11px;
  color: var(--af-success, #10b981);
  font-weight: 600;
}

.kb-search__result-content {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kb-search__empty {
  margin-top: 12px;
  text-align: center;
  color: var(--af-text-muted, #64748b);
  font-size: 13px;
}

/* ─── Content / Document List ────────────────── */

.kb-view__content {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px;
}

.kb-view__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--af-text-muted, #64748b);
  font-size: 14px;
}

.kb-view__empty-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--af-text-muted, #64748b);
}

.kb-view__table {
  margin-top: 8px;
}

/* ─── Status Error Message ────────────────────── */

.kb-status__error-msg {
  margin-top: 4px;
  font-size: 11px;
  color: var(--af-error, #ef4444);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Form Layout ─────────────────────────────── */

.kb-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.kb-form-row {
  display: flex;
  gap: 12px;
}

.kb-form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-tertiary, #94a3b8);
}

.kb-form-file-row {
  display: flex;
  gap: 8px;
}

.kb-form-file-row :deep(.n-input) {
  flex: 1;
}
</style>
