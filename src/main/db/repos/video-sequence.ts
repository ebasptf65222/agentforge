// AgentForge 多镜头序列数据访问层（Repository）
// video_sequences 表 + 与 video_tasks 子任务的聚合逻辑，供视频任务引擎使用。
// 每行代表一个 M6 多镜头序列（父任务），其镜头由 video_tasks.sequence_id 关联。
// 状态由子任务状态聚合而来（reconcileVideoSequence）。

import type Database from 'better-sqlite3'
import type { VideoProvider, VideoSequence, VideoSequenceStatus } from '@shared/types'
import { getDatabase } from '../index'
import { generateId } from '../../utils/id'

/** 创建序列时的入参 */
export interface CreateVideoSequenceParams {
  title: string
  provider?: VideoProvider
  totalCount: number
}

/** 运行时可更新的序列字段 */
export interface UpdateVideoSequenceParams {
  status?: VideoSequenceStatus
  succeededCount?: number
  failedCount?: number
  cancelledCount?: number
}

/** SQLite 行结构（snake_case，与 video_sequences 表一致） */
interface VideoSequenceRow {
  id: string
  title: string
  provider: string
  status: string
  total_count: number
  succeeded_count: number
  failed_count: number
  cancelled_count: number
  created_at: number
  updated_at: number
}

function rowToSequence(row: VideoSequenceRow): VideoSequence {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider as VideoProvider,
    status: row.status as VideoSequenceStatus,
    totalCount: row.total_count,
    succeededCount: row.succeeded_count,
    failedCount: row.failed_count,
    cancelledCount: row.cancelled_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建多镜头序列记录（初始为 submitted）。
 */
export function createVideoSequence(params: CreateVideoSequenceParams): VideoSequence {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO video_sequences
      (id, title, provider, status, total_count, succeeded_count, failed_count, cancelled_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
  ).run(id, params.title, params.provider ?? 'seedance', 'submitted', params.totalCount, now, now)

  const seq = getVideoSequenceById(id)
  if (!seq) throw new Error('Failed to create video sequence')
  return seq
}

/**
 * 根据 ID 获取多镜头序列。
 */
export function getVideoSequenceById(id: string): VideoSequence | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM video_sequences WHERE id = ?').get(id) as
    | VideoSequenceRow
    | undefined
  return row ? rowToSequence(row) : null
}

/**
 * 分页获取多镜头序列列表（按创建时间倒序）。
 */
export function listVideoSequences(limit = 50): VideoSequence[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM video_sequences ORDER BY created_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(limit, 200))) as VideoSequenceRow[]
  return rows.map(rowToSequence)
}

/**
 * 更新多镜头序列的部分字段（自动刷新 updated_at）。
 */
export function updateVideoSequence(
  id: string,
  params: UpdateVideoSequenceParams,
): VideoSequence | null {
  const db: Database.Database = getDatabase()
  const existing = getVideoSequenceById(id)
  if (!existing) return null

  const values: Array<number | string> = []
  const setClauses: string[] = ['updated_at = ?']
  values.push(Date.now())

  if (params.status !== undefined) {
    setClauses.push('status = ?')
    values.push(params.status)
  }
  if (params.succeededCount !== undefined) {
    setClauses.push('succeeded_count = ?')
    values.push(params.succeededCount)
  }
  if (params.failedCount !== undefined) {
    setClauses.push('failed_count = ?')
    values.push(params.failedCount)
  }
  if (params.cancelledCount !== undefined) {
    setClauses.push('cancelled_count = ?')
    values.push(params.cancelledCount)
  }

  db.prepare(`UPDATE video_sequences SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...[...values, id] as Array<number | string>,
  )
  return getVideoSequenceById(id)
}

/**
 * 根据序列下子任务的最新状态聚合父序列计数与状态。
 * 规则：全部成功→succeeded；任一失败→failed；全部取消→cancelled；否则 running。
 */
export function reconcileVideoSequence(sequenceId: string): VideoSequence | null {
  const db: Database.Database = getDatabase()
  const seq = getVideoSequenceById(sequenceId)
  if (!seq) return null

  const row = db
    .prepare(
      `SELECT
         COUNT(*)                             AS total,
         SUM(status = 'succeeded')            AS succeeded,
         SUM(status = 'failed')               AS failed,
         SUM(status = 'cancelled')            AS cancelled
       FROM video_tasks WHERE sequence_id = ?`,
    )
    .get(sequenceId) as { total: number; succeeded: number; failed: number; cancelled: number }

  const total = Number(row.total) || 0
  const succeeded = Number(row.succeeded) || 0
  const failed = Number(row.failed) || 0
  const cancelled = Number(row.cancelled) || 0

  let status: VideoSequenceStatus
  if (total > 0 && succeeded === total) {
    status = 'succeeded'
  } else if (failed > 0) {
    status = 'failed'
  } else if (total > 0 && cancelled === total) {
    status = 'cancelled'
  } else {
    status = total === 0 ? 'submitted' : 'running'
  }

  return updateVideoSequence(sequenceId, {
    status,
    succeededCount: succeeded,
    failedCount: failed,
    cancelledCount: cancelled,
  })
}

/**
 * 删除多镜头序列记录。
 */
export function deleteVideoSequence(id: string): void {
  const db: Database.Database = getDatabase()
  db.prepare('DELETE FROM video_sequences WHERE id = ?').run(id)
}