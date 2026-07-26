// AgentForge kb_documents 表的数据访问层（Repository）
// 实现 P4-01: 知识库文档 CRUD
// 与 Spec v0.2 §5.7 KbDocument 类型一致

import type Database from 'better-sqlite3'
import type { KbDocument } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 * - file_type: TEXT ('pdf' | 'markdown' | 'txt' | 'docx' | 'xlsx' | 'csv')
 * - status: TEXT ('indexing' | 'ready' | 'error')
 * - error_message: TEXT | null
 */
interface KbDocumentRow {
  id: string
  file_path: string
  file_name: string
  file_type: string
  chunk_count: number
  status: string
  error_message: string | null
  created_at: number
  updated_at: number
}

/** 创建文档参数 */
export interface CreateKbDocumentParams {
  filePath: string
  fileName: string
  fileType: KbDocument['fileType']
}

/** 更新文档参数 */
export interface UpdateKbDocumentParams {
  id: string
  status?: KbDocument['status']
  errorMessage?: string | null
  chunkCount?: number
}

/** 支持的文件类型 */
const VALID_FILE_TYPES = ['pdf', 'markdown', 'txt', 'docx', 'xlsx', 'csv'] as const

/** 支持的状态值 */
const VALID_STATUSES = ['indexing', 'ready', 'error'] as const

/**
 * 将数据库行转换为 KbDocument 实体。
 */
function rowToKbDocument(row: KbDocumentRow): KbDocument {
  return {
    id: row.id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileType: row.file_type as KbDocument['fileType'],
    chunkCount: row.chunk_count,
    status: row.status as KbDocument['status'],
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 校验文件类型是否合法。
 */
function validateFileType(fileType: string): void {
  if (!VALID_FILE_TYPES.includes(fileType as (typeof VALID_FILE_TYPES)[number])) {
    throw new AppError(
      ErrorCodes.KB_INVALID_FILE_TYPE,
      `Unsupported file type "${fileType}". Supported types: ${VALID_FILE_TYPES.join(', ')}.`,
      { fileType },
    )
  }
}

/**
 * 创建知识库文档记录。
 * - file_path 重复时抛出 KB_DOCUMENT_DUPLICATE
 * - 返回带 id 和时间戳的完整 KbDocument
 *
 * @param params - 创建参数
 * @returns 新建的 KbDocument
 * @throws {AppError} KB_DOCUMENT_DUPLICATE - file_path 已存在
 * @throws {AppError} KB_INVALID_FILE_TYPE - 不支持的文件类型
 */
export function createKbDocument(params: CreateKbDocumentParams): KbDocument {
  const db: Database.Database = getDatabase()

  validateFileType(params.fileType)

  // 检查 file_path 是否重复
  const existing = db
    .prepare('SELECT id FROM kb_documents WHERE file_path = ?')
    .get(params.filePath) as { id: string } | undefined

  if (existing !== undefined) {
    throw new AppError(
      ErrorCodes.KB_DOCUMENT_DUPLICATE,
      `Document with path "${params.filePath}" already exists.`,
      { filePath: params.filePath },
    )
  }

  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO kb_documents
      (id, file_path, file_name, file_type, chunk_count, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, params.filePath, params.fileName, params.fileType, 0, 'indexing', null, now, now)

  return getKbDocumentById(id)
}

/**
 * 根据 ID 查询单个文档。
 *
 * @param id - 文档 ID
 * @returns KbDocument 实体
 * @throws {AppError} KB_DOCUMENT_NOT_FOUND - 文档不存在
 */
export function getKbDocumentById(id: string): KbDocument {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM kb_documents WHERE id = ?').get(id) as
    KbDocumentRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KB_DOCUMENT_NOT_FOUND, `Document with id "${id}" not found.`, {
      id,
    })
  }

  return rowToKbDocument(row)
}

/**
 * 根据 file_path 查询单个文档。
 *
 * @param filePath - 文件路径
 * @returns KbDocument 实体或 undefined
 */
export function getKbDocumentByPath(filePath: string): KbDocument | undefined {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM kb_documents WHERE file_path = ?').get(filePath) as
    KbDocumentRow | undefined

  if (row === undefined) {
    return undefined
  }

  return rowToKbDocument(row)
}

/**
 * 查询所有文档。
 *
 * @param options - 可选过滤参数
 * @returns KbDocument 数组（按 updated_at 降序）
 */
export function listKbDocuments(options?: { status?: KbDocument['status'] }): KbDocument[] {
  const db: Database.Database = getDatabase()

  let query = 'SELECT * FROM kb_documents'
  const params: string[] = []

  if (options?.status !== undefined) {
    if (!VALID_STATUSES.includes(options.status)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid status "${options.status}". Valid statuses: ${VALID_STATUSES.join(', ')}.`,
      )
    }
    query += ' WHERE status = ?'
    params.push(options.status)
  }

  query += ' ORDER BY updated_at DESC'

  const rows = db.prepare(query).all(...params) as KbDocumentRow[]
  return rows.map(rowToKbDocument)
}

/**
 * 更新文档状态。
 * - 仅更新提供的字段
 * - 更新 updated_at 时间戳
 *
 * @param params - 更新参数
 * @throws {AppError} KB_DOCUMENT_NOT_FOUND - 文档不存在
 */
export function updateKbDocument(params: UpdateKbDocumentParams): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM kb_documents WHERE id = ?').get(params.id) as
    { id: string } | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.KB_DOCUMENT_NOT_FOUND,
      `Document with id "${params.id}" not found.`,
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
        `Invalid status "${params.status}". Valid statuses: ${VALID_STATUSES.join(', ')}.`,
      )
    }
    setClauses.push('status = ?')
    values.push(params.status)
  }

  if (params.errorMessage !== undefined) {
    setClauses.push('error_message = ?')
    values.push(params.errorMessage)
  }

  if (params.chunkCount !== undefined) {
    setClauses.push('chunk_count = ?')
    values.push(params.chunkCount)
  }

  values.push(params.id)

  db.prepare(`UPDATE kb_documents SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 删除文档。
 * 关联的 kb_chunks 会通过 ON DELETE CASCADE 自动删除。
 *
 * @param id - 文档 ID
 * @throws {AppError} KB_DOCUMENT_NOT_FOUND - 文档不存在
 */
export function deleteKbDocument(id: string): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM kb_documents WHERE id = ?').get(id) as
    { id: string } | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KB_DOCUMENT_NOT_FOUND, `Document with id "${id}" not found.`, {
      id,
    })
  }

  db.prepare('DELETE FROM kb_documents WHERE id = ?').run(id)
}

/**
 * 检查文档是否存在。
 *
 * @param id - 文档 ID
 * @returns 是否存在
 */
export function kbDocumentExists(id: string): boolean {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT 1 FROM kb_documents WHERE id = ?').get(id) as
    { '1': number } | undefined
  return row !== undefined
}

/**
 * 获取文档总数。
 *
 * @param options - 可选过滤参数
 * @returns 文档数量
 */
export function countKbDocuments(options?: { status?: KbDocument['status'] }): number {
  const db: Database.Database = getDatabase()

  if (options?.status !== undefined) {
    const row = db
      .prepare('SELECT COUNT(*) as cnt FROM kb_documents WHERE status = ?')
      .get(options.status) as { cnt: number }
    return row.cnt
  }

  const row = db.prepare('SELECT COUNT(*) as cnt FROM kb_documents').get() as { cnt: number }
  return row.cnt
}
