// AgentForge 定时任务调度核心服务
//
// 实现：
// 1. 单定时器模式（始终只持有一个 setTimeout，指向最近的任务）
// 2. Cron 表达式解析（使用 croner 库）
// 3. 任务执行（通过 engine-dispatcher 复用 Agent 执行流程）
// 4. 错过的任务检测（系统挂起恢复后补跑）
// 5. 连续错误熔断（errorCount >= 5 时自动禁用）
//
// 架构：
// - scheduler-service.ts: 调度核心（定时器管理 + 执行触发）
// - db/repos/scheduled-task.ts: 数据持久化
// - ipc/scheduler.ts: IPC 接口
// - tools/schedule-task.ts: 对话内工具

import { Cron } from 'croner'
import type {
  ScheduledTask,
  ScheduledTaskRun,
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
  TaskRunStatus,
} from '@shared/types'
import {
  listEnabledScheduledTasks,
  listScheduledTasks,
  getScheduledTaskById,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  updateNextRunAt,
  markTaskRunning,
  markTaskFinished,
  resetErrorCount,
  createTaskRun,
  finishTaskRun,
  getTaskRuns,
  getRecentTaskRuns,
} from '../db/repos/scheduled-task'
import { createConversation } from '../db/repos/conversation'
import { getSettings } from '../db/repos/app-settings'
import { getMainWindowWebContents } from '../utils/electron-helpers'
import { AppError, ErrorCodes } from '../utils/error'
import type { AgentExecutionRequest } from '@shared/types'

// ─── 常量 ───────────────────────────────────────────────────────

/** JS setTimeout 最大值 ~24.8 天 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** 连续错误熔断阈值 */
const MAX_CONSECUTIVE_ERRORS = 5

/** 开发任务默认配置 */
const DEV_TASK_DEFAULTS = {
  approvalMode: 'full-auto' as const,
  maxSteps: 50,
}

/** 普通任务默认配置 */
const NORMAL_TASK_DEFAULTS = {
  approvalMode: 'auto-edit' as const,
  maxSteps: 20,
}

// ─── 调度器状态 ───────────────────────────────────────────────────

interface SchedulerState {
  /** 当前定时器 */
  timer: NodeJS.Timeout | null
  /** 是否已初始化 */
  initialized: boolean
  /** 是否正在执行任务（防止并发） */
  executing: boolean
}

const state: SchedulerState = {
  timer: null,
  initialized: false,
  executing: false,
}

// ─── Cron 表达式解析 ─────────────────────────────────────────────

/**
 * 使用 croner 计算下次执行时间。
 *
 * @param cronExpr - Cron 表达式（5 段：分 时 日 月 周）
 * @param timezone - 时区（IANA 名称），为空则使用系统时区
 * @returns 下次执行的 Unix 时间戳（毫秒），如果表达式无效返回 null
 */
export function calculateNextRun(cronExpr: string, timezone?: string | null): number | null {
  try {
    const cron = new Cron(cronExpr, {
      timezone: timezone ?? undefined,
    })
    const next = cron.nextRun()
    return next ? next.getTime() : null
  } catch {
    return null
  }
}

/**
 * 根据任务调度配置计算下次执行时间。
 */
function computeNextRun(task: ScheduledTask): number | null {
  switch (task.scheduleType) {
    case 'cron':
      if (!task.cronExpr) return null
      return calculateNextRun(task.cronExpr, task.timezone)

    case 'at':
      // 一次性任务：如果时间还没到，返回 atMs；否则返回 null
      if (task.atMs && task.atMs > Date.now()) return task.atMs
      return null

    case 'every': {
      if (!task.everyMs) return null
      const anchor = task.anchorMs ?? Date.now()
      const now = Date.now()
      const elapsed = now - anchor
      const periods = Math.floor(elapsed / task.everyMs)
      return anchor + (periods + 1) * task.everyMs
    }

    default:
      return null
  }
}

// ─── 定时器管理 ───────────────────────────────────────────────────

/**
 * 扫描所有已启用的任务，找到最近的下次执行时间。
 */
