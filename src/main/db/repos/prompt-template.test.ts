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

// Mock electron (db/index.ts 依赖 electron)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  },
}))

// Mock db/index.ts 的 getDatabase，使其返回我们的测试 DB
vi.mock('../index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getSchemaVersion: vi.fn(() => 10),
}))

// 在 mock 设置完成后导入被测模块
const {
  createPromptTemplate,
  getPromptTemplateById,
  getAllPromptTemplates,
  getPromptTemplatesByCategory,
  updatePromptTemplate,
  deletePromptTemplate,
} = await import('./prompt-template')

import { AppError, ErrorCodes } from '../../utils/error'

// ─── 辅助函数 ─────────────────────────────────────────────────────

/** 创建测试用 Prompt 模板参数 */
function makeCreateParams(
  overrides: Partial<Parameters<typeof createPromptTemplate>[0]> = {},
): Parameters<typeof createPromptTemplate>[0] {
  return {
    title: 'Test Template',
    content: 'You are a helpful assistant. Task: {{task}}',
    category: 'general',
    variables: ['task'],
    ...overrides,
  }
}

describe('prompt-template repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-prompt-template-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── createPromptTemplate ─────────────────────────────────────────

  describe('createPromptTemplate', () => {
    it('should create a template and return full PromptTemplate with id and timestamps', () => {
      const created = createPromptTemplate(makeCreateParams())

      expect(created.id).toBeTruthy()
      expect(created.title).toBe('Test Template')
      expect(created.content).toContain('{{task}}')
      expect(created.category).toBe('general')
      expect(created.variables).toEqual(['task'])
      expect(created.createdAt).toBeGreaterThan(0)
      expect(created.updatedAt).toBeGreaterThan(0)
    })

    it('should default category to "general" when not provided', () => {
      const created = createPromptTemplate({
        title: 'No Category',
        content: 'Some content',
      })

      expect(created.category).toBe('general')
    })

    it('should default variables to [] when not provided', () => {
      const created = createPromptTemplate({
        title: 'No Vars',
        content: 'Some content',
      })

      expect(created.variables).toEqual([])
    })

    it('should throw VALIDATION_ERROR when title is empty string', () => {
      expect(() => createPromptTemplate(makeCreateParams({ title: '' }))).toThrow(AppError)
      try {
        createPromptTemplate(makeCreateParams({ title: '' }))
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR when title is whitespace only', () => {
      expect(() => createPromptTemplate(makeCreateParams({ title: '   ' }))).toThrow(AppError)
    })

    it('should throw VALIDATION_ERROR when content is empty string', () => {
      expect(() => createPromptTemplate(makeCreateParams({ content: '' }))).toThrow(AppError)
      try {
        createPromptTemplate(makeCreateParams({ content: '' }))
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR when content is whitespace only', () => {
      expect(() => createPromptTemplate(makeCreateParams({ content: '   ' }))).toThrow(AppError)
    })

    it('should persist template to database (queryable by id)', () => {
      const created = createPromptTemplate(makeCreateParams())
      const fetched = getPromptTemplateById(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched?.title).toBe(created.title)
      expect(fetched?.content).toBe(created.content)
    })

    it('should allow multiple templates with the same title', () => {
      const t1 = createPromptTemplate(makeCreateParams())
      const t2 = createPromptTemplate(makeCreateParams())

      expect(t1.id).not.toBe(t2.id)
    })
  })

  // ─── getPromptTemplateById ───────────────────────────────────────

  describe('getPromptTemplateById', () => {
    it('should return template by id', () => {
      const created = createPromptTemplate(makeCreateParams())
      const fetched = getPromptTemplateById(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.title).toBe('Test Template')
    })

    it('should return null when id does not exist', () => {
      const fetched = getPromptTemplateById('nonexistent-id')

      expect(fetched).toBeNull()
    })
  })

  // ─── getAllPromptTemplates ───────────────────────────────────────

  describe('getAllPromptTemplates', () => {
    it('should return all templates sorted by updated_at DESC', () => {
      const t1 = createPromptTemplate(makeCreateParams({ title: 'T1' }))
      const t2 = createPromptTemplate(makeCreateParams({ title: 'T2' }))

      // 更新 t1 使其 updatedAt 更晚
      updatePromptTemplate({ id: t1.id, title: 'T1-updated' })

      const list = getAllPromptTemplates()

      expect(list).toHaveLength(2)
      // t1 被更新过，updatedAt 更大，应排在前面
      expect(list[0].id).toBe(t1.id)
      expect(list[1].id).toBe(t2.id)
    })

    it('should return empty array when no templates exist', () => {
      const list = getAllPromptTemplates()

      expect(list).toEqual([])
    })
  })

  // ─── getPromptTemplatesByCategory ───────────────────────────────

  describe('getPromptTemplatesByCategory', () => {
    it('should return only templates matching the category', () => {
      createPromptTemplate(makeCreateParams({ title: 'G1', category: 'general' }))
      createPromptTemplate(makeCreateParams({ title: 'C1', category: 'coding' }))
      createPromptTemplate(makeCreateParams({ title: 'C2', category: 'coding' }))

      const codingList = getPromptTemplatesByCategory('coding')

      expect(codingList).toHaveLength(2)
      expect(codingList.every((t) => t.category === 'coding')).toBe(true)
    })

    it('should return empty array when no templates match the category', () => {
      createPromptTemplate(makeCreateParams({ category: 'general' }))

      const list = getPromptTemplatesByCategory('nonexistent-category')

      expect(list).toEqual([])
    })
  })

  // ─── updatePromptTemplate ───────────────────────────────────────

  describe('updatePromptTemplate', () => {
    it('should update title', () => {
      const created = createPromptTemplate(makeCreateParams())
      updatePromptTemplate({ id: created.id, title: 'Updated Title' })

      const fetched = getPromptTemplateById(created.id)
      expect(fetched?.title).toBe('Updated Title')
    })

    it('should update content', () => {
      const created = createPromptTemplate(makeCreateParams())
      updatePromptTemplate({ id: created.id, content: 'New content {{task}}' })

      const fetched = getPromptTemplateById(created.id)
      expect(fetched?.content).toBe('New content {{task}}')
    })

    it('should update category', () => {
      const created = createPromptTemplate(makeCreateParams())
      updatePromptTemplate({ id: created.id, category: 'coding' })

      const fetched = getPromptTemplateById(created.id)
      expect(fetched?.category).toBe('coding')
    })

    it('should update variables', () => {
      const created = createPromptTemplate(makeCreateParams())
      updatePromptTemplate({ id: created.id, variables: ['topic', 'format', 'lang'] })

      const fetched = getPromptTemplateById(created.id)
      expect(fetched?.variables).toEqual(['topic', 'format', 'lang'])
    })

    it('should update updated_at timestamp', async () => {
      const created = createPromptTemplate(makeCreateParams())
      const originalUpdatedAt = created.updatedAt

      // 等待至少 5ms 确保时间戳不同
      await new Promise((r) => setTimeout(r, 5))
      updatePromptTemplate({ id: created.id, title: 'Updated' })

      const fetched = getPromptTemplateById(created.id)
      expect(fetched?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('should only update provided fields', () => {
      const created = createPromptTemplate(makeCreateParams())
      updatePromptTemplate({ id: created.id, title: 'New Title' })

      const fetched = getPromptTemplateById(created.id)
      // title 应更新
      expect(fetched?.title).toBe('New Title')
      // content 应保持原样
      expect(fetched?.content).toBe(created.content)
      // category 应保持原样
      expect(fetched?.category).toBe('general')
    })

    it('should throw PROMPT_TEMPLATE_NOT_FOUND when updating nonexistent template', () => {
      expect(() =>
        updatePromptTemplate({ id: 'nonexistent', title: 'Test' }),
      ).toThrow(AppError)
      try {
        updatePromptTemplate({ id: 'nonexistent', title: 'Test' })
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND)
      }
    })

    it('should throw VALIDATION_ERROR when updating title to empty', () => {
      const created = createPromptTemplate(makeCreateParams())
      expect(() => updatePromptTemplate({ id: created.id, title: '' })).toThrow(AppError)
    })

    it('should throw VALIDATION_ERROR when updating content to empty', () => {
      const created = createPromptTemplate(makeCreateParams())
      expect(() => updatePromptTemplate({ id: created.id, content: '' })).toThrow(AppError)
    })
  })

  // ─── deletePromptTemplate ───────────────────────────────────────

  describe('deletePromptTemplate', () => {
    it('should delete a template', () => {
      const created = createPromptTemplate(makeCreateParams())
      deletePromptTemplate(created.id)

      const fetched = getPromptTemplateById(created.id)
      expect(fetched).toBeNull()
    })

    it('should throw PROMPT_TEMPLATE_NOT_FOUND when deleting nonexistent template', () => {
      expect(() => deletePromptTemplate('nonexistent')).toThrow(AppError)
      try {
        deletePromptTemplate('nonexistent')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND)
      }
    })

    it('should not affect other templates when deleting one', () => {
      const t1 = createPromptTemplate(makeCreateParams({ title: 'T1' }))
      const t2 = createPromptTemplate(makeCreateParams({ title: 'T2' }))

      deletePromptTemplate(t1.id)

      const list = getAllPromptTemplates()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(t2.id)
    })
  })

  // ─── JSON 序列化/反序列化 ─────────────────────────────────────────

  describe('JSON serialization', () => {
    it('should correctly serialize and deserialize variables with special characters', () => {
      const created = createPromptTemplate(
        makeCreateParams({
          variables: ['var-with-dash', 'var_with_underscore', 'var.with.dot'],
        }),
      )
      const fetched = getPromptTemplateById(created.id)

      expect(fetched?.variables).toEqual([
        'var-with-dash',
        'var_with_underscore',
        'var.with.dot',
      ])
    })

    it('should handle empty variables array', () => {
      const created = createPromptTemplate(makeCreateParams({ variables: [] }))
      const fetched = getPromptTemplateById(created.id)

      expect(fetched?.variables).toEqual([])
    })

    it('should handle content with unicode characters', () => {
      const created = createPromptTemplate(
        makeCreateParams({ content: '你是一个助手。任务：{{任务}}' }),
      )
      const fetched = getPromptTemplateById(created.id)

      expect(fetched?.content).toBe('你是一个助手。任务：{{任务}}')
    })

    it('should handle category with unicode characters', () => {
      const created = createPromptTemplate(makeCreateParams({ category: '写作' }))
      const fetched = getPromptTemplateById(created.id)

      expect(fetched?.category).toBe('写作')
    })

    it('should recover gracefully from corrupted variables JSON', () => {
      const created = createPromptTemplate(makeCreateParams({ variables: ['task'] }))

      // 手动破坏 variables 列
      testDb
        .prepare('UPDATE prompt_templates SET variables = ? WHERE id = ?')
        .run('not-valid-json', created.id)

      const fetched = getPromptTemplateById(created.id)
      // 应返回空数组作为 fallback
      expect(fetched?.variables).toEqual([])
    })
  })
})
