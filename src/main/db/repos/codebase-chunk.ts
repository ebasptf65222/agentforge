// AgentForge codebase_chunks 表的数据访问层（Repository）
// CB-03: 代码分块 CRUD + 嵌入管理

import type Database from 'better-sqlite3'
import type { CodebaseChunk, CodeChunkType } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/** SQLite 行类型 */
interface CodebaseChunkRow {
  id: string
  file_id: string
  content: string
  chunk_type: string
  symbol_id: string | null
  start_line: number
  end_line: number
  token_count: number
  chunk_index: number
  embedding: string | null
  created_at: number
}

/** 创建参数 */
export interface CreateCodebaseChunkParams {
  fileId: string
  content: string
  chunkType: CodeChunkType
  symbolId?: string
  startLine: number
  endLine: number
  tokenCount: number
  chunkIndex: number
}

/** 查询过滤参数 */
export interface ListCodebaseChunksOptions {
  fileId?: string
  chunkType?: CodeChunkType
  withEmbedding?: boolean
  limit?: number
  offset?: number
}

const VALID_CHUNK_TYPES: CodeChunkType[] = ['module', 'function', 'class', 'block', 'comment']

/** 行 → 实体转换 */
function rowToCodebaseChunk(row: CodebaseChunkRow): CodebaseChunk {
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
    fileId: row.file_id,
    content: row.content,
    chunkType: row.chunk_type as CodeChunkType,
    symbolId: row.symbol_id ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    tokenCount: row.token_count,
    chunkIndex: row.chunk_index,
    embedding,
  }
}

/** 创建单个代码分块。 */
export function createCodebaseChunk(params: CreateCodebaseChunkParams): CodebaseChunk {
  const db: Database.Database = getDatabase()

  const id = generateId()
  const now = Date.now()

  db.prepare(
    `INSERT INTO codebase_chunks
      (id, file_id, content, chunk_type, symbol_id, start_line, end_line, token_count, chunk_index, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    id,
    params.fileId,
    params.content,
    params.chunkType,
    params.symbolId ?? null,
    params.startLine,
    params.endLine,
    params.tokenCount,
    params.chunkIndex,
    now,
  )

  return getCodebaseChunkById(id)
}

/** 批量创建代码分块（事务）。 */
export function batchCreateCodebaseChunks(
  params: { fileId: string; chunks: CreateCodebaseChunkParams[] },
): CodebaseChunk[] {
  const db: Database.Database = getDatabase()

  const now = Date.now()
  const insertStmt = db.prepare(
    `INSERT INTO codebase_chunks
      (id, file_id, content, chunk_type, symbol_id, start_line, end_line, token_count, chunk_index, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  )

  const ids: string[] = []

  const transaction = db.transaction(() => {
    for (const chunk of params.chunks) {
      const id = generateId()
      insertStmt.run(
        id,
        params.fileId,
        chunk.content,
        chunk.chunkType,
        chunk.symbolId ?? null,
        chunk.startLine,
        chunk.endLine,
        chunk.tokenCount,
        chunk.chunkIndex,
        now,
      )
      ids.push(id)
    }
  })

  transaction()

  return ids.map((id) => getCodebaseChunkById(id))
}

/** 根据 ID 查询分块。 */
export function getCodebaseChunkById(id: string): CodebaseChunk {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM codebase_chunks WHERE id = ?').get(id) as
    | CodebaseChunkRow
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `Codebase chunk with id "${id}" not found.`,
      { id },
    )
  }

  return rowToCodebaseChunk(row)
}

