// AgentForge messages 表数据访问层（Repository）
// 实现 P1-08: 消息 CRUD
// 与 Spec v0.2 §6.4 表结构一致

import type Database from 'better-sqlite3'
import type { ChatMessage, MessageRole, MessageMetadata } from '@shared/types'
import { getDatabase } from '../index'
import { generateId } from '../../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 */
interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  thinking: string | null
  tool_calls: string | null
  metadata: string | null
  created_at: number
  updated_at: number
}

/** 创建消息参数 */
export interface CreateMessageParams {
  conversationId: string
  role: MessageRole
  content: string
  thinking?: string
  toolCalls?: string
  metadata?: MessageMetadata
}

// OPT2-17: 安全 JSON 解析，无效 JSON 返回 undefined 而非崩溃
function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 将数据库行转换为 ChatMessage 实体。
 */
function rowToMessage(row: MessageRow): ChatMessage {
  let metadata: MessageMetadata | undefined
  if (row.metadata !== null) {
    try {
      metadata = JSON.parse(row.metadata) as MessageMetadata
    } catch {
      metadata = undefined
    }
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    thinking: row.thinking ?? undefined,
    toolCalls: row.tool_calls !== null ? safeParseJson(row.tool_calls) : undefined,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建消息。
 *
 * @param params - 创建参数
 * @returns 新建的 ChatMessage
 */
export function createMessage(params: CreateMessageParams): ChatMessage {
  const db: Database.Database = getDatabase()

  const now = Date.now()
  const id = generateId()
  const metadataJson = params.metadata !== undefined ? JSON.stringify(params.metadata) : null

  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, thinking, tool_calls, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.conversationId,
    params.role,
    params.content,
    params.thinking ?? null,
    params.toolCalls ?? null,
    metadataJson,
    now,
    now,
  )

  return rowToMessage({
    id,
    conversation_id: params.conversationId,
    role: params.role,
    content: params.content,
    thinking: params.thinking ?? null,
    tool_calls: params.toolCalls ?? null,
    metadata: metadataJson,
    created_at: now,
    updated_at: now,
  })
}

/**
 * 根据会话 ID 查询所有消息，按 created_at 升序排列。
 *
 * @param conversationId - 会话 ID
 * @returns ChatMessage 数组
 */
export function getMessagesByConversationId(conversationId: string): ChatMessage[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as MessageRow[]

  return rows.map(rowToMessage)
}
