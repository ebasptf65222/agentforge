// AgentForge Skill 域 IPC Handlers
// 实现 P3-02: Skill CRUD IPC + Preload 扩展
// 通道命名: skill:list, skill:get, skill:getByName, skill:create, skill:update, skill:delete

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { Skill, SkillTrigger } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  createSkill,
  getSkillById,
  getSkillByName,
  listSkills,
  updateSkill,
  deleteSkill,
  type CreateSkillParams,
  type UpdateSkillParams,
} from '../db/repos/skill'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

const VALID_TRIGGERS: readonly SkillTrigger[] = ['auto', 'manual']

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

function assertOptionalTrigger(value: unknown): asserts value is SkillTrigger | undefined {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !VALID_TRIGGERS.includes(value as SkillTrigger))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid trigger: ${String(value)}. Must be one of: ${VALID_TRIGGERS.join(', ')}.`,
      { trigger: value },
    )
  }
}

function assertOptionalStringArray(
  value: unknown,
  field: string,
): asserts value is string[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be an array of strings.`,
      { field, value },
    )
  }
}

function assertOptionalVariables(
  value: unknown,
): asserts value is NonNullable<CreateSkillParams['variables']> | undefined {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "variables" must be an array.', {
      variables: value,
    })
  }
  for (const v of value) {
    if (v === null || typeof v !== 'object') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Each variable must be an object.', {
        variable: v,
      })
    }
    const obj = v as Record<string, unknown>
    if (typeof obj['name'] !== 'string' || obj['name'].trim() === '') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Variable "name" must be a non-empty string.',
        {
          variable: v,
        },
      )
    }
    if (typeof obj['description'] !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Variable "description" must be a string.', {
        variable: v,
      })
    }
    if (typeof obj['required'] !== 'boolean') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Variable "required" must be a boolean.', {
        variable: v,
      })
    }
    if (obj['defaultValue'] !== undefined && typeof obj['defaultValue'] !== 'string') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Variable "defaultValue" must be a string if provided.',
        { variable: v },
      )
    }
  }
}

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * skill:list - 查询所有 Skill
 * 可选参数: trigger (auto|manual), builtinOnly (boolean)
 */
export function handleList(params: unknown): Skill[] {
  if (params === undefined || params === null) {
    return listSkills()
  }
  if (typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'List skill params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertOptionalTrigger(p['trigger'])

  let builtinOnly: boolean | undefined
  if (p['builtinOnly'] !== undefined) {
    if (typeof p['builtinOnly'] !== 'boolean') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "builtinOnly" must be a boolean.', {
        builtinOnly: p['builtinOnly'],
      })
    }
    builtinOnly = p['builtinOnly']
  }

  return listSkills({
    trigger: p['trigger'] as SkillTrigger | undefined,
    builtinOnly,
  })
}

/**
 * skill:get - 根据 ID 查询 Skill
 */
export function handleGet(params: unknown): Skill {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get skill params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  return getSkillById(p['id'])
}

/**
 * skill:getByName - 根据 name 查询 Skill
 * 返回 Skill 或 null（不存在时）
 */
export function handleGetByName(params: unknown): Skill | null {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'GetByName skill params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['name'], 'name')

  return getSkillByName(p['name']) ?? null
}

/**
 * skill:create - 创建 Skill
 */
export function handleCreate(params: unknown): Skill {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Create skill params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['name'], 'name')
  assertNonEmptyString(p['displayName'], 'displayName')
  assertNonEmptyString(p['description'], 'description')
  assertNonEmptyString(p['prompt'], 'prompt')
  assertOptionalString(p['modelId'], 'modelId')
  assertOptionalStringArray(p['allowedTools'], 'allowedTools')
  assertOptionalTrigger(p['trigger'])
  assertOptionalVariables(p['variables'])

  const createParams: CreateSkillParams = {
    name: p['name'],
    displayName: p['displayName'],
    description: p['description'],
    prompt: p['prompt'],
    modelId: p['modelId'],
    allowedTools: p['allowedTools'] ?? [],
    trigger: (p['trigger'] as SkillTrigger) ?? 'auto',
    variables: p['variables'] as CreateSkillParams['variables'],
  }

  return createSkill(createParams)
}

/**
 * skill:update - 更新 Skill
 * 内置 Skill 仅允许更新 modelId
 */
export function handleUpdate(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Update skill params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')
  assertOptionalString(p['displayName'], 'displayName')
  assertOptionalString(p['description'], 'description')
  assertOptionalString(p['prompt'], 'prompt')
  assertOptionalStringArray(p['allowedTools'], 'allowedTools')
  assertOptionalTrigger(p['trigger'])
  assertOptionalVariables(p['variables'])

  // modelId 可以是 string | null | undefined
  if (p['modelId'] !== undefined && p['modelId'] !== null) {
    if (typeof p['modelId'] !== 'string' || p['modelId'].trim() === '') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Field "modelId" must be a non-empty string or null.',
        { modelId: p['modelId'] },
      )
    }
  }

  const updateParams: UpdateSkillParams = {
    id: p['id'],
    displayName: p['displayName'],
    description: p['description'],
    prompt: p['prompt'],
    modelId: p['modelId'] === null ? null : (p['modelId'] as string | undefined),
    allowedTools: p['allowedTools'],
    trigger: p['trigger'] as SkillTrigger | undefined,
    variables: p['variables'] as UpdateSkillParams['variables'],
  }

  updateSkill(updateParams)
}

/**
 * skill:delete - 删除 Skill
 * 内置 Skill 不可删除
 */
export function handleDelete(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Delete skill params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  deleteSkill(p['id'])
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'skill:list', handler: (_event, params: unknown) => handleList(params) },
  { channel: 'skill:get', handler: (_event, params: unknown) => handleGet(params) },
  { channel: 'skill:getByName', handler: (_event, params: unknown) => handleGetByName(params) },
  { channel: 'skill:create', handler: (_event, params: unknown) => handleCreate(params) },
  { channel: 'skill:update', handler: (_event, params: unknown) => handleUpdate(params) },
  { channel: 'skill:delete', handler: (_event, params: unknown) => handleDelete(params) },
]

/**
 * 注册 Skill 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerSkillHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
