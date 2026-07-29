// AgentForge LangGraph 引擎: 上下文管理增强 - Memory Store (P2-04)
//
// 为 LangGraph 引擎提供持久化记忆存储，支持跨对话上下文保留。
//
// 设计目标：
// - 基于 SQLite 的键值存储，持久化对话上下文摘要
// - 在对话结束时自动保存上下文摘要
// - 在新对话开始时自动加载相关上下文
// - 支持按 conversationId 和 namespace 检索
// - 与现有 context-manager.ts 的截断策略互补
//
// 与现有 context-manager 的关系：
// - context-manager: 负责单次对话内的上下文截断（token 窗口管理）
// - memory-store: 负责跨对话的上下文持久化（长期记忆）
//
// 数据结构：
// - key: `${namespace}:${conversationId}:${key}`
// - value: JSON 序列化的记忆内容
// - createdAt / updatedAt: 时间戳

import { getDatabase } from '../db/index'
import { generateId } from '../utils/id'

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 记忆条目 */
export interface MemoryEntry {
  id: string
  namespace: string
  conversationId: string
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

/** 记忆存储配置 */
export interface MemoryStoreConfig {
  /** 默认命名空间 */
  defaultNamespace?: string
  /** 最大记忆条目数（按 conversationId 限制） */
  maxEntriesPerConversation?: number
}

// ─── MemoryStore ─────────────────────────────────────────────────

/**
 * 持久化记忆存储。
 *
 * 基于 SQLite 的键值存储，支持：
 * - 按命名空间和会话 ID 存储/检索记忆
 * - 自动清理过期记忆
 * - 上下文摘要持久化
 */
export class MemoryStore {
  private config: Required<MemoryStoreConfig>
  private initialized = false

  constructor(config: MemoryStoreConfig = {}) {
    this.config = {
      defaultNamespace: config.defaultNamespace ?? 'agentforge',
      maxEntriesPerConversation: config.maxEntriesPerConversation ?? 100,
    }
  }

  /**
   * 初始化记忆表（幂等）。
   * 在首次使用前调用。
   */
  initialize(): void {
    if (this.initialized) return

    const db = getDatabase()
    db.exec(`
      CREATE TABLE IF NOT EXISTS langgraph_memory (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(namespace, conversation_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_conversation
        ON langgraph_memory(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_memory_namespace
        ON langgraph_memory(namespace, conversation_id);
    `)

    this.initialized = true
  }

