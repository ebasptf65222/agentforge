// AgentForge 分镜模板库数据访问层（Repository）M19
// video_templates 表 CRUD，提供可复用的单镜头 / 多镜头序列模板。

import type Database from 'better-sqlite3'
import type {
  VideoAspect,
  VideoResolution,
  VideoShot,
  VideoTemplate,
  VideoTemplateType,
} from '@shared/types'
import { getDatabase } from '../index'
import { generateId } from '../../utils/id'

/** 创建模板的入参 */
export interface CreateVideoTemplateRepoParams {
  name: string
  description?: string
  type?: VideoTemplateType
  resolution?: VideoResolution
  aspect?: VideoAspect
  shots: VideoShot[]
  continuity?: boolean
  model?: string | null
  tags?: string[]
}

/** 运行时可更新的模板字段 */
export interface UpdateVideoTemplateRepoParams {
  name?: string
  description?: string
  type?: VideoTemplateType
  resolution?: VideoResolution
  aspect?: VideoAspect
  shots?: VideoShot[]
  continuity?: boolean
  model?: string | null
  tags?: string[]
}

/** SQLite 行结构（snake_case，与 video_templates 表一致） */
interface VideoTemplateRow {
  id: string
  name: string
  description: string
  type: string
  resolution: string
  aspect: string
  shots: string
  continuity: number
  model: string | null
  tags: string
  created_at: number
  updated_at: number
}

/** 解析 shots JSON 文本列；非法内容回退为空数组 */
function parseShots(raw: string): VideoShot[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is VideoShot =>
        typeof s === 'object' && s !== null && typeof (s as VideoShot).prompt === 'string',
    )
  } catch {
    return []
  }
}

/** 解析 tags JSON 文本列；非法内容回退为空数组 */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

function rowToTemplate(row: VideoTemplateRow): VideoTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as VideoTemplateType,
    resolution: row.resolution as VideoResolution,
    aspect: row.aspect as VideoAspect,
    shots: parseShots(row.shots),
    continuity: Boolean(row.continuity),
    model: row.model,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建分镜/序列模板。
 */
export function createVideoTemplate(params: CreateVideoTemplateRepoParams): VideoTemplate {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const id = generateId()

  db.prepare(
    `INSERT INTO video_templates
      (id, name, description, type, resolution, aspect, shots, continuity, model, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.description ?? '',
    params.type ?? 'shot',
    params.resolution ?? '720P',
    params.aspect ?? '16:9',
    JSON.stringify(params.shots),
    params.continuity ? 1 : 0,
    params.model ?? null,
    JSON.stringify(params.tags ?? []),
    now,
    now,
  )

  const template = getVideoTemplateById(id)
  if (!template) throw new Error('Failed to create video template')
  return template
}

/**
 * 根据 ID 获取模板。
 */
export function getVideoTemplateById(id: string): VideoTemplate | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM video_templates WHERE id = ?').get(id) as
    | VideoTemplateRow
    | undefined
  return row ? rowToTemplate(row) : null
}

/**
 * 获取模板列表（按更新时间倒序）。
 */
export function listVideoTemplates(limit = 200): VideoTemplate[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM video_templates ORDER BY updated_at DESC, rowid DESC LIMIT ?')
    .all(Math.max(1, Math.min(limit, 500))) as VideoTemplateRow[]
  return rows.map(rowToTemplate)
}

/**
 * 更新模板的部分字段（自动刷新 updated_at）。
 */
export function updateVideoTemplate(
  id: string,
  params: UpdateVideoTemplateRepoParams,
): VideoTemplate | null {
  const db: Database.Database = getDatabase()
  const existing = getVideoTemplateById(id)
  if (!existing) return null

  const values: Array<number | string | null> = []
  const setClauses: string[] = ['updated_at = ?']
  values.push(Date.now())

  if (params.name !== undefined) {
    setClauses.push('name = ?')
    values.push(params.name)
  }
  if (params.description !== undefined) {
    setClauses.push('description = ?')
    values.push(params.description)
  }
  if (params.type !== undefined) {
    setClauses.push('type = ?')
    values.push(params.type)
  }
  if (params.resolution !== undefined) {
    setClauses.push('resolution = ?')
    values.push(params.resolution)
  }
  if (params.aspect !== undefined) {
    setClauses.push('aspect = ?')
    values.push(params.aspect)
  }
  if (params.shots !== undefined) {
    setClauses.push('shots = ?')
    values.push(JSON.stringify(params.shots))
  }
  if (params.continuity !== undefined) {
    setClauses.push('continuity = ?')
    values.push(params.continuity ? 1 : 0)
  }
  if (params.model !== undefined) {
    setClauses.push('model = ?')
    values.push(params.model)
  }
  if (params.tags !== undefined) {
    setClauses.push('tags = ?')
    values.push(JSON.stringify(params.tags))
  }

  db.prepare(`UPDATE video_templates SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...([...values, id] as Array<number | string | null>),
  )
  return getVideoTemplateById(id)
}

/**
 * 彻底删除模板。
 */
export function deleteVideoTemplate(id: string): void {
  const db: Database.Database = getDatabase()
  db.prepare('DELETE FROM video_templates WHERE id = ?').run(id)
}