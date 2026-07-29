// AgentForge codebase_files 表的数据访问层（Repository）
// CB-01: 代码库文件 CRUD + 增量扫描支持

import type Database from 'better-sqlite3'
import type { CodebaseFile, CodebaseLanguage, CodebaseFileStatus } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/** SQLite 行类型 */
interface CodebaseFileRow {
  id: string
  file_path: string
  file_name: string
  language: string
  file_hash: string
  line_count: number
  symbol_count: number
  chunk_count: number
  status: string
  error_message: string | null
  indexed_at: number | null
  created_at: number
  updated_at: number
}

/** 创建参数 */
export interface CreateCodebaseFileParams {
  filePath: string
  fileName: string
  language: CodebaseLanguage
  fileHash: string
  lineCount: number
}

/** 更新参数 */
export interface UpdateCodebaseFileParams {
  id: string
  status?: CodebaseFileStatus
  errorMessage?: string | null
  fileHash?: string
  lineCount?: number
  symbolCount?: number
  chunkCount?: number
  indexedAt?: number | null
}

/** 查询过滤参数 */
export interface ListCodebaseFilesOptions {
  language?: CodebaseLanguage
  status?: CodebaseFileStatus
  limit?: number
  offset?: number
}

const VALID_STATUSES: CodebaseFileStatus[] = ['pending', 'indexing', 'ready', 'error']

