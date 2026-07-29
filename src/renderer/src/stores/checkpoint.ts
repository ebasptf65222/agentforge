// P2-02: Checkpoint store - manages file snapshot history and rollback state.
// Wraps the electron.checkpoint IPC API and exposes reactive state.

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Checkpoint, CheckpointDiff } from '@shared/types'
import { showToast } from '@/utils/toast'

export const useCheckpointStore = defineStore('checkpoint', () => {
  // ─── State ───────────────────────────────────────────────────

  /** All checkpoints (latest first) */
  const checkpoints = ref<Checkpoint[]>([])

  /** Total count of checkpoints matching the current query */
  const totalCount = ref(0)

  /** Whether the list is loading */
  const loading = ref(false)

  /** Currently selected checkpoint ID (for diff view) */
  const selectedCheckpointId = ref<number | null>(null)

  /** Diff data for the selected checkpoint */
  const diffData = ref<CheckpointDiff | null>(null)

  /** Whether diff is loading */
  const diffLoading = ref(false)

  /** Filter by relative path (empty = all files) */
  const filterPath = ref<string>('')

  /** Filter by execution ID (empty = all executions) */
  const filterExecutionId = ref<string>('')

  /** Pagination offset */
  const offset = ref(0)

  /** Page size */
  const limit = ref(50)

  /** Whether a rollback is in progress */
  const rollingBack = ref(false)

  /** Error message (null if no error) */
  const error = ref<string | null>(null)

  // ─── Computed ────────────────────────────────────────────────

  /** Whether there are any checkpoints */
  const hasCheckpoints = computed(() => checkpoints.value.length > 0)

  /** Whether there are more checkpoints to load */
  const hasMore = computed(() => offset.value + checkpoints.value.length < totalCount.value)

  /** Currently selected checkpoint object */
  const selectedCheckpoint = computed(() =>
    checkpoints.value.find((c) => c.id === selectedCheckpointId.value) ?? null,
  )

  // ─── Actions ─────────────────────────────────────────────────

  /**
   * Load checkpoints from the backend with current filters.
   */
  async function loadCheckpoints(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const params: Record<string, unknown> = {
        limit: limit.value,
        offset: offset.value,
      }
      if (filterPath.value.trim()) {
        params['relativePath'] = filterPath.value.trim()
      }
      if (filterExecutionId.value.trim()) {
        params['executionId'] = filterExecutionId.value.trim()
      }

      const result = await window.electron.checkpoint.list(params)
      checkpoints.value = result.checkpoints
      totalCount.value = result.count
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      showToast(`加载快照列表失败: ${error.value}`, 'error')
    } finally {
      loading.value = false
    }
  }

  /**
   * Load the next page of checkpoints (append).
   */
  async function loadMore(): Promise<void> {
    if (!hasMore.value || loading.value) return
    offset.value += limit.value
    loading.value = true
    try {
      const params: Record<string, unknown> = {
        limit: limit.value,
        offset: offset.value,
      }
      if (filterPath.value.trim()) {
        params['relativePath'] = filterPath.value.trim()
      }
      if (filterExecutionId.value.trim()) {
        params['executionId'] = filterExecutionId.value.trim()
      }

      const result = await window.electron.checkpoint.list(params)
      checkpoints.value.push(...result.checkpoints)
      totalCount.value = result.count
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      showToast(`加载更多快照失败: ${error.value}`, 'error')
    } finally {
      loading.value = false
    }
  }

  /**
   * Load the diff for a specific checkpoint.
   */
  async function loadDiff(checkpointId: number): Promise<void> {
    diffLoading.value = true
    selectedCheckpointId.value = checkpointId
    try {
      diffData.value = await window.electron.checkpoint.diff({ checkpointId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`获取差异失败: ${msg}`, 'error')
      diffData.value = null
    } finally {
      diffLoading.value = false
    }
  }

  /**
   * Clear the diff view.
   */
  function clearDiff(): void {
    diffData.value = null
    selectedCheckpointId.value = null
  }

  /**
   * Rollback to a specific checkpoint.
   * Shows a confirmation toast and reloads the list after success.
   */
  async function rollback(checkpointId: number): Promise<boolean> {
    rollingBack.value = true
    try {
      const result = await window.electron.checkpoint.rollback({ checkpointId })
      if (result.success) {
        showToast(
          `已回滚: ${result.relativePath}（操作: ${result.action}）`,
          'success',
        )
        // Reload the list to reflect changes
        await loadCheckpoints()
        // Clear diff if it was for this checkpoint
        if (selectedCheckpointId.value === checkpointId) {
          clearDiff()
        }
        return true
      } else {
        showToast(`回滚失败: 文件未能恢复`, 'error')
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`回滚失败: ${msg}`, 'error')
      return false
    } finally {
      rollingBack.value = false
    }
  }

  /**
   * Delete a specific checkpoint.
   */
  async function deleteCheckpoint(checkpointId: number): Promise<boolean> {
    try {
      await window.electron.checkpoint.delete({ checkpointId })
      showToast('快照已删除', 'success')
      // Remove from local list
      checkpoints.value = checkpoints.value.filter((c) => c.id !== checkpointId)
      totalCount.value = Math.max(0, totalCount.value - 1)
      // Clear diff if it was for this checkpoint
      if (selectedCheckpointId.value === checkpointId) {
        clearDiff()
      }
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`删除快照失败: ${msg}`, 'error')
      return false
    }
  }

  /**
   * Clean up old checkpoints.
   */
  async function cleanup(retentionDays?: number, keepPerFile?: number): Promise<number> {
    try {
      const params: Record<string, unknown> = {}
      if (retentionDays !== undefined) params['retentionDays'] = retentionDays
      if (keepPerFile !== undefined) params['keepPerFile'] = keepPerFile

      const result = await window.electron.checkpoint.cleanup(params)
      showToast(`已清理 ${result.deleted} 个旧快照`, 'success')
      // Reload the list
      await loadCheckpoints()
      return result.deleted
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`清理快照失败: ${msg}`, 'error')
      return 0
    }
  }

  /**
   * Apply filters and reload.
   */
  async function applyFilters(path: string, executionId: string): Promise<void> {
    filterPath.value = path
    filterExecutionId.value = executionId
    offset.value = 0
    await loadCheckpoints()
  }

  /**
   * Reset filters and reload.
   */
  async function resetFilters(): Promise<void> {
    filterPath.value = ''
    filterExecutionId.value = ''
    offset.value = 0
    await loadCheckpoints()
  }

  /**
   * Refresh the checkpoint list.
   */
  async function refresh(): Promise<void> {
    offset.value = 0
    await loadCheckpoints()
  }

  return {
    // State
    checkpoints,
    totalCount,
    loading,
    selectedCheckpointId,
    diffData,
    diffLoading,
    filterPath,
    filterExecutionId,
    offset,
    limit,
    rollingBack,
    error,
    // Computed
    hasCheckpoints,
    hasMore,
    selectedCheckpoint,
    // Actions
    loadCheckpoints,
    loadMore,
    loadDiff,
    clearDiff,
    rollback,
    deleteCheckpoint,
    cleanup,
    applyFilters,
    resetFilters,
    refresh,
  }
})
