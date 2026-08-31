// M3: Video Store - Pinia store for AI video generation task state
// 渲染侧维护任务映射，订阅主进程 video:event 异步推送（progress/completed/failed）。
// 提供 generate/cancel/refresh 等动作，供视频消息渲染与设置页任务列表共用。

import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import type { VideoTask, VideoAsyncEvent, VideoConfigView, VideoProvider, CreateVideoTaskParams } from '@shared/types'
import { showToast } from '@/utils/toast'

export const useVideoStore = defineStore('video', () => {
  // ─── State ───────────────────────────────────────────────────

  /** 任务映射：taskId → VideoTask */
  const tasks = ref<Record<string, VideoTask>>({})

  /** 是否在加载任务列表 */
  const loading = ref(false)

  /** 事件订阅清理函数 */
  let stopEvent: (() => void) | null = null

  // ─── Getters ─────────────────────────────────────────────────

  /** 任务数组（按创建时间倒序） */
  const list = computed<VideoTask[]>(() =>
    Object.values(tasks.value).sort((a, b) => b.createdAt - a.createdAt),
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

  // ─── Internal ────────────────────────────────────────────────

  function upsert(task: VideoTask): void {
    tasks.value = { ...tasks.value, [task.id]: task }
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

  /** 读取配置回显 */
  async function getConfig(): Promise<VideoConfigView> {
    return (await window.electron.video.getConfig()) as VideoConfigView
  }

  /** 初始化：订阅事件流并拉取任务列表 */
  function init(): void {
    if (!stopEvent) {
      stopEvent = window.electron.video.onEvent(handleEvent)
    }
    void refresh()
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
    loading,
    // Getters
    list,
    activeCount,
    getTask,
    // Actions
    generate,
    cancel,
    refresh,
    getConfig,
    testConfig,
    init,
  }
})

/** 判断任务是否已结束 */
function isTerminal(status: VideoTask['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}