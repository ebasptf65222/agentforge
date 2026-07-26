// AgentForge skills 表的数据访问层（Repository）
// 实现 P3-01: Skill CRUD
// 与 Spec v0.2 §5.6 + §11.1 一致

import type Database from 'better-sqlite3'
import type { Skill, SkillVariable, SkillTrigger } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 * - allowed_tools: TEXT (JSON 字符串数组)
 * - variables: TEXT (JSON SkillVariable 数组)
 * - is_builtin: INTEGER (0/1)
 * - trigger: TEXT ('auto' | 'manual')
 */
interface SkillRow {
  id: string
  name: string
  display_name: string
  description: string
  prompt: string
  model_id: string | null
  allowed_tools: string
  trigger: string
  variables: string
  is_builtin: number
  created_at: number
  updated_at: number
}

/** 创建 Skill 参数 */
export interface CreateSkillParams {
  name: string
  displayName: string
  description: string
  prompt: string
  modelId?: string
  allowedTools: string[]
  trigger: SkillTrigger
  variables?: SkillVariable[]
  isBuiltin?: boolean
}

/** 更新 Skill 参数（内置 Skill 仅允许更新 modelId） */
export interface UpdateSkillParams {
  id: string
  displayName?: string
  description?: string
  prompt?: string
  /** 传入 null 清除 modelId，传入字符串设置 modelId */
  modelId?: string | null
  allowedTools?: string[]
  trigger?: SkillTrigger
  variables?: SkillVariable[]
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
 * 将数据库行转换为 Skill 实体。
 */
function rowToSkill(row: SkillRow): Skill {
  const allowedTools = safeParseJson<string[]>(row.allowed_tools, [])
  const variables = safeParseJson<SkillVariable[]>(row.variables, [])

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    prompt: row.prompt,
    modelId: row.model_id ?? undefined,
    allowedTools,
    trigger: row.trigger as SkillTrigger,
    variables,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建 Skill。
 * - name 重复时抛出 SKILL_DUPLICATE
 * - prompt 为空时抛出 SKILL_PROMPT_EMPTY
 * - 返回带 id 和时间戳的完整 Skill
 *
 * @param params - 创建参数
 * @returns 新建的 Skill
 * @throws {AppError} SKILL_DUPLICATE - name 已存在
 * @throws {AppError} SKILL_PROMPT_EMPTY - prompt 为空
 */
export function createSkill(params: CreateSkillParams): Skill {
  const db: Database.Database = getDatabase()

  // 校验 prompt 非空
  if (!params.prompt || params.prompt.trim() === '') {
    throw new AppError(ErrorCodes.SKILL_PROMPT_EMPTY, 'Skill prompt cannot be empty.', {
      name: params.name,
    })
  }

  // 检查 name 是否重复
  const existing = db.prepare('SELECT id FROM skills WHERE name = ?').get(params.name) as
    { id: string } | undefined

  if (existing !== undefined) {
    throw new AppError(
      ErrorCodes.SKILL_DUPLICATE,
      `Skill with name "${params.name}" already exists.`,
      { name: params.name },
    )
  }

  const now = Date.now()
  const id = generateId()
  const allowedToolsJson = JSON.stringify(params.allowedTools ?? [])
  const variablesJson = JSON.stringify(params.variables ?? [])

  db.prepare(
    `INSERT INTO skills
      (id, name, display_name, description, prompt, model_id, allowed_tools, trigger, variables, is_builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.displayName,
    params.description,
    params.prompt,
    params.modelId ?? null,
    allowedToolsJson,
    params.trigger,
    variablesJson,
    params.isBuiltin ? 1 : 0,
    now,
    now,
  )

  return getSkillById(id)
}

/**
 * 根据 ID 查询单个 Skill。
 *
 * @param id - Skill ID
 * @returns Skill 实体
 * @throws {AppError} SKILL_NOT_FOUND - Skill 不存在
 */
export function getSkillById(id: string): Skill {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.SKILL_NOT_FOUND, `Skill with id "${id}" not found.`, { id })
  }

  return rowToSkill(row)
}

/**
 * 根据 name 查询单个 Skill。
 * name 是 Skill 的唯一标识，用于意图匹配。
 *
 * @param name - Skill 名称
 * @returns Skill 实体或 undefined
 */
export function getSkillByName(name: string): Skill | undefined {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as SkillRow | undefined

  if (row === undefined) {
    return undefined
  }

  return rowToSkill(row)
}

/**
 * 查询所有 Skill。
 *
 * @param options - 可选过滤参数
 * @returns Skill 数组
 */
export function listSkills(options?: { trigger?: SkillTrigger; builtinOnly?: boolean }): Skill[] {
  const db: Database.Database = getDatabase()

  let query = 'SELECT * FROM skills'
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options?.trigger !== undefined) {
    conditions.push('trigger = ?')
    params.push(options.trigger)
  }

  if (options?.builtinOnly !== undefined) {
    conditions.push('is_builtin = ?')
    params.push(options.builtinOnly ? 1 : 0)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  query += ' ORDER BY created_at ASC'

  const rows = db.prepare(query).all(...params) as SkillRow[]
  return rows.map(rowToSkill)
}

/**
 * 更新 Skill。
 * - 内置 Skill 仅允许更新 modelId（保护 prompt 不被修改，Spec §11.5）
 * - 仅更新提供的字段
 * - 更新 updated_at 时间戳
 *
 * @param params - 更新参数
 * @throws {AppError} SKILL_NOT_FOUND - Skill 不存在
 * @throws {AppError} SKILL_PROMPT_EMPTY - prompt 为空（非内置 Skill 更新 prompt 时）
 */
export function updateSkill(params: UpdateSkillParams): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(params.id) as SkillRow | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.SKILL_NOT_FOUND, `Skill with id "${params.id}" not found.`, {
      id: params.id,
    })
  }

  const isBuiltin = row.is_builtin === 1
  const now = Date.now()

  // 内置 Skill 仅允许更新 modelId
  if (isBuiltin) {
    if (params.modelId !== undefined) {
      db.prepare('UPDATE skills SET model_id = ?, updated_at = ? WHERE id = ?').run(
        params.modelId ?? null,
        now,
        params.id,
      )
    }
    return
  }

  // 非内置 Skill：动态构建 UPDATE 语句
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (params.displayName !== undefined) {
    setClauses.push('display_name = ?')
    values.push(params.displayName)
  }

  if (params.description !== undefined) {
    setClauses.push('description = ?')
    values.push(params.description)
  }

  if (params.prompt !== undefined) {
    if (params.prompt.trim() === '') {
      throw new AppError(ErrorCodes.SKILL_PROMPT_EMPTY, 'Skill prompt cannot be empty.', {
        id: params.id,
      })
    }
    setClauses.push('prompt = ?')
    values.push(params.prompt)
  }

  if (params.modelId !== undefined) {
    setClauses.push('model_id = ?')
    values.push(params.modelId ?? null)
  }

  if (params.allowedTools !== undefined) {
    setClauses.push('allowed_tools = ?')
    values.push(JSON.stringify(params.allowedTools))
  }

  if (params.trigger !== undefined) {
    setClauses.push('trigger = ?')
    values.push(params.trigger)
  }

  if (params.variables !== undefined) {
    setClauses.push('variables = ?')
    values.push(JSON.stringify(params.variables))
  }

  values.push(params.id)

  db.prepare(`UPDATE skills SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 删除 Skill。
 * - 内置 Skill 不可删除（Spec §11.5）
 *
 * @param id - Skill ID
 * @throws {AppError} SKILL_NOT_FOUND - Skill 不存在
 * @throws {AppError} SKILL_DELETE_BUILTIN - 试图删除内置 Skill
 */
export function deleteSkill(id: string): void {
  const db: Database.Database = getDatabase()

  const row = db.prepare('SELECT id, is_builtin FROM skills WHERE id = ?').get(id) as
    { id: string; is_builtin: number } | undefined

  if (row === undefined) {
    throw new AppError(ErrorCodes.SKILL_NOT_FOUND, `Skill with id "${id}" not found.`, { id })
  }

  if (row.is_builtin === 1) {
    throw new AppError(
      ErrorCodes.SKILL_DELETE_BUILTIN,
      `Cannot delete builtin skill (id="${id}"). Builtin skills are protected.`,
      { id },
    )
  }

  db.prepare('DELETE FROM skills WHERE id = ?').run(id)
}

/**
 * 检查 Skill 是否存在。
 *
 * @param id - Skill ID
 * @returns 是否存在
 */
export function skillExists(id: string): boolean {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT 1 FROM skills WHERE id = ?').get(id) as { '1': number } | undefined
  return row !== undefined
}

/**
 * 获取所有可自动触发的 Skill（trigger = 'auto'）。
 * 用于意图匹配引擎。
 *
 * @returns trigger='auto' 的 Skill 数组
 */
export function listAutoTriggerSkills(): Skill[] {
  return listSkills({ trigger: 'auto' })
}
