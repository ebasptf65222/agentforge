import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, getDatabase, closeDatabase, getSchemaVersion } from './index'

describe('Database Initialization', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-db-test-'))
    dbPath = join(tempDir, 'test.db')
    // 确保每次测试都是独立的数据库实例
    closeDatabase()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── 验收标准 1-3: PRAGMA 配置 ────────────────────────────────

  it('should set journal_mode to WAL', () => {
    const db = initDatabase(dbPath)
    const result = db.pragma('journal_mode', { simple: true }) as string
    expect(result).toBe('wal')
  })

  it('should enable foreign_keys', () => {
    const db = initDatabase(dbPath)
    const result = db.pragma('foreign_keys', { simple: true }) as number
    expect(result).toBe(1)
  })

  it('should set busy_timeout to 5000', () => {
    const db = initDatabase(dbPath)
    const result = db.pragma('busy_timeout', { simple: true }) as number
    expect(result).toBe(5000)
  })

  // ─── 验收标准 4: schema_version ──────────────────────────────

  it('should create schema_version table with version=3', () => {
    initDatabase(dbPath)
    expect(getSchemaVersion()).toBe(3)
  })

  // ─── 验收标准 5: conversations 外键 ───────────────────────────

  it('should have conversations.model_id referencing model_configs(id)', () => {
    const db = initDatabase(dbPath)
    const fks = db.pragma('foreign_key_list(conversations)') as Array<{
      id: number
      table: string
      from: string
      to: string
    }>
    const modelIdFk = fks.find((fk) => fk.from === 'model_id')
    expect(modelIdFk).toBeDefined()
    expect(modelIdFk?.table).toBe('model_configs')
    expect(modelIdFk?.to).toBe('id')
  })

  // ─── 验收标准 6: messages.role CHECK 约束 ────────────────────

  it('should enforce CHECK constraint on messages.role', () => {
    const db = initDatabase(dbPath)

    // 先插入必要的 model 和 conversation（绕过外键）
    db.exec(`
      INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at)
      VALUES ('m1', 'Test', 'openai', 'gpt-4', 'fake-key', 0, 0);
      INSERT INTO conversations (id, title, model_id, created_at, updated_at)
      VALUES ('c1', 'Test', 'm1', 0, 0);
    `)

    // 合法角色应该成功
    expect(() => {
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('msg1', 'c1', 'user', 'hello', 0, 0)
    }).not.toThrow()

    // 非法角色应该抛出
    expect(() => {
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('msg2', 'c1', 'invalid_role', 'hello', 0, 0)
    }).toThrow()
  })

  // ─── 验收标准 7: model_configs.provider CHECK 约束 ────────────

  it('should enforce CHECK constraint on model_configs.provider', () => {
    const db = initDatabase(dbPath)

    expect(() => {
      db.prepare(
        'INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('m1', 'Test', 'openai', 'gpt-4', 'key', 0, 0)
    }).not.toThrow()

    expect(() => {
      db.prepare(
        'INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('m2', 'Test', 'invalid_provider', 'gpt-4', 'key', 0, 0)
    }).toThrow()
  })

  // ─── 验收标准 8: UNIQUE(provider, model_id) ──────────────────

  it('should enforce UNIQUE(provider, model_id) on model_configs', () => {
    const db = initDatabase(dbPath)

    db.prepare(
      'INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('m1', 'Test 1', 'openai', 'gpt-4', 'key1', 0, 0)

    expect(() => {
      db.prepare(
        'INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('m2', 'Test 2', 'openai', 'gpt-4', 'key2', 0, 0)
    }).toThrow()
  })

  // ─── 验收标准 9: idx_messages_conv 索引 ──────────────────────

  it('should have idx_messages_conv index on messages', () => {
    const db = initDatabase(dbPath)
    const indexes = db.pragma('index_list(messages)') as Array<{ name: string; unique: number }>
    const idx = indexes.find((i) => i.name === 'idx_messages_conv')
    expect(idx).toBeDefined()
  })

  // ─── 验收标准 10: idx_conv_updated 索引 ──────────────────────

  it('should have idx_conv_updated index on conversations', () => {
    const db = initDatabase(dbPath)
    const indexes = db.pragma('index_list(conversations)') as Array<{
      name: string
      unique: number
    }>
    const idx = indexes.find((i) => i.name === 'idx_conv_updated')
    expect(idx).toBeDefined()
  })

  // ─── 验收标准 11: app_settings 初始化 ────────────────────────

  it('should initialize app_settings with id=1 via INSERT OR IGNORE', () => {
    const db = initDatabase(dbPath)
    const row = db.prepare('SELECT id, theme, updated_at FROM app_settings WHERE id = 1').get() as
      { id: number; theme: string; updated_at: number } | undefined

    expect(row).toBeDefined()
    expect(row?.id).toBe(1)
    expect(row?.theme).toBe('dark')
    expect(row?.updated_at).toBeGreaterThan(0)
  })

  it('should not overwrite app_settings on re-initialization (INSERT OR IGNORE)', () => {
    const db1 = initDatabase(dbPath)
    db1.prepare('UPDATE app_settings SET theme = ? WHERE id = 1').run('light')
    closeDatabase()

    // 重新初始化（同一文件）
    const db2 = initDatabase(dbPath)
    const row = db2.prepare('SELECT theme FROM app_settings WHERE id = 1').get() as {
      theme: string
    }
    expect(row.theme).toBe('light')
  })

  // ─── 验收标准 12: ON DELETE CASCADE ──────────────────────────

  it('should cascade delete messages when conversation is deleted', () => {
    const db = initDatabase(dbPath)

    db.exec(`
      INSERT INTO model_configs (id, name, provider, model_id, api_key, created_at, updated_at)
      VALUES ('m1', 'Test', 'openai', 'gpt-4', 'fake-key', 0, 0);
      INSERT INTO conversations (id, title, model_id, created_at, updated_at)
      VALUES ('c1', 'Test', 'm1', 0, 0);
      INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at)
      VALUES ('msg1', 'c1', 'user', 'hello', 0, 0);
      INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at)
      VALUES ('msg2', 'c1', 'assistant', 'hi', 0, 0);
    `)

    let count = db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?')
      .get('c1') as { cnt: number }
    expect(count.cnt).toBe(2)

    db.prepare('DELETE FROM conversations WHERE id = ?').run('c1')

    count = db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?')
      .get('c1') as { cnt: number }
    expect(count.cnt).toBe(0)
  })

  // ─── 辅助验证 ────────────────────────────────────────────────

  it('should create 7 tables (5 P1 + mcp_servers + skills)', () => {
    const db = initDatabase(dbPath)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    const tableNames = tables.map((t) => t.name).sort()
    expect(tableNames).toEqual([
      'app_settings',
      'conversations',
      'mcp_servers',
      'messages',
      'model_configs',
      'schema_version',
      'skills',
    ])
  })

  it('should create database file on disk', () => {
    initDatabase(dbPath)
    expect(existsSync(dbPath)).toBe(true)
  })

  it('should return singleton on multiple initDatabase calls', () => {
    const db1 = initDatabase(dbPath)
    const db2 = initDatabase(dbPath)
    expect(db1).toBe(db2)
  })

  it('should throw when getDatabase called before init', () => {
    closeDatabase()
    expect(() => getDatabase()).toThrow()
  })

  it('should close database and allow re-init', () => {
    initDatabase(dbPath)
    closeDatabase()
    // 再次初始化不应报错
    expect(() => initDatabase(dbPath)).not.toThrow()
  })
})
