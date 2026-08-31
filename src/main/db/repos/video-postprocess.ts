// AgentForge 视频后处理数据访问层（Repository）M18
// video_postprocess_runs 表，记录每一次成片后处理（字幕/水印/拼接/重命名/归档）的执行信息。

import type Database from 'better-sqlite3'
import type { VideoPostprocessRun, VideoPostprocessType } from '@shared/types'
import { getDatabase } from '../index'
import { generateId } from '../../utils/id'

/** SQLite 行结构（snake_case，与 video_postprocess_runs 表一致） */
interface VideoPostprocessRunRow {
  id: string
  type: string
  task_ids: string
  output_path: string | null
  output_task_id: string | null
  status: string
  message: string | null
  created_at: number
}

/** 解析 task_ids JSON 文本列；非法内容回退为空数组 */
function parseTaskIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

function rowToRun(row: VideoPostprocessRunRow): VideoPostprocessRun {
  return {
    id: row.id,
    type: row.type as VideoPostprocessType,
    taskIds: parseTaskIds(row.task_ids),
    outputPath: row.output_path,
    outputTaskId: row.output_task_id,
    status: row.status as VideoPostprocessRun['status'],
    message: row.message,
    createdAt: row.created_at,
  }
}

/**
 * 创建一条后处理执行记录（初始为 running 状态）。
 */
export function createVideoPostprocessRun(params: {
  type: VideoPostprocessType
  taskIds: string[]
}): VideoPostprocessRun {
  const db: Database.Database = getDatabase()
  const id = generateId()
  const now = Date.now()

  db.prepare(
    `INSERT INTO video_postprocess_runs
      (id, type, task_ids, status, created_at)
     VALUES (?, ?, ?, 'running', ?)`,
  ).run(id, params.type, JSON.stringify(params.taskIds), now)

  const run = getVideoPostprocessRunById(id)
  if (!run) throw new Error('Failed to create video postprocess run')
  return run
}

/**
 * 根据 ID 获取后处理执行记录。
 */
export function getVideoPostprocessRunById(id: string): VideoPostprocessRun | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM video_postprocess_runs WHERE id = ?').get(id) as
    | VideoPostprocessRunRow
    | undefined
  return row ? rowToRun(row) : null
}

/**
 * 获取后处理执行记录列表（按创建时间倒序）。
 */
export function listVideoPostprocessRuns(limit = 50): VideoPostprocessRun[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM video_postprocess_runs ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(Math.max(1, Math.min(limit, 200))) as VideoPostprocessRunRow[]
  return rows.map(rowToRun)
}

/**
 * 完成一条后处理执行记录（写入结果并落终态）。
 */
export function finishVideoPostprocessRun(
  id: string,
  status: 'ok' | 'error',
  message: string,
  outputPath?: string | null,
  outputTaskId?: string | null,
): VideoPostprocessRun | null {
  const db: Database.Database = getDatabase()
  db.prepare(
    `UPDATE video_postprocess_runs
       SET status = ?, message = ?, output_path = ?, output_task_id = ?
     WHERE id = ?`,
  ).run(status, message, outputPath ?? null, outputTaskId ?? null, id)
  return getVideoPostprocessRunById(id)
}