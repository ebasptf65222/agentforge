// AgentForge Prompt Template 域 IPC Handlers
// 实现 PT-01: Prompt 模板库 CRUD IPC
// 通道命名: prompt-template:list, prompt-template:get, prompt-template:create,
//           prompt-template:update, prompt-template:delete

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { PromptTemplate } from '@shared/types'
import {
  ensureParamsObject,
  validateNonEmptyString,
  validateOptionalString,
  validateOptionalStringArray,
} from '../utils/ipc-validator'
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

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * prompt-template:list - 查询所有 Prompt 模板
 * 可选参数: category (按分类过滤)
 */
export function handleList(params: unknown): PromptTemplate[] {
  if (params === undefined || params === null) {
    return getAllPromptTemplates()
  }
  const p = ensureParamsObject(params, 'prompt-template:list')

  if (p['category'] !== undefined) {
    const category = validateNonEmptyString(p['category'], 'category')
    return getPromptTemplatesByCategory(category)
  }

  return getAllPromptTemplates()
}

/**
 * prompt-template:get - 根据 ID 查询单个 Prompt 模板
 * 返回 PromptTemplate 或 null（不存在时）
 */
export function handleGet(params: unknown): PromptTemplate | null {
  const p = ensureParamsObject(params, 'prompt-template:get')

  const id = validateNonEmptyString(p['id'], 'id')

  return getPromptTemplateById(id)
}

/**
 * prompt-template:create - 创建 Prompt 模板
 */
export function handleCreate(params: unknown): PromptTemplate {
  const p = ensureParamsObject(params, 'prompt-template:create')

  const title = validateNonEmptyString(p['title'], 'title')
  const content = validateNonEmptyString(p['content'], 'content')
  const category = validateOptionalString(p['category'], 'category')
  const variables = validateOptionalStringArray(p['variables'], 'variables')

  const createParams: CreatePromptTemplateParams = {
    title,
    content,
    category,
    variables,
  }

  return createPromptTemplate(createParams)
}

/**
 * prompt-template:update - 更新 Prompt 模板
 */
export function handleUpdate(params: unknown): void {
  const p = ensureParamsObject(params, 'prompt-template:update')

  const id = validateNonEmptyString(p['id'], 'id')
  const title = validateOptionalString(p['title'], 'title')
  const content = validateOptionalString(p['content'], 'content')
  const category = validateOptionalString(p['category'], 'category')
  const variables = validateOptionalStringArray(p['variables'], 'variables')

  const updateParams: UpdatePromptTemplateParams = {
    id,
    title,
    content,
    category,
    variables,
  }

  updatePromptTemplate(updateParams)
}

/**
 * prompt-template:delete - 删除 Prompt 模板
 */
export function handleDelete(params: unknown): void {
  const p = ensureParamsObject(params, 'prompt-template:delete')

  const id = validateNonEmptyString(p['id'], 'id')

  deletePromptTemplate(id)
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
