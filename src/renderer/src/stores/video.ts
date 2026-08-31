// M3: Video Store - Pinia store for AI video generation task state
// 渲染侧维护任务映射，订阅主进程 video:event 异步推送（progress/completed/failed）。
// 提供 generate/cancel/refresh 等动作，供视频消息渲染与设置页任务列表共用。

import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import type { VideoTask, VideoAsyncEvent, VideoConfigView, VideoProvider, CreateVideoTaskParams, VideoSequence, VideoSequenceDetail, VideoRoutingConfig, VideoRoutingLogEntry, VideoStatsOverview, VideoQueueSnapshot, VideoExportAssetsResult, VideoTrashPurgeResult, VideoSchedule, VideoScheduleRun, CreateVideoScheduleParams, UpdateVideoScheduleParams, VideoPostprocessRun, VideoPostprocessResult, VideoSubtitleParams, VideoWatermarkParams, VideoConcatParams, VideoRenameParams, VideoTemplate, CreateVideoTemplateParams, UpdateVideoTemplateParams, VideoBillingOverview } from '@shared/types'
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

  // ─── M15: 跨厂商智能路由状态 ──────────────────────────────────

  /** 路由配置 */
  const routingConfig = ref<VideoRoutingConfig | null>(null)
  /** 路由决策日志 */
  const routingLogs = ref<VideoRoutingLogEntry[]>([])
  /** 路由加载中 */
  const routingLoading = ref(false)

  // ─── M10: 批量选择状态 ──────────────────────────────────────

  /** 已勾选的任务 id（批量操作） */
  const selectedTaskIds = ref<string[]>([])

  /** 已勾选的序列 id（批量操作） */
  const selectedSequenceIds = ref<string[]>([])

  // ─── M12: 生成历史统计 ──────────────────────────────────────

  /** 统计总览缓存 */
  const stats = ref<VideoStatsOverview | null>(null)
  /** 统计加载中 */
  const statsLoading = ref(false)
  /** 当前统计时间范围（天） */
  const statsDays = ref(30)

  // ─── M13: 生成队列 ──────────────────────────────────────────

  /** 队列快照缓存 */
  const queue = ref<VideoQueueSnapshot | null>(null)

  // ─── M14: 回收站 ────────────────────────────────────────────

  /** 回收站中的任务列表 */
  const trashTasks = ref<VideoTask[]>([])
  /** 回收站中的序列列表 */
  const trashSequences = ref<VideoSequence[]>([])
  /** 是否在加载回收站 */
  const trashLoading = ref(false)

  // ─── M17: 视频批量调度状态 ──────────────────────────────────

  /** 视频批量调度列表 */
  const schedules = ref<VideoSchedule[]>([])
  /** 调度加载中 */
  const schedulesLoading = ref(false)
  /** 当前查看历史的调度 id */
  const scheduleHistoryId = ref<string | null>(null)
  /** 当前调度执行历史 */
  const scheduleHistory = ref<VideoScheduleRun[]>([])

  // ─── M18: 成片后处理状态 ────────────────────────────────────

  /** 后处理执行记录 */
  const postprocessRuns = ref<VideoPostprocessRun[]>([])
  /** 后处理执行中 */
  const postprocessing = ref(false)

  // ─── M19: 分镜模板库状态 ────────────────────────────────────

  /** 分镜/序列模板列表 */
  const templates = ref<VideoTemplate[]>([])
  /** 模板加载中 */
  const templatesLoading = ref(false)

  // ─── M20: 成本与用量计费状态 ────────────────────────────────

  /** 计费总览缓存 */
  const billing = ref<VideoBillingOverview | null>(null)
  /** 计费加载中 */
  const billingLoading = ref(false)
  /** 当前计费时间范围（天） */
  const billingDays = ref(30)

  /** 事件订阅清理函数 */
  let stopEvent: (() => void) | null = null
  let stopScheduleCompleted: (() => void) | null = null
  let stopScheduleDisabled: (() => void) | null = null

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
    // M13：队列随事件刷新（终态释放并发槽位、任务进出队列）
    void refreshQueue()
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
    showToast('已移入回收站', 'success')
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
    showToast('序列已移入回收站', 'success')
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
    reportBatch('已批量移入回收站', result, () => {
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
    reportBatch('已批量移入回收站序列', result, () => {
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

  // ─── M12: 统计 Actions ─────────────────────────────────────

  /** 拉取生成历史统计（days 缺省沿用上次范围，默认 30） */
  async function fetchStats(days?: number): Promise<VideoStatsOverview> {
    const range = days ?? statsDays.value
    statsDays.value = range
    statsLoading.value = true
    try {
      const result = (await window.electron.video.stats(range)) as VideoStatsOverview
      stats.value = result
      return result
    } finally {
      statsLoading.value = false
    }
  }

  /** 导出统计 CSV 报表（弹出保存对话框）；用户取消不打扰 */
  async function exportStatsCsv(days?: number): Promise<boolean> {
    try {
      const result = await window.electron.video.exportStats(days ?? statsDays.value)
      if (result && typeof result === 'object' && 'canceled' in result && result.canceled) {
        return false
      }
      const path =
        result && typeof result === 'object' && 'path' in result
          ? String(result.path)
          : ''
      showToast(`统计报表已导出：${path}`, 'success')
      return true
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  // ─── M13: 队列 Actions ─────────────────────────────────────

  /** 拉取队列快照 */
  async function refreshQueue(): Promise<VideoQueueSnapshot | null> {
    try {
      queue.value = (await window.electron.video.queue()) as VideoQueueSnapshot
    } catch {
      // 队列快照拉取失败不打扰用户，保留上次快照
    }
    return queue.value
  }

  /** 暂停队列出队 */
  async function pauseQueue(): Promise<void> {
    queue.value = (await window.electron.video.queuePause()) as VideoQueueSnapshot
    showToast('队列已暂停，进行中的任务不受影响', 'info')
  }

  /** 恢复队列出队 */
  async function resumeQueue(): Promise<void> {
    queue.value = (await window.electron.video.queueResume()) as VideoQueueSnapshot
    showToast('队列已恢复', 'success')
  }

  /** 设置队列并发上限（1–10） */
  async function setQueueConcurrency(limit: number): Promise<void> {
    queue.value = (await window.electron.video.queueConcurrency(limit)) as VideoQueueSnapshot
  }

  // ─── M14: 资产管理 Actions ─────────────────────────────────

  /** 设置任务收藏标记，成功后本地同步 */
  async function setFavorite(id: string, favorite: boolean): Promise<void> {
    try {
      const task = (await window.electron.video.setFavorite(id, favorite)) as VideoTask | null
      if (task) upsert(task)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 整体覆盖任务标签，成功后本地同步 */
  async function setTags(id: string, tags: string[]): Promise<void> {
    try {
      const task = (await window.electron.video.setTags(id, tags)) as VideoTask | null
      if (task) upsert(task)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 拉取回收站快照 */
  async function fetchTrash(): Promise<void> {
    trashLoading.value = true
    try {
      const snapshot = await window.electron.video.trash()
      trashTasks.value = (snapshot as { tasks: VideoTask[] }).tasks ?? []
      trashSequences.value = (snapshot as { sequences: VideoSequence[] }).sequences ?? []
    } finally {
      trashLoading.value = false
    }
  }

  /** 从回收站恢复任务/序列，并刷新主列表 */
  async function restore(type: 'task' | 'sequence', id: string): Promise<void> {
    try {
      await window.electron.video.restore(type, id)
      trashTasks.value = trashTasks.value.filter((t) => t.id !== id)
      trashSequences.value = trashSequences.value.filter((s) => s.id !== id)
      await Promise.all([refresh(), refreshSequences()])
      showToast('已恢复', 'success')
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 彻底删除回收站中的任务/序列（含落盘文件） */
  async function purge(type: 'task' | 'sequence', id: string): Promise<void> {
    try {
      await window.electron.video.purge(type, id)
      trashTasks.value = trashTasks.value.filter((t) => t.id !== id)
      trashSequences.value = trashSequences.value.filter((s) => s.id !== id)
      showToast('已彻底删除', 'success')
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 清空回收站 */
  async function emptyTrash(): Promise<VideoTrashPurgeResult> {
    try {
      const result = (await window.electron.video.emptyTrash()) as VideoTrashPurgeResult
      trashTasks.value = []
      trashSequences.value = []
      showToast(`回收站已清空（任务 ${result.tasks}，序列 ${result.sequences}）`, 'success')
      return result
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
  }

  /** 批量导出成品视频到所选目录；用户取消返回 false */
  async function exportAssets(taskIds: string[], sequenceIds: string[]): Promise<boolean> {
    try {
      const result = (await window.electron.video.exportAssets(
        taskIds,
        sequenceIds,
      )) as VideoExportAssetsResult
      if (result && typeof result === 'object' && 'canceled' in result && result.canceled) {
        return false
      }
      const ok =
        result && typeof result === 'object' && 'exported' in result ? result : null
      if (ok) {
        const skipNote = ok.skipped.length > 0 ? `，跳过 ${ok.skipped.length} 项` : ''
        showToast(`已导出 ${ok.exported} 个视频到 ${ok.targetDir}${skipNote}`, 'success')
        deselectTasks(taskIds)
        deselectSequences(sequenceIds)
      }
      return true
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      throw error
    }
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

  /** 初始化：订阅事件流并拉取任务、序列与队列快照 */
  function init(): void {
    if (!stopEvent) {
      stopEvent = window.electron.video.onEvent(handleEvent)
    }
    if (!stopScheduleCompleted) {
      stopScheduleCompleted = window.electron.video.onScheduleCompleted(() => {
        void fetchSchedules()
      })
    }
    if (!stopScheduleDisabled) {
      stopScheduleDisabled = window.electron.video.onScheduleDisabled(() => {
        void fetchSchedules()
        showToast('定时批量任务因连续失败已被自动禁用', 'warning')
      })
    }
    void refresh()
    void refreshSequences()
    void refreshQueue()
    void fetchSchedules()
    void fetchTemplates()
  }

  /** 测试指定厂商配置（校验 key 解密与配置完整性） */
  async function testConfig(provider: VideoProvider): Promise<void> {
    await window.electron.video.testConfig(provider)
  }

  // ─── M15: 跨厂商智能路由 actions ─────────────────────────────

  /** 读取路由配置 */
  async function fetchRoutingConfig(): Promise<VideoRoutingConfig | null> {
    routingLoading.value = true
    try {
      const cfg = await window.electron.video.getRoutingConfig()
      routingConfig.value = cfg
      return cfg
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    } finally {
      routingLoading.value = false
    }
  }

  /** 更新路由配置（持久化 + 同步引擎） */
  async function updateRoutingConfig(
    config: VideoRoutingConfig,
  ): Promise<VideoRoutingConfig | null> {
    try {
      const normalized = await window.electron.video.setRoutingConfig(config)
      routingConfig.value = normalized
      return normalized
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    }
  }

  /** 读取路由决策日志 */
  async function fetchRoutingLogs(limit?: number): Promise<void> {
    try {
      routingLogs.value = await window.electron.video.getRoutingLogs(limit)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  /** 清空路由决策日志 */
  async function clearRoutingLogs(): Promise<void> {
    try {
      await window.electron.video.clearRoutingLogs()
      routingLogs.value = []
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  // ─── M17: 视频批量调度 actions ───────────────────────────────

  /** 拉取调度列表 */
  async function fetchSchedules(limit?: number): Promise<void> {
    schedulesLoading.value = true
    try {
      schedules.value = await window.electron.video.scheduleList(limit)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    } finally {
      schedulesLoading.value = false
    }
  }

  /** 创建调度 */
  async function createSchedule(params: CreateVideoScheduleParams): Promise<VideoSchedule | null> {
    try {
      const schedule = await window.electron.video.scheduleCreate(params)
      await fetchSchedules()
      showToast(`已创建定时批量任务「${schedule.name}」`, 'success')
      return schedule
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    }
  }

  /** 更新调度 */
  async function updateSchedule(
    id: string,
    params: UpdateVideoScheduleParams,
  ): Promise<VideoSchedule | null> {
    try {
      const schedule = await window.electron.video.scheduleUpdate(id, params)
      await fetchSchedules()
      showToast('定时批量任务已更新', 'success')
      return schedule
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    }
  }

  /** 启停调度 */
  async function toggleSchedule(id: string, enabled: boolean): Promise<void> {
    try {
      await window.electron.video.scheduleToggle(id, enabled)
      await fetchSchedules()
      showToast(enabled ? '定时任务已启用' : '定时任务已停用', 'info')
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  /** 删除调度 */
  async function deleteSchedule(id: string): Promise<void> {
    try {
      await window.electron.video.scheduleDelete(id)
      schedules.value = schedules.value.filter((s) => s.id !== id)
      if (scheduleHistoryId.value === id) {
        scheduleHistoryId.value = null
        scheduleHistory.value = []
      }
      showToast('定时任务已删除', 'success')
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  /** 手动触发一次调度 */
  async function runScheduleNow(id: string): Promise<void> {
    try {
      const run = await window.electron.video.scheduleRunNow(id)
      showToast(run ? `已触发定时任务，提交 ${run.taskCount} 个任务` : '任务已触发（排队中）', 'success')
      await fetchSchedules()
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  /** 拉取调度执行历史 */
  async function fetchScheduleHistory(id: string, limit?: number): Promise<void> {
    scheduleHistoryId.value = id
    try {
      scheduleHistory.value = await window.electron.video.scheduleHistory(id, limit)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  // ─── M18: 成片后处理 actions ────────────────────────────────

  /** 拉取后处理执行记录 */
  async function fetchPostprocessRuns(limit?: number): Promise<void> {
    try {
      postprocessRuns.value = await window.electron.video.postprocessRuns(limit)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  /** 执行后处理并反馈结果；成功返回 run，失败返回 null */
  async function runPostprocess(
    fn: () => Promise<VideoPostprocessResult>,
    successMsg: string,
  ): Promise<boolean> {
    postprocessing.value = true
    try {
      const result = await fn()
      await fetchPostprocessRuns()
      if (result.ok) {
        showToast(successMsg, 'success')
        return true
      }
      showToast(result.message || '后处理失败', 'warning')
      return false
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return false
    } finally {
      postprocessing.value = false
    }
  }

  /** 字幕烧录 */
  function postprocessSubtitle(params: VideoSubtitleParams): Promise<boolean> {
    return runPostprocess(
      () => window.electron.video.postprocessSubtitle(params),
      '字幕已烧录到成片',
    )
  }

  /** 水印叠加 */
  function postprocessWatermark(params: VideoWatermarkParams): Promise<boolean> {
    return runPostprocess(
      () => window.electron.video.postprocessWatermark(params),
      '水印已叠加到成片',
    )
  }

  /** 多视频拼接 */
  function postprocessConcat(params: VideoConcatParams): Promise<boolean> {
    return runPostprocess(
      () => window.electron.video.postprocessConcat(params),
      '成片拼接完成',
    )
  }

  /** 重命名成品 */
  function postprocessRename(params: VideoRenameParams): Promise<boolean> {
    return runPostprocess(
      () => window.electron.video.postprocessRename(params),
      '成片已重命名',
    )
  }

  /** 归档成品 */
  function postprocessArchive(taskIds: string[]): Promise<boolean> {
    return runPostprocess(
      () => window.electron.video.postprocessArchive({ taskIds }),
      `已归档 ${taskIds.length} 个成片`,
    )
  }

  // ─── M19: 分镜模板库 actions ────────────────────────────────

  /** 拉取模板列表 */
  async function fetchTemplates(limit?: number): Promise<void> {
    templatesLoading.value = true
    try {
      templates.value = await window.electron.video.templateList(limit)
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    } finally {
      templatesLoading.value = false
    }
  }

  /** 创建模板 */
  async function createTemplate(params: CreateVideoTemplateParams): Promise<VideoTemplate | null> {
    try {
      const template = await window.electron.video.templateCreate(params)
      await fetchTemplates()
      showToast(`已保存模板「${template.name}」`, 'success')
      return template
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    }
  }

  /** 更新模板 */
  async function updateTemplate(
    id: string,
    params: UpdateVideoTemplateParams,
  ): Promise<VideoTemplate | null> {
    try {
      const template = await window.electron.video.templateUpdate(id, params)
      await fetchTemplates()
      showToast('模板已更新', 'success')
      return template
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    }
  }

  /** 删除模板 */
  async function deleteTemplate(id: string): Promise<void> {
    try {
      await window.electron.video.templateDelete(id)
      templates.value = templates.value.filter((t) => t.id !== id)
      showToast('模板已删除', 'success')
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
    }
  }

  /** 按模板一键生成视频 */
  async function generateFromTemplate(
    id: string,
    providerOverride?: VideoProvider,
  ): Promise<boolean> {
    try {
      const result = await window.electron.video.templateGenerate(id, providerOverride)
      if (result && result.taskIds && result.taskIds.length > 0) {
        showToast(`已按模板提交 ${result.taskIds.length} 个视频任务`, 'success')
        return true
      }
      showToast('模板任务已提交', 'success')
      return true
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return false
    }
  }

  // ─── M20: 成本与用量计费 actions ────────────────────────────

  /** 拉取计费总览 */
  async function fetchBilling(days?: number): Promise<VideoBillingOverview | null> {
    const range = days ?? billingDays.value
    billingDays.value = range
    billingLoading.value = true
    try {
      billing.value = await window.electron.video.billing(range)
      return billing.value
    } catch (error) {
      showToast(String((error as { message?: unknown })?.message ?? error), 'error')
      return null
    } finally {
      billingLoading.value = false
    }
  }

  onUnmounted(() => {
    stopEvent?.()
    stopEvent = null
    stopScheduleCompleted?.()
    stopScheduleCompleted = null
    stopScheduleDisabled?.()
    stopScheduleDisabled = null
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
    // M12 生成历史统计
    stats,
    statsLoading,
    statsDays,
    fetchStats,
    exportStatsCsv,
    // M13 生成队列
    queue,
    refreshQueue,
    pauseQueue,
    resumeQueue,
    setQueueConcurrency,
    // M14 资产管理
    trashTasks,
    trashSequences,
    trashLoading,
    setFavorite,
    setTags,
    fetchTrash,
    restore,
    purge,
    emptyTrash,
    exportAssets,
    refresh,
    refreshSequences,
    getSequenceDetail,
    getConfig,
    testConfig,
    init,
    // M15 智能路由
    routingConfig,
    routingLogs,
    routingLoading,
    fetchRoutingConfig,
    updateRoutingConfig,
    fetchRoutingLogs,
    clearRoutingLogs,
    // M17 视频批量调度
    schedules,
    schedulesLoading,
    scheduleHistoryId,
    scheduleHistory,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    toggleSchedule,
    deleteSchedule,
    runScheduleNow,
    fetchScheduleHistory,
    // M18 成片后处理
    postprocessRuns,
    postprocessing,
    fetchPostprocessRuns,
    postprocessSubtitle,
    postprocessWatermark,
    postprocessConcat,
    postprocessRename,
    postprocessArchive,
    // M19 分镜模板库
    templates,
    templatesLoading,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    generateFromTemplate,
    // M20 成本与用量计费
    billing,
    billingLoading,
    billingDays,
    fetchBilling,
  }
})

/** 判断任务是否已结束 */
function isTerminal(status: VideoTask['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}