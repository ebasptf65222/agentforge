// AgentForge P2-02: Checkpoint 快照管理核心模块
// 在文件写入/删除前自动创建快照，支持回滚到历史状态

import { readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  createCheckpoint,
  getCheckpointById,
  listCheckpoints,
  deleteCheckpoint,
  pruneOldCheckpoints,
} from '../db/repos/checkpoint'
import { getWorkspacePath } from '../ipc/workspace'
import { resolveWorkspacePath } from '../tools/path-guard'
import { AppError, ErrorCodes } from '../utils/error'
import type { Checkpoint } from '@shared/types'

// ─── 常量 ─────────────────────────────────────────────────────

/** 快照内容大小上限（5MB，与工作区写入限制一致） */
const MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024

/** 每个文件默认保留的快照数量 */
const DEFAULT_KEEP_PER_FILE = 50

/** 自动清理：保留 30 天内的快照 */
const SNAPSHOT_RETENTION_DAYS = 30

// ─── 执行上下文 ───────────────────────────────────────────────

/**
 * 当前 Agent 执行上下文。
 * 在执行开始时设置，用于关联快照到具体执行。
 */
let currentExecutionId: string | undefined
let currentConversationId: string | undefined

/**
 * 设置当前执行上下文。
 * 在 Agent 执行开始时调用。
 */
export function setCheckpointContext(executionId?: string, conversationId?: string): void {
  currentExecutionId = executionId
  currentConversationId = conversationId
}

/**
 * 清除当前执行上下文。
 * 在 Agent 执行结束时调用。
 */
export function clearCheckpointContext(): void {
  currentExecutionId = undefined
  currentConversationId = undefined
}

/**
 * 获取当前执行上下文。
 */
export function getCheckpointContext(): { executionId?: string; conversationId?: string } {
  return {
    executionId: currentExecutionId,
    conversationId: currentConversationId,
  }
}

// ─── 自动快照 ─────────────────────────────────────────────────

/**
 * 在写入文件前自动创建快照。
 * 仅当文件已存在时才创建快照（新文件不需要回滚）。
 *
 * @param relativePath - 工作区相对路径
 * @param newContent - 即将写入的新内容
 * @returns 创建的快照（如文件不存在则返回 undefined）
 */
export async function snapshotBeforeWrite(
  relativePath: string,
  newContent: string,
): Promise<Checkpoint | undefined> {
  const wsPath = getWorkspacePath()
  const absPath = resolveWorkspacePath(wsPath, relativePath)

  // 文件不存在，无需快照
  if (!existsSync(absPath)) {
    return undefined
  }

  // 检查文件大小
  const fileStats = await stat(absPath)
  if (fileStats.size > MAX_SNAPSHOT_SIZE) {
    // 文件太大，跳过快照但记录一个占位符
    const checkpoint = createCheckpoint({
      executionId: currentExecutionId,
      conversationId: currentConversationId,
      relativePath,
      originalContent: undefined, // 标记为超大文件
      newContent,
      action: 'write',
    })
    return checkpoint
  }

  try {
    const originalContent = await readFile(absPath, 'utf-8')
    const checkpoint = createCheckpoint({
      executionId: currentExecutionId,
      conversationId: currentConversationId,
      relativePath,
      originalContent,
      newContent,
      action: 'write',
    })
    return checkpoint
  } catch {
    // 文件读取失败，创建无内容快照
    const checkpoint = createCheckpoint({
      executionId: currentExecutionId,
      conversationId: currentConversationId,
      relativePath,
      originalContent: undefined,
      newContent,
      action: 'write',
    })
    return checkpoint
  }
}

/**
 * 在删除文件前自动创建快照。
 * 仅当文件存在时才创建快照。
 *
 * @param relativePath - 工作区相对路径
 * @returns 创建的快照（如文件不存在则返回 undefined）
 */
export async function snapshotBeforeDelete(
  relativePath: string,
): Promise<Checkpoint | undefined> {
  const wsPath = getWorkspacePath()
  const absPath = resolveWorkspacePath(wsPath, relativePath)

  // 文件不存在，无需快照
  if (!existsSync(absPath)) {
    return undefined
  }

  let originalContent: string | undefined

  try {
    const fileStats = await stat(absPath)
    if (fileStats.isFile() && fileStats.size <= MAX_SNAPSHOT_SIZE) {
      originalContent = await readFile(absPath, 'utf-8')
    }
  } catch {
    // 读取失败，继续创建无内容快照
  }

  const checkpoint = createCheckpoint({
    executionId: currentExecutionId,
    conversationId: currentConversationId,
    relativePath,
    originalContent,
    newContent: '', // 删除后内容为空
    action: 'delete',
  })

  return checkpoint
}

// ─── 回滚 ─────────────────────────────────────────────────────

