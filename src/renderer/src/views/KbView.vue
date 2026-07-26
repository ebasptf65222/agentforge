<script setup lang="ts">
// P5-04: KbView - Knowledge base management view.
// Provides document import, list, search, and indexing operations.

import { onMounted, ref, computed } from 'vue'
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

function statusClass(status: KbDocument['status']): string {
  switch (status) {
    case 'ready':
      return 'kb-status--ready'
    case 'indexing':
      return 'kb-status--indexing'
    case 'error':
      return 'kb-status--error'
    default:
      return ''
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
</script>

<template>
  <div class="kb-view">
    <!-- Header -->
    <header class="kb-view__header">
      <button class="kb-view__back" title="返回对话" @click="handleBack">
        <span aria-hidden="true">&larr;</span>
      </button>
      <h1 class="kb-view__title">知识库管理</h1>
      <span v-if="statsText" class="kb-view__stats">{{ statsText }}</span>
    </header>

    <!-- Toolbar -->
    <div class="kb-view__toolbar">
      <button
        class="kb-btn kb-btn--primary"
        :disabled="kbStore.importing"
        @click="showImportDialog = true"
      >
        {{ kbStore.importing ? '导入中...' : '+ 导入文档' }}
      </button>
      <button
        class="kb-btn"
        :class="{ 'kb-btn--active': showSearchPanel }"
        @click="handleToggleSearch"
      >
        {{ showSearchPanel ? '收起搜索' : '语义搜索' }}
      </button>
    </div>

    <!-- Search Panel -->
    <div v-if="showSearchPanel" class="kb-search">
      <div class="kb-search__input-row">
        <input
          v-model="searchQuery"
          class="kb-search__input"
          type="text"
          placeholder="输入搜索内容..."
          @keydown.enter="handleSearch"
        />
        <button
          class="kb-btn kb-btn--primary"
          :disabled="kbStore.searching || !searchQuery.trim()"
          @click="handleSearch"
        >
          {{ kbStore.searching ? '搜索中...' : '搜索' }}
        </button>
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
      <div v-else-if="!kbStore.searching && searchQuery" class="kb-search__empty">无搜索结果</div>
    </div>

    <!-- Document List -->
    <div class="kb-view__content">
      <div v-if="kbStore.loading" class="kb-view__loading">加载中...</div>
      <div v-else-if="!hasDocuments" class="kb-view__empty">
        <p>知识库为空</p>
        <p class="kb-view__empty-hint">点击"导入文档"添加文件</p>
      </div>
      <table v-else class="kb-table">
        <thead>
          <tr>
            <th class="kb-table__th">文件名</th>
            <th class="kb-table__th">类型</th>
            <th class="kb-table__th">分块</th>
            <th class="kb-table__th">状态</th>
            <th class="kb-table__th">导入时间</th>
            <th class="kb-table__th">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in kbStore.documents" :key="doc.id" class="kb-table__row">
            <td class="kb-table__td kb-table__td--name" :title="doc.fileName">
              {{ doc.fileName }}
            </td>
            <td class="kb-table__td">
              <span class="kb-file-type">{{ fileTypeLabel(doc.fileType) }}</span>
            </td>
            <td class="kb-table__td">{{ doc.chunkCount }}</td>
            <td class="kb-table__td">
              <span class="kb-status" :class="statusClass(doc.status)">
                {{ formatStatus(doc.status) }}
              </span>
              <div v-if="doc.errorMessage" class="kb-status__error-msg" :title="doc.errorMessage">
                {{ doc.errorMessage }}
              </div>
            </td>
            <td class="kb-table__td">{{ formatDate(doc.createdAt) }}</td>
            <td class="kb-table__td">
              <div class="kb-actions">
                <button
                  class="kb-action-btn"
                  title="重新导入"
                  :disabled="kbStore.importing"
                  @click="handleReimport(doc.id)"
                >
                  &#8635;
                </button>
                <button
                  class="kb-action-btn"
                  title="生成嵌入"
                  :disabled="kbStore.isIndexing(doc.id) || doc.status !== 'ready'"
                  @click="handleIndex(doc.id)"
                >
                  &#9776;
                </button>
                <button
                  class="kb-action-btn"
                  title="重新索引"
                  :disabled="kbStore.isIndexing(doc.id) || doc.status !== 'ready'"
                  @click="handleReindex(doc.id)"
                >
                  &#10227;
                </button>
                <button
                  class="kb-action-btn kb-action-btn--danger"
                  title="删除"
                  @click="handleDelete(doc.id)"
                >
                  &times;
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Import Dialog -->
    <div v-if="showImportDialog" class="kb-modal-overlay" @click.self="showImportDialog = false">
      <div class="kb-modal">
        <div class="kb-modal__header">
          <h2 class="kb-modal__title">导入文档</h2>
          <button class="kb-modal__close" @click="showImportDialog = false">&times;</button>
        </div>
        <div class="kb-modal__body">
          <!-- File Selection -->
          <div class="kb-form-group">
            <label class="kb-form-label">文件路径</label>
            <div class="kb-form-file-row">
              <input
                v-model="importFilePath"
                class="kb-form-input"
                type="text"
                placeholder="点击右侧按钮选择文件"
                readonly
              />
              <button class="kb-btn" @click="handleSelectFile">选择</button>
            </div>
          </div>

          <!-- File Name -->
          <div class="kb-form-group">
            <label class="kb-form-label">文件名称</label>
            <input
              v-model="importFileName"
              class="kb-form-input"
              type="text"
              placeholder="文件名称"
            />
          </div>

          <!-- File Type -->
          <div class="kb-form-group">
            <label class="kb-form-label">文件类型</label>
            <select v-model="importFileType" class="kb-form-select">
              <option v-for="opt in FILE_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Chunking Strategy -->
          <div class="kb-form-group">
            <label class="kb-form-label">分块策略</label>
            <select v-model="chunkStrategy" class="kb-form-select">
              <option value="fixed">固定大小</option>
              <option value="paragraph">按段落</option>
            </select>
          </div>

          <!-- Chunk Size -->
          <div class="kb-form-row">
            <div class="kb-form-group">
              <label class="kb-form-label">分块大小 (tokens)</label>
              <input
                v-model.number="chunkSize"
                class="kb-form-input"
                type="number"
                min="50"
                max="2000"
                step="50"
              />
            </div>
            <div class="kb-form-group">
              <label class="kb-form-label">重叠大小 (tokens)</label>
              <input
                v-model.number="overlap"
                class="kb-form-input"
                type="number"
                min="0"
                max="500"
                step="10"
              />
            </div>
          </div>
        </div>
        <div class="kb-modal__footer">
          <button class="kb-btn" @click="showImportDialog = false">取消</button>
          <button
            class="kb-btn kb-btn--primary"
            :disabled="!importFilePath || !importFileName || kbStore.importing"
            @click="handleImport"
          >
            {{ kbStore.importing ? '导入中...' : '导入' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kb-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: #0f172a;
  overflow: hidden;
}

/* ─── Header ──────────────────────────────────── */

.kb-view__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid #374151;
  background-color: #111827;
  flex-shrink: 0;
}

.kb-view__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  color: #9ca3af;
  cursor: pointer;
  font-size: 18px;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.kb-view__back:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

.kb-view__title {
  font-size: 16px;
  font-weight: 700;
  color: #f9fafb;
  margin: 0;
  flex: 1;
}

.kb-view__stats {
  font-size: 12px;
  color: #9ca3af;
  white-space: nowrap;
}

/* ─── Toolbar ─────────────────────────────────── */

.kb-view__toolbar {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid #1f2937;
  flex-shrink: 0;
}

/* ─── Buttons ─────────────────────────────────── */

.kb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #1f2937;
  color: #d1d5db;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.kb-btn:hover:not(:disabled) {
  background-color: #374151;
  border-color: #4b5563;
  color: #f9fafb;
}

.kb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.kb-btn--primary {
  background-color: #4f46e5;
  border-color: #4f46e5;
  color: #ffffff;
}

.kb-btn--primary:hover:not(:disabled) {
  background-color: #4338ca;
  border-color: #4338ca;
}

.kb-btn--active {
  background-color: #4f46e5;
  border-color: #4f46e5;
  color: #ffffff;
}

/* ─── Search Panel ────────────────────────────── */

.kb-search {
  padding: 12px 20px;
  border-bottom: 1px solid #1f2937;
  background-color: #111827;
  flex-shrink: 0;
}

.kb-search__input-row {
  display: flex;
  gap: 8px;
}

.kb-search__input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #0f172a;
  color: #e5e7eb;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}

.kb-search__input:focus {
  border-color: #4f46e5;
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
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #0f172a;
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
  color: #a78bfa;
}

.kb-search__result-score {
  font-size: 11px;
  color: #10b981;
  font-weight: 600;
}

.kb-search__result-content {
  font-size: 12px;
  color: #9ca3af;
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
  color: #6b7280;
  font-size: 13px;
}

/* ─── Content / Document List ────────────────── */

.kb-view__content {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px;
}

.kb-view__loading,
.kb-view__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6b7280;
  font-size: 14px;
}

