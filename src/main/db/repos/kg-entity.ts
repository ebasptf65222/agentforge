// AgentForge kg_entities 表的数据访问层（Repository）
// 实现 KG-01: 知识图谱实体 CRUD

import type Database from 'better-sqlite3'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/** 知识图谱实体 */
export interface KgEntity {
  id: string
  name: string
  type: string
  description?: string
  sourceDocId?: string
  confidence: number
  createdAt: number
}

/** 创建实体参数 */
export interface CreateKgEntityParams {
  name: string
  type: string
  description?: string
  sourceDocId?: string
  confidence?: number
}

/** 更新实体参数 */
export interface UpdateKgEntityParams {
  id: string
  name?: string
  type?: string
  description?: string
  sourceDocId?: string | null
  confidence?: number
}

interface KgEntityRow {
  id: string
  name: string
  type: string
  description: string | null
  source_doc_id: string | null
  confidence: number
  created_at: number
}

function rowToEntity(row: KgEntityRow): KgEntity {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description ?? undefined,
    sourceDocId: row.source_doc_id ?? undefined,
    confidence: row.confidence,
    createdAt: row.created_at,
  }
}

/**
 * 创建或获取实体（按 name + type 唯一）。
 * 如果已存在则返回已有实体。
 */
export function createOrGetKgEntity(params: CreateKgEntityParams): KgEntity {
  const db: Database.Database = getDatabase()

  const existing = db
    .prepare('SELECT * FROM kg_entities WHERE name = ? AND type = ?')
    .get(params.name, params.type) as KgEntityRow | undefined

  if (existing) {
    return rowToEntity(existing)
  }

  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO kg_entities
      (id, name, type, description, source_doc_id, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.type,
    params.description ?? null,
    params.sourceDocId ?? null,
    params.confidence ?? 1.0,
    now,
  )

  return getKgEntityById(id)
}

/**
 * 批量创建实体，返回实体列表（含已有实体）。
 */
export function batchCreateKgEntities(paramsList: CreateKgEntityParams[]): KgEntity[] {
  const db: Database.Database = getDatabase()
  const tx = db.transaction(() => {
    return paramsList.map((p) => createOrGetKgEntity(p))
  })
  return tx()
}

/**
 * 根据 ID 查询实体。
 */
export function getKgEntityById(id: string): KgEntity {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM kg_entities WHERE id = ?').get(id) as
    | KgEntityRow
    | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KG_ENTITY_NOT_FOUND, `Entity with id "${id}" not found.`, {
      id,
    })
  }

  return rowToEntity(row)
}

/**
 * 根据 name 查询实体（模糊匹配）。
 */
export function searchKgEntitiesByName(name: string): KgEntity[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare("SELECT * FROM kg_entities WHERE name LIKE '%' || ? || '%'")
    .all(name) as KgEntityRow[]
  return rows.map(rowToEntity)
}

/**
 * 根据 type 查询实体。
 */
export function listKgEntitiesByType(type: string): KgEntity[] {
  const db: Database.Database = getDatabase()
  const rows = db.prepare('SELECT * FROM kg_entities WHERE type = ?').all(type) as KgEntityRow[]
  return rows.map(rowToEntity)
}

/**
 * 查询所有实体。
 */
export function listKgEntities(): KgEntity[] {
  const db: Database.Database = getDatabase()
  const rows = db.prepare('SELECT * FROM kg_entities ORDER BY created_at DESC').all() as KgEntityRow[]
  return rows.map(rowToEntity)
}

/**
 * 更新实体。
 */
export function updateKgEntity(params: UpdateKgEntityParams): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM kg_entities WHERE id = ?').get(params.id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.KG_ENTITY_NOT_FOUND,
      `Entity with id "${params.id}" not found.`,
      { id: params.id },
    )
  }

  const setClauses: string[] = []
  const values: (string | number | null)[] = []

  if (params.name !== undefined) {
    setClauses.push('name = ?')
    values.push(params.name)
  }
  if (params.type !== undefined) {
    setClauses.push('type = ?')
    values.push(params.type)
  }
  if (params.description !== undefined) {
    setClauses.push('description = ?')
    values.push(params.description)
  }
  if (params.sourceDocId !== undefined) {
    setClauses.push('source_doc_id = ?')
    values.push(params.sourceDocId)
  }
  if (params.confidence !== undefined) {
    setClauses.push('confidence = ?')
    values.push(params.confidence)
  }

  if (setClauses.length === 0) return

  values.push(params.id)
  db.prepare(`UPDATE kg_entities SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 删除实体（级联删除关联关系）。
 */
export function deleteKgEntity(id: string): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM kg_entities WHERE id = ?').get(id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KG_ENTITY_NOT_FOUND, `Entity with id "${id}" not found.`, {
      id,
    })
  }

  db.prepare('DELETE FROM kg_entities WHERE id = ?').run(id)
}

/**
 * 获取实体总数。
 */
export function countKgEntities(): number {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT COUNT(*) as cnt FROM kg_entities').get() as { cnt: number }
  return row.cnt
}
