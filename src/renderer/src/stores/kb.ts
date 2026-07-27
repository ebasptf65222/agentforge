// P5-04: KbStore - Pinia store for knowledge base management.
// Wraps the electron.kb IPC API and exposes reactive state for the UI.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { KbDocument, SearchResult, KbStats, ImportResult } from '@shared/types'
import type { KbImportParams, KbSearchParams, KbIndexParams } from '@/types/electron-api'
import { showToast } from '@/utils/toast'

export const useKbStore = defineStore('kb', () => {
  // ─── State ───────────────────────────────────────────────────

  /** All documents in the knowledge base. */
  const documents = ref<KbDocument[]>([])

  /** KB statistics. */
  const stats = ref<KbStats | null>(null)

  /** Whether a list request is in flight. */
  const loading = ref(false)

  /** Whether an import is in progress. */
  const importing = ref(false)

  /** Whether an index/reindex operation is in progress (keyed by documentId).
   *  OPT-09: 使用 ref<string[]> 替代 ref<Set<string>>，
   *  因为 Vue 3 对 Set 的响应式追踪有限（add/delete 不触发更新）。
   */
  const indexing = ref<string[]>([])

  /** Semantic search results. */
  const searchResults = ref<SearchResult[]>([])

  /** Whether a search is in progress. */
  const searching = ref(false)

  // ─── Actions ─────────────────────────────────────────────────

  /** Load all documents from the main process. */
  async function loadDocuments(): Promise<void> {
    loading.value = true
    try {
      documents.value = await window.electron.kb.list()
    } catch {
      showToast('加载文档列表失败', 'error')
    } finally {
      loading.value = false
    }
  }

  /** Load KB statistics. */
  async function loadStats(): Promise<void> {
    try {
      stats.value = await window.electron.kb.stats()
    } catch (error) {
      console.error('[KbStore] Failed to load stats:', error)
    }
  }

  /** Import a document into the knowledge base. */
  async function importDocument(params: KbImportParams): Promise<ImportResult | null> {
    importing.value = true
    try {
      const result = await window.electron.kb.import(params)
      showToast(`文档 "${result.fileName}" 导入成功，共 ${result.chunkCount} 个分块`, 'success')
      await Promise.all([loadDocuments(), loadStats()])
      return result
    } catch (error) {
      const message = getErrorMessage(error)
      showToast(`导入失败: ${message}`, 'error')
      return null
    } finally {
      importing.value = false
    }
  }

  /** Delete a document and its chunks. */
  async function deleteDocument(id: string): Promise<void> {
    try {
      await window.electron.kb.delete(id)
      showToast('文档已删除', 'success')
      await Promise.all([loadDocuments(), loadStats()])
    } catch (error) {
      const message = getErrorMessage(error)
      showToast(`删除失败: ${message}`, 'error')
    }
  }

  /** Reimport a document (re-parse and re-chunk). */
  async function reimportDocument(id: string): Promise<void> {
    try {
      const result = await window.electron.kb.reimport({ id })
      showToast(`重新导入成功，共 ${result.chunkCount} 个分块`, 'success')
      await loadDocuments()
    } catch (error) {
      const message = getErrorMessage(error)
      showToast(`重新导入失败: ${message}`, 'error')
    }
  }

  /** Generate embeddings for a document. */
  async function indexDocument(id: string, batchSize?: number): Promise<void> {
    // OPT-09: 使用数组 push/filter 保证响应式
    if (!indexing.value.includes(id)) {
      indexing.value = [...indexing.value, id]
    }
    try {
      const params: KbIndexParams = { id }
      if (batchSize !== undefined) params.batchSize = batchSize
      const count = await window.electron.kb.index(params)
      if (count === 0) {
        showToast('所有分块已有嵌入，无需重新索引', 'info')
      } else {
        showToast(`索引完成，已生成 ${count} 个嵌入`, 'success')
      }
      await loadStats()
    } catch (error) {
      const message = getErrorMessage(error)
      showToast(`索引失败: ${message}`, 'error')
    } finally {
      indexing.value = indexing.value.filter((docId) => docId !== id)
    }
  }

  /** Reindex a document (force regenerate all embeddings). */
  async function reindexDocument(id: string): Promise<void> {
    // OPT-09: 使用数组 push/filter 保证响应式
    if (!indexing.value.includes(id)) {
      indexing.value = [...indexing.value, id]
    }
    try {
      const count = await window.electron.kb.reindex({ id })
      showToast(`重新索引完成，已生成 ${count} 个嵌入`, 'success')
      await loadStats()
    } catch (error) {
      const message = getErrorMessage(error)
      showToast(`重新索引失败: ${message}`, 'error')
    } finally {
      indexing.value = indexing.value.filter((docId) => docId !== id)
    }
  }

  /** Semantic search the knowledge base. */
  async function search(params: KbSearchParams): Promise<void> {
    searching.value = true
    try {
      searchResults.value = await window.electron.kb.search(params)
    } catch (error) {
      const message = getErrorMessage(error)
      showToast(`搜索失败: ${message}`, 'error')
      searchResults.value = []
    } finally {
      searching.value = false
    }
  }

  /** Clear search results. */
  function clearSearch(): void {
    searchResults.value = []
  }

  /** Check if a document is currently being indexed. */
  function isIndexing(id: string): boolean {
    return indexing.value.includes(id)
  }

  return {
    // State
    documents,
    stats,
    loading,
    importing,
    searching,
    searchResults,
    // Actions
    loadDocuments,
    loadStats,
    importDocument,
    deleteDocument,
    reimportDocument,
    indexDocument,
    reindexDocument,
    search,
    clearSearch,
    isIndexing,
  }
})

// ─── Helpers ────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as Record<string, unknown>)['message'])
  }
  return String(error)
}
