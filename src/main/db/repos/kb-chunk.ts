// AgentForge kb_chunks 表的数据访问层（Repository）
// 实现 P4-01: 文档分块 CRUD + 嵌入管理
// 与 Spec v0.2 §5.7 DocumentChunk 类型一致

import type Database from 'better-sqlite3'
import type { DocumentChunk } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 * - embedding: TEXT (JSON 数组字符串) | null
 * - chunk_index: INTEGER
 */
interface KbChunkRow {
  id: string
  document_id: string
  content: string
  token_count: number
  chunk_index: number
  embedding: string | null
  created_at: number
}

/** 创建分块参数 */
export interface CreateKbChunkParams {
  documentId: string
  content: string
  tokenCount: number
  chunkIndex: number
}

/** 批量创建分块参数 */
export interface BatchCreateKbChunkParams {
  documentId: string
  chunks: Array<{ content: string; tokenCount: number; chunkIndex: number }>
}

/**
 * 将数据库行转换为 DocumentChunk 实体。
 */
function rowToDocumentChunk(row: KbChunkRow): DocumentChunk {
  let embedding: number[] | undefined
  if (row.embedding !== null) {
    try {
      embedding = JSON.parse(row.embedding) as number[]
    } catch {
      embedding = undefined
    }
  }

  return {
    id: row.id,
    documentId: row.document_id,
    content: row.content,
    tokenCount: row.token_count,
    chunkIndex: row.chunk_index,
    embedding,
  }
}

/**
 * 创建单个分块。
 *
 * @param params - 创建参数
 * @returns 新建的 DocumentChunk
 */
export function createKbChunk(params: CreateKbChunkParams): DocumentChunk {
  const db: Database.Database = getDatabase()

  const id = generateId()
  const now = Date.now()

  db.prepare(
    `INSERT INTO kb_chunks
      (id, document_id, content, token_count, chunk_index, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, params.documentId, params.content, params.tokenCount, params.chunkIndex, null, now)

  return getKbChunkById(id)
}

/**
 * 批量创建分块（使用事务确保原子性）。
 *
 * @param params - 批量创建参数
 * @returns 新建的 DocumentChunk 数组
 */
export function batchCreateKbChunks(params: BatchCreateKbChunkParams): DocumentChunk[] {
  const db: Database.Database = getDatabase()

  const now = Date.now()
  const insertStmt = db.prepare(
    `INSERT INTO kb_chunks
      (id, document_id, content, token_count, chunk_index, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )

  const ids: string[] = []

  const transaction = db.transaction(() => {
    for (const chunk of params.chunks) {
      const id = generateId()
      insertStmt.run(
        id,
        params.documentId,
        chunk.content,
        chunk.tokenCount,
        chunk.chunkIndex,
        null,
        now,
      )
      ids.push(id)
    }
  })

  transaction()

  return ids.map((id) => getKbChunkById(id))
}

/**
 * 根据 ID 查询单个分块。
 *
 * @param id - 分块 ID
 * @returns DocumentChunk 实体
 * @throws {AppError} KB_CHUNK_NOT_FOUND - 分块不存在
 */
export function getKbChunkById(id: string): DocumentChunk {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM kb_chunks WHERE id = ?').get(id) as KbChunkRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KB_CHUNK_NOT_FOUND, `Chunk with id "${id}" not found.`, { id })
  }

  return rowToDocumentChunk(row)
}

/**
 * 查询文档的所有分块（按 chunk_index 升序）。
 *
 * @param documentId - 文档 ID
 * @returns DocumentChunk 数组
 */
export function getKbChunksByDocumentId(documentId: string): DocumentChunk[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index ASC')
    .all(documentId) as KbChunkRow[]
  return rows.map(rowToDocumentChunk)
}

/**
 * 更新单个分块的嵌入向量。
 *
 * @param id - 分块 ID
 * @param embedding - 嵌入向量（number 数组）
 * @throws {AppError} KB_CHUNK_NOT_FOUND - 分块不存在
 */