function findNextRunAt(): { task: ScheduledTask; runAtMs: number } | null {
  const tasks = listEnabledScheduledTasks()
  let nearest: { task: ScheduledTask; runAtMs: number } | null = null

  for (const task of tasks) {
    // 跳过正在执行的任务
    if (task.runningAtMs !== null) continue

    // 检查是否需要（重新）计算 nextRunAtMs
    let nextRunMs = task.nextRunAtMs
    if (nextRunMs === null || nextRunMs <= Date.now()) {
      nextRunMs = computeNextRun(task)
      if (nextRunMs !== null) {
        updateNextRunAt(task.id, nextRunMs)
      }
    }

    if (nextRunMs !== null && nextRunMs > Date.now()) {
      if (nearest === null || nextRunMs < nearest.runAtMs) {
        nearest = { task, runAtMs: nextRunMs }
      }
    }
  }

  return nearest
}

/**
 * 重新设置定时器（单定时器模式）。
 *
 * 始终只持有一个 setTimeout，指向最近的任务。
 * 当定时器触发后，执行到期任务，然后重新设置定时器。
 */
export function armTimer(): void {
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }

  const next = findNextRunAt()
  if (!next) {
    console.info('[Scheduler] No pending tasks. Timer disarmed.')
    return
  }

  const delay = Math.max(next.runAtMs - Date.now(), 0)
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS)

  console.info(
    `[Scheduler] Next task "${next.task.name}" at ${new Date(next.runAtMs).toISOString()} (in ${Math.round(delay / 1000)}s)`,
  )

  state.timer = setTimeout(() => {
    void onTimerFire()
  }, clampedDelay)
  // 允许进程在定时器未触发时退出
  state.timer.unref?.()
}

/**
 * 定时器触发时的处理函数。
 * 执行所有到期任务，然后重新设置定时器。
 */
async function onTimerFire(): Promise<void> {
  state.timer = null

  // 检查是否有错过的任务（系统休眠恢复后）
  await checkMissedRuns()

  // 执行到期任务
  const now = Date.now()
  const tasks = listEnabledScheduledTasks()
  const dueTasks = tasks.filter(
    (t) => t.nextRunAtMs !== null && t.nextRunAtMs <= now && t.runningAtMs === null,
  )

  for (const task of dueTasks) {
    await executeTask(task.id)
  }

  // 重新设置定时器
  armTimer()
}

// ─── 任务执行 ───────────────────────────────────────────────────

/**
 * 执行单个定时任务。
 *
 * 流程：
 * 1. 标记任务开始执行
 * 2. 创建执行记录
 * 3. 创建隔离会话（或使用主会话）
 * 4. 通过 engine-dispatcher 执行 Agent
 * 5. 记录结果
 * 6. 计算下次执行时间
 * 7. 重新设置定时器
 */