/**
 * 回滚到指定快照状态。
 * 将文件恢复到快照时的原始内容。
 *
 * @param checkpointId - 快照 ID
 * @returns 回滚结果
 * @throws {AppError} CHECKPOINT_NOT_FOUND - 快照不存在
 * @throws {AppError} CHECKPOINT_NO_CONTENT - 快照没有内容（超大文件或读取失败）
 * @throws {AppError} CHECKPOINT_ROLLBACK_FAILED - 回滚写入失败
 */
export async function rollbackToCheckpoint(checkpointId: number): Promise<{
  success: boolean
  relativePath: string
  action: 'write' | 'delete' | 'rename'
  restored: boolean
}> {
  const checkpoint = getCheckpointById(checkpointId)
  if (!checkpoint) {
    throw new AppError(
      ErrorCodes.CHECKPOINT_NOT_FOUND,
      `Checkpoint not found: ${checkpointId}`,
      { checkpointId },
    )
  }

  const wsPath = getWorkspacePath()
  const absPath = resolveWorkspacePath(wsPath, checkpoint.relativePath)

  // 如果是删除操作，恢复原始文件
  if (checkpoint.action === 'delete') {
    if (checkpoint.originalContent === undefined) {
      throw new AppError(
        ErrorCodes.CHECKPOINT_NO_CONTENT,
        `Checkpoint ${checkpointId} has no content to restore (file was too large or unreadable).`,
        { checkpointId, relativePath: checkpoint.relativePath },
      )
    }
    // 确保父目录存在
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, checkpoint.originalContent, 'utf-8')
    return {
      success: true,
      relativePath: checkpoint.relativePath,
      action: checkpoint.action,
      restored: true,
    }
  }

  // 如果是写入操作，恢复原始内容
  if (checkpoint.action === 'write') {
    // 原始内容不存在意味着文件当时不存在，应删除
    if (checkpoint.originalContent === undefined) {
      // 文件之前不存在，删除它
      if (existsSync(absPath)) {
        await rm(absPath, { recursive: false })
      }
      return {
        success: true,
        relativePath: checkpoint.relativePath,
        action: checkpoint.action,
        restored: true,
      }
    }

    // 恢复原始内容
    await writeFile(absPath, checkpoint.originalContent, 'utf-8')
    return {
      success: true,
      relativePath: checkpoint.relativePath,
      action: checkpoint.action,
      restored: true,
    }
  }

  // rename 操作暂不支持回滚
  return {
    success: false,
    relativePath: checkpoint.relativePath,
    action: checkpoint.action,
    restored: false,
  }
}

// ─── 查询 ─────────────────────────────────────────────────────

/**
 * 列出快照（代理到 repository）。
 */
export { listCheckpoints }

/**
 * 获取快照详情（代理到 repository）。
 */
export { getCheckpointById }

/**
 * 删除快照（代理到 repository）。
 */
export { deleteCheckpoint }

/**
 * 获取文件的快照历史。
 *
 * @param relativePath - 工作区相对路径
 * @param limit - 最大返回数量
 * @returns 快照列表
 */
export function getFileHistory(relativePath: string, limit?: number): Checkpoint[] {
  return listCheckpoints({ relativePath, limit: limit ?? 50 })
}

/**
 * 获取快照与当前文件的差异。
 *
 * @param checkpointId - 快照 ID
 * @returns 差异信息
 */
export async function getCheckpointDiff(checkpointId: number): Promise<{
  relativePath: string
  checkpointId: number
  currentExists: boolean
  originalContent?: string
  currentContent?: string
  hasChanged: boolean
}> {
  const checkpoint = getCheckpointById(checkpointId)
  if (!checkpoint) {
    throw new AppError(
      ErrorCodes.CHECKPOINT_NOT_FOUND,
      `Checkpoint not found: ${checkpointId}`,
      { checkpointId },
    )
  }

  const wsPath = getWorkspacePath()
  const absPath = resolveWorkspacePath(wsPath, checkpoint.relativePath)
  const currentExists = existsSync(absPath)

  let currentContent: string | undefined
  if (currentExists) {
    try {
      currentContent = await readFile(absPath, 'utf-8')
    } catch {
      // 读取失败
    }
  }

  const hasChanged =
    currentContent !== checkpoint.originalContent &&
    currentContent !== checkpoint.newContent

  return {
    relativePath: checkpoint.relativePath,
    checkpointId,
    currentExists,
    originalContent: checkpoint.originalContent,
    currentContent,
    hasChanged,
  }
}

// ─── 清理 ─────────────────────────────────────────────────────

/**
 * 清理旧快照。
 * 保留每个文件最近 N 个快照，删除超出保留期限的快照。
 *
 * @param options - 清理选项
 * @returns 删除的快照数量
 */
export function cleanupCheckpoints(options: {
  retentionDays?: number
  keepPerFile?: number
} = {}): number {
  const retentionDays = options.retentionDays ?? SNAPSHOT_RETENTION_DAYS
  const keepPerFile = options.keepPerFile ?? DEFAULT_KEEP_PER_FILE
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  return pruneOldCheckpoints(cutoff, keepPerFile)
}
