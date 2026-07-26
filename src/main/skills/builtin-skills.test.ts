// AgentForge P3-05: 内置 Skills 种子数据测试
// 验证 schema.sql 种子数据正确插入了两个内置 Skill

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
const schemaSql = readFileSync(join(__dirname_test, '../db/schema.sql'), 'utf-8')

// ─── 测试用 DB 实例 ──────────────────────────────────────────────
let tempDir: string
let testDb: DatabaseType

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  },
}))

vi.mock('../db/index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getSchemaVersion: vi.fn(() => 5),
}))

const {
  getSkillByName,
  getSkillById,
  listSkills,
  listAutoTriggerSkills,
  updateSkill,
  deleteSkill,
} = await import('../db/repos/skill')

import { AppError, ErrorCodes } from '../utils/error'
import type { Skill } from '@shared/types'

/** Helper: 断言 Skill 存在并返回非 null 值（避免 non-null assertion 警告） */
function requireSkill(name: string): Skill {
  const skill = getSkillByName(name)
  if (!skill) throw new Error(`Skill "${name}" not found`)
  return skill
}

// ─── 测试 ───────────────────────────────────────────────────────

describe('Built-in Skills seed data (P3-05)', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-builtin-skills-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── research-report ─────────────────────────────────────────

  describe('research-report', () => {
    it('should exist in database after schema initialization', () => {
      const skill = getSkillByName('research-report')
      expect(skill).toBeDefined()
    })

    it('should have correct basic properties', () => {
      const skill = getSkillByName('research-report')
      expect(skill).toBeDefined()

      expect(skill?.id).toBe('builtin-skill-research-report')
      expect(skill?.name).toBe('research-report')
      expect(skill?.displayName).toBe('研究报告生成')
      expect(skill?.description).toContain('研究报告')
      expect(skill?.isBuiltin).toBe(true)
      expect(skill?.trigger).toBe('auto')
    })

    it('should have prompt with {{topic}} variable placeholder', () => {
      const skill = getSkillByName('research-report')
      expect(skill).toBeDefined()
      expect(skill?.prompt).toContain('{{topic}}')
      expect(skill?.prompt).toContain('研究报告')
    })

    it('should have allowedTools with web-search and web-scrape', () => {
      const skill = getSkillByName('research-report')
      expect(skill).toBeDefined()
      expect(skill?.allowedTools).toEqual(['web-search', 'web-scrape'])
    })

    it('should have topic variable defined as required', () => {
      const skill = getSkillByName('research-report')
      expect(skill).toBeDefined()
      expect(skill?.variables).toHaveLength(1)
      expect(skill?.variables[0]?.name).toBe('topic')
      expect(skill?.variables[0]?.required).toBe(true)
    })

    it('should have modelId as undefined (use default)', () => {
      const skill = getSkillByName('research-report')
      expect(skill).toBeDefined()
      expect(skill?.modelId).toBeUndefined()
    })
  })

  // ─── summarize-docs ──────────────────────────────────────────

  describe('summarize-docs', () => {
    it('should exist in database after schema initialization', () => {
      const skill = getSkillByName('summarize-docs')
      expect(skill).toBeDefined()
    })

    it('should have correct basic properties', () => {
      const skill = getSkillByName('summarize-docs')
      expect(skill).toBeDefined()

      expect(skill?.id).toBe('builtin-skill-summarize-docs')
      expect(skill?.name).toBe('summarize-docs')
      expect(skill?.displayName).toBe('文档摘要')
      expect(skill?.description).toContain('摘要')
      expect(skill?.isBuiltin).toBe(true)
      expect(skill?.trigger).toBe('auto')
    })

    it('should have prompt with {{content}} and {{style}} variable placeholders', () => {
      const skill = getSkillByName('summarize-docs')
      expect(skill).toBeDefined()
      expect(skill?.prompt).toContain('{{content}}')
      expect(skill?.prompt).toContain('{{style}}')
    })

    it('should have allowedTools with file-read', () => {
      const skill = getSkillByName('summarize-docs')
      expect(skill).toBeDefined()
      expect(skill?.allowedTools).toEqual(['file-read'])
    })

    it('should have content variable as required and style as optional with default', () => {
      const skill = getSkillByName('summarize-docs')
      expect(skill).toBeDefined()
      expect(skill?.variables).toHaveLength(2)

      const contentVar = skill?.variables.find((v) => v.name === 'content')
      expect(contentVar?.required).toBe(true)

      const styleVar = skill?.variables.find((v) => v.name === 'style')
      expect(styleVar?.required).toBe(false)
      expect(styleVar?.defaultValue).toBe('简洁')
    })
  })

  // ─── 通用内置 Skill 行为 ─────────────────────────────────────

  describe('built-in Skill protection', () => {
    it('should list both built-in Skills in listSkills', () => {
      const builtinSkills = listSkills({ builtinOnly: true })
      expect(builtinSkills).toHaveLength(2)
      expect(builtinSkills.map((s) => s.name).sort()).toEqual(['research-report', 'summarize-docs'])
    })

    it('should list both built-in Skills in listAutoTriggerSkills', () => {
      const autoSkills = listAutoTriggerSkills()
      expect(autoSkills).toHaveLength(2)
      expect(autoSkills.every((s) => s.isBuiltin)).toBe(true)
    })

    it('should not allow deleting research-report', () => {
      const skill = requireSkill('research-report')

      try {
        deleteSkill(skill.id)
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_DELETE_BUILTIN)
      }
    })

    it('should not allow deleting summarize-docs', () => {
      const skill = requireSkill('summarize-docs')

      try {
        deleteSkill(skill.id)
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.SKILL_DELETE_BUILTIN)
      }
    })

    it('should only allow updating modelId for research-report', () => {
      const skill = requireSkill('research-report')

      // 更新 modelId 应该成功
      updateSkill({ id: skill.id, modelId: 'custom-model-1' })
      const updated = getSkillById(skill.id)
      expect(updated.modelId).toBe('custom-model-1')

      // prompt 不应改变
      expect(updated.prompt).toBe(skill.prompt)
    })

    it('should not allow updating prompt for summarize-docs', () => {
      const skill = requireSkill('summarize-docs')
      const originalPrompt = skill.prompt

      // 尝试更新 prompt（应被忽略，不报错也不改变）
      updateSkill({ id: skill.id, prompt: 'Hacked prompt' })

      const updated = getSkillById(skill.id)
      expect(updated.prompt).toBe(originalPrompt)
    })

    it('should allow clearing modelId for built-in Skill', () => {
      const skill = requireSkill('research-report')

      // 先设置 modelId
      updateSkill({ id: skill.id, modelId: 'some-model' })
      expect(getSkillById(skill.id).modelId).toBe('some-model')

      // 清除 modelId
      updateSkill({ id: skill.id, modelId: null })
      expect(getSkillById(skill.id).modelId).toBeUndefined()
    })
  })

  // ─── 幂等性测试 ──────────────────────────────────────────────

  describe('seed idempotency', () => {
    it('should not duplicate built-in Skills when schema is re-executed', () => {
      // 再次执行 schema.sql（模拟重复初始化）
      testDb.exec(schemaSql)

      const builtinSkills = listSkills({ builtinOnly: true })
      expect(builtinSkills).toHaveLength(2)
    })

    it('should preserve modelId changes across schema re-execution', () => {
      const skill = requireSkill('research-report')
      updateSkill({ id: skill.id, modelId: 'my-model' })

      // 再次执行 schema.sql
      testDb.exec(schemaSql)

      // modelId 应该保留（INSERT OR IGNORE 不覆盖已有行）
      const after = getSkillById(skill.id)
      expect(after.modelId).toBe('my-model')
    })
  })
})
