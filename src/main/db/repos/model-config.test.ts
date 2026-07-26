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

// Mock electron (db/index.ts 和 encryption.ts 都依赖 electron)
const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plain: string) => Buffer.from(`enc:${plain}`)),
  decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, '')),
}
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
  safeStorage: mockSafeStorage,
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
  createModelConfig,
  getModelConfigById,
  getModelConfigMasked,
  listModelConfigs,
  updateModelConfig,
  deleteModelConfig,
  modelConfigExists,
  DEFAULT_CAPABILITIES,
} = await import('./model-config')

describe('model-config repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-repo-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
    vi.clearAllMocks()
    // 重新设置 safeStorage mock 的默认行为（clearAllMocks 会重置实现）
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.encryptString.mockImplementation((plain: string) => Buffer.from(`enc:${plain}`))
    mockSafeStorage.decryptString.mockImplementation((buf: Buffer) =>
      buf.toString('utf-8').replace(/^enc:/, ''),
    )
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── createModelConfig ─────────────────────────────────────────

  describe('createModelConfig', () => {
    it('should create a model and return full ModelConfig with id and timestamps', () => {
      const created = createModelConfig({
        name: 'GPT-4 Test',
        provider: 'openai',
        modelId: 'gpt-4',
        apiKey: 'sk-test-123',
        baseUrl: 'https://api.openai.com/v1',
        temperature: 0.5,
        maxTokens: 2048,
      })

      expect(created.id).toBeDefined()
      expect(typeof created.id).toBe('string')
      expect(created.id.length).toBe(36) // UUID v4
      expect(created.name).toBe('GPT-4 Test')
      expect(created.provider).toBe('openai')
      expect(created.modelId).toBe('gpt-4')
      expect(created.apiKey).toBe('sk-test-123') // decrypted
      expect(created.baseUrl).toBe('https://api.openai.com/v1')
      expect(created.temperature).toBe(0.5)
      expect(created.maxTokens).toBe(2048)
      expect(created.isDefault).toBe(false)
      expect(created.createdAt).toBeGreaterThan(0)
      expect(created.updatedAt).toBe(created.createdAt)
    })

    it('should apply default values for temperature, maxTokens, capabilities', () => {
      const created = createModelConfig({
        name: 'Default Model',
        provider: 'deepseek',
        modelId: 'deepseek-chat',
        apiKey: 'sk-test',
      })

      expect(created.temperature).toBe(0.7)
      expect(created.maxTokens).toBe(4096)
      expect(created.capabilities).toEqual(DEFAULT_CAPABILITIES)
      expect(created.baseUrl).toBeUndefined()
    })

    it('should encrypt API key before storing', () => {
      createModelConfig({
        name: 'Enc Test',
        provider: 'openai',
        modelId: 'gpt-4-enc',
        apiKey: 'sk-secret-key',
      })

      expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('sk-secret-key')

      // Verify stored value is encrypted (Base64 of "enc:sk-secret-key")
      const row = testDb
        .prepare('SELECT api_key FROM model_configs WHERE model_id = ?')
        .get('gpt-4-enc') as { api_key: string }
      expect(row.api_key).toBe(Buffer.from('enc:sk-secret-key').toString('base64'))
    })

    it('should throw MODEL_DUPLICATE when provider + modelId already exists', () => {
      createModelConfig({
        name: 'First',
        provider: 'openai',
        modelId: 'gpt-4',
        apiKey: 'sk-key-1',
      })

      expect(() =>
        createModelConfig({
          name: 'Second',
          provider: 'openai',
          modelId: 'gpt-4',
          apiKey: 'sk-key-2',
        }),
      ).toThrow(/MODEL_DUPLICATE|already exists/)
    })

    it('should allow same modelId with different providers', () => {
      createModelConfig({
        name: 'OpenAI',
        provider: 'openai',
        modelId: 'shared-model',
        apiKey: 'sk-1',
      })

      expect(() =>
        createModelConfig({
          name: 'Custom',
          provider: 'custom',
          modelId: 'shared-model',
          apiKey: 'sk-2',
        }),
      ).not.toThrow()
    })

    it('should merge capabilities with defaults', () => {
      const created = createModelConfig({
        name: 'Cap Test',
        provider: 'anthropic',
        modelId: 'claude-3',
        apiKey: 'sk-test',
        capabilities: { toolUse: true, maxContextLength: 100000 },
      })

      expect(created.capabilities).toEqual({
        streaming: true, // default
        toolUse: true, // overridden
        vision: false, // default
        maxContextLength: 100000, // overridden
      })
    })
  })

  // ─── getModelConfigById ────────────────────────────────────────

  describe('getModelConfigById', () => {
    it('should return model with decrypted API key', () => {
      const created = createModelConfig({
        name: 'Get Test',
        provider: 'openai',
        modelId: 'gpt-4-get',
        apiKey: 'sk-decrypt-me',
      })

      const fetched = getModelConfigById(created.id)
      expect(fetched.apiKey).toBe('sk-decrypt-me')
    })

    it('should throw MODEL_NOT_FOUND for non-existent id', () => {
      expect(() => getModelConfigById('non-existent-id')).toThrow(/MODEL_NOT_FOUND|not found/)
    })
  })

  // ─── getModelConfigMasked ──────────────────────────────────────

  describe('getModelConfigMasked', () => {
    it('should return model with apiKey masked as ***', () => {
      const created = createModelConfig({
        name: 'Mask Test',
        provider: 'openai',
        modelId: 'gpt-4-mask',
        apiKey: 'sk-secret',
      })

      const masked = getModelConfigMasked(created.id)
      expect(masked.apiKey).toBe('***')
      expect(masked.name).toBe('Mask Test')
    })

    it('should throw MODEL_NOT_FOUND for non-existent id', () => {
      expect(() => getModelConfigMasked('non-existent-id')).toThrow(/MODEL_NOT_FOUND|not found/)
    })
  })

  // ─── listModelConfigs ──────────────────────────────────────────

  describe('listModelConfigs', () => {
    it('should return empty array when no models exist', () => {
      const list = listModelConfigs()
      expect(list).toEqual([])
    })

    it('should return all models with masked apiKey', () => {
      createModelConfig({
        name: 'Model A',
        provider: 'openai',
        modelId: 'gpt-4-a',
        apiKey: 'sk-a',
      })
      createModelConfig({
        name: 'Model B',
        provider: 'deepseek',
        modelId: 'deepseek-b',
        apiKey: 'sk-b',
      })

      const list = listModelConfigs()
      expect(list).toHaveLength(2)
      expect(list.every((m) => m.apiKey === '***')).toBe(true)
      expect(list.map((m) => m.name).sort()).toEqual(['Model A', 'Model B'])
    })
  })

  // ─── updateModelConfig ─────────────────────────────────────────

  describe('updateModelConfig', () => {
    it('should update name field', () => {
      const created = createModelConfig({
        name: 'Old Name',
        provider: 'openai',
        modelId: 'gpt-4-upd',
        apiKey: 'sk-old',
      })

      updateModelConfig({ id: created.id, name: 'New Name' })
      const updated = getModelConfigById(created.id)
      expect(updated.name).toBe('New Name')
      expect(updated.apiKey).toBe('sk-old') // unchanged
    })

    it('should re-encrypt API key when provided', () => {
      const created = createModelConfig({
        name: 'Key Update',
        provider: 'openai',
        modelId: 'gpt-4-key',
        apiKey: 'sk-old',
      })

      updateModelConfig({ id: created.id, apiKey: 'sk-new' })
      expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('sk-new')

      const updated = getModelConfigById(created.id)
      expect(updated.apiKey).toBe('sk-new')
    })

    it('should update temperature and maxTokens', () => {
      const created = createModelConfig({
        name: 'Param Update',
        provider: 'openai',
        modelId: 'gpt-4-param',
        apiKey: 'sk-test',
      })

      updateModelConfig({ id: created.id, temperature: 0.1, maxTokens: 8192 })
      const updated = getModelConfigById(created.id)
      expect(updated.temperature).toBe(0.1)
      expect(updated.maxTokens).toBe(8192)
    })

    it('should set isDefault=true and clear other defaults', () => {
      const m1 = createModelConfig({
        name: 'Model 1',
        provider: 'openai',
        modelId: 'gpt-4-d1',
        apiKey: 'sk-1',
      })
      const m2 = createModelConfig({
        name: 'Model 2',
        provider: 'openai',
        modelId: 'gpt-4-d2',
        apiKey: 'sk-2',
      })

      updateModelConfig({ id: m1.id, isDefault: true })
      expect(getModelConfigById(m1.id).isDefault).toBe(true)

      updateModelConfig({ id: m2.id, isDefault: true })
      expect(getModelConfigById(m2.id).isDefault).toBe(true)
      expect(getModelConfigById(m1.id).isDefault).toBe(false)
    })

    it('should merge capabilities on update', () => {
      const created = createModelConfig({
        name: 'Cap Update',
        provider: 'openai',
        modelId: 'gpt-4-cap',
        apiKey: 'sk-test',
        capabilities: { toolUse: true, maxContextLength: 8000 },
      })

      updateModelConfig({ id: created.id, capabilities: { vision: true } })
      const updated = getModelConfigById(created.id)
      expect(updated.capabilities).toEqual({
        streaming: true,
        toolUse: true, // preserved
        vision: true, // updated
        maxContextLength: 8000, // preserved
      })
    })

    it('should update updated_at timestamp', () => {
      const created = createModelConfig({
        name: 'TS Test',
        provider: 'openai',
        modelId: 'gpt-4-ts',
        apiKey: 'sk-test',
      })

      const updated = getModelConfigById(created.id)
      updateModelConfig({ id: created.id, name: 'Updated Name' })
      const after = getModelConfigById(created.id)

      expect(after.updatedAt).toBeGreaterThanOrEqual(updated.updatedAt)
      expect(after.name).toBe('Updated Name')
    })

    it('should throw MODEL_NOT_FOUND for non-existent id', () => {
      expect(() => updateModelConfig({ id: 'non-existent', name: 'X' })).toThrow(
        /MODEL_NOT_FOUND|not found/,
      )
    })

    it('should update baseUrl', () => {
      const created = createModelConfig({
        name: 'URL Test',
        provider: 'openai',
        modelId: 'gpt-4-url',
        apiKey: 'sk-test',
        baseUrl: 'https://old.example.com',
      })

      updateModelConfig({ id: created.id, baseUrl: 'https://new.example.com' })
      expect(getModelConfigById(created.id).baseUrl).toBe('https://new.example.com')
    })
  })

  // ─── deleteModelConfig ─────────────────────────────────────────

  describe('deleteModelConfig', () => {
    it('should delete a non-default model', () => {
      const created = createModelConfig({
        name: 'Delete Me',
        provider: 'openai',
        modelId: 'gpt-4-del',
        apiKey: 'sk-test',
      })

      deleteModelConfig(created.id)
      expect(modelConfigExists(created.id)).toBe(false)
    })

    it('should throw MODEL_NOT_FOUND for non-existent id', () => {
      expect(() => deleteModelConfig('non-existent')).toThrow(/MODEL_NOT_FOUND|not found/)
    })

    it('should throw MODEL_DELETE_DEFAULT when deleting default model', () => {
      const created = createModelConfig({
        name: 'Default Model',
        provider: 'openai',
        modelId: 'gpt-4-default',
        apiKey: 'sk-test',
      })

      updateModelConfig({ id: created.id, isDefault: true })

      expect(() => deleteModelConfig(created.id)).toThrow(/MODEL_DELETE_DEFAULT|default model/)
      // Model should still exist
      expect(modelConfigExists(created.id)).toBe(true)
    })
  })

  // ─── modelConfigExists ─────────────────────────────────────────

  describe('modelConfigExists', () => {
    it('should return true for existing model', () => {
      const created = createModelConfig({
        name: 'Exists',
        provider: 'openai',
        modelId: 'gpt-4-exist',
        apiKey: 'sk-test',
      })

      expect(modelConfigExists(created.id)).toBe(true)
    })

    it('should return false for non-existent model', () => {
      expect(modelConfigExists('non-existent')).toBe(false)
    })
  })
})
