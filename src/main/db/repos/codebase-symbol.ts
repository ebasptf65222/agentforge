// AgentForge codebase_symbols 表的数据访问层（Repository）
// CB-02: 代码符号 CRUD

import type Database from 'better-sqlite3'
import type { CodebaseSymbol, SymbolType, SymbolVisibility } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/** SQLite 行类型 */
interface CodebaseSymbolRow {
  id: string
  file_id: string
  name: string
  qualified_name: string
  symbol_type: string
  visibility: string
  signature: string | null
  start_line: number
  end_line: number
  doc_comment: string | null
  created_at: number
}

/** 创建参数 */
export interface CreateCodebaseSymbolParams {
  fileId: string
  name: string
  qualifiedName: string
  symbolType: SymbolType
  visibility?: SymbolVisibility
  signature?: string
  startLine: number
  endLine: number
  docComment?: string
}

/** 查询过滤参数 */
export interface ListCodebaseSymbolsOptions {
  fileId?: string
  name?: string
  symbolType?: SymbolType
  limit?: number
  offset?: number
}

const VALID_SYMBOL_TYPES: SymbolType[] = [
  'function', 'method', 'class', 'interface', 'type', 'variable', 'import', 'export', 'constant', 'enum',
]

/** 行 → 实体转换 */
function rowToCodebaseSymbol(row: CodebaseSymbolRow): CodebaseSymbol {
  return {
    id: row.id,
    fileId: row.file_id,
    name: row.name,
    qualifiedName: row.qualified_name,
    symbolType: row.symbol_type as SymbolType,
    visibility: row.visibility as SymbolVisibility,
    signature: row.signature ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    docComment: row.doc_comment ?? undefined,
    createdAt: row.created_at,
  }
}

/** 创建单个符号。 */
export function createCodebaseSymbol(params: CreateCodebaseSymbolParams): CodebaseSymbol {
  const db: Database.Database = getDatabase()

  const id = generateId()
  const now = Date.now()

  db.prepare(
    `INSERT INTO codebase_symbols
      (id, file_id, name, qualified_name, symbol_type, visibility, signature, start_line, end_line, doc_comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.fileId,
    params.name,
    params.qualifiedName,
    params.symbolType,
    params.visibility ?? 'default',
    params.signature ?? null,
    params.startLine,
    params.endLine,
    params.docComment ?? null,
    now,
  )

  return getCodebaseSymbolById(id)
}

/** 批量创建符号（事务）。 */
export function batchCreateCodebaseSymbols(
  params: { fileId: string; symbols: CreateCodebaseSymbolParams[] },
): CodebaseSymbol[] {
  const db: Database.Database = getDatabase()

  const now = Date.now()
  const insertStmt = db.prepare(
    `INSERT INTO codebase_symbols
      (id, file_id, name, qualified_name, symbol_type, visibility, signature, start_line, end_line, doc_comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const ids: string[] = []

  const transaction = db.transaction(() => {
    for (const sym of params.symbols) {
      const id = generateId()
      insertStmt.run(
        id,
        params.fileId,
        sym.name,
        sym.qualifiedName,
        sym.symbolType,
        sym.visibility ?? 'default',
        sym.signature ?? null,
        sym.startLine,
        sym.endLine,
        sym.docComment ?? null,
        now,
      )
      ids.push(id)
    }
  })

  transaction()

  return ids.map((id) => getCodebaseSymbolById(id))
}

/** 根据 ID 查询符号。 */
export function getCodebaseSymbolById(id: string): CodebaseSymbol {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM codebase_symbols WHERE id = ?').get(id) as
    | CodebaseSymbolRow
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `Symbol with id "${id}" not found.`,
      { id },
    )
  }

  return rowToCodebaseSymbol(row)
}

/** 查询符号列表，支持多种过滤。 */
export function listCodebaseSymbols(options?: ListCodebaseSymbolsOptions): CodebaseSymbol[] {
  const db: Database.Database = getDatabase()

  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options?.fileId !== undefined) {
    conditions.push('file_id = ?')
    params.push(options.fileId)
  }

  if (options?.name !== undefined) {
    conditions.push('name LIKE ?')
    params.push(`%${options.name}%`)
  }

  if (options?.symbolType !== undefined) {
    if (!VALID_SYMBOL_TYPES.includes(options.symbolType)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid symbol type "${options.symbolType}". Valid: ${VALID_SYMBOL_TYPES.join(', ')}.`,
      )
    }
    conditions.push('symbol_type = ?')
    params.push(options.symbolType)
  }

  let query = 'SELECT * FROM codebase_symbols'
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY file_id ASC, start_line ASC'

  if (options?.limit !== undefined) {
    query += ' LIMIT ?'
    params.push(options.limit)
    if (options?.offset !== undefined) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }
  }

  const rows = db.prepare(query).all(...params) as CodebaseSymbolRow[]
  return rows.map(rowToCodebaseSymbol)
}

/** 按名称模糊搜索符号。 */
export function searchCodebaseSymbols(namePattern: string, limit: number = 20): CodebaseSymbol[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare(
      `SELECT * FROM codebase_symbols
       WHERE name LIKE ? OR qualified_name LIKE ?
       ORDER BY start_line ASC
       LIMIT ?`,
    )
    .all(`%${namePattern}%`, `%${namePattern}%`, limit) as CodebaseSymbolRow[]
  return rows.map(rowToCodebaseSymbol)
}

/** 删除文件的所有符号。 */
export function deleteCodebaseSymbolsByFileId(fileId: string): number {
  const db: Database.Database = getDatabase()
  const result = db.prepare('DELETE FROM codebase_symbols WHERE file_id = ?').run(fileId)
  return result.changes
}

/** 统计符号数量。 */
export function countCodebaseSymbols(options?: { fileId?: string; symbolType?: SymbolType }): number {
  const db: Database.Database = getDatabase()

  const conditions: string[] = []
  const params: string[] = []

  if (options?.fileId !== undefined) {
    conditions.push('file_id = ?')
    params.push(options.fileId)
  }

  if (options?.symbolType !== undefined) {
    conditions.push('symbol_type = ?')
    params.push(options.symbolType)
  }

  let query = 'SELECT COUNT(*) as cnt FROM codebase_symbols'
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  const row = db.prepare(query).get(...params) as { cnt: number }
  return row.cnt
}
