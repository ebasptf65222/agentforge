// AgentForge P2-02: Checkpoint Repository
// checkpoints 表数据访问层

import type Database from 'better-sqlite3'
import type { Checkpoint } from '@shared/types'
import { getDatabase } from '../index'

/** SQLite 行类型 */
interface CheckpointRow {
  id: number
  execution_id: string | null
  conversation_id: string | null
  relative_path: string
  original_content: string | null
  new_content: string
  action: 'write' | 'delete' | 'rename'
  created_at: number
}

/**
 * 行数据转换为领域对象。
 */
function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    executionId: row.execution_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    relativePath: row.relative_path,
    originalContent: row.original_content ?? undefined,
    newContent: row.new_content,
    action: row.action,
    createdAt: row.created_at,
  }
}

/**
 * 创建快照记录。
 *
 * @param checkpoint - 快照数据
 * @returns 插入后的快照（含 id）
 */
export function createCheckpoint(checkpoint: Omit<Checkpoint, 'id' | 'createdAt'>): Checkpoint {
  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO checkpoints (execution_id, conversation_id, relative_path, original_content, new_content, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const now = Date.now()
  const result = stmt.run(
    checkpoint.executionId ?? null,
    checkpoint.conversationId ?? null,
    checkpoint.relativePath,
    checkpoint.originalContent ?? null,
    checkpoint.newContent,
    checkpoint.action,
    now,
  )
  return {
    ...checkpoint,
    id: Number(result.lastInsertRowid),
    createdAt: now,
  }
}

/**
 * 根据 ID 获取快照。
 *
 * @param id - 快照 ID
 * @returns 快照或 undefined
 */
export function getCheckpointById(id: number): Checkpoint | undefined {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM checkpoints WHERE id = ?')
    .get(id) as CheckpointRow | undefined
  return row ? rowToCheckpoint(row) : undefined
}

/**
 * 列出快照。
 *
 * @param options - 筛选和分页选项
 * @returns 快照列表
 */
export function listCheckpoints(options: {
  executionId?: string
  conversationId?: string
  relativePath?: string
  action?: 'write' | 'delete' | 'rename'
  limit?: number
  offset?: number
} = {}): Checkpoint[] {
  const db = getDatabase()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options.executionId !== undefined) {
    conditions.push('execution_id = ?')
    params.push(options.executionId)
  }
  if (options.conversationId !== undefined) {
    conditions.push('conversation_id = ?')
    params.push(options.conversationId)
  }
  if (options.relativePath !== undefined) {
    conditions.push('relative_path = ?')
    params.push(options.relativePath)
  }
  if (options.action !== undefined) {
    conditions.push('action = ?')
    params.push(options.action)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0

  const rows = db
    .prepare(
      `SELECT * FROM checkpoints ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CheckpointRow[]

  return rows.map(rowToCheckpoint)
}

/**
 * 统计快照数量。
 *
 * @param options - 筛选选项
 * @returns 快照数量
 */
export function countCheckpoints(options: {
  executionId?: string
  conversationId?: string
  relativePath?: string
} = {}): number {
  const db = getDatabase()
  const conditions: string[] = []
  const params: string[] = []

  if (options.executionId !== undefined) {
    conditions.push('execution_id = ?')
    params.push(options.executionId)
  }
  if (options.conversationId !== undefined) {
    conditions.push('conversation_id = ?')
    params.push(options.conversationId)
  }
  if (options.relativePath !== undefined) {
    conditions.push('relative_path = ?')
    params.push(options.relativePath)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = db.prepare(`SELECT COUNT(*) as count FROM checkpoints ${whereClause}`).get(...params) as { count: number }
  return result.count
}

/**
 * 删除指定快照。
 *
 * @param id - 快照 ID
 * @returns 是否删除成功
 */
export function deleteCheckpoint(id: number): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * 批量删除旧快照（清理策略）。
 *
 * @param beforeTimestamp - 删除此时间戳之前的快照
 * @param keepPerFile - 每个文件保留的最少快照数（默认 10）
 * @returns 删除的快照数量
 */
export function pruneOldCheckpoints(beforeTimestamp: number, keepPerFile: number = 10): number {
  const db = getDatabase()

  // 使用 CTE 为每个文件按时间倒序编号，删除超出保留数量的旧快照
  const stmt = db.prepare(
    `DELETE FROM checkpoints
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY relative_path ORDER BY created_at DESC) as rn
         FROM checkpoints
         WHERE created_at < ?
       )
       WHERE rn > ?
     )`,
  )

  const result = stmt.run(beforeTimestamp, keepPerFile)
  return result.changes
}

/**
 * 清空所有快照（谨慎使用）。
 *
 * @returns 删除的快照数量
 */
export function clearAllCheckpoints(): number {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM checkpoints').run()
  return result.changes
}