export async function executeTask(taskId: string): Promise<ScheduledTaskRun | null> {
  if (state.executing) {
    console.warn('[Scheduler] Another task is already executing. Skipping.')
    return null
  }

  const task = getScheduledTaskById(taskId)
  if (!task.enabled) {
    console.info(`[Scheduler] Task "${task.name}" is disabled. Skipping.`)
    return null
  }

  // 熔断检查
  if (task.errorCount >= MAX_CONSECUTIVE_ERRORS) {
    console.error(
      `[Scheduler] Task "${task.name}" has ${task.errorCount} consecutive errors. Auto-disabling.`,
    )
    updateScheduledTask(taskId, { enabled: false })
    notifyTaskDisabled(taskId, '连续错误次数过多，已自动禁用')
    return null
  }

  state.executing = true
  markTaskRunning(taskId)
  const run = createTaskRun(taskId)

  const startedAt = Date.now()
  console.info(`[Scheduler] Executing task "${task.name}" (run ${run.id})`)

  try {
    // 获取模型 ID
    const settings = getSettings()
    const modelId = task.agentConfig.modelId ?? settings.defaultModelId
    if (!modelId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No model ID configured for task execution')
    }

    // 构建审批模式和最大步数
    const isDevTask = task.agentConfig.isDevTask === true
    const defaults = isDevTask ? DEV_TASK_DEFAULTS : NORMAL_TASK_DEFAULTS
    const approvalMode = task.agentConfig.approvalMode ?? defaults.approvalMode
    const maxSteps = task.agentConfig.maxSteps ?? defaults.maxSteps

    // 构建 prompt
    let prompt = task.agentConfig.prompt

    // 开发任务：如果有 Plan 任务列表，注入到 prompt
    if (isDevTask && task.agentConfig.planTasks && task.agentConfig.planTasks.length > 0) {
      const pendingTasks = task.agentConfig.planTasks.filter((t) => t.status === 'pending')
      if (pendingTasks.length > 0) {
        const taskList = pendingTasks
          .map((t, i) => `${i + 1}. ${t.title}\n   ${t.description}`)
          .join('\n')
        prompt = `${prompt}\n\n## 开发任务清单\n请按顺序执行以下开发任务：\n\n${taskList}\n\n每完成一个任务，请提交代码并更新任务状态。`
      }
    }

    // 创建会话
    const conversation = createConversation({
      title: `[定时] ${task.name}`,
      modelId,
      approvalMode,
    })

    // 动态导入执行器（避免循环依赖）
    const { executeAgentFlow } = await import('../agent/engine-dispatcher')

    // 构建执行请求
    const request: AgentExecutionRequest = {
      conversationId: conversation.id,
      userInput: prompt,
      modelId,
      approvalMode,
      maxSteps,
      skillName: task.agentConfig.skillName,
    }

    // 执行 Agent
    const result = await executeAgentFlow(request)
    const durationMs = Date.now() - startedAt

    // 标记完成
    markTaskFinished(taskId, 'ok', durationMs, result.summary)
    finishTaskRun(run.id, 'ok', conversation.id, result.summary, null)

    // 重置错误计数
    if (task.errorCount > 0) {
      resetErrorCount(taskId)
    }

    console.info(
      `[Scheduler] Task "${task.name}" completed in ${durationMs}ms (steps: ${result.totalSteps})`,
    )

    // 通知前端
    notifyTaskCompleted(taskId, 'ok', result.summary, conversation.id)

    return getTaskRunById(run.id)
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const errorMsg = error instanceof Error ? error.message : String(error)

    console.error(`[Scheduler] Task "${task.name}" failed:`, error)

    markTaskFinished(taskId, 'error', durationMs)
    finishTaskRun(run.id, 'error', null, null, errorMsg)

    notifyTaskCompleted(taskId, 'error', errorMsg, null)

    return getTaskRunById(run.id)
  } finally {
    state.executing = false

    // 计算下次执行时间（一次性任务不会有下次）
    const updatedTask = getScheduledTaskById(taskId)
    const nextRun = computeNextRun(updatedTask)
    updateNextRunAt(taskId, nextRun)

    // 重新设置定时器
    armTimer()
  }
}

// ─── 错过的任务检测 ───────────────────────────────────────────────

/**
 * 检查并执行因系统休眠而错过的任务。
 *
 * 系统挂起后恢复时调用。
 * 对每个 nextRunAtMs 已过期的任务，标记为 skipped 并重新计算下次执行时间。
 */
export async function checkMissedRuns(): Promise<void> {
  const tasks = listEnabledScheduledTasks()
  const now = Date.now()

  for (const task of tasks) {
    if (task.nextRunAtMs !== null && task.nextRunAtMs < now - 60_000 && task.runningAtMs === null) {
      // 超过 1 分钟的过期任务标记为 skipped
      console.warn(
        `[Scheduler] Task "${task.name}" missed its schedule at ${new Date(task.nextRunAtMs).toISOString()}. Marking as skipped.`,
      )
      markTaskFinished(task.id, 'skipped', 0)

      // 创建一条 skipped 记录
      const run = createTaskRun(task.id)
      finishTaskRun(run.id, 'skipped', null, null, 'Missed run (system was suspended)')

      // 重新计算下次执行时间
      const nextRun = computeNextRun(task)
      updateNextRunAt(task.id, nextRun)
    }
  }
}

