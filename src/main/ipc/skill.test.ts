// AgentForge P3-02: Skill IPC Handler 单元测试
// 测试 handleList / handleGet / handleGetByName / handleCreate / handleUpdate / handleDelete
// Mock skill repo，验证 handler 参数校验与调用行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Skill, SkillVariable } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const {
  mockCreateSkill,
  mockGetSkillById,
  mockGetSkillByName,
  mockListSkills,
  mockUpdateSkill,
  mockDeleteSkill,
} = vi.hoisted(() => ({
  mockCreateSkill: vi.fn(),
  mockGetSkillById: vi.fn(),
  mockGetSkillByName: vi.fn(),
  mockListSkills: vi.fn(),
  mockUpdateSkill: vi.fn(),
  mockDeleteSkill: vi.fn(),
}))

vi.mock('../db/repos/skill', () => ({
  createSkill: (...args: unknown[]) => mockCreateSkill(...args),
  getSkillById: (...args: unknown[]) => mockGetSkillById(...args),
  getSkillByName: (...args: unknown[]) => mockGetSkillByName(...args),
  listSkills: (...args: unknown[]) => mockListSkills(...args),
  updateSkill: (...args: unknown[]) => mockUpdateSkill(...args),
  deleteSkill: (...args: unknown[]) => mockDeleteSkill(...args),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const { handleList, handleGet, handleGetByName, handleCreate, handleUpdate, handleDelete } =
  await import('./skill')

// ─── Helpers ────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'test-skill',
    displayName: 'Test Skill',
    description: 'A test skill',
    prompt: 'You are a helpful assistant.',
    modelId: undefined,
    allowedTools: ['web_search'],
    trigger: 'auto',
    variables: [],
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn()
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

describe('skill IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── handleList ─────────────────────────────────────────────────

  describe('handleList', () => {
    it('should list all skills when no params', () => {
      const skills = [makeSkill()]
      mockListSkills.mockReturnValue(skills)

      const result = handleList(undefined)

      expect(mockListSkills).toHaveBeenCalledWith()
      expect(result).toEqual(skills)
    })

    it('should list all skills when params is null', () => {
      mockListSkills.mockReturnValue([])

      handleList(null)

      expect(mockListSkills).toHaveBeenCalledWith()
    })

    it('should filter by trigger', () => {
      mockListSkills.mockReturnValue([])

      handleList({ trigger: 'manual' })

      expect(mockListSkills).toHaveBeenCalledWith({ trigger: 'manual', builtinOnly: undefined })
    })

    it('should filter by builtinOnly', () => {
      mockListSkills.mockReturnValue([])

      handleList({ builtinOnly: true })

      expect(mockListSkills).toHaveBeenCalledWith({ trigger: undefined, builtinOnly: true })
    })

    it('should filter by both trigger and builtinOnly', () => {
      mockListSkills.mockReturnValue([])

      handleList({ trigger: 'auto', builtinOnly: false })

      expect(mockListSkills).toHaveBeenCalledWith({ trigger: 'auto', builtinOnly: false })
    })

    it('should throw VALIDATION_ERROR for invalid trigger', () => {
      expectAppError(() => handleList({ trigger: 'invalid' }), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when builtinOnly is not boolean', () => {
      expectAppError(() => handleList({ builtinOnly: 'yes' }), ErrorCodes.VALIDATION_ERROR)
    })
  })

  // ─── handleGet ──────────────────────────────────────────────────

  describe('handleGet', () => {
    it('should return skill by id', () => {
      const skill = makeSkill()
      mockGetSkillById.mockReturnValue(skill)

      const result = handleGet({ id: 'skill-1' })

      expect(mockGetSkillById).toHaveBeenCalledWith('skill-1')
      expect(result).toEqual(skill)
    })

    it('should propagate SKILL_NOT_FOUND from repo', () => {
      mockGetSkillById.mockImplementation(() => {
        throw new AppError(ErrorCodes.SKILL_NOT_FOUND, 'Not found')
      })

      expectAppError(() => handleGet({ id: 'nonexistent' }), ErrorCodes.SKILL_NOT_FOUND)
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleGet({}), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleGet('string'), ErrorCodes.VALIDATION_ERROR)
    })
  })

  // ─── handleGetByName ────────────────────────────────────────────

  describe('handleGetByName', () => {
    it('should return skill by name', () => {
      const skill = makeSkill()
      mockGetSkillByName.mockReturnValue(skill)

      const result = handleGetByName({ name: 'test-skill' })

      expect(mockGetSkillByName).toHaveBeenCalledWith('test-skill')
      expect(result).toEqual(skill)
    })

    it('should return null when skill does not exist', () => {
      mockGetSkillByName.mockReturnValue(undefined)

      const result = handleGetByName({ name: 'nonexistent' })

      expect(result).toBeNull()
    })

    it('should throw VALIDATION_ERROR when name is missing', () => {
      expectAppError(() => handleGetByName({}), ErrorCodes.VALIDATION_ERROR)
    })
  })

  // ─── handleCreate ───────────────────────────────────────────────

  describe('handleCreate', () => {
    it('should create a skill with all required fields', () => {
      const skill = makeSkill()
      mockCreateSkill.mockReturnValue(skill)

      const result = handleCreate({
        name: 'test-skill',
        displayName: 'Test Skill',
        description: 'A test skill',
        prompt: 'You are a helpful assistant.',
        allowedTools: ['web_search'],
        trigger: 'auto',
      })

      expect(mockCreateSkill).toHaveBeenCalledWith({
        name: 'test-skill',
        displayName: 'Test Skill',
        description: 'A test skill',
        prompt: 'You are a helpful assistant.',
        modelId: undefined,
        allowedTools: ['web_search'],
        trigger: 'auto',
        variables: undefined,
      })
      expect(result).toEqual(skill)
    })

    it('should create a skill with optional modelId and variables', () => {
      const vars: SkillVariable[] = [
        { name: 'topic', description: 'Research topic', required: true },
      ]
      mockCreateSkill.mockReturnValue(makeSkill())

      handleCreate({
        name: 'research',
        displayName: 'Research Report',
        description: 'Generate a research report',
        prompt: 'Research {{topic}}',
        modelId: 'deepseek-chat',
        allowedTools: ['web_search', 'web_scrape'],
        trigger: 'auto',
        variables: vars,
      })

      expect(mockCreateSkill).toHaveBeenCalledWith({
        name: 'research',
        displayName: 'Research Report',
        description: 'Generate a research report',
        prompt: 'Research {{topic}}',
        modelId: 'deepseek-chat',
        allowedTools: ['web_search', 'web_scrape'],
        trigger: 'auto',
        variables: vars,
      })
    })

    it('should default trigger to auto when not provided', () => {
      mockCreateSkill.mockReturnValue(makeSkill())

      handleCreate({
        name: 'test',
        displayName: 'Test',
        description: 'desc',
        prompt: 'prompt',
        allowedTools: [],
      })

      expect(mockCreateSkill).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'auto' }))
    })

    it('should throw VALIDATION_ERROR when name is missing', () => {
      expectAppError(
        () =>
          handleCreate({ displayName: 'Test', description: 'd', prompt: 'p', allowedTools: [] }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when prompt is empty', () => {
      expectAppError(
        () =>
          handleCreate({
            name: 'test',
            displayName: 'Test',
            description: 'd',
            prompt: '',
            allowedTools: [],
          }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR for invalid trigger', () => {
      expectAppError(
        () =>
          handleCreate({
            name: 'test',
            displayName: 'Test',
            description: 'd',
            prompt: 'p',
            allowedTools: [],
            trigger: 'invalid',
          }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should propagate SKILL_DUPLICATE from repo', () => {
      mockCreateSkill.mockImplementation(() => {
        throw new AppError(ErrorCodes.SKILL_DUPLICATE, 'Duplicate')
      })

      expectAppError(
        () =>
          handleCreate({
            name: 'dup',
            displayName: 'Dup',
            description: 'd',
            prompt: 'p',
            allowedTools: [],
          }),
        ErrorCodes.SKILL_DUPLICATE,
      )
    })

    it('should throw VALIDATION_ERROR when allowedTools is not an array', () => {
      expectAppError(
        () =>
          handleCreate({
            name: 'test',
            displayName: 'Test',
            description: 'd',
            prompt: 'p',
            allowedTools: 'web_search',
          }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when variables has invalid structure', () => {
      expectAppError(
        () =>
          handleCreate({
            name: 'test',
            displayName: 'Test',
            description: 'd',
            prompt: 'p',
            allowedTools: [],
            variables: [{ name: '', description: 'd', required: true }],
          }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })
  })

  // ─── handleUpdate ───────────────────────────────────────────────

  describe('handleUpdate', () => {
    it('should update skill display name', () => {
      handleUpdate({ id: 'skill-1', displayName: 'Updated' })

      expect(mockUpdateSkill).toHaveBeenCalledWith({
        id: 'skill-1',
        displayName: 'Updated',
        description: undefined,
        prompt: undefined,
        modelId: undefined,
        allowedTools: undefined,
        trigger: undefined,
        variables: undefined,
      })
    })

    it('should update modelId to null (clear)', () => {
      handleUpdate({ id: 'skill-1', modelId: null })

      expect(mockUpdateSkill).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'skill-1', modelId: null }),
      )
    })

    it('should update multiple fields', () => {
      handleUpdate({
        id: 'skill-1',
        displayName: 'New Name',
        prompt: 'New prompt',
        allowedTools: ['tool1', 'tool2'],
        trigger: 'manual',
      })

      expect(mockUpdateSkill).toHaveBeenCalledWith({
        id: 'skill-1',
        displayName: 'New Name',
        description: undefined,
        prompt: 'New prompt',
        modelId: undefined,
        allowedTools: ['tool1', 'tool2'],
        trigger: 'manual',
        variables: undefined,
      })
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleUpdate({ displayName: 'Test' }), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when prompt is empty string', () => {
      expectAppError(() => handleUpdate({ id: 'skill-1', prompt: '' }), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR for invalid trigger', () => {
      expectAppError(
        () => handleUpdate({ id: 'skill-1', trigger: 'invalid' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should propagate SKILL_NOT_FOUND from repo', () => {
      mockUpdateSkill.mockImplementation(() => {
        throw new AppError(ErrorCodes.SKILL_NOT_FOUND, 'Not found')
      })

      expectAppError(
        () => handleUpdate({ id: 'nonexistent', displayName: 'X' }),
        ErrorCodes.SKILL_NOT_FOUND,
      )
    })
  })

  // ─── handleDelete ───────────────────────────────────────────────

  describe('handleDelete', () => {
    it('should delete skill by id', () => {
      handleDelete({ id: 'skill-1' })

      expect(mockDeleteSkill).toHaveBeenCalledWith('skill-1')
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleDelete({}), ErrorCodes.VALIDATION_ERROR)
    })

    it('should propagate SKILL_DELETE_BUILTIN from repo', () => {
      mockDeleteSkill.mockImplementation(() => {
        throw new AppError(ErrorCodes.SKILL_DELETE_BUILTIN, 'Cannot delete builtin')
      })

      expectAppError(() => handleDelete({ id: 'builtin-1' }), ErrorCodes.SKILL_DELETE_BUILTIN)
    })

    it('should propagate SKILL_NOT_FOUND from repo', () => {
      mockDeleteSkill.mockImplementation(() => {
        throw new AppError(ErrorCodes.SKILL_NOT_FOUND, 'Not found')
      })

      expectAppError(() => handleDelete({ id: 'nonexistent' }), ErrorCodes.SKILL_NOT_FOUND)
    })
  })
})
