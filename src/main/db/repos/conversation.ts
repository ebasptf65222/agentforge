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
  parent_id: string | null
  fork_index: number
  is_forked: number
  created_at: number
  updated_at: number
}

/** 创建会话参数 */
export interface CreateConversationParams {
  title?: string
  modelId: string
  approvalMode?: ApprovalMode
}

/** Fork 会话参数 (P3-01) */
export interface ForkConversationParams {
  sourceConversationId: string
  /** 在 fork 点之前的消息数量（即保留 source 的前 N 条消息） */
  messageCount?: number
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
    parentId: row.parent_id ?? null,
    forkIndex: row.fork_index ?? 0,
    isForked: row.is_forked === 1,
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

// ─── P3-01: 对话分支 (Fork) ────────────────────────────────────────

/**
 * Fork 一个会话：复制 source 会话及其消息，创建一个新的分支会话。
 *
 * - 新会话的 parent_id 指向 source
 * - 新会话的 title 为 "source标题 (fork)"
 * - 复制 source 的所有消息到新会话
 * - 新会话的 model_id / approval_mode 与 source 相同
 * - 新会话的 is_forked = 1
 *
 * @param params - Fork 参数
 * @returns 新建的 fork 会话
 * @throws {AppError} CONVERSATION_NOT_FOUND - 源会话不存在
 */
export function forkConversation(params: ForkConversationParams): Conversation {
  const db: Database.Database = getDatabase()
  const { sourceConversationId, messageCount } = params

  // 1. 获取源会话
  const source = getConversationById(sourceConversationId)

  // 2. 计算 fork_index（同 parent 的兄弟数量）
  const siblingCount = db
    .prepare('SELECT COUNT(*) as count FROM conversations WHERE parent_id = ?')
    .get(sourceConversationId) as { count: number }

  const forkIndex = siblingCount.count

  // 3. 创建新会话
  const now = Date.now()
  const newId = generateId()
  const title = `${source.title} (分支 ${forkIndex + 1})`

  db.prepare(
    `INSERT INTO conversations
     (id, title, model_id, approval_mode, message_count, last_message_at,
      parent_id, fork_index, is_forked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    newId,
    title,
    source.modelId,
    source.approvalMode,
    0, // 稍后根据复制的消息数更新
    now,
    sourceConversationId,
    forkIndex,
    now,
    now,
  )

  // 4. 复制消息（如果指定了 messageCount，只复制前 N 条）
  let copiedMessages = 0
  if (messageCount === undefined || messageCount > 0) {
    const limitClause = messageCount !== undefined ? `LIMIT ${messageCount}` : ''
    const messages = db
      .prepare(
        `SELECT id, role, content, thinking, tool_calls, metadata, created_at, updated_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC
         ${limitClause}`,
      )
      .all(sourceConversationId) as Array<{
        id: string
        role: string
        content: string
        thinking: string | null
        tool_calls: string | null
        metadata: string | null
        created_at: number
        updated_at: number
      }>

    const insertMsg = db.prepare(
      `INSERT INTO messages
       (id, conversation_id, role, content, thinking, tool_calls, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    for (const msg of messages) {
      const newMsgId = generateId()
      insertMsg.run(
        newMsgId,
        newId,
        msg.role,
        msg.content,
        msg.thinking,
        msg.tool_calls,
        msg.metadata,
        msg.created_at,
        msg.updated_at,
      )
      copiedMessages++
    }
  }

  // 5. 更新新会话的消息计数
  if (copiedMessages > 0) {
    db.prepare('UPDATE conversations SET message_count = ? WHERE id = ?').run(
      copiedMessages,
      newId,
    )
  }

  return getConversationById(newId)
}

/**
 * 获取指定会话的所有子分支（直接子级）。
 *
 * @param parentId - 父会话 ID
 * @returns 子会话数组（按 fork_index 排序）
 */
export function getConversationChildren(parentId: string): Conversation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM conversations WHERE parent_id = ? ORDER BY fork_index ASC')
    .all(parentId) as ConversationRow[]

  return rows.map(rowToConversation)
}

/**
 * 获取指定会话的祖先链（从根到当前）。
 *
 * @param id - 会话 ID
 * @returns 祖先会话数组（从根到直接父级）
 */
export function getConversationAncestors(id: string): Conversation[] {
  const db: Database.Database = getDatabase()
  const ancestors: Conversation[] = []

  let currentId: string | null = id
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const row = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(currentId) as ConversationRow | undefined

    if (!row || !row.parent_id) break

    const parent = getConversationById(row.parent_id)
    ancestors.unshift(parent)
    currentId = row.parent_id
  }

  return ancestors
}

/**
 * 获取所有 fork 会话（带有分支关系的会话列表）。
 * 返回按 updated_at 降序排列的所有会话，前端自行构建树。
 *
 * @returns 所有会话数组
 */
export function listConversationsWithFork(): Conversation[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as ConversationRow[]

  return rows.map(rowToConversation)
}