// ─── 前端通知 ─────────────────────────────────────────────────────

function notifyTaskCompleted(
  taskId: string,
  status: TaskRunStatus,
  summary: string,
  conversationId: string | null,
): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('scheduler:task-completed', { taskId, status, summary, conversationId })
  }
}

function notifyTaskDisabled(taskId: string, reason: string): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('scheduler:task-disabled', { taskId, reason })
  }
}

// ─── 公共 API ─────────────────────────────────────────────────────

/**
 * 初始化调度器。
 * 在 app.whenReady() 后调用。
 */
export function initializeScheduler(): void {
  if (state.initialized) {
    console.warn('[Scheduler] Already initialized.')
    return
  }
  state.initialized = true

  console.info('[Scheduler] Initializing...')

  // 为所有已启用的任务计算下次执行时间
  const tasks = listEnabledScheduledTasks()
  for (const task of tasks) {
    if (task.nextRunAtMs === null || task.nextRunAtMs <= Date.now()) {
      const nextRun = computeNextRun(task)
      if (nextRun !== null) {
        updateNextRunAt(task.id, nextRun)
      }
    }
  }

  // 检查错过的任务
  void checkMissedRuns().then(() => {
    armTimer()
  })

  console.info(`[Scheduler] Initialized with ${tasks.length} enabled task(s).`)
}

/**
 * 关闭调度器。
 * 在 before-quit 中调用。
 */
export function shutdownScheduler(): void {
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  state.initialized = false
  console.info('[Scheduler] Shut down.')
}

/**
 * 重新设置定时器（外部触发，如任务创建/更新后）。
 */
export function rearmTimer(): void {
  armTimer()
}

// ─── 任务管理 API（供 IPC 调用） ──────────────────────────────────

export function createTask(params: CreateScheduledTaskParams): ScheduledTask {
  const task = createScheduledTask(params)

  // 如果任务已启用，重新设置定时器
  if (task.enabled) {
    const nextRun = computeNextRun(task)
    if (nextRun !== null) {
      updateNextRunAt(task.id, nextRun)
    }
    armTimer()
  }

  return task
}

export function updateTask(id: string, params: UpdateScheduledTaskParams): ScheduledTask {
  const task = updateScheduledTask(id, params)

  // 重新计算下次执行时间
  const nextRun = task.enabled ? computeNextRun(task) : null
  updateNextRun(id, nextRun)
  armTimer()

  return task
}

export function deleteTask(id: string): void {
  deleteScheduledTask(id)
  armTimer()
}

export function toggleTask(id: string, enabled: boolean): ScheduledTask {
  const task = updateScheduledTask(id, { enabled })

  if (enabled) {
    const nextRun = computeNextRun(task)
    if (nextRun !== null) {
      updateNextRunAt(id, nextRun)
    }
  }
  armTimer()

  return task
}

export async function runTaskNow(id: string): Promise<ScheduledTaskRun | null> {
  return executeTask(id)
}

export function listAllTasks(): ScheduledTask[] {
  return listScheduledTasks()
}

export function getTaskHistory(taskId: string, limit?: number): ScheduledTaskRun[] {
  return getTaskRuns(taskId, limit)
}

export function getRecentRuns(limit?: number): ScheduledTaskRun[] {
  return getRecentTaskRuns(limit)
}

// ─── 单例 ─────────────────────────────────────────────────────────

let instance: typeof schedulerApi | null = null

const schedulerApi = {
  initialize: initializeScheduler,
  shutdown: shutdownScheduler,
  rearm: rearmTimer,
  createTask,
  updateTask,
  deleteTask,
  toggleTask,
  runTaskNow,
  listAllTasks,
  getTaskHistory,
  getRecentRuns,
  checkMissedRuns,
}

/**
 * 获取调度器单例。
 */
export function getSchedulerService(): typeof schedulerApi {
  if (instance === null) {
    instance = schedulerApi
  }
  return instance
}
