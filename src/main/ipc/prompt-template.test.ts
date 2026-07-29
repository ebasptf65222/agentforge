// AgentForge PT-01: Prompt Template IPC Handler 单元测试
// 测试 handleList / handleGet / handleCreate / handleUpdate / handleDelete
// Mock prompt-template repo，验证 handler 参数校验与调用行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptTemplate } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const {
  mockCreatePromptTemplate,
  mockGetPromptTemplateById,
  mockGetAllPromptTemplates,
  mockGetPromptTemplatesByCategory,
  mockUpdatePromptTemplate,
  mockDeletePromptTemplate,
} = vi.hoisted(() => ({
  mockCreatePromptTemplate: vi.fn(),
  mockGetPromptTemplateById: vi.fn(),
  mockGetAllPromptTemplates: vi.fn(),
  mockGetPromptTemplatesByCategory: vi.fn(),
  mockUpdatePromptTemplate: vi.fn(),
  mockDeletePromptTemplate: vi.fn(),
}))

vi.mock('../db/repos/prompt-template', () => ({
  createPromptTemplate: (...args: unknown[]) => mockCreatePromptTemplate(...args),
  getPromptTemplateById: (...args: unknown[]) => mockGetPromptTemplateById(...args),
  getAllPromptTemplates: (...args: unknown[]) => mockGetAllPromptTemplates(...args),
  getPromptTemplatesByCategory: (...args: unknown[]) => mockGetPromptTemplatesByCategory(...args),
  updatePromptTemplate: (...args: unknown[]) => mockUpdatePromptTemplate(...args),
  deletePromptTemplate: (...args: unknown[]) => mockDeletePromptTemplate(...args),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const { handleList, handleGet, handleCreate, handleUpdate, handleDelete } = await import(
  './prompt-template'
)

// ─── Helpers ────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: 'tpl-1',
    title: 'Test Template',
    content: 'You are a helpful assistant. Task: {{task}}',
    category: 'general',
    variables: ['task'],
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

describe('prompt-template IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── handleList ─────────────────────────────────────────────────

  describe('handleList', () => {
    it('should list all templates when no params', () => {
      const templates = [makeTemplate()]
      mockGetAllPromptTemplates.mockReturnValue(templates)

      const result = handleList(undefined)

      expect(mockGetAllPromptTemplates).toHaveBeenCalledWith()
      expect(result).toEqual(templates)
    })

    it('should list all templates when params is null', () => {
      mockGetAllPromptTemplates.mockReturnValue([])

      handleList(null)

      expect(mockGetAllPromptTemplates).toHaveBeenCalledWith()
    })

    it('should list all templates when params is empty object', () => {
      mockGetAllPromptTemplates.mockReturnValue([])

      handleList({})

      expect(mockGetAllPromptTemplates).toHaveBeenCalledWith()
    })

    it('should filter by category', () => {
      mockGetPromptTemplatesByCategory.mockReturnValue([])

      handleList({ category: 'coding' })

      expect(mockGetPromptTemplatesByCategory).toHaveBeenCalledWith('coding')
    })

    it('should throw VALIDATION_ERROR when category is empty string', () => {
      expectAppError(() => handleList({ category: '' }), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleList('string'), ErrorCodes.VALIDATION_ERROR)
    })
  })

  // ─── handleGet ──────────────────────────────────────────────────

  describe('handleGet', () => {
    it('should return template by id', () => {
      const template = makeTemplate()
      mockGetPromptTemplateById.mockReturnValue(template)

      const result = handleGet({ id: 'tpl-1' })

      expect(mockGetPromptTemplateById).toHaveBeenCalledWith('tpl-1')
      expect(result).toEqual(template)
    })

    it('should return null when template does not exist', () => {
      mockGetPromptTemplateById.mockReturnValue(null)

      const result = handleGet({ id: 'nonexistent' })

      expect(result).toBeNull()
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleGet({}), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleGet('string'), ErrorCodes.VALIDATION_ERROR)
    })
  })

  // ─── handleCreate ───────────────────────────────────────────────

  describe('handleCreate', () => {
    it('should create a template with all required fields', () => {
      const template = makeTemplate()
      mockCreatePromptTemplate.mockReturnValue(template)

      const result = handleCreate({
        title: 'Test Template',
        content: 'You are a helpful assistant. Task: {{task}}',
        category: 'general',
        variables: ['task'],
      })

      expect(mockCreatePromptTemplate).toHaveBeenCalledWith({
        title: 'Test Template',
        content: 'You are a helpful assistant. Task: {{task}}',
        category: 'general',
        variables: ['task'],
      })
      expect(result).toEqual(template)
    })

    it('should create a template with optional category and variables omitted', () => {
      mockCreatePromptTemplate.mockReturnValue(makeTemplate())

      handleCreate({
        title: 'Minimal Template',
        content: 'Just a prompt',
      })

      expect(mockCreatePromptTemplate).toHaveBeenCalledWith({
        title: 'Minimal Template',
        content: 'Just a prompt',
        category: undefined,
        variables: undefined,
      })
    })

    it('should throw VALIDATION_ERROR when title is missing', () => {
      expectAppError(
        () => handleCreate({ content: 'some content' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when title is empty string', () => {
      expectAppError(
        () => handleCreate({ title: '', content: 'some content' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when content is missing', () => {
      expectAppError(
        () => handleCreate({ title: 'Some Title' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when content is empty string', () => {
      expectAppError(
        () => handleCreate({ title: 'Title', content: '' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when category is empty string', () => {
      expectAppError(
        () => handleCreate({ title: 'T', content: 'c', category: '' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when variables is not an array', () => {
      expectAppError(
        () => handleCreate({ title: 'T', content: 'c', variables: 'task' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when variables contains non-string', () => {
      expectAppError(
        () => handleCreate({ title: 'T', content: 'c', variables: ['task', 123] }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleCreate('string'), ErrorCodes.VALIDATION_ERROR)
    })

    it('should propagate VALIDATION_ERROR from repo', () => {
      mockCreatePromptTemplate.mockImplementation(() => {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Title empty')
      })

      expectAppError(
        () => handleCreate({ title: 'T', content: 'c' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })
  })

  // ─── handleUpdate ───────────────────────────────────────────────

  describe('handleUpdate', () => {
    it('should update template title', () => {
      handleUpdate({ id: 'tpl-1', title: 'Updated Title' })

      expect(mockUpdatePromptTemplate).toHaveBeenCalledWith({
        id: 'tpl-1',
        title: 'Updated Title',
        content: undefined,
        category: undefined,
        variables: undefined,
      })
    })

    it('should update multiple fields', () => {
      handleUpdate({
        id: 'tpl-1',
        title: 'New Title',
        content: 'New content',
        category: 'coding',
        variables: ['topic', 'format'],
      })

      expect(mockUpdatePromptTemplate).toHaveBeenCalledWith({
        id: 'tpl-1',
        title: 'New Title',
        content: 'New content',
        category: 'coding',
        variables: ['topic', 'format'],
      })
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleUpdate({ title: 'Test' }), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when title is empty string', () => {
      expectAppError(
        () => handleUpdate({ id: 'tpl-1', title: '' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when content is empty string', () => {
      expectAppError(
        () => handleUpdate({ id: 'tpl-1', content: '' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when category is empty string', () => {
      expectAppError(
        () => handleUpdate({ id: 'tpl-1', category: '' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when variables is not an array', () => {
      expectAppError(
        () => handleUpdate({ id: 'tpl-1', variables: 'task' }),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleUpdate('string'), ErrorCodes.VALIDATION_ERROR)
    })

    it('should propagate PROMPT_TEMPLATE_NOT_FOUND from repo', () => {
      mockUpdatePromptTemplate.mockImplementation(() => {
        throw new AppError(ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND, 'Not found')
      })

      expectAppError(
        () => handleUpdate({ id: 'nonexistent', title: 'X' }),
        ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND,
      )
    })
  })

  // ─── handleDelete ───────────────────────────────────────────────

  describe('handleDelete', () => {
    it('should delete template by id', () => {
      handleDelete({ id: 'tpl-1' })

      expect(mockDeletePromptTemplate).toHaveBeenCalledWith('tpl-1')
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleDelete({}), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleDelete('string'), ErrorCodes.VALIDATION_ERROR)
    })

    it('should propagate PROMPT_TEMPLATE_NOT_FOUND from repo', () => {
      mockDeletePromptTemplate.mockImplementation(() => {
        throw new AppError(ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND, 'Not found')
      })

      expectAppError(() => handleDelete({ id: 'nonexistent' }), ErrorCodes.PROMPT_TEMPLATE_NOT_FOUND)
    })
  })
})