/** 查询分块列表，支持多种过滤。 */
export function listCodebaseChunks(options?: ListCodebaseChunksOptions): CodebaseChunk[] {
  const db: Database.Database = getDatabase()

  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options?.fileId !== undefined) {
    conditions.push('file_id = ?')
    params.push(options.fileId)
  }

  if (options?.chunkType !== undefined) {
    if (!VALID_CHUNK_TYPES.includes(options.chunkType)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid chunk type "${options.chunkType}". Valid: ${VALID_CHUNK_TYPES.join(', ')}.`,
      )
    }
    conditions.push('chunk_type = ?')
    params.push(options.chunkType)
  }

  if (options?.withEmbedding === true) {
    conditions.push('embedding IS NOT NULL')
  } else if (options?.withEmbedding === false) {
    conditions.push('embedding IS NULL')
  }

  let query = 'SELECT * FROM codebase_chunks'
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY file_id ASC, chunk_index ASC'

  if (options?.limit !== undefined) {
    query += ' LIMIT ?'
    params.push(options.limit)
    if (options?.offset !== undefined) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }
  }

  const rows = db.prepare(query).all(...params) as CodebaseChunkRow[]
  return rows.map(rowToCodebaseChunk)
}

/** 更新分块嵌入向量。 */
export function updateCodebaseChunkEmbedding(id: string, embedding: number[]): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM codebase_chunks WHERE id = ?').get(id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `Codebase chunk with id "${id}" not found.`,
      { id },
    )
  }

  db.prepare('UPDATE codebase_chunks SET embedding = ? WHERE id = ?').run(
    JSON.stringify(embedding),
    id,
  )
}

/** 批量更新嵌入向量（事务）。 */
export function batchUpdateCodebaseChunkEmbeddings(
  updates: Array<{ id: string; embedding: number[] }>,
): void {
  const db: Database.Database = getDatabase()

  const updateStmt = db.prepare('UPDATE codebase_chunks SET embedding = ? WHERE id = ?')

  const transaction = db.transaction(() => {
    for (const update of updates) {
      updateStmt.run(JSON.stringify(update.embedding), update.id)
    }
  })

  transaction()
}

/** 清除文件所有分块的嵌入（设为 NULL）。 */
export function clearCodebaseChunkEmbeddings(fileId: string): number {
  const db: Database.Database = getDatabase()
  const result = db
    .prepare('UPDATE codebase_chunks SET embedding = NULL WHERE file_id = ?')
    .run(fileId)
  return result.changes
}

/** 删除文件的所有分块。 */
export function deleteCodebaseChunksByFileId(fileId: string): number {
  const db: Database.Database = getDatabase()
  const result = db.prepare('DELETE FROM codebase_chunks WHERE file_id = ?').run(fileId)
  return result.changes
}

/** 统计分块数量。 */
export function countCodebaseChunks(options?: { fileId?: string }): number {
  const db: Database.Database = getDatabase()

  if (options?.fileId !== undefined) {
    const row = db
      .prepare('SELECT COUNT(*) as cnt FROM codebase_chunks WHERE file_id = ?')
      .get(options.fileId) as { cnt: number }
    return row.cnt
  }

  const row = db.prepare('SELECT COUNT(*) as cnt FROM codebase_chunks').get() as { cnt: number }
  return row.cnt
}

/** 统计已嵌入的分块数量。 */
export function countCodebaseChunksWithEmbeddings(options?: { fileId?: string }): number {
  const db: Database.Database = getDatabase()

  if (options?.fileId !== undefined) {
    const row = db
      .prepare('SELECT COUNT(*) as cnt FROM codebase_chunks WHERE file_id = ? AND embedding IS NOT NULL')
      .get(options.fileId) as { cnt: number }
    return row.cnt
  }

  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM codebase_chunks WHERE embedding IS NOT NULL')
    .get() as { cnt: number }
  return row.cnt
}

/** 获取已嵌入的分块（支持分页）。 */
export function getCodebaseChunksWithEmbeddings(
  options?: { fileId?: string; limit?: number; offset?: number },
): CodebaseChunk[] {
  const db: Database.Database = getDatabase()

  const conditions: string[] = ['embedding IS NOT NULL']
  const params: (string | number)[] = []

  if (options?.fileId !== undefined) {
    conditions.push('file_id = ?')
    params.push(options.fileId)
  }

  let query = 'SELECT * FROM codebase_chunks WHERE ' + conditions.join(' AND ')
  query += ' ORDER BY file_id ASC, chunk_index ASC'

  if (options?.limit !== undefined) {
    query += ' LIMIT ?'
    params.push(options.limit)
    if (options?.offset !== undefined) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }
  }

  const rows = db.prepare(query).all(...params) as CodebaseChunkRow[]
  return rows.map(rowToCodebaseChunk)
}
