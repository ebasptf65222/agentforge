import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

// ─── 静态读取 schema ─────────────────────────────────────────────
const __dirname_test = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(__dirname_test, '../schema.sql'), 'utf-8')

// ─── 测试用 DB 实例（在 beforeEach 中初始化）──────────────────────
let tempDir: string
let testDb: DatabaseType

// Mock electron（db/index.ts 依赖 electron）
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
}))

// Mock db/index.ts 的 getDatabase，使其返回我们的测试 DB
vi.mock('../index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getSchemaVersion: vi.fn(() => 1),
}))

// 在 mock 设置完成后导入被测模块
const { createMessage, getMessagesByConversationId } = await import('./message')

describe('message repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-msg-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
    vi.clearAllMocks()
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // 辅助：插入测试用模型和会话
  function insertTestFixtures(): { modelId: string; convId: string } {
    const modelId = 'model-test-1'
    const convId = 'conv-test-1'
    const now = Date.now()

    testDb
      .prepare(
        'INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(modelId, 'Test Model', 'openai', 'gpt-4', 'sk-test', now, now)

    testDb
      .prepare(
        'INSERT INTO conversations (id, title, model_id, message_count, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      )
      .run(convId, 'Test Conv', modelId, now, now)

    return { modelId, convId }
  }

  // ─── createMessage ──────────────────────────────────────────

  describe('createMessage', () => {
    it('should create a user message and return ChatMessage', () => {
      const { convId } = insertTestFixtures()

      const msg = createMessage({
        conversationId: convId,
        role: 'user',
        content: 'Hello world',
      })

      expect(msg.id).toBeDefined()
      expect(typeof msg.id).toBe('string')
      expect(msg.conversationId).toBe(convId)
      expect(msg.role).toBe('user')
      expect(msg.content).toBe('Hello world')
      expect(msg.thinking).toBeUndefined()
      expect(msg.metadata).toBeUndefined()
      expect(msg.createdAt).toBeGreaterThan(0)
      expect(msg.updatedAt).toBe(msg.createdAt)
    })

    it('should create an assistant message with metadata', () => {
      const { convId } = insertTestFixtures()

      const msg = createMessage({
        conversationId: convId,
        role: 'assistant',
        content: 'Hi there!',
        metadata: {
          modelId: 'model-test-1',
          tokensUsed: 42,
          duration: 1234,
          stopped: false,
        },
      })

      expect(msg.role).toBe('assistant')
      expect(msg.content).toBe('Hi there!')
      expect(msg.metadata).toEqual({
        modelId: 'model-test-1',
        tokensUsed: 42,
        duration: 1234,
        stopped: false,
      })
    })

    it('should create a message with thinking content', () => {
      const { convId } = insertTestFixtures()

      const msg = createMessage({
        conversationId: convId,
        role: 'assistant',
        content: 'Answer',
        thinking: 'Let me think...',
      })

      expect(msg.thinking).toBe('Let me think...')
    })

    it('should store metadata as JSON in database', () => {
      const { convId } = insertTestFixtures()

      createMessage({
        conversationId: convId,
        role: 'assistant',
        content: 'test',
        metadata: { modelId: 'm1', tokensUsed: 10 },
      })

      const row = testDb
        .prepare('SELECT metadata FROM messages WHERE conversation_id = ?')
        .get(convId) as { metadata: string }
      expect(row.metadata).toBe('{"modelId":"m1","tokensUsed":10}')
    })

    it('should store metadata as null when not provided', () => {
      const { convId } = insertTestFixtures()

      createMessage({
        conversationId: convId,
        role: 'user',
        content: 'hello',
      })

      const row = testDb
        .prepare('SELECT metadata FROM messages WHERE conversation_id = ?')
        .get(convId) as { metadata: string | null }
      expect(row.metadata).toBeNull()
    })
  })

  // ─── getMessagesByConversationId ────────────────────────────

  describe('getMessagesByConversationId', () => {
    it('should return empty array when no messages exist', () => {
      const { convId } = insertTestFixtures()

      const msgs = getMessagesByConversationId(convId)
      expect(msgs).toEqual([])
    })

    it('should return messages ordered by created_at ASC', () => {
      const { convId } = insertTestFixtures()

      const msg1 = createMessage({ conversationId: convId, role: 'user', content: 'First' })
      const msg2 = createMessage({ conversationId: convId, role: 'assistant', content: 'Second' })

      const msgs = getMessagesByConversationId(convId)
      expect(msgs).toHaveLength(2)
      expect(msgs[0].id).toBe(msg1.id)
      expect(msgs[0].role).toBe('user')
      expect(msgs[1].id).toBe(msg2.id)
      expect(msgs[1].role).toBe('assistant')
    })

    it('should not return messages from other conversations', () => {
      const { convId } = insertTestFixtures()

      // Create another conversation
      const now = Date.now()
      const convId2 = 'conv-test-2'
      testDb
        .prepare(
          'INSERT INTO conversations (id, title, model_id, message_count, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
        )
        .run(convId2, 'Other Conv', 'model-test-1', now, now)

      createMessage({ conversationId: convId, role: 'user', content: 'In conv1' })
      createMessage({ conversationId: convId2, role: 'user', content: 'In conv2' })

      const msgs = getMessagesByConversationId(convId)
      expect(msgs).toHaveLength(1)
      expect(msgs[0].content).toBe('In conv1')
    })

    it('should parse metadata from JSON', () => {
      const { convId } = insertTestFixtures()

      createMessage({
        conversationId: convId,
        role: 'assistant',
        content: 'test',
        metadata: { modelId: 'm1', tokensUsed: 100, stopped: true },
      })

      const msgs = getMessagesByConversationId(convId)
      expect(msgs[0].metadata).toEqual({
        modelId: 'm1',
        tokensUsed: 100,
        stopped: true,
      })
    })

    it('should handle invalid metadata JSON gracefully', () => {
      const { convId } = insertTestFixtures()

      // Insert a message with invalid JSON metadata
      const now = Date.now()
      testDb
        .prepare(
          'INSERT INTO messages (id, conversation_id, role, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('msg-invalid-json', convId, 'assistant', 'test', '{invalid json}', now, now)

      const msgs = getMessagesByConversationId(convId)
      expect(msgs).toHaveLength(1)
      expect(msgs[0].metadata).toBeUndefined()
    })
  })
})
