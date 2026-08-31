// M3: Video Store - Pinia store for AI video generation task state
// 渲染侧维护任务映射，订阅主进程 video:event 异步推送（progress/completed/failed）。
// 提供 generate/cancel/refresh 等动作，供视频消息渲染与设置页任务列表共用。

import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import type { VideoTask, VideoAsyncEvent, VideoConfigView, VideoProvider, CreateVideoTaskParams, VideoSequence, VideoSequenceDetail } from '@shared/types'
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
    // Actions
    generate,
    cancel,
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