// AgentForge 视频批量调度服务（M17）
//
// 职责：
// 1. 定时（cron）触发批量造片——到点后把调度内的批量任务行交给视频引擎队列，无人值守出片。
// 2. 支持手动触发（runNow）。
// 3. 采用与 scheduler-service 相同的“单定时器”模式：始终只持有一个 setTimeout。
// 4. 连续错误熔断（errorCount >= 5 自动禁用）。
// 5. 记录每一次执行到 video_schedule_runs 表。

import type {
  CreateVideoScheduleParams,
  UpdateVideoScheduleParams,
  VideoSchedule,
  VideoScheduleRun,
  VideoScheduleRunStatus,
  VideoScheduleTrigger,
  VideoBatchConfig,
} from '@shared/types'
import {
  createVideoSchedule as repoCreate,
  updateVideoSchedule as repoUpdate,
  deleteVideoSchedule as repoDelete,
  listVideoSchedules,
  listEnabledVideoSchedules,
  getVideoScheduleById,
  getVideoScheduleRunById,
  createVideoScheduleRun,
  finishVideoScheduleRun,
  listVideoScheduleRuns,
} from '../db/repos/video-schedule'
import { calculateNextRun } from './scheduler-service'
import { getVideoEngine } from './video-engine'
import { getMainWindowWebContents } from '../utils/electron-helpers'
import { AppError, ErrorCodes } from '../utils/error'

/** JS setTimeout 最大值 ~24.8 天 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1
/** 连续错误熔断阈值 */
const MAX_CONSECUTIVE_ERRORS = 5

interface VideoScheduleState {
  timer: NodeJS.Timeout | null
  initialized: boolean
  executing: boolean
}

const state: VideoScheduleState = {
  timer: null,
  initialized: false,
  executing: false,
}

// ─── 定时器管理与触发 ──────────────────────────────────────────

/** 找到下一个可触发的（cron）调度 */
function findNextRunAt(): { schedule: VideoSchedule; runAtMs: number } | null {
  const schedules = listEnabledVideoSchedules()
  const now = Date.now()
  let nearest: { schedule: VideoSchedule; runAtMs: number } | null = null

  for (const schedule of schedules) {
    if (schedule.trigger !== 'cron') continue
    if (schedule.runningAtMs !== null) continue

    let nextRunMs = schedule.nextRunAtMs
    if (nextRunMs === null || nextRunMs <= now) {
      nextRunMs = calculateNextRun(schedule.cronExpr, schedule.timezone)
      if (nextRunMs !== null) {
        repoUpdate(schedule.id, { nextRunAtMs: nextRunMs })
      }
    }
    if (nextRunMs !== null && nextRunMs > now) {
      if (nearest === null || nextRunMs < nearest.runAtMs) {
        nearest = { schedule, runAtMs: nextRunMs }
      }
    }
  }
  return nearest
}

/**
 * 重新设置定时器（单定时器模式）。外部在调度创建/更新/删除后调用。
 */
function armTimer(): void {
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  const next = findNextRunAt()
  if (!next) {
    console.info('[VideoSchedule] No pending video schedules. Timer disarmed.')
    return
  }
  const delay = Math.max(next.runAtMs - Date.now(), 0)
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS)
  console.info(
    `[VideoSchedule] Next schedule "${next.schedule.name}" at ${new Date(next.runAtMs).toISOString()} (in ${Math.round(delay / 1000)}s)`,
  )
  state.timer = setTimeout(() => {
    void onTimerFire()
  }, clampedDelay)
  state.timer.unref?.()
}

/** 定时器触发：执行所有到期的 cron 调度，然后重排定时器 */
async function onTimerFire(): Promise<void> {
  state.timer = null
  const now = Date.now()
  for (const schedule of listEnabledVideoSchedules()) {
    if (
      schedule.trigger === 'cron' &&
      schedule.nextRunAtMs !== null &&
      schedule.nextRunAtMs <= now &&
      schedule.runningAtMs === null
    ) {
      await executeSchedule(schedule.id, 'timer')
    }
  }
  armTimer()
}

// ─── 执行 ──────────────────────────────────────────────────────

/**
 * 执行单次视频批量调度。
 *
 * @param trigger - 'timer' 定时触发 / 'manual' 手动触发
 * @param concurrencyOverride - 手动触发时的并发覆盖（可选，优先于调度内配置）
 */