  /**
   * 存储记忆条目。
   * 如果同 namespace+conversationId+key 的条目已存在，则更新。
   *
   * @param conversationId - 会话 ID
   * @param key - 记忆键
   * @param value - 记忆值（字符串或可序列化对象）
   * @param namespace - 命名空间（默认 'agentforge'）
   */
  set(
    conversationId: string,
    key: string,
    value: string | Record<string, unknown>,
    namespace?: string,
  ): void {
    this.initialize()
    const db = getDatabase()
    const ns = namespace ?? this.config.defaultNamespace
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
    const now = Date.now()
    const id = generateId()

    db.prepare(
      `INSERT INTO langgraph_memory (id, namespace, conversation_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, conversation_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    ).run(id, ns, conversationId, key, valueStr, now, now)
  }

  /**
   * 获取记忆条目。
   *
   * @param conversationId - 会话 ID
   * @param key - 记忆键
   * @param namespace - 命名空间
   * @returns 记忆值（字符串），不存在时返回 null
   */
  get(
    conversationId: string,
    key: string,
    namespace?: string,
  ): string | null {
    this.initialize()
    const db = getDatabase()
    const ns = namespace ?? this.config.defaultNamespace

    const row = db
      .prepare(
        `SELECT value FROM langgraph_memory
         WHERE namespace = ? AND conversation_id = ? AND key = ?`,
      )
      .get(ns, conversationId, key) as { value: string } | undefined

    return row?.value ?? null
  }

  /**
   * 获取会话的所有记忆条目。
   *
   * @param conversationId - 会话 ID
   * @param namespace - 命名空间
   * @returns MemoryEntry 数组
   */
  getAll(conversationId: string, namespace?: string): MemoryEntry[] {
    this.initialize()
    const db = getDatabase()
    const ns = namespace ?? this.config.defaultNamespace

    const rows = db
      .prepare(
        `SELECT id, namespace, conversation_id as conversationId, key, value,
                created_at as createdAt, updated_at as updatedAt
         FROM langgraph_memory
         WHERE namespace = ? AND conversation_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(ns, conversationId) as MemoryEntry[]

    return rows
  }

  /**
   * 删除记忆条目。
   *
   * @param conversationId - 会话 ID
   * @param key - 记忆键
   * @param namespace - 命名空间
   * @returns 是否删除成功
   */
  delete(conversationId: string, key: string, namespace?: string): boolean {
    this.initialize()
    const db = getDatabase()
    const ns = namespace ?? this.config.defaultNamespace

    const result = db
      .prepare(
        `DELETE FROM langgraph_memory
         WHERE namespace = ? AND conversation_id = ? AND key = ?`,
      )
      .run(ns, conversationId, key)

    return result.changes > 0
  }

  /**
   * 清除会话的所有记忆。
   *
   * @param conversationId - 会话 ID
   * @param namespace - 命名空间
   * @returns 删除的条目数
   */
  clear(conversationId: string, namespace?: string): number {
    this.initialize()
    const db = getDatabase()
    const ns = namespace ?? this.config.defaultNamespace

    const result = db
      .prepare(
        `DELETE FROM langgraph_memory
         WHERE namespace = ? AND conversation_id = ?`,
      )
      .run(ns, conversationId)

    return result.changes
  }

  /**
   * 保存对话上下文摘要。
   * 在对话结束时调用，将对话摘要持久化。
   *
   * @param conversationId - 会话 ID
   * @param summary - 对话摘要
   * @param metadata - 额外元数据
   */
  saveConversationSummary(
    conversationId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.set(conversationId, 'summary', summary)
    if (metadata) {
      this.set(conversationId, 'metadata', metadata)
    }
  }

  /**
   * 加载对话上下文摘要。
   * 在新对话开始时调用，加载相关上下文。
   *
   * @param conversationId - 会话 ID
   * @returns 摘要字符串，不存在时返回 null
   */
  loadConversationSummary(conversationId: string): string | null {
    return this.get(conversationId, 'summary')
  }

  /**
   * 加载对话元数据。
   *
   * @param conversationId - 会话 ID
   * @returns 元数据对象，不存在时返回 null
   */
  loadConversationMetadata(conversationId: string): Record<string, unknown> | null {
    const raw = this.get(conversationId, 'metadata')
    if (!raw) return null
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /**
   * 构建上下文摘要提示词。
   * 将记忆中的摘要注入到 System Prompt 中。
   *
   * @param conversationId - 会话 ID
   * @returns 包含历史摘要的提示词片段，无摘要时返回空字符串
   */
  buildContextPrompt(conversationId: string): string {
    const summary = this.loadConversationSummary(conversationId)
    if (!summary) return ''

    return `\n## Previous Conversation Summary\n${summary}\n`
  }

  /**
   * 获取会话记忆条目数量。
   *
   * @param conversationId - 会话 ID
   * @param namespace - 命名空间
   * @returns 条目数量
   */
  count(conversationId: string, namespace?: string): number {
    this.initialize()
    const db = getDatabase()
    const ns = namespace ?? this.config.defaultNamespace

    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM langgraph_memory
         WHERE namespace = ? AND conversation_id = ?`,
      )
      .get(ns, conversationId) as { count: number }

    return row.count
  }
}

// ─── 单例管理 ─────────────────────────────────────────────────────

/** 全局 MemoryStore 单例 */
let globalMemoryStore: MemoryStore | null = null

/**
 * 获取全局 MemoryStore 单例。
 */
export function getMemoryStore(): MemoryStore {
  if (!globalMemoryStore) {
    globalMemoryStore = new MemoryStore()
  }
  return globalMemoryStore
}

/**
 * 重置全局 MemoryStore（仅供测试使用）。
 */
export function resetMemoryStore(): void {
  globalMemoryStore = null
}
