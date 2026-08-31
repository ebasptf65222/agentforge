// M3: Video Store - Pinia store for AI video generation task state
// 渲染侧维护任务映射，订阅主进程 video:event 异步推送（progress/completed/failed）。
// 提供 generate/cancel/refresh 等动作，供视频消息渲染与设置页任务列表共用。

import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import type { VideoTask, VideoAsyncEvent, VideoConfigView, VideoProvider, CreateVideoTaskParams, VideoSequence, VideoSequenceDetail } from '@shared/types'
import type { VideoCsvParseResult } from '@/types/electron-api'
import { showToast } from '@/utils/toast'

export const useVideoStore = defineStore('video', () => {
  // ─── State ───────────────────────────────────────────────────

  /** 任务映射：taskId → VideoTask */
  const tasks = ref<Record<string, VideoTask>>({})

  /** 多镜头序列映射：sequenceId → VideoSequence */
  const sequences = ref<Record<string, VideoSequence>>({})

  /** 序列详情缓存：sequenceId → VideoSequenceDetail */
  const sequenceDetails = ref<Record<string, VideoSequenceDetail>>({})

  /** 是否在加载任务列表 */
  const loading = ref(false)

  // ─── M10: 批量选择状态 ──────────────────────────────────────

  /** 已勾选的任务 id（批量操作） */
  const selectedTaskIds = ref<string[]>([])

  /** 已勾选的序列 id（批量操作） */
  const selectedSequenceIds = ref<string[]>([])

  /** 事件订阅清理函数 */
  let stopEvent: (() => void) | null = null

  // ─── Getters ─────────────────────────────────────────────────

  /** 任务数组（按创建时间倒序） */
  const list = computed<VideoTask[]>(() =>
    Object.values(tasks.value).sort((a, b) => b.createdAt - a.createdAt),
  )

  /** 多镜头序列数组（按创建时间倒序，仅包含实际序列父记录） */
  const sequenceList = computed<VideoSequence[]>(() =>
    Object.values(sequences.value).sort((a, b) => b.createdAt - a.createdAt),
  )

  /** 进行中（未结束）的任务数量 */
  const activeCount = computed(
    () =>
      list.value.filter((t) => !isTerminal(t.status)).length,
  )

  /** 获取指定任务 */
  function getTask(id: string): VideoTask | null {
    return tasks.value[id] ?? null
  }

  /** 获取指定序列 */
  function getSequence(id: string): VideoSequence | null {
    return sequences.value[id] ?? null
  }

  // ─── M10: 选择 Getters ─────────────────────────────────────

  /** 已选任务数 */
  const selectedTaskCount = computed(() => selectedTaskIds.value.length)

  /** 已选序列数 */
  const selectedSequenceCount = computed(() => selectedSequenceIds.value.length)

  /** 已选总数 */
  const selectedCount = computed(
    () => selectedTaskIds.value.length + selectedSequenceIds.value.length,
  )

  function isTaskSelected(id: string): boolean {
    return selectedTaskIds.value.includes(id)
  }

  function isSequenceSelected(id: string): boolean {
    return selectedSequenceIds.value.includes(id)
  }

  // ─── M10: 选择 Actions ─────────────────────────────────────

  function toggleSelectTask(id: string): void {
    const set = new Set(selectedTaskIds.value)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    selectedTaskIds.value = Array.from(set)
  }

  function toggleSelectSequence(id: string): void {
    const set = new Set(selectedSequenceIds.value)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    selectedSequenceIds.value = Array.from(set)
  }

  /** 批量选中给定任务并清空既有任务选择（配合“全选当前筛选”） */
  function selectAllTasks(ids: string[]): void {
    selectedTaskIds.value = Array.from(new Set(ids))
  }

  /** 批量选中给定序列并清空既有序列选择 */
  function selectAllSequences(ids: string[]): void {
    selectedSequenceIds.value = Array.from(new Set(ids))
  }

  /** 清空全部选择 */
  function clearSelection(): void {
    selectedTaskIds.value = []
    selectedSequenceIds.value = []
  }

  /** 从选择中移除指定任务（通常为操作完毕后） */
  function deselectTasks(ids: string[]): void {
    const set = new Set(selectedTaskIds.value)
    for (const id of ids) set.delete(id)
    selectedTaskIds.value = Array.from(set)
  }

  /** 从选择中移除指定序列（通常为操作完毕后） */
  function deselectSequences(ids: string[]): void {
    const set = new Set(selectedSequenceIds.value)
    for (const id of ids) set.delete(id)
    selectedSequenceIds.value = Array.from(set)
  }

  // ─── Internal ────────────────────────────────────────────────

  function upsert(task: VideoTask): void {
    tasks.value = { ...tasks.value, [task.id]: task }
  }

  function upsertSequence(sequence: VideoSequence): void {
    sequences.value = { ...sequences.value, [sequence.id]: sequence }
  }

  function handleEvent(event: VideoAsyncEvent): void {
    const existing = tasks.value[event.taskId]
    if (!existing) return
    if (event.type === 'progress') {
      upsert({ ...existing, progress: event.progress, status: event.status })
    } else if (event.type === 'completed' && event.outputPath) {
      upsert({ ...existing, status: 'succeeded', progress: 100, outputPath: event.outputPath })
    } else if (event.type === 'failed') {
      upsert({ ...existing, status: 'failed', errorMessage: event.message })
    }
    // 子任务进度/终态会影响父序列聚合状态，周期性刷新序列列表
    void refreshSequences()
  }

  // ─── Actions ─────────────────────────────────────────────────

  /** 生成一段视频任务 */
  async function generate(params: CreateVideoTaskParams): Promise<VideoTask> {
    const task = (await window.electron.video.generate(params)) as VideoTask
    upsert(task)
    return task
  }

  /** 取消在途任务 */
  async function cancel(id: string): Promise<VideoTask | null> {
    const task = (await window.electron.video.cancel(id)) as VideoTask | null
    if (task) {
      upsert(task)
      showToast('视频任务已取消', 'info')
    }
    return task
  }

  /** 重试一个已失败/已取消的任务（M9），返回新建的子任务 */
  async function retry(id: string): Promise<VideoTask> {
    try {
      const task = (await window.electron.video.retry(id)) as VideoTask
      upsert(task)
      showToast('已重新提交视频任务', 'success')
      return task
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 取消一个多镜头序列的全部在途子任务（M9） */
  async function cancelSequence(id: string): Promise<VideoSequence> {
    const seq = (await window.electron.video.cancelSequence(id)) as VideoSequence
    upsertSequence(seq)
    showToast('序列已取消', 'info')
    return seq
  }

  /** 删除一条任务记录及落盘文件（M9） */
  async function deleteTask(id: string): Promise<void> {
    await window.electron.video.deleteTask(id)
    const { [id]: _removed, ...next } = tasks.value
    tasks.value = next as Record<string, VideoTask>
    showToast('已删除视频', 'success')
  }

  /** 删除一个多镜头序列及全部子任务与落盘文件（M9） */
  async function deleteSequence(id: string): Promise<void> {
    await window.electron.video.deleteSequence(id)
    const { [id]: _removed, ...seqNext } = sequences.value
    sequences.value = seqNext as Record<string, VideoSequence>
    const taskNext: Record<string, VideoTask> = {}
    for (const [key, value] of Object.entries(tasks.value)) {
      if (value?.sequenceId !== id) taskNext[key] = value
    }
    tasks.value = taskNext
    showToast('已删除序列', 'success')
  }

  // ─── M10: 批量 Actions ─────────────────────────────────────

  interface BatchResultSlice<T> {
    succeeded: T[]
    failed: Array<{ id: string; message: string }>
  }

  function reportBatch(
    label: string,
    result: BatchResultSlice<unknown>,
    actionable: () => void,
  ): void {
    const ok = result.succeeded.length
    const fail = result.failed.length
    actionable()
    if (fail === 0) {
      showToast(`${label}成功 ${ok} 项`, 'success')
    } else {
      showToast(`${label}完成：成功 ${ok}，失败 ${fail}`, 'warning')
    }
  }

  /** 批量重试已失败/已取消的任务（M10），新建任务 upsert 并保留失败明细 */
  async function batchRetry(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let result: BatchResultSlice<VideoTask> = { succeeded: [], failed: [] }
    try {
      result = (await window.electron.video.retryTasks(ids)) as BatchResultSlice<VideoTask>
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
    reportBatch('已批量重试', result, () => {
      for (const task of result.succeeded) upsert(task)
      deselectTasks(ids)
    })
  }

  /** 批量取消多个进行中的多镜头序列（M10） */
  async function batchCancelSequences(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let result: BatchResultSlice<VideoSequence> = { succeeded: [], failed: [] }
    try {
      result = (await window.electron.video.cancelSequences(ids)) as BatchResultSlice<VideoSequence>
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
    reportBatch('已批量取消序列', result, () => {
      for (const seq of result.succeeded) upsertSequence(seq)
      deselectSequences(ids)
    })
  }

  /** 批量删除任务记录及落盘文件（M10），成功后本地移除 */
  async function batchDeleteTasks(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let result: BatchResultSlice<string> = { succeeded: [], failed: [] }
    try {
      result = (await window.electron.video.deleteTasks(ids)) as BatchResultSlice<string>
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
    reportBatch('已批量删除', result, () => {
      const removed = new Set(result.succeeded)
      const next: Record<string, VideoTask> = {}
      for (const [key, value] of Object.entries(tasks.value)) {
        if (!removed.has(key)) next[key] = value
      }
      tasks.value = next
      deselectTasks(ids)
    })
  }

  /** 批量删除多个序列及其子任务与落盘文件（M10） */
  async function batchDeleteSequences(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let result: BatchResultSlice<string> = { succeeded: [], failed: [] }
    try {
      result = (await window.electron.video.deleteSequences(ids)) as BatchResultSlice<string>
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
    reportBatch('已批量删除序列', result, () => {
      const removed = new Set(result.succeeded)
      const seqNext: Record<string, VideoSequence> = {}
      for (const [key, value] of Object.entries(sequences.value)) {
        if (!removed.has(key)) seqNext[key] = value
      }
      sequences.value = seqNext
      const taskNext: Record<string, VideoTask> = {}
      for (const [key, value] of Object.entries(tasks.value)) {
        if (!removed.has(value?.sequenceId ?? '')) taskNext[key] = value
      }
      tasks.value = taskNext
      deselectSequences(ids)
    })
  }

  // ─── M11: CSV 批量造片 ────────────────────────────────────

  /**
   * 解析本地 CSV 文件为任务行预览（M11）。
   * 表头缺 prompt 列或文件读取失败时向上抛出，由调用方在模态内提示。
   */
  async function parseCsv(filePath: string): Promise<VideoCsvParseResult> {
    try {
      return await window.electron.video.parseCsv(filePath)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 批量生成一组单视频任务（M11 CSV 造片），成功任务 upsert 进视频库 */
  async function batchGenerate(rows: CreateVideoTaskParams[], concurrency?: number): Promise<void> {
    if (rows.length === 0) return
    let result: BatchResultSlice<VideoTask> = { succeeded: [], failed: [] }
    try {
      result = (await window.electron.video.batchGenerate(rows, concurrency)) as BatchResultSlice<VideoTask>
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
    reportBatch('已批量生成', result, () => {
      for (const task of result.succeeded) upsert(task)
    })
  }

  /** 刷新任务列表 */
  async function refresh(limit = 50): Promise<VideoTask[]> {
    loading.value = true
    try {
      const result = (await window.electron.video.list(limit)) as VideoTask[]
      const map: Record<string, VideoTask> = {}
      for (const t of result) map[t.id] = t
      // 合并：保留本地产物、以服务端为准
      tasks.value = { ...tasks.value, ...map }
      return result
    } finally {
      loading.value = false
    }
  }

  /** 刷新多镜头序列列表 */
  async function refreshSequences(limit = 50): Promise<VideoSequence[]> {
    const result = (await window.electron.video.listSequences(limit)) as VideoSequence[]
    const map: Record<string, VideoSequence> = {}
    for (const s of result) map[s.id] = s
    sequences.value = { ...sequences.value, ...map }
    return result
  }

  /** 获取序列详情（含镜头子任务），带本地缓存 */
  async function getSequenceDetail(id: string): Promise<VideoSequenceDetail | null> {
    const cached = sequenceDetails.value[id]
    if (cached) return cached
    const detail = (await window.electron.video.getSequenceDetail(id)) as
      | VideoSequenceDetail
      | null
    if (detail) {
      upsertSequence(detail.sequence)
      sequenceDetails.value = { ...sequenceDetails.value, [id]: detail }
    }
    return detail
  }

  /** 读取配置回显 */
  async function getConfig(): Promise<VideoConfigView> {
    return (await window.electron.video.getConfig()) as VideoConfigView
  }

  /** 初始化：订阅事件流并拉取任务与序列列表 */
  function init(): void {
    if (!stopEvent) {
      stopEvent = window.electron.video.onEvent(handleEvent)
    }
    void refresh()
    void refreshSequences()
  }

  /** 测试指定厂商配置（校验 key 解密与配置完整性） */
  async function testConfig(provider: VideoProvider): Promise<void> {
    await window.electron.video.testConfig(provider)
  }

  onUnmounted(() => {
    stopEvent?.()
    stopEvent = null
  })

  return {
    // State
    tasks,
    sequences,
    loading,
    // Getters
    list,
    sequenceList,
    activeCount,
    getTask,
    getSequence,
    // M10 选择
    selectedTaskIds,
    selectedSequenceIds,
    selectedTaskCount,
    selectedSequenceCount,
    selectedCount,
    isTaskSelected,
    isSequenceSelected,
    toggleSelectTask,
    toggleSelectSequence,
    selectAllTasks,
    selectAllSequences,
    clearSelection,
    deselectTasks,
    deselectSequences,
    // Actions
    generate,
    cancel,
    retry,
    cancelSequence,
    deleteTask,
    deleteSequence,
    batchRetry,
    batchCancelSequences,
    batchDeleteTasks,
    batchDeleteSequences,
    // M11 CSV 批量造片
    parseCsv,
    batchGenerate,
    refresh,
    refreshSequences,
    getSequenceDetail,
    getConfig,
    testConfig,
    init,
  }
})

/** 判断任务是否已结束 */
function isTerminal(status: VideoTask['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}