/** 行 → 实体转换 */
function rowToCodebaseFile(row: CodebaseFileRow): CodebaseFile {
  return {
    id: row.id,
    filePath: row.file_path,
    fileName: row.file_name,
    language: row.language as CodebaseLanguage,
    fileHash: row.file_hash,
    lineCount: row.line_count,
    symbolCount: row.symbol_count,
    chunkCount: row.chunk_count,
    status: row.status as CodebaseFileStatus,
    errorMessage: row.error_message ?? undefined,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建代码库文件记录。
 * file_path 唯一约束，重复时抛出错误。
 */
export function createCodebaseFile(params: CreateCodebaseFileParams): CodebaseFile {
  const db: Database.Database = getDatabase()

  const existing = db
    .prepare('SELECT id FROM codebase_files WHERE file_path = ?')
    .get(params.filePath) as { id: string } | undefined

  if (existing !== undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `File with path "${params.filePath}" already exists in codebase index.`,
      { filePath: params.filePath },
    )
  }

  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO codebase_files
      (id, file_path, file_name, language, file_hash, line_count, symbol_count, chunk_count, status, error_message, indexed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'pending', NULL, NULL, ?, ?)`,
  ).run(id, params.filePath, params.fileName, params.language, params.fileHash, params.lineCount, now, now)

  return getCodebaseFileById(id)
}

/** 根据 ID 查询文件。 */
export function getCodebaseFileById(id: string): CodebaseFile {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM codebase_files WHERE id = ?').get(id) as
    | CodebaseFileRow
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `Codebase file with id "${id}" not found.`,
      { id },
    )
  }

  return rowToCodebaseFile(row)
}

/** 根据文件路径查询文件。 */
export function getCodebaseFileByPath(filePath: string): CodebaseFile | undefined {
  const db: Database.Database = getDatabase()
  const row = db
    .prepare('SELECT * FROM codebase_files WHERE file_path = ?')
    .get(filePath) as CodebaseFileRow | undefined

  if (row === undefined) {
    return undefined
  }

  return rowToCodebaseFile(row)
}

/** 列出所有文件，支持过滤和分页。 */
export function listCodebaseFiles(options?: ListCodebaseFilesOptions): CodebaseFile[] {
  const db: Database.Database = getDatabase()

  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options?.language !== undefined) {
    conditions.push('language = ?')
    params.push(options.language)
  }

  if (options?.status !== undefined) {
    conditions.push('status = ?')
    params.push(options.status)
  }

  let query = 'SELECT * FROM codebase_files'
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY file_path ASC'

  if (options?.limit !== undefined) {
    query += ' LIMIT ?'
    params.push(options.limit)
    if (options?.offset !== undefined) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }
  }

  const rows = db.prepare(query).all(...params) as CodebaseFileRow[]
  return rows.map(rowToCodebaseFile)
}

/**
 * 更新文件记录。
 * 仅更新提供的字段，自动更新 updated_at。
 */
export function updateCodebaseFile(params: UpdateCodebaseFileParams): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM codebase_files WHERE id = ?').get(params.id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `Codebase file with id "${params.id}" not found.`,
      { id: params.id },
    )
  }

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (params.status !== undefined) {
    if (!VALID_STATUSES.includes(params.status)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid status "${params.status}". Valid: ${VALID_STATUSES.join(', ')}.`,
      )
    }
    setClauses.push('status = ?')
    values.push(params.status)
  }

  if (params.errorMessage !== undefined) {
    setClauses.push('error_message = ?')
    values.push(params.errorMessage)
  }

  if (params.fileHash !== undefined) {
    setClauses.push('file_hash = ?')
    values.push(params.fileHash)
  }

  if (params.lineCount !== undefined) {
    setClauses.push('line_count = ?')
    values.push(params.lineCount)
  }

  if (params.symbolCount !== undefined) {
    setClauses.push('symbol_count = ?')
    values.push(params.symbolCount)
  }

  if (params.chunkCount !== undefined) {
    setClauses.push('chunk_count = ?')
    values.push(params.chunkCount)
  }

  if (params.indexedAt !== undefined) {
    setClauses.push('indexed_at = ?')
    values.push(params.indexedAt)
  }

  values.push(params.id)
  db.prepare(`UPDATE codebase_files SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 删除文件记录。
 * 关联的 symbols 和 chunks 通过 ON DELETE CASCADE 自动删除。
 */
export function deleteCodebaseFile(id: string): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM codebase_files WHERE id = ?').get(id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `Codebase file with id "${id}" not found.`,
      { id },
    )
  }

  db.prepare('DELETE FROM codebase_files WHERE id = ?').run(id)
}

/** 删除所有文件记录（清空代码库索引）。 */
export function deleteAllCodebaseFiles(): number {
  const db: Database.Database = getDatabase()
  const result = db.prepare('DELETE FROM codebase_files').run()
  return result.changes
}

/** 检查文件是否存在。 */
export function codebaseFileExists(id: string): boolean {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT 1 FROM codebase_files WHERE id = ?').get(id) as
    | { '1': number }
    | undefined
  return row !== undefined
}

/** 统计文件数量。 */
export function countCodebaseFiles(options?: { status?: CodebaseFileStatus; language?: CodebaseLanguage }): number {
  const db: Database.Database = getDatabase()

  const conditions: string[] = []
  const params: string[] = []

  if (options?.status !== undefined) {
    conditions.push('status = ?')
    params.push(options.status)
  }

  if (options?.language !== undefined) {
    conditions.push('language = ?')
    params.push(options.language)
  }

  let query = 'SELECT COUNT(*) as cnt FROM codebase_files'
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  const row = db.prepare(query).get(...params) as { cnt: number }
  return row.cnt
}

/** 获取按语言分组的文件统计。 */
export function getCodebaseFileStatsByLanguage(): Array<{ language: string; fileCount: number }> {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare(
      `SELECT language, COUNT(*) as file_count
       FROM codebase_files
       GROUP BY language
       ORDER BY file_count DESC`,
    )
    .all() as Array<{ language: string; file_count: number }>
  return rows.map((r) => ({ language: r.language, fileCount: r.file_count }))
}

/**
 * Upsert 文件记录：存在则更新，不存在则创建。
 * 用于增量扫描：文件路径相同但 hash 变化时更新。
 */
export function upsertCodebaseFile(params: CreateCodebaseFileParams): CodebaseFile {
  const db: Database.Database = getDatabase()

  const existing = getCodebaseFileByPath(params.filePath)

  if (existing === undefined) {
    return createCodebaseFile(params)
  }

  const now = Date.now()
  db.prepare(
    `UPDATE codebase_files
     SET file_name = ?, language = ?, file_hash = ?, line_count = ?, status = 'pending',
         error_message = NULL, indexed_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(params.fileName, params.language, params.fileHash, params.lineCount, now, existing.id)

  return getCodebaseFileById(existing.id)
}