export async function executeSchedule(
  scheduleId: string,
  trigger: 'timer' | 'manual',
  concurrencyOverride?: number,
): Promise<VideoScheduleRun | null> {
  if (state.executing) {
    console.warn('[VideoSchedule] Another video schedule is executing. Skipping.')
    return null
  }
  const schedule = getVideoScheduleById(scheduleId)
  if (!schedule) {
    throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video schedule not found: ${scheduleId}`)
  }
  if (!schedule.enabled) {
    console.info(`[VideoSchedule] Schedule "${schedule.name}" is disabled. Skipping.`)
    return null
  }
  if (schedule.errorCount >= MAX_CONSECUTIVE_ERRORS) {
    console.error(
      `[VideoSchedule] Schedule "${schedule.name}" has ${schedule.errorCount} consecutive errors. Auto-disabling.`,
    )
    repoUpdate(scheduleId, { enabled: false })
    notifyScheduleDisabled(scheduleId, '连续错误次数过多，已自动禁用')
    return null
  }

  state.executing = true
  repoUpdate(scheduleId, { runningAtMs: Date.now() })
  const run = createVideoScheduleRun(scheduleId)

  try {
    const batch = schedule.batch
    const rows = batch.rows ?? []
    if (rows.length === 0) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Video schedule has an empty batch (no task rows).',
      )
    }
    // 校验批量行：过滤空 prompt，转成引擎 generateRows 可消费的参数
    const validRows = rows.filter((row) => row && row.prompt && row.prompt.trim() !== '')
    const skipped = rows.length - validRows.length

    const concurrency = concurrencyOverride ?? batch.concurrency
    const result = await getVideoEngine().generateRows(validRows, concurrency)
    const taskCount = result.succeeded.length
    const failedCount = result.failed.length

    const summary =
      skipped > 0
        ? `提交 ${taskCount} 个任务，跳过 ${skipped} 个空行，失败 ${failedCount} 个`
        : `提交 ${taskCount} 个任务，失败 ${failedCount} 个`

    // 更新调度状态
    const status: VideoScheduleRunStatus = failedCount > 0 ? 'error' : 'ok'
    repoUpdate(scheduleId, {
      runningAtMs: null,
      lastRunAtMs: Date.now(),
      lastStatus: status,
      lastRunCount: taskCount,
      runCount: schedule.runCount + 1,
      errorCount: 0,
    })
    finishVideoScheduleRun(run.id, status, taskCount, failedCount, summary, null)
    // 重算下次 cron 触发
    recomputeNextRun(scheduleId)
    notifyScheduleCompleted(scheduleId, status, summary)
    return getVideoScheduleRunById(run.id)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[VideoSchedule] Schedule "${schedule.name}" failed:`, error)
    repoUpdate(scheduleId, {
      runningAtMs: null,
      lastRunAtMs: Date.now(),
      lastStatus: 'error',
      errorCount: schedule.errorCount + 1,
    })
    finishVideoScheduleRun(run.id, 'error', 0, 0, null, errorMsg)
    recomputeNextRun(scheduleId)
    notifyScheduleCompleted(scheduleId, 'error', errorMsg)
    return getVideoScheduleRunById(run.id)
  } finally {
    state.executing = false
    armTimer()
  }
}

/** 重算 cron 调度的下次触发时间（手动/执行完成后调用） */
function recomputeNextRun(scheduleId: string): void {
  const schedule = getVideoScheduleById(scheduleId)
  if (!schedule || schedule.trigger !== 'cron') return
  const next = calculateNextRun(schedule.cronExpr, schedule.timezone)
  repoUpdate(scheduleId, { nextRunAtMs: next })
}

// ─── 前端通知 ──────────────────────────────────────────────────

function notifyScheduleCompleted(
  scheduleId: string,
  status: VideoScheduleRunStatus,
  summary: string,
): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('video:schedule-completed', { scheduleId, status, summary })
  }
}

function notifyScheduleDisabled(scheduleId: string, reason: string): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('video:schedule-disabled', { scheduleId, reason })
  }
}

// ─── 生命周期 ──────────────────────────────────────────────────

/**
 * 初始化视频调度：为所有 cron 调度计算下次触发时间并武装定时器。
 */
