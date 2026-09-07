// AgentForge 视频批量调度数据访问层（Repository）M17
// video_schedules 表 + video_schedule_runs 执行记录表。
// 提供调度实体 CRUD、运行记录管理与下一次触发时间维护，供视频批量调度服务使用。

import type Database from 'better-sqlite3'
import type {
  VideoBatchConfig,
  VideoSchedule,
  VideoScheduleRun,
  VideoScheduleRunStatus,
  VideoScheduleTrigger,
} from '@shared/types'
import { getDatabase } from '../index'
import { generateId } from '../../utils/id'

/** 创建视频批量调度的入参 */
export interface CreateVideoScheduleRepoParams {
  name: string
  enabled?: boolean
  trigger?: VideoScheduleTrigger
  cronExpr?: string | null
  timezone?: string | null
  batch: VideoBatchConfig
}

/** 运行时可更新的调度字段 */
export interface UpdateVideoScheduleRepoParams {
  name?: string
  enabled?: boolean
  trigger?: VideoScheduleTrigger
  cronExpr?: string | null
  timezone?: string | null
  batch?: VideoBatchConfig
  nextRunAtMs?: number | null
  runningAtMs?: number | null
  lastRunAtMs?: number | null
  lastStatus?: VideoScheduleRunStatus | null
  lastRunCount?: number | null
  runCount?: number
  errorCount?: number
}

/** SQLite 行结构（snake_case，与 video_schedules 表一致） */
interface VideoScheduleRow {
  id: string
  name: string
  enabled: number
  trigger: string
  cron_expr: string | null
  timezone: string | null
  batch_config: string
  next_run_at_ms: number | null
  running_at_ms: number | null
  last_run_at_ms: number | null
  last_status: string | null
  last_run_count: number | null
  run_count: number
  error_count: number
  created_at: number
  updated_at: number
}

/** SQLite 行结构（snake_case，与 video_schedule_runs 表一致） */
interface VideoScheduleRunRow {
  id: string
  schedule_id: string
  started_at_ms: number
  finished_at_ms: number | null
  status: string
  task_count: number
  failed_count: number
  summary: string | null
  error: string | null
}

/** 解析 batch_config JSON 文本列；非法内容回退为空批次 */
function parseBatchConfig(raw: string): VideoBatchConfig {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return { rows: [] }
    const obj = parsed as Record<string, unknown>
    const rows = Array.isArray(obj['rows']) ? (obj['rows'] as VideoBatchConfig['rows']) : []
    const sequences = Array.isArray(obj['sequences'])
      ? (obj['sequences'] as VideoBatchConfig['sequences'])
      : undefined
    const templateIds = Array.isArray(obj['templateIds'])
      ? (obj['templateIds'] as VideoBatchConfig['templateIds'])
      : undefined
    return {
      rows,
      concurrency: typeof obj['concurrency'] === 'number' ? obj['concurrency'] : undefined,
      sequences,
      templateIds,
    }
  } catch {
    return { rows: [] }
  }
}

function rowToSchedule(row: VideoScheduleRow): VideoSchedule {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    trigger: row.trigger as VideoScheduleTrigger,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    batch: parseBatchConfig(row.batch_config),
    nextRunAtMs: row.next_run_at_ms,
    runningAtMs: row.running_at_ms,
    lastRunAtMs: row.last_run_at_ms,
    lastStatus: row.last_status as VideoScheduleRunStatus | null,
    lastRunCount: row.last_run_count,
    runCount: row.run_count,
    errorCount: row.error_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRun(row: VideoScheduleRunRow): VideoScheduleRun {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
    status: row.status as VideoScheduleRunStatus,
    taskCount: row.task_count,
    failedCount: row.failed_count,
    summary: row.summary,
    error: row.error,
  }
}

/**
 * 创建视频批量调度记录（初始 enabled 缺省 true，trigger 缺省 'cron'）。
 */
export function createVideoSchedule(params: CreateVideoScheduleRepoParams): VideoSchedule {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO video_schedules
      (id, name, enabled, trigger, cron_expr, timezone, batch_config,
       run_count, error_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    id,
    params.name,
    params.enabled === false ? 0 : 1,
    params.trigger ?? 'cron',
    params.cronExpr ?? null,
    params.timezone ?? null,
    JSON.stringify(params.batch),
    now,
    now,
  )

  const schedule = getVideoScheduleById(id)
  if (!schedule) throw new Error('Failed to create video schedule')
  return schedule
}

/**
 * 根据 ID 获取视频批量调度。
 */
export function getVideoScheduleById(id: string): VideoSchedule | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM video_schedules WHERE id = ?').get(id) as
    | VideoScheduleRow
    | undefined
  return row ? rowToSchedule(row) : null
}

/**
 * 获取全部视频批量调度（按创建时间倒序）。
 */
export function listVideoSchedules(limit = 200): VideoSchedule[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM video_schedules ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(Math.max(1, Math.min(limit, 500))) as VideoScheduleRow[]
  return rows.map(rowToSchedule)
}

