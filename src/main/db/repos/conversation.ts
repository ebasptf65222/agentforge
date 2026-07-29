// AgentForge conversations 表数据访问层（Repository）
// 实现 P1-08: 会话 CRUD
// 与 Spec v0.2 §6.3 表结构一致

import type Database from 'better-sqlite3'
import type { Conversation, ApprovalMode } from '@shared/types'
import { getDatabase } from '../index'
import { AppError, ErrorCodes } from '../../utils/error'
import { generateId } from '../../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 */
interface ConversationRow {
  id: string
  title: string
  model_id: string
  approval_mode: string
  message_count: number
  last_message_at: number | null
  sdk_session_id: string | null
  created_at: number
  updated_at: number
}

/** 创建会话参数 */
export interface CreateConversationParams {
  title?: string
  modelId: string
  approvalMode?: ApprovalMode
}

/**
 * 将数据库行转换为 Conversation 实体。
 */
function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    approvalMode: row.approval_mode as ApprovalMode,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    sdkSessionId: row.sdk_session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建会话。
 * - 默认 title 为 '新会话'
 * - 默认 approvalMode 为 'auto-edit'
 *
 * @param params - 创建参数
 * @returns 新建的 Conversation
 */
export function createConversation(params: CreateConversationParams): Conversation {
  const db: Database.Database = getDatabase()

  const now = Date.now()
  const id = generateId()
  const title = params.title ?? '新会话'
  const approvalMode = params.approvalMode ?? 'auto-edit'

  db.prepare(
    `INSERT INTO conversations (id, title, model_id, approval_mode, message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, title, params.modelId, approvalMode, now, now)

  return getConversationById(id)
}

/**
 * 查询所有会话，按 updated_at 降序排列。
 *
 * @returns Conversation 数组
 */
export function listConversations(): Conversation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as ConversationRow[]

  return rows.map(rowToConversation)
}

/**
 * 根据 ID 查询单个会话。
 *
 * @param id - 会话 ID
 * @returns Conversation
 * @throws {AppError} CONVERSATION_NOT_FOUND - 会话不存在
 */
export function getConversationById(id: string): Conversation {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    ConversationRow | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.CONVERSATION_NOT_FOUND,
      `Conversation with id "${id}" not found.`,
      {
        id,
      },
    )
  }

  return rowToConversation(row)
}

/**
 * 删除会话（级联删除消息由 ON DELETE CASCADE 保证）。
 *
 * @param id - 会话 ID
 * @throws {AppError} CONVERSATION_NOT_FOUND - 会话不存在
 */
export function deleteConversation(id: string): void {
  const db: Database.Database = getDatabase()

  const existing = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id) as
    { '1': number } | undefined

  if (existing === undefined) {
    throw new AppError(
      ErrorCodes.CONVERSATION_NOT_FOUND,
      `Conversation with id "${id}" not found.`,
      {
        id,
      },
    )
  }

  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

/**
 * 更新会话标题。
 *
 * @param id - 会话 ID
 * @param title - 新标题
 * @throws {AppError} CONVERSATION_NOT_FOUND - 会话不存在
 */
export function updateConversationTitle(id: string, title: string): void {
  const db: Database.Database = getDatabase()
  const now = Date.now()

  const result = db
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, now, id)

  if (result.changes === 0) {
    throw new AppError(
      ErrorCodes.CONVERSATION_NOT_FOUND,
      `Conversation with id "${id}" not found.`,
      {
        id,
      },
    )
  }
}

/**
 * 递增会话消息计数。
 *
 * @param id - 会话 ID
 * @param increment - 递增量（默认 1）
 */
export function incrementMessageCount(id: string, increment = 1): void {
  const db: Database.Database = getDatabase()
  const now = Date.now()

  db.prepare(
    'UPDATE conversations SET message_count = message_count + ?, updated_at = ? WHERE id = ?',
  ).run(increment, now, id)
}

/**
 * 更新会话最后消息时间。
 *
 * @param id - 会话 ID
 * @param lastMessageAt - 最后消息时间戳（默认 Date.now()）
 */
export function updateLastMessageAt(id: string, lastMessageAt?: number): void {
  const db: Database.Database = getDatabase()
  const now = Date.now()
  const ts = lastMessageAt ?? now

  db.prepare('UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?').run(
    ts,
    now,
    id,
  )
}

/**
 * 更新会话的 SDK sessionId（用于后续 resume）。
 *
 * 在创建新 SDK session 后调用，将 SDK 分配的 sessionId 持久化到数据库，
 * 以便应用重启后通过 client.resumeSession 恢复对话上下文。
 *
 * @param id - 会话 ID
 * @param sdkSessionId - SDK 分配的 sessionId
 */
export function updateSdkSessionId(id: string, sdkSessionId: string): void {
  const db: Database.Database = getDatabase()
  const now = Date.now()

  db.prepare('UPDATE conversations SET sdk_session_id = ?, updated_at = ? WHERE id = ?').run(
    sdkSessionId,
    now,
    id,
  )
}
