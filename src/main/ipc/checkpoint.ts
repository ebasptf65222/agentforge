// AgentForge P2-02: Checkpoint IPC Handlers
// 通道命名: checkpoint:list, checkpoint:rollback, checkpoint:diff,
//           checkpoint:history, checkpoint:cleanup, checkpoint:delete

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import { AppError, ErrorCodes } from '../utils/error'
import {
  listCheckpoints,
  rollbackToCheckpoint,
  getCheckpointDiff,
  getFileHistory,
  cleanupCheckpoints,
  deleteCheckpoint,
} from '../checkpoint'
import type { Checkpoint } from '@shared/types'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

function assertPositiveNumber(value: unknown, field: string): asserts value is number {
  const num = Number(value)
  if (Number.isNaN(num) || num <= 0) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a positive number.`,
      { field, value },
    )
  }
}

function getOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value
  }
  if (value !== undefined) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string if provided.`,
      { field, value },
    )
  }
  return undefined
}

// ─── IPC Handlers ────────────────────────────────────────────────

/**
 * 列出快照。
 * 参数: { relativePath?, executionId?, limit?, offset? }
 */
async function handleList(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ checkpoints: Checkpoint[]; count: number }> {
  const options: Parameters<typeof listCheckpoints>[0] = {}

  const relativePath = getOptionalString(params['relativePath'], 'relativePath')
  if (relativePath) options.relativePath = relativePath

  const executionId = getOptionalString(params['executionId'], 'executionId')
  if (executionId) options.executionId = executionId

  if (params['limit'] !== undefined) {
    const limit = Number(params['limit'])
    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'limit must be between 1 and 100.',
        { limit: params['limit'] },
      )
    }
    options.limit = Math.floor(limit)
  }

  if (params['offset'] !== undefined) {
    const offset = Number(params['offset'])
    if (Number.isNaN(offset) || offset < 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'offset must be a non-negative number.', {
        offset: params['offset'],
      })
    }
    options.offset = Math.floor(offset)
  }

  const checkpoints = listCheckpoints(options)
  return { checkpoints, count: checkpoints.length }
}

/**
 * 回滚到快照。
 * 参数: { checkpointId }
 */
async function handleRollback(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ success: boolean; relativePath: string; action: string; restored: boolean }> {
  assertPositiveNumber(params['checkpointId'], 'checkpointId')
  return await rollbackToCheckpoint(params['checkpointId'])
}

/**
 * 获取快照差异。
 * 参数: { checkpointId }
 */
async function handleDiff(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{
  relativePath: string
  checkpointId: number
  currentExists: boolean
  originalContent?: string
  currentContent?: string
  hasChanged: boolean
}> {
  assertPositiveNumber(params['checkpointId'], 'checkpointId')
  return await getCheckpointDiff(params['checkpointId'])
}

/**
 * 获取文件历史。
 * 参数: { relativePath, limit? }
 */
async function handleHistory(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ checkpoints: Checkpoint[]; relativePath: string }> {
  const relativePath = getOptionalString(params['relativePath'], 'relativePath')
  if (!relativePath) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'relativePath is required.', {})
  }

  let limit: number | undefined
  if (params['limit'] !== undefined) {
    limit = Number(params['limit'])
    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'limit must be between 1 and 100.', {
        limit: params['limit'],
      })
    }
    limit = Math.floor(limit)
  }

  const checkpoints = getFileHistory(relativePath, limit)
  return { checkpoints, relativePath }
}

/**
 * 清理旧快照。
 * 参数: { retentionDays?, keepPerFile? }
 */
async function handleCleanup(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ deleted: number }> {
  const options: { retentionDays?: number; keepPerFile?: number } = {}

  if (params['retentionDays'] !== undefined) {
    const days = Number(params['retentionDays'])
    if (Number.isNaN(days) || days < 1 || days > 365) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'retentionDays must be between 1 and 365.',
        { retentionDays: params['retentionDays'] },
      )
    }
    options.retentionDays = Math.floor(days)
  }

  if (params['keepPerFile'] !== undefined) {
    const keep = Number(params['keepPerFile'])
    if (Number.isNaN(keep) || keep < 1 || keep > 500) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'keepPerFile must be between 1 and 500.',
        { keepPerFile: params['keepPerFile'] },
      )
    }
    options.keepPerFile = Math.floor(keep)
  }

  const deleted = cleanupCheckpoints(options)
  return { deleted }
}

/**
 * 删除快照。
 * 参数: { checkpointId }
 */
async function handleDelete(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ deleted: boolean }> {
  assertPositiveNumber(params['checkpointId'], 'checkpointId')
  const deleted = deleteCheckpoint(params['checkpointId'])
  return { deleted }
}

// ─── 注册函数 ────────────────────────────────────────────────────

const handlers: Array<{ channel: string; handler: IpcMainInvokeHandler }> = [
  { channel: 'checkpoint:list', handler: handleList },
  { channel: 'checkpoint:rollback', handler: handleRollback },
  { channel: 'checkpoint:diff', handler: handleDiff },
  { channel: 'checkpoint:history', handler: handleHistory },
  { channel: 'checkpoint:cleanup', handler: handleCleanup },
  { channel: 'checkpoint:delete', handler: handleDelete },
]

/**
 * 注册 Checkpoint IPC handlers。
 * 幂等：重复调用安全。
 */
export function registerCheckpointHandlers(): void {
  for (const { channel, handler } of handlers) {
    const wrappedHandler: IpcMainInvokeHandler = async (event, ...args) => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        if (error instanceof AppError) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new AppError(ErrorCodes.INTERNAL_ERROR, message, { channel })
      }
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, wrappedHandler)
  }
}
