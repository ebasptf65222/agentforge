// AgentForge 定时任务数据访问层（Repository）
// 管理 scheduled_tasks 和 scheduled_task_runs 表的 CRUD 操作

import type Database from 'better-sqlite3'
import type {
  ScheduledTask,
  ScheduledTaskRun,
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
  TaskAgentConfig,
  ScheduleType,
  SessionTarget,
  TaskRunStatus,
} from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

// ─── 数据库行类型 ───────────────────────────────────────────────

interface ScheduledTaskRow {
  id: string
  name: string
  enabled: number
  schedule_type: string
  cron_expr: string | null
  at_ms: number | null
  every_ms: number | null
  anchor_ms: number | null
  timezone: string | null
  agent_config: string
  session_target: string
  next_run_at_ms: number | null
  running_at_ms: number | null
  last_run_at_ms: number | null
  last_status: string | null
  last_duration_ms: number | null
  run_count: number
  error_count: number
  created_at: string
  updated_at: string
}

interface ScheduledTaskRunRow {
  id: string
  task_id: string
  started_at_ms: number
  finished_at_ms: number | null
  status: string
  conversation_id: string | null
  summary: string | null
  error: string | null
  duration_ms: number | null
}

// ─── 转换函数 ───────────────────────────────────────────────────

function rowToTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    scheduleType: row.schedule_type as ScheduleType,
    cronExpr: row.cron_expr,
    atMs: row.at_ms,
    everyMs: row.every_ms,
    anchorMs: row.anchor_ms,
    timezone: row.timezone,
    agentConfig: JSON.parse(row.agent_config) as TaskAgentConfig,
    sessionTarget: row.session_target as SessionTarget,
    nextRunAtMs: row.next_run_at_ms,
    runningAtMs: row.running_at_ms,
    lastRunAtMs: row.last_run_at_ms,
    lastStatus: (row.last_status as TaskRunStatus | null) ?? null,
    lastDurationMs: row.last_duration_ms,
    runCount: row.run_count,
    errorCount: row.error_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
    status: row.status as TaskRunStatus,
    conversationId: row.conversation_id,
    summary: row.summary,
    error: row.error,
    durationMs: row.duration_ms,
  }
}

// ─── CRUD: scheduled_tasks ──────────────────────────────────────

/**
 * 创建定时任务。
 */
export function createScheduledTask(params: CreateScheduledTaskParams): ScheduledTask {
  const db: Database.Database = getDatabase()
  const now = new Date().toISOString()
  const id = generateId()
  const enabled = params.enabled !== false ? 1 : 0
  const sessionTarget = params.sessionTarget ?? 'isolated'

  db.prepare(
    `INSERT INTO scheduled_tasks
      (id, name, enabled, schedule_type, cron_expr, at_ms, every_ms, anchor_ms, timezone,
       agent_config, session_target, run_count, error_count, created_at, updated_at)
    VALUES
      (@id, @name, @enabled, @scheduleType, @cronExpr, @atMs, @everyMs, @anchorMs, @timezone,
       @agentConfig, @sessionTarget, 0, 0, @now, @now)`,
  ).run({
    id,
    name: params.name,
    enabled,
    scheduleType: params.scheduleType,
    cronExpr: params.cronExpr ?? null,
    atMs: params.atMs ?? null,
    everyMs: params.everyMs ?? null,
    anchorMs: params.scheduleType === 'every' ? Date.now() : null,
    timezone: params.timezone ?? null,
    agentConfig: JSON.stringify(params.agentConfig),
    sessionTarget,
    now,
  })

  return getScheduledTaskById(id)
}

/**
 * 根据 ID 获取定时任务。
 */
export function getScheduledTaskById(id: string): ScheduledTask {
  const db: Database.Database = getDatabase()
  const row = db
    .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
    .get(id) as ScheduledTaskRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.DB_ERROR, `Scheduled task not found: ${id}`)
  }
  return rowToTask(row)
}

/**
 * 获取所有定时任务。
 */
export function listScheduledTasks(): ScheduledTask[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTaskRow[]

  return rows.map(rowToTask)
}

/**
 * 获取所有已启用的定时任务。
 */
export function listEnabledScheduledTasks(): ScheduledTask[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY next_run_at_ms ASC')
    .all() as ScheduledTaskRow[]

  return rows.map(rowToTask)
}

/**
 * 更新定时任务。
 */
