// Scheduler Store - 定时任务管理 Pinia store

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  ScheduledTask,
  ScheduledTaskRun,
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
  ScheduleType,
  TaskRunStatus,
} from '@shared/types'
import { showToast } from '@/utils/toast'

export const useSchedulerStore = defineStore('scheduler', () => {
  // ─── State ───────────────────────────────────────────────────

  const tasks = ref<ScheduledTask[]>([])
  const loading = ref(false)
  const recentRuns = ref<ScheduledTaskRun[]>([])
  const selectedTaskHistory = ref<ScheduledTaskRun[]>([])

  // ─── Getters ─────────────────────────────────────────────────

  const enabledTasks = computed(() => tasks.value.filter((t) => t.enabled))
  const disabledTasks = computed(() => tasks.value.filter((t) => !t.enabled))
  const runningTasks = computed(() => tasks.value.filter((t) => t.runningAtMs !== null))
  const errorTasks = computed(() => tasks.value.filter((t) => t.errorCount > 0))

  // ─── Actions ─────────────────────────────────────────────────

  /** 加载所有定时任务 */
  async function loadTasks(): Promise<void> {
    loading.value = true
    try {
      tasks.value = await window.electron.scheduler.list()
    } catch (error) {
      console.error('[SchedulerStore] loadTasks failed:', error)
      showToast('加载定时任务列表失败', 'error')
    } finally {
      loading.value = false
    }
  }

  /** 创建定时任务 */
  async function createTask(
    params: CreateScheduledTaskParams,
  ): Promise<ScheduledTask | undefined> {
    try {
      const task = await window.electron.scheduler.create(params)
      tasks.value.unshift(task)
      showToast('定时任务创建成功', 'success')
      return task
    } catch (error) {
      console.error('[SchedulerStore] createTask failed:', error)
      showToast('创建定时任务失败', 'error')
      throw error
    }
  }

  /** 更新定时任务 */
  async function updateTask(
    id: string,
    params: UpdateScheduledTaskParams,
  ): Promise<ScheduledTask | undefined> {
    try {
      const updated = await window.electron.scheduler.update({ id, ...params })
      const idx = tasks.value.findIndex((t) => t.id === id)
      if (idx >= 0) {
        tasks.value[idx] = updated
      }
      showToast('定时任务已更新', 'success')
      return updated
    } catch (error) {
      console.error('[SchedulerStore] updateTask failed:', error)
      showToast('更新定时任务失败', 'error')
      throw error
    }
  }

  /** 删除定时任务 */
  async function deleteTask(id: string): Promise<void> {
    try {
      await window.electron.scheduler.delete(id)
      tasks.value = tasks.value.filter((t) => t.id !== id)
      showToast('定时任务已删除', 'success')
    } catch (error) {
      console.error('[SchedulerStore] deleteTask failed:', error)
      showToast('删除定时任务失败', 'error')
      throw error
    }
  }

  /** 启用/禁用任务 */
  async function toggleTask(id: string, enabled: boolean): Promise<void> {
    try {
      const updated = await window.electron.scheduler.toggle(id, enabled)
      const idx = tasks.value.findIndex((t) => t.id === id)
      if (idx >= 0) {
        tasks.value[idx] = updated
      }
      showToast(enabled ? '任务已启用' : '任务已禁用', 'success')
    } catch (error) {
      console.error('[SchedulerStore] toggleTask failed:', error)
      showToast('操作失败', 'error')
    }
  }

  /** 立即执行任务 */
  async function runTaskNow(id: string): Promise<void> {
    try {
      await window.electron.scheduler.runNow(id)
      showToast('任务已触发执行', 'success')
      // 刷新任务列表以获取最新状态
      await loadTasks()
    } catch (error) {
      console.error('[SchedulerStore] runTaskNow failed:', error)
      showToast('触发执行失败', 'error')
    }
  }

  /** 加载任务执行历史 */
  async function loadTaskHistory(taskId: string, limit = 20): Promise<void> {
    try {
      selectedTaskHistory.value = await window.electron.scheduler.history(taskId, limit)
    } catch (error) {
      console.error('[SchedulerStore] loadTaskHistory failed:', error)
      showToast('加载执行历史失败', 'error')
    }
  }

  /** 加载最近执行记录 */
  async function loadRecentRuns(limit = 50): Promise<void> {
    try {
      recentRuns.value = await window.electron.scheduler.recentRuns(limit)
    } catch (error) {
      console.error('[SchedulerStore] loadRecentRuns failed:', error)
    }
  }

  return {
    tasks,
    loading,
    recentRuns,
    selectedTaskHistory,
    enabledTasks,
    disabledTasks,
    runningTasks,
    errorTasks,
    loadTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    runTaskNow,
    loadTaskHistory,
    loadRecentRuns,
  }
})