export function initializeVideoScheduler(): void {
  if (state.initialized) {
    return
  }
  state.initialized = true
  const now = Date.now()
  for (const schedule of listEnabledVideoSchedules()) {
    if (schedule.trigger === 'cron' && (schedule.nextRunAtMs === null || schedule.nextRunAtMs <= now)) {
      const next = calculateNextRun(schedule.cronExpr, schedule.timezone)
      if (next !== null) {
        repoUpdate(schedule.id, { nextRunAtMs: next })
      }
    }
  }
  armTimer()
  console.info('[VideoSchedule] Initialized.')
}

/**
 * 关闭视频调度（释放定时器）。
 */
export function shutdownVideoScheduler(): void {
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  state.initialized = false
  console.info('[VideoSchedule] Shut down.')
}

// ─── 公共 API（供 IPC 调用） ──────────────────────────────────

export function createScheduleTask(params: CreateVideoScheduleParams): VideoSchedule {
  const normalized = normalizeCreateParams(params)
  const schedule = repoCreate(normalized)
  if (schedule.enabled && schedule.trigger === 'cron') {
    recomputeNextRun(schedule.id)
  }
  armTimer()
  return getVideoScheduleById(schedule.id) ?? schedule
}

export function updateScheduleTask(
  id: string,
  params: UpdateVideoScheduleParams,
): VideoSchedule {
  const existing = getVideoScheduleById(id)
  if (!existing) {
    throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video schedule not found: ${id}`)
  }
  const updated = repoUpdate(id, params)
  if (!updated) throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video schedule not found: ${id}`)
  if (updated.enabled && updated.trigger === 'cron') {
    recomputeNextRun(id)
  } else {
    repoUpdate(id, { nextRunAtMs: null })
  }
  armTimer()
  return getVideoScheduleById(id) ?? updated
}

export function toggleScheduleTask(id: string, enabled: boolean): VideoSchedule {
  const updated = repoUpdate(id, { enabled })
  if (!updated) throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video schedule not found: ${id}`)
  if (updated.enabled && updated.trigger === 'cron') {
    recomputeNextRun(id)
  } else {
    repoUpdate(id, { nextRunAtMs: null })
  }
  armTimer()
  return getVideoScheduleById(id) ?? updated
}

export function deleteScheduleTask(id: string): void {
  repoDelete(id)
  armTimer()
}

/** 手动触发一次调度 */
export function runScheduleNow(id: string): Promise<VideoScheduleRun | null> {
  return executeSchedule(id, 'manual')
}

export function listScheduleTasks(limit?: number): VideoSchedule[] {
  return listVideoSchedules(limit)
}

export function getScheduleHistory(id: string, limit?: number): VideoScheduleRun[] {
  return listVideoScheduleRuns(id, limit)
}

/**
 * 规整创建参数：name 非空、trigger 合法、cron 触发须提供有效 cron 表达式。
 */
function normalizeCreateParams(params: CreateVideoScheduleParams): {
  name: string
  enabled: boolean
  trigger: VideoScheduleTrigger
  cronExpr: string | null
  timezone: string | null
  batch: VideoBatchConfig
} {
  const name = params.name?.trim()
  if (!name) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video schedule name must not be empty.')
  }
  const trigger = params.trigger ?? 'cron'
  const rows = Array.isArray(params.batch?.rows) ? params.batch.rows : []
  if (rows.length === 0 || rows.some((r) => !r?.prompt || !r.prompt.trim())) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Video schedule batch must contain at least one non-empty prompt.',
    )
  }
  if (trigger === 'cron') {
    if (!params.cronExpr || calculateNextRun(params.cronExpr, params.timezone) === null) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid cron expression: ${params.cronExpr ?? '(none)'}`,
      )
    }
  }
  return {
    name,
    enabled: params.enabled ?? true,
    trigger,
    cronExpr: params.cronExpr ?? null,
    timezone: params.timezone ?? null,
    batch: { rows, concurrency: params.batch?.concurrency },
  }
}

// ─── 单例 ──────────────────────────────────────────────────────

let instance: typeof api | null = null

const api = {
  initialize: initializeVideoScheduler,
  shutdown: shutdownVideoScheduler,
  rearm: armTimer,
  create: createScheduleTask,
  update: updateScheduleTask,
  toggle: toggleScheduleTask,
  delete: deleteScheduleTask,
  runNow: runScheduleNow,
  list: listScheduleTasks,
  history: getScheduleHistory,
}

/**
 * 获取视频调度服务单例。
 */
export function getVideoScheduleService(): typeof api {
  if (instance === null) {
    instance = api
  }
  return instance
}