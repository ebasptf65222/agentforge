// AgentForge kg_relations 表的数据访问层（Repository）
// 实现 KG-01: 知识图谱关系 CRUD

import type Database from 'better-sqlite3'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/** 知识图谱关系 */
export interface KgRelation {
  id: string
  sourceId: string
  targetId: string
  relation: string
  description?: string
  sourceDocId?: string
  confidence: number
  createdAt: number
}

/** 创建关系参数 */
export interface CreateKgRelationParams {
  sourceId: string
  targetId: string
  relation: string
  description?: string
  sourceDocId?: string
  confidence?: number
}

interface KgRelationRow {
  id: string
  source_id: string
  target_id: string
  relation: string
  description: string | null
  source_doc_id: string | null
  confidence: number
  created_at: number
}

function rowToRelation(row: KgRelationRow): KgRelation {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    description: row.description ?? undefined,
    sourceDocId: row.source_doc_id ?? undefined,
    confidence: row.confidence,
    createdAt: row.created_at,
  }
}

/**
 * 创建或获取关系（按 sourceId + targetId + relation 唯一）。
 * 如果已存在则返回已有关系。
 */
export function createOrGetKgRelation(params: CreateKgRelationParams): KgRelation {
  const db: Database.Database = getDatabase()

  const existing = db
    .prepare('SELECT * FROM kg_relations WHERE source_id = ? AND target_id = ? AND relation = ?')
    .get(params.sourceId, params.targetId, params.relation) as KgRelationRow | undefined

  if (existing) {
    return rowToRelation(existing)
  }

  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO kg_relations
      (id, source_id, target_id, relation, description, source_doc_id, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.sourceId,
    params.targetId,
    params.relation,
    params.description ?? null,
    params.sourceDocId ?? null,
    params.confidence ?? 1.0,
    now,
  )

  return getKgRelationById(id)
}

/**
 * 批量创建关系，返回关系列表（含已有关系）。
 */
export function batchCreateKgRelations(paramsList: CreateKgRelationParams[]): KgRelation[] {
  const db: Database.Database = getDatabase()
  const tx = db.transaction(() => {
    return paramsList.map((p) => createOrGetKgRelation(p))
  })
  return tx()
}

/**
 * 根据 ID 查询关系。
 */
export function getKgRelationById(id: string): KgRelation {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM kg_relations WHERE id = ?').get(id) as
    | KgRelationRow
    | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.KG_RELATION_NOT_FOUND, `Relation with id "${id}" not found.`, {
      id,
    })
  }

  return rowToRelation(row)
}

/**
 * 查询某实体的所有出向关系。
 */
export function getKgRelationsBySource(sourceId: string): KgRelation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM kg_relations WHERE source_id = ?')
    .all(sourceId) as KgRelationRow[]
  return rows.map(rowToRelation)
}

/**
 * 查询某实体的所有入向关系。
 */
export function getKgRelationsByTarget(targetId: string): KgRelation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM kg_relations WHERE target_id = ?')
    .all(targetId) as KgRelationRow[]
  return rows.map(rowToRelation)
}

/**
 * 查询某实体的所有关联关系（出向 + 入向）。
 */
export function getKgRelationsByEntity(entityId: string): KgRelation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM kg_relations WHERE source_id = ? OR target_id = ?')
    .all(entityId, entityId) as KgRelationRow[]
  return rows.map(rowToRelation)
}

/**
 * 根据关系类型查询。
 */
export function getKgRelationsByType(relation: string): KgRelation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM kg_relations WHERE relation = ?')
    .all(relation) as KgRelationRow[]
  return rows.map(rowToRelation)
}

/**
 * 查询所有关系。
 */
export function listKgRelations(): KgRelation[] {
  const db: Database.Database = getDatabase()
  const rows = db.prepare('SELECT * FROM kg_relations ORDER BY created_at DESC').all() as KgRelationRow[]
  return rows.map(rowToRelation)
}

/**
 * 删除关系。
 */
export function deleteKgRelation(id: string): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM kg_relations WHERE id = ?').get(id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.KG_RELATION_NOT_FOUND,
      `Relation with id "${id}" not found.`,
      { id },
    )
  }

  db.prepare('DELETE FROM kg_relations WHERE id = ?').run(id)
}

/**
 * 获取关系总数。
 */
export function countKgRelations(): number {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT COUNT(*) as cnt FROM kg_relations').get() as { cnt: number }
  return row.cnt
}
