// AgentForge 视频任务数据访问层（Repository）
// video_tasks 表的 CRUD 与状态更新，供视频任务引擎持久化任务元数据。
// 视频文件本体存储于 workspace/videos，output_path 保存相对路径。

import type Database from 'better-sqlite3'
import type { CreateVideoTaskParams, VideoProvider, VideoTask, VideoTaskStatus } from '@shared/types'
import { getDatabase } from '../index'
import { generateId } from '../../utils/id'

/** 创建任务时的本地状态字段 */
interface CreateVideoTaskRow extends CreateVideoTaskParams {
  model: string
  provider?: VideoProvider
}

/** 运行时可更新的任务字段 */
export interface UpdateVideoTaskParams {
  providerTaskId?: string | null
  status?: VideoTaskStatus
  progress?: number
  errorCode?: string | null
  errorMessage?: string | null
  downloadUrl?: string | null
  outputPath?: string | null
}

/** SQLite 行结构（snake_case，与 video_tasks 表一致） */
interface VideoTaskRow {
  id: string
  provider: string
  provider_task_id: string | null
  prompt: string
  model: string
  duration: number
  resolution: string
  aspect: string
  status: string
  progress: number
  error_code: string | null
  error_message: string | null
  download_url: string | null
  output_path: string | null
  sequence_id: string | null
  shot_index: number | null
  is_chained: number
  created_at: number
  updated_at: number
}

function rowToTask(row: VideoTaskRow): VideoTask {
  return {
    id: row.id,
    provider: row.provider as VideoProvider,
    providerTaskId: row.provider_task_id,
    prompt: row.prompt,
    model: row.model,
    duration: row.duration,
    resolution: row.resolution as VideoTask['resolution'],
    aspect: row.aspect as VideoTask['aspect'],
    status: row.status as VideoTaskStatus,
    progress: row.progress,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    downloadUrl: row.download_url,
    outputPath: row.output_path,
    sequenceId: row.sequence_id,
    shotIndex: row.shot_index,
    isChained: Boolean(row.is_chained),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建视频任务记录。
 */
export function createVideoTask(params: CreateVideoTaskRow): VideoTask {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO video_tasks
      (id, provider, provider_task_id, prompt, model, duration, resolution, aspect,
       status, progress, error_code, error_message, download_url, output_path,
       sequence_id, shot_index, is_chained, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.provider ?? 'seedance',
    null,
    params.prompt,
    params.model,
    params.duration ?? 5,
    params.resolution ?? '720P',
    params.aspect ?? '16:9',
    'submitted',
    0,
    null,
    null,
    null,
    null,
    params.sequenceId ?? null,
    params.shotIndex ?? null,
    params.isChained ? 1 : 0,
    now,
    now,
  )

  const task = getVideoTaskById(id)
  if (!task) throw new Error('Failed to create video task')
  return task
}

/**
 * 创建多镜头序列中的“排队”子任务（M8 连续性衔接专用）。
 * 仅在连续性序列生成时使用：各镜头先以 queued 落库占位，
 * 达成一个镜头后由引擎截取其尾帧，再把下一个 queued 任务提交到厂商。
 * 非连续性（M6 并行跑批）无需此路径。
 */
export function createQueuedVideoTask(params: {
  provider: VideoProvider
  prompt: string
  model: string
  duration: number
  resolution: VideoTask['resolution']
  aspect: VideoTask['aspect']
  sequenceId: string
  shotIndex: number
  isChained: boolean
}): VideoTask {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO video_tasks
      (id, provider, provider_task_id, prompt, model, duration, resolution, aspect,
       status, progress, error_code, error_message, download_url, output_path,
       sequence_id, shot_index, is_chained, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.provider,
    params.prompt,
    params.model,
    params.duration,
    params.resolution,
    params.aspect,
    params.sequenceId,
    params.shotIndex,
    params.isChained ? 1 : 0,
    now,
    now,
  )

  const task = getVideoTaskById(id)
  if (!task) throw new Error('Failed to create queued video task')
  return task
}

/**
 * 根据 ID 获取视频任务。
 */
export function getVideoTaskById(id: string): VideoTask | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM video_tasks WHERE id = ?').get(id) as
    | VideoTaskRow
    | undefined
  return row ? rowToTask(row) : null
}

/**
 * 分页获取视频任务列表（按创建时间倒序）。
 */
export function listVideoTasks(limit = 50): VideoTask[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM video_tasks ORDER BY created_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(limit, 200))) as VideoTaskRow[]
  return rows.map(rowToTask)
}

/**
 * 获取指定多镜头序列下的全部子任务（按镜头序号升序）。
 */
export function listVideoTasksBySequence(sequenceId: string): VideoTask[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM video_tasks WHERE sequence_id = ? ORDER BY shot_index ASC, created_at ASC')
    .all(sequenceId) as VideoTaskRow[]
  return rows.map(rowToTask)
}

/**
 * 更新视频任务的部分字段（仅提供者字段被更新，自动刷新 updated_at）。
 */
export function updateVideoTask(id: string, params: UpdateVideoTaskParams): VideoTask | null {
  const db: Database.Database = getDatabase()
  const existing = getVideoTaskById(id)
  if (!existing) return null

  const values: Array<number | string | null> = []
  const setClauses: string[] = ['updated_at = ?']
  values.push(Date.now())

  if (params.providerTaskId !== undefined) {
    setClauses.push('provider_task_id = ?')
    values.push(params.providerTaskId)
  }
  if (params.status !== undefined) {
    setClauses.push('status = ?')
    values.push(params.status)
  }
  if (params.progress !== undefined) {
    setClauses.push('progress = ?')
    values.push(params.progress)
  }
  if (params.errorCode !== undefined) {
    setClauses.push('error_code = ?')
    values.push(params.errorCode)
  }
  if (params.errorMessage !== undefined) {
    setClauses.push('error_message = ?')
    values.push(params.errorMessage)
  }
  if (params.downloadUrl !== undefined) {
    setClauses.push('download_url = ?')
    values.push(params.downloadUrl)
  }
  if (params.outputPath !== undefined) {
    setClauses.push('output_path = ?')
    values.push(params.outputPath)
  }

  db.prepare(`UPDATE video_tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...([...values, id] as Array<number | string | null>),
  )
  return getVideoTaskById(id)
}

/**
 * 删除视频任务记录。
 */
export function deleteVideoTask(id: string): void {
  const db: Database.Database = getDatabase()
  db.prepare('DELETE FROM video_tasks WHERE id = ?').run(id)
}