export function updateKbChunkEmbedding(id: string, embedding: number[]): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM kb_chunks WHERE id = ?').get(id) as
    { id: string } | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KB_CHUNK_NOT_FOUND, `Chunk with id "${id}" not found.`, { id })
  }

  db.prepare('UPDATE kb_chunks SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), id)
}

/**
 * 批量更新分块嵌入（使用事务确保原子性）。
 *
 * @param updates - 嵌入更新数组
 */
export function batchUpdateKbChunkEmbeddings(
  updates: Array<{ id: string; embedding: number[] }>,
): void {
  const db: Database.Database = getDatabase()

  const updateStmt = db.prepare('UPDATE kb_chunks SET embedding = ? WHERE id = ?')

  const transaction = db.transaction(() => {
    for (const update of updates) {
      updateStmt.run(JSON.stringify(update.embedding), update.id)
    }
  })

  transaction()
}

/**
 * 删除文档的所有分块。
 *
 * @param documentId - 文档 ID
 * @returns 删除的分块数量
 */
export function deleteKbChunksByDocumentId(documentId: string): number {
  const db: Database.Database = getDatabase()
  const result = db.prepare('DELETE FROM kb_chunks WHERE document_id = ?').run(documentId)
  return result.changes
}

/**
 * 清除文档所有分块的嵌入向量（设为 NULL）。
 * 用于重建索引前正确清除旧嵌入，而非用空数组代替。
 *
 * @param documentId - 文档 ID
 * @returns 清除嵌入的分块数量
 */
export function clearKbChunkEmbeddings(documentId: string): number {
  const db: Database.Database = getDatabase()
  const result = db
    .prepare('UPDATE kb_chunks SET embedding = NULL WHERE document_id = ?')
    .run(documentId)
  return result.changes
}

/**
 * 获取已生成嵌入的分块（支持分页）。
 * 用于语义搜索时加载向量数据。
 *
 * @param options - 可选过滤和分页参数
 * @returns DocumentChunk 数组（仅包含有嵌入的）
 */
export function getKbChunksWithEmbeddings(
  options?: { documentId?: string; limit?: number; offset?: number },
): DocumentChunk[] {
  const db: Database.Database = getDatabase()

  let query = 'SELECT * FROM kb_chunks WHERE embedding IS NOT NULL'
  const params: (string | number)[] = []

  if (options?.documentId !== undefined) {
    query += ' AND document_id = ?'
    params.push(options.documentId)
  }

  query += ' ORDER BY document_id ASC, chunk_index ASC'

  if (options?.limit !== undefined) {
    query += ' LIMIT ?'
    params.push(options.limit)
    if (options?.offset !== undefined) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }
  }

  const rows = db.prepare(query).all(...params) as KbChunkRow[]
  return rows.map(rowToDocumentChunk)
}

/**
 * 统计已生成嵌入的分块总数。
 *
 * @param options - 可选过滤参数
 * @returns 有嵌入的分块数量
 */
export function countKbChunksWithEmbeddings(options?: { documentId?: string }): number {
  const db: Database.Database = getDatabase()
  let query = 'SELECT COUNT(*) as cnt FROM kb_chunks WHERE embedding IS NOT NULL'
  const params: string[] = []
  if (options?.documentId !== undefined) {
    query += ' AND document_id = ?'
    params.push(options.documentId)
  }
  const row = db.prepare(query).get(...params) as { cnt: number }
  return row.cnt
}

/**
 * 获取文档的分块数量。
 *
 * @param documentId - 文档 ID
 * @returns 分块数量
 */
export function countKbChunks(documentId: string): number {
  const db: Database.Database = getDatabase()
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM kb_chunks WHERE document_id = ?')
    .get(documentId) as { cnt: number }
  return row.cnt
}

/**
 * 获取所有文档的总分块数量。
 *
 * @returns 分块总数
 */
export function countAllKbChunks(): number {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT COUNT(*) as cnt FROM kb_chunks').get() as { cnt: number }
  return row.cnt
}

/**
 * 检查分块是否存在。
 *
 * @param id - 分块 ID
 * @returns 是否存在
 */
export function kbChunkExists(id: string): boolean {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT 1 FROM kb_chunks WHERE id = ?').get(id) as
    { '1': number } | undefined
  return row !== undefined
}
