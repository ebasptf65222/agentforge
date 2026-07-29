// AgentForge Prompt Template 域 IPC Handlers
// 实现 PT-01: Prompt 模板库 CRUD IPC
// 通道命名: prompt-template:list, prompt-template:get, prompt-template:create,
//           prompt-template:update, prompt-template:delete

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { PromptTemplate } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { assertNonEmptyString } from '../utils/assertions'
import {
  createPromptTemplate,
  getPromptTemplateById,
  getAllPromptTemplates,
  getPromptTemplatesByCategory,
  updatePromptTemplate,
  deletePromptTemplate,
  type CreatePromptTemplateParams,
  type UpdatePromptTemplateParams,
} from '../db/repos/prompt-template'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
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

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * prompt-template:list - 查询所有 Prompt 模板
 * 可选参数: category (按分类过滤)
 */
export function handleList(params: unknown): PromptTemplate[] {
  if (params === undefined || params === null) {
    return getAllPromptTemplates()
  }
  if (typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'List prompt template params must be an object.')
  }
  const p = params as Record<string, unknown>

  if (p['category'] !== undefined) {
    assertNonEmptyString(p['category'], 'category')
    return getPromptTemplatesByCategory(p['category'])
  }

  return getAllPromptTemplates()
}

/**
 * prompt-template:get - 根据 ID 查询单个 Prompt 模板
 * 返回 PromptTemplate 或 null（不存在时）
 */
export function handleGet(params: unknown): PromptTemplate | null {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get prompt template params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  return getPromptTemplateById(p['id'])
}

/**
 * prompt-template:create - 创建 Prompt 模板
 */
export function handleCreate(params: unknown): PromptTemplate {
  if (params === null || typeof params !== 'object') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Create prompt template params must be an object.',
    )
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['title'], 'title')
  assertNonEmptyString(p['content'], 'content')
  assertOptionalString(p['category'], 'category')
  assertOptionalStringArray(p['variables'], 'variables')

  const createParams: CreatePromptTemplateParams = {
    title: p['title'],
    content: p['content'],
    category: p['category'],
    variables: p['variables'],
  }

  return createPromptTemplate(createParams)
}

/**
 * prompt-template:update - 更新 Prompt 模板
 */
export function handleUpdate(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Update prompt template params must be an object.',
    )
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')
  assertOptionalString(p['title'], 'title')
  assertOptionalString(p['content'], 'content')
  assertOptionalString(p['category'], 'category')
  assertOptionalStringArray(p['variables'], 'variables')

  const updateParams: UpdatePromptTemplateParams = {
    id: p['id'],
    title: p['title'],
    content: p['content'],
    category: p['category'],
    variables: p['variables'],
  }

  updatePromptTemplate(updateParams)
}

/**
 * prompt-template:delete - 删除 Prompt 模板
 */
export function handleDelete(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Delete prompt template params must be an object.',
    )
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  deletePromptTemplate(p['id'])
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'prompt-template:list', handler: (_event, params: unknown) => handleList(params) },
  { channel: 'prompt-template:get', handler: (_event, params: unknown) => handleGet(params) },
  { channel: 'prompt-template:create', handler: (_event, params: unknown) => handleCreate(params) },
  { channel: 'prompt-template:update', handler: (_event, params: unknown) => handleUpdate(params) },
  { channel: 'prompt-template:delete', handler: (_event, params: unknown) => handleDelete(params) },
]

/**
 * 注册 Prompt Template 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerPromptTemplateHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