export function updateScheduledTask(id: string, params: UpdateScheduledTaskParams): ScheduledTask {
  const db: Database.Database = getDatabase()
  const existing = getScheduledTaskById(id)
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE scheduled_tasks SET
      name = @name,
      enabled = @enabled,
      schedule_type = @scheduleType,
      cron_expr = @cronExpr,
      at_ms = @atMs,
      every_ms = @everyMs,
      timezone = @timezone,
      agent_config = @agentConfig,
      session_target = @sessionTarget,
      updated_at = @now
    WHERE id = @id`,
  ).run({
    id,
    name: params.name ?? existing.name,
    enabled: params.enabled !== undefined ? (params.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    scheduleType: params.scheduleType ?? existing.scheduleType,
    cronExpr: params.cronExpr !== undefined ? params.cronExpr : existing.cronExpr,
    atMs: params.atMs !== undefined ? params.atMs : existing.atMs,
    everyMs: params.everyMs !== undefined ? params.everyMs : existing.everyMs,
    timezone: params.timezone !== undefined ? params.timezone : existing.timezone,
    agentConfig: params.agentConfig
      ? JSON.stringify(params.agentConfig)
      : JSON.stringify(existing.agentConfig),
    sessionTarget: params.sessionTarget ?? existing.sessionTarget,
    now,
  })

  return getScheduledTaskById(id)
}

/**
 * 删除定时任务。
 */
export function deleteScheduledTask(id: string): void {
  const db: Database.Database = getDatabase()
  const result = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new AppError(ErrorCodes.DB_ERROR, `Scheduled task not found: ${id}`)
  }
}

/**
 * 更新任务下次执行时间。
 */
export function updateNextRunAt(id: string, nextRunAtMs: number | null): void {
  const db: Database.Database = getDatabase()
  db.prepare('UPDATE scheduled_tasks SET next_run_at_ms = ?, updated_at = ? WHERE id = ?').run(
    nextRunAtMs,
    new Date().toISOString(),
    id,
  )
}

/**
 * 标记任务开始执行。
 */
export function markTaskRunning(id: string): void {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  db.prepare(
    'UPDATE scheduled_tasks SET running_at_ms = ?, next_run_at_ms = NULL, updated_at = ? WHERE id = ?',
  ).run(now, new Date().toISOString(), id)
}

/**
 * 标记任务执行完成。
 */
export function markTaskFinished(
  id: string,
  status: TaskRunStatus,
  durationMs: number,
  _summary?: string,
): void {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const task = getScheduledTaskById(id)
  const errorCount = status === 'error' ? task.errorCount + 1 : 0

  db.prepare(
    `UPDATE scheduled_tasks SET
      running_at_ms = NULL,
      last_run_at_ms = ?,
      last_status = ?,
      last_duration_ms = ?,
      run_count = run_count + 1,
      error_count = ?,
      updated_at = ?
    WHERE id = ?`,
  ).run(now, status, durationMs, errorCount, new Date().toISOString(), id)
}

/**
 * 重置连续错误计数。
 */
export function resetErrorCount(id: string): void {
  const db: Database.Database = getDatabase()
  db.prepare('UPDATE scheduled_tasks SET error_count = 0, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  )
}

// ─── CRUD: scheduled_task_runs ───────────────────────────────────

/**
 * 创建执行记录。
 */
export function createTaskRun(taskId: string): ScheduledTaskRun {
  const db: Database.Database = getDatabase()
  const id = generateId()
  const startedAtMs = Date.now()

  db.prepare(
    `INSERT INTO scheduled_task_runs (id, task_id, started_at_ms, status)
    VALUES (?, ?, ?, 'running')`,
  ).run(id, taskId, startedAtMs)

  return getTaskRunById(id)
}

/**
 * 根据 ID 获取执行记录。
 */
export function getTaskRunById(id: string): ScheduledTaskRun {
  const db: Database.Database = getDatabase()
  const row = db
    .prepare('SELECT * FROM scheduled_task_runs WHERE id = ?')
    .get(id) as ScheduledTaskRunRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.DB_ERROR, `Task run not found: ${id}`)
  }
  return rowToRun(row)
}

/**
 * 完成执行记录。
 */
export function finishTaskRun(
  runId: string,
  status: TaskRunStatus,
  conversationId: string | null,
  summary: string | null,
  error: string | null,
): void {
  const db: Database.Database = getDatabase()
  const run = getTaskRunById(runId)
  const finishedAtMs = Date.now()
  const durationMs = finishedAtMs - run.startedAtMs

  db.prepare(
    `UPDATE scheduled_task_runs SET
      finished_at_ms = ?,
      status = ?,
      conversation_id = ?,
      summary = ?,
      error = ?,
      duration_ms = ?
    WHERE id = ?`,
  ).run(finishedAtMs, status, conversationId, summary, error, durationMs, runId)
}

/**
 * 获取任务的执行历史。
 */
export function getTaskRuns(taskId: string, limit = 20): ScheduledTaskRun[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare(
      'SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at_ms DESC LIMIT ?',
    )
    .all(taskId, limit) as ScheduledTaskRunRow[]

  return rows.map(rowToRun)
}

/**
 * 获取最近执行的记录。
 */
export function getRecentTaskRuns(limit = 50): ScheduledTaskRun[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM scheduled_task_runs ORDER BY started_at_ms DESC LIMIT ?')
    .all(limit) as ScheduledTaskRunRow[]

  return rows.map(rowToRun)
}
