// AgentForge prompt_templates 表数据访问层（Repository）
// 实现 PT-01: Prompt 模板库 CRUD
// 与 schema.sql §6.16 表结构一致

import type Database from 'better-sqlite3'
import type { PromptTemplate } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 * - variables: TEXT (JSON 字符串数组，变量名列表)
 */
interface PromptTemplateRow {
  id: string
  title: string
  content: string
  category: string
  variables: string
  created_at: number
  updated_at: number
}

/** 创建 Prompt 模板参数 */
export interface CreatePromptTemplateParams {
  title: string
  content: string
  category?: string
  variables?: string[]
}

/** 更新 Prompt 模板参数 */
export interface UpdatePromptTemplateParams {
  id: string
  title?: string
  content?: string
  category?: string
  variables?: string[]
}

/**
 * 安全解析 JSON，失败时返回 fallback 值。
 */
function safeParseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/**
 * 将数据库行转换为 PromptTemplate 实体。
 */
function rowToPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  const variables = safeParseJson<string[]>(row.variables, [])

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    variables,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建 Prompt 模板。
 * - title 为空时抛出 VALIDATION_ERROR
 * - content 为空时抛出 VALIDATION_ERROR
 * - 返回带 id 和时间戳的完整 PromptTemplate
 *
 * @param params - 创建参数
 * @returns 新建的 PromptTemplate
 * @throws {AppError} VALIDATION_ERROR - title 或 content 为空
 */
export function createPromptTemplate(params: CreatePromptTemplateParams): PromptTemplate {
  const db: Database.Database = getDatabase()

  // 校验 title 非空
  if (!params.title || params.title.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Prompt template title cannot be empty.', {
      title: params.title,
    })
  }

  // 校验 content 非空
  if (!params.content || params.content.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Prompt template content cannot be empty.', {
      content: params.content,
    })
  }

  const now = Date.now()
  const id = generateId()
  const category = params.category ?? 'general'
  const variablesJson = JSON.stringify(params.variables ?? [])

  db.prepare(
    `INSERT INTO prompt_templates (id, title, content, category, variables, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, params.title, params.content, category, variablesJson, now, now)

  return getPromptTemplateById(id)
}

/**
 * 根据 ID 查询单个 Prompt 模板。
 *
 * @param id - Prompt 模板 ID
 * @returns PromptTemplate 实体，不存在时返回 null
 */
export function getPromptTemplateById(id: string): PromptTemplate | null {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as
    | PromptTemplateRow
    | undefined

  if (row === undefined) {
    return null
  }

  return rowToPromptTemplate(row)
}

/**
 * 查询所有 Prompt 模板，按 updated_at 降序排列。
 *
 * @returns PromptTemplate 数组
 */
export function getAllPromptTemplates(): PromptTemplate[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM prompt_templates ORDER BY updated_at DESC')
    .all() as PromptTemplateRow[]

  return rows.map(rowToPromptTemplate)
}

/**
 * 根据分类查询 Prompt 模板，按 updated_at 降序排列。
 *
 * @param category - 分类名称
 * @returns PromptTemplate 数组
 */
export function getPromptTemplatesByCategory(category: string): PromptTemplate[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM prompt_templates WHERE category = ? ORDER BY updated_at DESC')
    .all(category) as PromptTemplateRow[]

  return rows.map(rowToPromptTemplate)
}

/**
 * 更新 Prompt 模板。
 * - 仅更新提供的字段
 * - title/content 非空校验
 * - 更新 updated_at 时间戳
 *
 * @param params - 更新参数
 * @throws {AppError} PROMPT_TEMPLATE_NOT_FOUND - 模板不存在
 * @throws {AppError} VALIDATION_ERROR - title 或 content 为空
 */
export function updatePromptTemplate(params: UpdatePromptTemplateParams): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id FROM prompt_templates WHERE id = ?').get(params.id) as
    | { id: string }
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND,
      `Prompt template with id "${params.id}" not found.`,
      { id: params.id },
    )
  }

  // 字段校验
  if (params.title !== undefined && params.title.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Prompt template title cannot be empty.', {
      id: params.id,
    })
  }

  if (params.content !== undefined && params.content.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Prompt template content cannot be empty.', {
      id: params.id,
    })
  }

  const now = Date.now()

  // 动态构建 UPDATE 语句
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]

  if (params.title !== undefined) {
    setClauses.push('title = ?')
    values.push(params.title)
  }

  if (params.content !== undefined) {
    setClauses.push('content = ?')
    values.push(params.content)
  }

  if (params.category !== undefined) {
    setClauses.push('category = ?')
    values.push(params.category)
  }

  if (params.variables !== undefined) {
    setClauses.push('variables = ?')
    values.push(JSON.stringify(params.variables))
  }

  values.push(params.id)

  db.prepare(`UPDATE prompt_templates SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 删除 Prompt 模板。
 *
 * @param id - Prompt 模板 ID
 * @throws {AppError} PROMPT_TEMPLATE_NOT_FOUND - 模板不存在
 */
export function deletePromptTemplate(id: string): void {
  const db: Database.Database = getDatabase()

  const existing = db.prepare('SELECT 1 FROM prompt_templates WHERE id = ?').get(id) as
    | { '1': number }
    | undefined

  if (existing === undefined) {
    throw new AppError(
      ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND,
      `Prompt template with id "${id}" not found.`,
      { id },
    )
  }

  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id)
}
