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
  getSchemaVersion: vi.fn(() => 5),
}))

// 在 mock 设置完成后导入被测模块
const {
  createSkill,
  getSkillById,
  getSkillByName,
  listSkills,
  updateSkill,
  deleteSkill,
  skillExists,
  listAutoTriggerSkills,
} = await import('./skill')

import { AppError, ErrorCodes } from '../../utils/error'
import type { SkillVariable } from '@shared/types'

// ─── 辅助函数 ─────────────────────────────────────────────────────

/** 创建测试用 Skill 参数 */
function makeCreateParams(
  overrides: Partial<Parameters<typeof createSkill>[0]> = {},
): Parameters<typeof createSkill>[0] {
  return {
    name: 'test-skill',
    displayName: 'Test Skill',
    description: 'A test skill for testing',
    prompt: 'You are a helpful assistant. Task: {{task}}',
    allowedTools: ['web_search', 'file_write'],
    trigger: 'auto' as const,
    variables: [
      { name: 'task', description: 'The task to perform', required: true },
    ] as SkillVariable[],
    ...overrides,
  }
}

describe('skill repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-skill-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── createSkill ─────────────────────────────────────────────────

  describe('createSkill', () => {
    it('should create a skill and return full Skill with id and timestamps', () => {
      const created = createSkill(makeCreateParams())

      expect(created.id).toBeTruthy()
      expect(created.name).toBe('test-skill')
      expect(created.displayName).toBe('Test Skill')
      expect(created.description).toBe('A test skill for testing')
      expect(created.prompt).toContain('{{task}}')
      expect(created.allowedTools).toEqual(['web_search', 'file_write'])
      expect(created.trigger).toBe('auto')
      expect(created.variables).toHaveLength(1)
      expect(created.variables[0].name).toBe('task')
      expect(created.isBuiltin).toBe(false)
      expect(created.createdAt).toBeGreaterThan(0)
      expect(created.updatedAt).toBeGreaterThan(0)
    })

    it('should create a builtin skill with isBuiltin=true', () => {
      const created = createSkill(makeCreateParams({ isBuiltin: true }))

      expect(created.isBuiltin).toBe(true)
    })

    it('should create a manual trigger skill', () => {
      const created = createSkill(makeCreateParams({ trigger: 'manual' }))

      expect(created.trigger).toBe('manual')
    })

    it('should create a skill with optional modelId', () => {
      const created = createSkill(makeCreateParams({ modelId: 'model-123' }))

      expect(created.modelId).toBe('model-123')
    })

    it('should create a skill with empty variables defaulting to []', () => {
      const created = createSkill(makeCreateParams({ variables: undefined }))

      expect(created.variables).toEqual([])
    })

    it('should throw SKILL_DUPLICATE when name already exists', () => {
      createSkill(makeCreateParams())

      expect(() => createSkill(makeCreateParams())).toThrow(AppError)
      try {
        createSkill(makeCreateParams())
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_DUPLICATE)
      }
    })

    it('should throw SKILL_PROMPT_EMPTY when prompt is empty string', () => {
      expect(() => createSkill(makeCreateParams({ prompt: '' }))).toThrow(AppError)
      try {
        createSkill(makeCreateParams({ prompt: '' }))
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_PROMPT_EMPTY)
      }
    })

    it('should throw SKILL_PROMPT_EMPTY when prompt is whitespace only', () => {
      expect(() => createSkill(makeCreateParams({ prompt: '   ' }))).toThrow(AppError)
    })

    it('should persist skill to database (queryable by id)', () => {
      const created = createSkill(makeCreateParams())
      const fetched = getSkillById(created.id)

      expect(fetched.name).toBe(created.name)
      expect(fetched.prompt).toBe(created.prompt)
    })
  })

  // ─── getSkillById ────────────────────────────────────────────────

  describe('getSkillById', () => {
    it('should return skill by id', () => {
      const created = createSkill(makeCreateParams())
      const fetched = getSkillById(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.name).toBe('test-skill')
    })

    it('should throw SKILL_NOT_FOUND when id does not exist', () => {
      expect(() => getSkillById('nonexistent-id')).toThrow(AppError)
      try {
        getSkillById('nonexistent-id')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_NOT_FOUND)
      }
    })
  })

  // ─── getSkillByName ─────────────────────────────────────────────

  describe('getSkillByName', () => {
    it('should return skill by name', () => {
      createSkill(makeCreateParams())
      const fetched = getSkillByName('test-skill')

      expect(fetched).toBeDefined()
      expect(fetched?.name).toBe('test-skill')
    })

    it('should return undefined when name does not exist', () => {
      const fetched = getSkillByName('nonexistent-skill')

      expect(fetched).toBeUndefined()
    })
  })

  // ─── listSkills ──────────────────────────────────────────────────

  describe('listSkills', () => {
    it('should return all skills sorted by created_at ASC', () => {
      // 内置 Skills 已由 schema.sql 种子数据插入（2 个）
      const s1 = createSkill(makeCreateParams({ name: 'skill-a' }))
      createSkill(makeCreateParams({ name: 'skill-b' }))
      const s3 = createSkill(makeCreateParams({ name: 'skill-c' }))

      const list = listSkills()

      // 2 个内置 + 3 个自定义 = 5
      expect(list).toHaveLength(5)
      // 内置 Skills 在前（created_at 更早）
      expect(list[0].isBuiltin).toBe(true)
      expect(list[1].isBuiltin).toBe(true)
      // 自定义 Skills 按插入顺序排列
      expect(list[2].id).toBe(s1.id)
      expect(list[4].id).toBe(s3.id)
    })

    it('should return only built-in skills when no custom skills exist', () => {
      const list = listSkills()
      // schema.sql 种子数据插入了 2 个内置 Skill
      expect(list).toHaveLength(2)
      expect(list.every((s) => s.isBuiltin)).toBe(true)
    })

    it('should filter by trigger=auto', () => {
      // 内置 Skills 均为 trigger=auto（2 个）
      createSkill(makeCreateParams({ name: 'auto-1', trigger: 'auto' }))
      createSkill(makeCreateParams({ name: 'manual-1', trigger: 'manual' }))
      createSkill(makeCreateParams({ name: 'auto-2', trigger: 'auto' }))

      const list = listSkills({ trigger: 'auto' })

      // 2 个内置 + 2 个自定义 auto = 4
      expect(list).toHaveLength(4)
      expect(list.every((s) => s.trigger === 'auto')).toBe(true)
    })

    it('should filter by trigger=manual', () => {
      createSkill(makeCreateParams({ name: 'auto-1', trigger: 'auto' }))
      createSkill(makeCreateParams({ name: 'manual-1', trigger: 'manual' }))

      const list = listSkills({ trigger: 'manual' })

      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('manual-1')
    })

    it('should filter by builtinOnly=true', () => {
      // schema.sql 已插入 2 个内置 Skill
      createSkill(makeCreateParams({ name: 'custom-1', isBuiltin: false }))
      createSkill(makeCreateParams({ name: 'builtin-1', isBuiltin: true }))

      const list = listSkills({ builtinOnly: true })

      // 2 个种子内置 + 1 个测试创建的内置 = 3
      expect(list).toHaveLength(3)
      expect(list.every((s) => s.isBuiltin)).toBe(true)
    })

    it('should filter by builtinOnly=false (custom only)', () => {
      createSkill(makeCreateParams({ name: 'custom-1', isBuiltin: false }))
      createSkill(makeCreateParams({ name: 'builtin-1', isBuiltin: true }))

      const list = listSkills({ builtinOnly: false })

      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('custom-1')
    })

    it('should combine trigger and builtin filters', () => {
      // schema.sql 已插入 2 个内置 auto Skill
      createSkill(makeCreateParams({ name: 'auto-custom', trigger: 'auto', isBuiltin: false }))
      createSkill(makeCreateParams({ name: 'auto-builtin', trigger: 'auto', isBuiltin: true }))
      createSkill(makeCreateParams({ name: 'manual-builtin', trigger: 'manual', isBuiltin: true }))

      const list = listSkills({ trigger: 'auto', builtinOnly: true })

      // 2 个种子内置 + 1 个测试创建的 auto+builtin = 3
      expect(list).toHaveLength(3)
      expect(list.every((s) => s.trigger === 'auto' && s.isBuiltin)).toBe(true)
    })
  })

  // ─── updateSkill ─────────────────────────────────────────────────

  describe('updateSkill', () => {
    it('should update displayName', () => {
      const created = createSkill(makeCreateParams())
      updateSkill({ id: created.id, displayName: 'Updated Name' })

      const fetched = getSkillById(created.id)
      expect(fetched.displayName).toBe('Updated Name')
    })

    it('should update description', () => {
      const created = createSkill(makeCreateParams())
      updateSkill({ id: created.id, description: 'New description' })

      const fetched = getSkillById(created.id)
      expect(fetched.description).toBe('New description')
    })

    it('should update prompt', () => {
      const created = createSkill(makeCreateParams())
      updateSkill({ id: created.id, prompt: 'New prompt {{task}}' })

      const fetched = getSkillById(created.id)
      expect(fetched.prompt).toBe('New prompt {{task}}')
    })

    it('should update allowedTools', () => {
      const created = createSkill(makeCreateParams())
      updateSkill({ id: created.id, allowedTools: ['web_search', 'web_scrape', 'kb_search'] })

      const fetched = getSkillById(created.id)
      expect(fetched.allowedTools).toEqual(['web_search', 'web_scrape', 'kb_search'])
    })

    it('should update trigger', () => {
      const created = createSkill(makeCreateParams({ trigger: 'auto' }))
      updateSkill({ id: created.id, trigger: 'manual' })

      const fetched = getSkillById(created.id)
      expect(fetched.trigger).toBe('manual')
    })

    it('should update variables', () => {
      const created = createSkill(makeCreateParams())
      const newVars: SkillVariable[] = [
        { name: 'topic', description: 'Topic', required: true },
        { name: 'format', description: 'Output format', required: false, defaultValue: 'md' },
      ]
      updateSkill({ id: created.id, variables: newVars })

      const fetched = getSkillById(created.id)
      expect(fetched.variables).toHaveLength(2)
      expect(fetched.variables[1].defaultValue).toBe('md')
    })

    it('should update modelId', () => {
      const created = createSkill(makeCreateParams())
      updateSkill({ id: created.id, modelId: 'new-model-id' })

      const fetched = getSkillById(created.id)
      expect(fetched.modelId).toBe('new-model-id')
    })

    it('should clear modelId when set to null', () => {
      const created = createSkill(makeCreateParams({ modelId: 'model-1' }))
      updateSkill({ id: created.id, modelId: null })

      const fetched = getSkillById(created.id)
      expect(fetched.modelId).toBeUndefined()
    })

    it('should update updated_at timestamp', async () => {
      const created = createSkill(makeCreateParams())
      const originalUpdatedAt = created.updatedAt

      // 等待至少 5ms 确保时间戳不同
      await new Promise((r) => setTimeout(r, 5))
      updateSkill({ id: created.id, displayName: 'Updated' })

      const fetched = getSkillById(created.id)
      expect(fetched.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('should throw SKILL_NOT_FOUND when updating nonexistent skill', () => {
      expect(() => updateSkill({ id: 'nonexistent', displayName: 'Test' })).toThrow(AppError)
      try {
        updateSkill({ id: 'nonexistent', displayName: 'Test' })
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_NOT_FOUND)
      }
    })

    it('should throw SKILL_PROMPT_EMPTY when updating prompt to empty', () => {
      const created = createSkill(makeCreateParams())
      expect(() => updateSkill({ id: created.id, prompt: '' })).toThrow(AppError)
    })

    // ─── 内置 Skill 保护 ──────────────────────────────────────────

    it('should only update modelId for builtin skill', () => {
      const created = createSkill(makeCreateParams({ isBuiltin: true, prompt: 'Original prompt' }))

      // 尝试更新 prompt（应被忽略）
      updateSkill({
        id: created.id,
        prompt: 'Modified prompt',
        displayName: 'Modified',
        modelId: 'new-model',
      })

      const fetched = getSkillById(created.id)
      // modelId 应更新
      expect(fetched.modelId).toBe('new-model')
      // prompt 应保持原样
      expect(fetched.prompt).toBe('Original prompt')
      // displayName 应保持原样
      expect(fetched.displayName).toBe('Test Skill')
    })

    it('should allow clearing modelId for builtin skill', () => {
      const created = createSkill(makeCreateParams({ isBuiltin: true, modelId: 'model-1' }))

      updateSkill({ id: created.id, modelId: null })

      const fetched = getSkillById(created.id)
      expect(fetched.modelId).toBeUndefined()
    })

    it('should do nothing when updating builtin skill with only non-modelId fields', () => {
      const created = createSkill(makeCreateParams({ isBuiltin: true }))

      updateSkill({
        id: created.id,
        displayName: 'Should not change',
        description: 'Should not change',
      })

      const fetched = getSkillById(created.id)
      expect(fetched.displayName).toBe('Test Skill')
      expect(fetched.description).toBe('A test skill for testing')
    })
  })

  // ─── deleteSkill ─────────────────────────────────────────────────

  describe('deleteSkill', () => {
    it('should delete a custom skill', () => {
      const created = createSkill(makeCreateParams())
      deleteSkill(created.id)

      expect(skillExists(created.id)).toBe(false)
    })

    it('should throw SKILL_NOT_FOUND when deleting nonexistent skill', () => {
      expect(() => deleteSkill('nonexistent')).toThrow(AppError)
      try {
        deleteSkill('nonexistent')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_NOT_FOUND)
      }
    })

    it('should throw SKILL_DELETE_BUILTIN when deleting builtin skill', () => {
      const created = createSkill(makeCreateParams({ isBuiltin: true }))

      expect(() => deleteSkill(created.id)).toThrow(AppError)
      try {
        deleteSkill(created.id)
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_DELETE_BUILTIN)
      }
      // 确认仍未被删除
      expect(skillExists(created.id)).toBe(true)
    })
  })

  // ─── skillExists ──────────────────────────────────────────────────

  describe('skillExists', () => {
    it('should return true when skill exists', () => {
      const created = createSkill(makeCreateParams())

      expect(skillExists(created.id)).toBe(true)
    })

    it('should return false when skill does not exist', () => {
      expect(skillExists('nonexistent')).toBe(false)
    })
  })

  // ─── listAutoTriggerSkills ───────────────────────────────────────

  describe('listAutoTriggerSkills', () => {
    it('should return only trigger=auto skills', () => {
      // 内置 Skills 均为 trigger=auto（2 个）
      createSkill(makeCreateParams({ name: 'auto-1', trigger: 'auto' }))
      createSkill(makeCreateParams({ name: 'manual-1', trigger: 'manual' }))
      createSkill(makeCreateParams({ name: 'auto-2', trigger: 'auto' }))

      const list = listAutoTriggerSkills()

      // 2 个内置 + 2 个自定义 auto = 4
      expect(list).toHaveLength(4)
      expect(list.every((s) => s.trigger === 'auto')).toBe(true)
    })

    it('should include built-in auto skills even when only manual custom skills exist', () => {
      createSkill(makeCreateParams({ name: 'manual-1', trigger: 'manual' }))

      const list = listAutoTriggerSkills()

      // 内置 Skills 均为 auto 触发，始终返回
      expect(list).toHaveLength(2)
      expect(list.every((s) => s.isBuiltin)).toBe(true)
    })
  })

  // ─── JSON 序列化/反序列化 ─────────────────────────────────────────

  describe('JSON serialization', () => {
    it('should correctly serialize and deserialize allowedTools with special characters', () => {
      const created = createSkill(
        makeCreateParams({
          allowedTools: ['tool-with-dash', 'tool_with_underscore', 'tool.with.dot'],
        }),
      )
      const fetched = getSkillById(created.id)

      expect(fetched.allowedTools).toEqual([
        'tool-with-dash',
        'tool_with_underscore',
        'tool.with.dot',
      ])
    })

    it('should correctly serialize and deserialize variables with all fields', () => {
      const vars: SkillVariable[] = [
        { name: 'topic', description: 'Research topic', required: true },
        { name: 'depth', description: 'Detail level', required: false, defaultValue: 'medium' },
        { name: 'lang', description: 'Output language 中文', required: false, defaultValue: 'zh' },
      ]
      const created = createSkill(makeCreateParams({ variables: vars }))
      const fetched = getSkillById(created.id)

      expect(fetched.variables).toEqual(vars)
    })

    it('should handle empty allowedTools array', () => {
      const created = createSkill(makeCreateParams({ allowedTools: [] }))
      const fetched = getSkillById(created.id)

      expect(fetched.allowedTools).toEqual([])
    })
  })

  // ─── CHECK 约束验证 ──────────────────────────────────────────────

  describe('CHECK constraints', () => {
    it('should reject invalid trigger value at DB level', () => {
      expect(() => {
        testDb
          .prepare(
            `INSERT INTO skills (id, name, display_name, description, prompt, allowed_tools, trigger, variables, is_builtin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'test-id',
            'bad-trigger',
            'Bad',
            'desc',
            'prompt',
            '[]',
            'invalid',
            '[]',
            0,
            Date.now(),
            Date.now(),
          )
      }).toThrow()
    })
  })
})