/**
 * 获取全部已启用的视频批量调度。
 */
export function listEnabledVideoSchedules(): VideoSchedule[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare(
      'SELECT * FROM video_schedules WHERE enabled = 1 ORDER BY created_at ASC, rowid ASC',
    )
    .all() as VideoScheduleRow[]
  return rows.map(rowToSchedule)
}

/**
 * 更新视频批量调度的部分字段（自动刷新 updated_at）。
 */
export function updateVideoSchedule(
  id: string,
  params: UpdateVideoScheduleRepoParams,
): VideoSchedule | null {
  const db: Database.Database = getDatabase()
  const existing = getVideoScheduleById(id)
  if (!existing) return null

  const values: Array<number | string | null> = []
  const setClauses: string[] = ['updated_at = ?']
  values.push(Date.now())

  if (params.name !== undefined) {
    setClauses.push('name = ?')
    values.push(params.name)
  }
  if (params.enabled !== undefined) {
    setClauses.push('enabled = ?')
    values.push(params.enabled ? 1 : 0)
  }
  if (params.trigger !== undefined) {
    setClauses.push('trigger = ?')
    values.push(params.trigger)
  }
  if (params.cronExpr !== undefined) {
    setClauses.push('cron_expr = ?')
    values.push(params.cronExpr)
  }
  if (params.timezone !== undefined) {
    setClauses.push('timezone = ?')
    values.push(params.timezone)
  }
  if (params.batch !== undefined) {
    setClauses.push('batch_config = ?')
    values.push(JSON.stringify(params.batch))
  }
  if (params.nextRunAtMs !== undefined) {
    setClauses.push('next_run_at_ms = ?')
    values.push(params.nextRunAtMs)
  }
  if (params.runningAtMs !== undefined) {
    setClauses.push('running_at_ms = ?')
    values.push(params.runningAtMs)
  }
  if (params.lastRunAtMs !== undefined) {
    setClauses.push('last_run_at_ms = ?')
    values.push(params.lastRunAtMs)
  }
  if (params.lastStatus !== undefined) {
    setClauses.push('last_status = ?')
    values.push(params.lastStatus)
  }
  if (params.lastRunCount !== undefined) {
    setClauses.push('last_run_count = ?')
    values.push(params.lastRunCount)
  }
  if (params.runCount !== undefined) {
    setClauses.push('run_count = ?')
    values.push(params.runCount)
  }
  if (params.errorCount !== undefined) {
    setClauses.push('error_count = ?')
    values.push(params.errorCount)
  }

  db.prepare(`UPDATE video_schedules SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...([...values, id] as Array<number | string | null>),
  )
  return getVideoScheduleById(id)
}

/**
 * 彻底删除视频批量调度（级联删除其执行记录）。
 */
export function deleteVideoSchedule(id: string): void {
  const db: Database.Database = getDatabase()
  db.prepare('DELETE FROM video_schedules WHERE id = ?').run(id)
}

/**
 * 创建一条调度执行记录（初始为 running 状态）。
 */
export function createVideoScheduleRun(scheduleId: string): VideoScheduleRun {
  const db: Database.Database = getDatabase()
  const id = generateId()
  const now = Date.now()

  db.prepare(
    `INSERT INTO video_schedule_runs
      (id, schedule_id, started_at_ms, status, task_count, failed_count)
     VALUES (?, ?, ?, 'running', 0, 0)`,
  ).run(id, scheduleId, now)

  const run = getVideoScheduleRunById(id)
  if (!run) throw new Error('Failed to create video schedule run')
  return run
}

/**
 * 结束一条调度执行记录。
 */
export function finishVideoScheduleRun(
  id: string,
  status: VideoScheduleRunStatus,
  taskCount: number,
  failedCount: number,
  summary: string | null,
  error: string | null,
): VideoScheduleRun | null {
  const db: Database.Database = getDatabase()
  db.prepare(
    `UPDATE video_schedule_runs
       SET finished_at_ms = ?, status = ?, task_count = ?, failed_count = ?, summary = ?, error = ?
     WHERE id = ?`,
  ).run(Date.now(), status, taskCount, failedCount, summary, error, id)
  return getVideoScheduleRunById(id)
}

/**
 * 根据 ID 获取调度执行记录。
 */
export function getVideoScheduleRunById(id: string): VideoScheduleRun | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM video_schedule_runs WHERE id = ?').get(id) as
    | VideoScheduleRunRow
    | undefined
  return row ? rowToRun(row) : null
}

/**
 * 获取指定调度的执行记录（按开始时间倒序）。
 */
export function listVideoScheduleRuns(scheduleId: string, limit = 50): VideoScheduleRun[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare(
      'SELECT * FROM video_schedule_runs WHERE schedule_id = ? ORDER BY started_at_ms DESC, rowid DESC LIMIT ?',
    )
    .all(scheduleId, Math.max(1, Math.min(limit, 200))) as VideoScheduleRunRow[]
  return rows.map(rowToRun)
}