.kb-view__empty-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #4b5563;
}

/* ─── Table ───────────────────────────────────── */

.kb-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}

.kb-table__th {
  text-align: left;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  border-bottom: 1px solid #374151;
  white-space: nowrap;
}

.kb-table__row {
  border-bottom: 1px solid #1f2937;
  transition: background-color 0.1s ease;
}

.kb-table__row:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.kb-table__td {
  padding: 10px 12px;
  font-size: 13px;
  color: #d1d5db;
  vertical-align: middle;
}

.kb-table__td--name {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── File Type Badge ─────────────────────────── */

.kb-file-type {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background-color: #1f2937;
  color: #9ca3af;
}

/* ─── Status Badge ────────────────────────────── */

.kb-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.kb-status--ready {
  background-color: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.kb-status--indexing {
  background-color: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.kb-status--error {
  background-color: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.kb-status__error-msg {
  margin-top: 4px;
  font-size: 11px;
  color: #ef4444;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Action Buttons ──────────────────────────── */

.kb-actions {
  display: flex;
  gap: 4px;
}

.kb-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #374151;
  border-radius: 4px;
  background-color: transparent;
  color: #9ca3af;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.kb-action-btn:hover:not(:disabled) {
  background-color: #374151;
  border-color: #4b5563;
  color: #e5e7eb;
}

.kb-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.kb-action-btn--danger:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
  color: #ef4444;
}

/* ─── Modal ───────────────────────────────────── */

.kb-modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.kb-modal {
  width: 480px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background-color: #111827;
  border: 1px solid #374151;
  border-radius: 12px;
  overflow: hidden;
}

.kb-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #374151;
}

.kb-modal__title {
  font-size: 16px;
  font-weight: 700;
  color: #f9fafb;
  margin: 0;
}

.kb-modal__close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  color: #9ca3af;
  font-size: 20px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.kb-modal__close:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

.kb-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kb-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #374151;
}

/* ─── Form Elements ───────────────────────────── */

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
  color: #9ca3af;
}

.kb-form-input,
.kb-form-select {
  padding: 8px 12px;
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #0f172a;
  color: #e5e7eb;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}

.kb-form-input:focus,
.kb-form-select:focus {
  border-color: #4f46e5;
}

.kb-form-input:read-only {
  cursor: default;
}

.kb-form-select {
  cursor: pointer;
}

.kb-form-file-row {
  display: flex;
  gap: 8px;
}

.kb-form-file-row .kb-form-input {
  flex: 1;
}
</style>
