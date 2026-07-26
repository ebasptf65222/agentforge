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
const {
  createConversation,
  listConversations,
  getConversationById,
  deleteConversation,
  updateConversationTitle,
  incrementMessageCount,
  updateLastMessageAt,
} = await import('./conversation')

describe('conversation repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-conv-test-'))
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

  // 辅助：插入测试用模型配置
  function insertTestModel(id = 'model-1'): void {
    testDb
      .prepare(
        'INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, 'Test Model', 'openai', 'gpt-4', 'sk-test', Date.now(), Date.now())
  }

  // ─── createConversation ─────────────────────────────────────

  describe('createConversation', () => {
    it('should create a conversation with default title and approvalMode', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })

      expect(conv.id).toBeDefined()
      expect(typeof conv.id).toBe('string')
      expect(conv.title).toBe('新会话')
      expect(conv.modelId).toBe('model-1')
      expect(conv.approvalMode).toBe('auto-edit')
      expect(conv.messageCount).toBe(0)
      expect(conv.lastMessageAt).toBeNull()
      expect(conv.createdAt).toBeGreaterThan(0)
      expect(conv.updatedAt).toBe(conv.createdAt)
    })

    it('should create a conversation with custom title and approvalMode', () => {
      insertTestModel()

      const conv = createConversation({
        modelId: 'model-1',
        title: 'Test Chat',
        approvalMode: 'suggest',
      })

      expect(conv.title).toBe('Test Chat')
      expect(conv.approvalMode).toBe('suggest')
    })
  })

  // ─── listConversations ───────────────────────────────────────

  describe('listConversations', () => {
    it('should return empty array when no conversations exist', () => {
      const list = listConversations()
      expect(list).toEqual([])
    })

    it('should return conversations ordered by updated_at DESC', async () => {
      insertTestModel()

      const conv1 = createConversation({ modelId: 'model-1' })
      // Ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 2))
      const conv2 = createConversation({ modelId: 'model-1' })

      const list = listConversations()
      expect(list).toHaveLength(2)
      // conv2 should be first (more recent updated_at)
      expect(list[0].id).toBe(conv2.id)
      expect(list[1].id).toBe(conv1.id)
    })
  })

  // ─── getConversationById ────────────────────────────────────

  describe('getConversationById', () => {
    it('should return conversation by id', () => {
      insertTestModel()

      const created = createConversation({ modelId: 'model-1', title: 'Find Me' })
      const fetched = getConversationById(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.title).toBe('Find Me')
    })

    it('should throw CONVERSATION_NOT_FOUND for non-existent id', () => {
      expect(() => getConversationById('non-existent')).toThrow(/CONVERSATION_NOT_FOUND|not found/)
    })
  })

  // ─── deleteConversation ─────────────────────────────────────

  describe('deleteConversation', () => {
    it('should delete a conversation', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      deleteConversation(conv.id)

      expect(listConversations()).toHaveLength(0)
    })

    it('should throw CONVERSATION_NOT_FOUND for non-existent id', () => {
      expect(() => deleteConversation('non-existent')).toThrow(/CONVERSATION_NOT_FOUND|not found/)
    })

    it('should cascade delete associated messages', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      // Directly insert a message
      testDb
        .prepare(
          'INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('msg-1', conv.id, 'user', 'hello', Date.now(), Date.now())

      deleteConversation(conv.id)

      const msgCount = testDb
        .prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?')
        .get(conv.id) as { cnt: number }
      expect(msgCount.cnt).toBe(0)
    })
  })

  // ─── updateConversationTitle ────────────────────────────────

  describe('updateConversationTitle', () => {
    it('should update the conversation title', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      updateConversationTitle(conv.id, 'New Title')

      const updated = getConversationById(conv.id)
      expect(updated.title).toBe('New Title')
    })

    it('should throw CONVERSATION_NOT_FOUND for non-existent id', () => {
      expect(() => updateConversationTitle('non-existent', 'Title')).toThrow(
        /CONVERSATION_NOT_FOUND|not found/,
      )
    })
  })

  // ─── incrementMessageCount ──────────────────────────────────

  describe('incrementMessageCount', () => {
    it('should increment message_count by 1 by default', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      expect(conv.messageCount).toBe(0)

      incrementMessageCount(conv.id)
      const updated = getConversationById(conv.id)
      expect(updated.messageCount).toBe(1)
    })

    it('should increment by a custom amount', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      incrementMessageCount(conv.id, 3)

      const updated = getConversationById(conv.id)
      expect(updated.messageCount).toBe(3)
    })

    it('should update updated_at timestamp', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      incrementMessageCount(conv.id)

      const updated = getConversationById(conv.id)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(conv.updatedAt)
    })
  })

  // ─── updateLastMessageAt ────────────────────────────────────

  describe('updateLastMessageAt', () => {
    it('should update last_message_at to current time', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      expect(conv.lastMessageAt).toBeNull()

      updateLastMessageAt(conv.id)

      const updated = getConversationById(conv.id)
      expect(updated.lastMessageAt).toBeGreaterThan(0)
    })

    it('should use provided timestamp', () => {
      insertTestModel()

      const conv = createConversation({ modelId: 'model-1' })
      const customTime = 9999999999999
      updateLastMessageAt(conv.id, customTime)

      const updated = getConversationById(conv.id)
      expect(updated.lastMessageAt).toBe(customTime)
    })
  })
})
