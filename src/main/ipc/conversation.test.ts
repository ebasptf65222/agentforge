// AgentForge P1-09a: 会话 CRUD IPC Handler 单元测试
// 测试 handleCreateConversation / handleListConversations /
//      handleGetConversation / handleDeleteConversation / handleGetMessages
// Mock 数据库 repository 层，验证 handler 参数校验与调用行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Conversation, ChatMessage } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const {
  mockCreateConversation,
  mockListConversations,
  mockGetConversationById,
  mockDeleteConversation,
  mockGetMessagesByConversationId,
  mockModelConfigExists,
} = vi.hoisted(() => {
  const mockCreateConversation = vi.fn()
  const mockListConversations = vi.fn()
  const mockGetConversationById = vi.fn()
  const mockDeleteConversation = vi.fn()
  const mockGetMessagesByConversationId = vi.fn()
  const mockModelConfigExists = vi.fn()
  return {
    mockCreateConversation,
    mockListConversations,
    mockGetConversationById,
    mockDeleteConversation,
    mockGetMessagesByConversationId,
    mockModelConfigExists,
  }
})

vi.mock('../db/repos/conversation', () => ({
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  listConversations: (...args: unknown[]) => mockListConversations(...args),
  getConversationById: (...args: unknown[]) => mockGetConversationById(...args),
  deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
}))

// chat.ts 同时导入 createMessage 和 getMessagesByConversationId，因此两者都需要 mock
vi.mock('../db/repos/message', () => ({
  createMessage: vi.fn(),
  getMessagesByConversationId: (...args: unknown[]) => mockGetMessagesByConversationId(...args),
}))

vi.mock('../db/repos/model-config', () => ({
  modelConfigExists: (...args: unknown[]) => mockModelConfigExists(...args),
}))

// chat.ts 还会导入 router；提供空实现避免副作用
vi.mock('../models/router', () => ({
  getModelAdapter: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const {
  handleCreateConversation,
  handleListConversations,
  handleGetConversation,
  handleDeleteConversation,
  handleGetMessages,
} = await import('./chat')

// ─── Helpers ────────────────────────────────────────────────────

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: '新会话',
    modelId: 'model-1',
    approvalMode: 'auto-edit',
    messageCount: 0,
    lastMessageAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'hello',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function expectAppError(promise: () => unknown, code: string): void {
  try {
    promise()
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Conversation CRUD IPC Handlers (P1-09a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── handleCreateConversation ───────────────────────────────

  describe('handleCreateConversation', () => {
    it('should throw VALIDATION_ERROR when params is null', () => {
      expectAppError(() => handleCreateConversation(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleCreateConversation('string'), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when modelId is missing', () => {
      expectAppError(() => handleCreateConversation({ title: 'T' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when modelId is empty string', () => {
      expectAppError(() => handleCreateConversation({ modelId: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when approvalMode is invalid', () => {
      mockModelConfigExists.mockReturnValue(true)
      expectAppError(
        () => handleCreateConversation({ modelId: 'm1', approvalMode: 'invalid' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when title is not a string', () => {
      expectAppError(
        () => handleCreateConversation({ modelId: 'm1', title: 123 }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw MODEL_NOT_FOUND when modelId does not exist in model_configs', () => {
      mockModelConfigExists.mockReturnValue(false)
      expectAppError(
        () => handleCreateConversation({ modelId: 'no-such-model' }),
        'MODEL_NOT_FOUND',
      )
      expect(mockModelConfigExists).toHaveBeenCalledWith('no-such-model')
    })

    it('should create conversation with default title when title is undefined', () => {
      mockModelConfigExists.mockReturnValue(true)
      const conv = makeConversation()
      mockCreateConversation.mockReturnValue(conv)

      const result = handleCreateConversation({ modelId: 'model-1' })

      expect(result).toBe(conv)
      expect(mockCreateConversation).toHaveBeenCalledWith({
        title: undefined,
        modelId: 'model-1',
        approvalMode: undefined,
      })
    })

    it('should create conversation with default title when title is empty/whitespace', () => {
      mockModelConfigExists.mockReturnValue(true)
      mockCreateConversation.mockReturnValue(makeConversation())

      handleCreateConversation({ modelId: 'model-1', title: '   ' })

      expect(mockCreateConversation).toHaveBeenCalledWith({
        title: undefined,
        modelId: 'model-1',
        approvalMode: undefined,
      })
    })

    it('should create conversation with provided title (trimmed)', () => {
      mockModelConfigExists.mockReturnValue(true)
      mockCreateConversation.mockReturnValue(makeConversation({ title: 'My Chat' }))

      const result = handleCreateConversation({ modelId: 'model-1', title: '  My Chat  ' })

      expect(result.title).toBe('My Chat')
      expect(mockCreateConversation).toHaveBeenCalledWith({
        title: 'My Chat',
        modelId: 'model-1',
        approvalMode: undefined,
      })
    })

    it('should create conversation with provided approvalMode', () => {
      mockModelConfigExists.mockReturnValue(true)
      mockCreateConversation.mockReturnValue(makeConversation({ approvalMode: 'suggest' }))

      const result = handleCreateConversation({
        modelId: 'model-1',
        approvalMode: 'suggest',
      })

      expect(result.approvalMode).toBe('suggest')
      expect(mockCreateConversation).toHaveBeenCalledWith({
        title: undefined,
        modelId: 'model-1',
        approvalMode: 'suggest',
      })
    })

    it('should accept full-auto as valid approvalMode', () => {
      mockModelConfigExists.mockReturnValue(true)
      mockCreateConversation.mockReturnValue(makeConversation({ approvalMode: 'full-auto' }))

      const result = handleCreateConversation({
        modelId: 'model-1',
        approvalMode: 'full-auto',
      })

      expect(result.approvalMode).toBe('full-auto')
    })

    it('should return the conversation from createConversation()', () => {
      mockModelConfigExists.mockReturnValue(true)
      const conv = makeConversation({ id: 'returned-id', title: 'Returned' })
      mockCreateConversation.mockReturnValue(conv)

      const result = handleCreateConversation({ modelId: 'model-1' })

      expect(result).toBe(conv)
    })
  })

  // ─── handleListConversations ────────────────────────────────

  describe('handleListConversations', () => {
    it('should return the result from listConversations() directly', () => {
      const list = [makeConversation({ id: 'c1' }), makeConversation({ id: 'c2' })]
      mockListConversations.mockReturnValue(list)

      const result = handleListConversations()

      expect(result).toBe(list)
      expect(mockListConversations).toHaveBeenCalledTimes(1)
    })

    it('should return empty array when no conversations exist', () => {
      mockListConversations.mockReturnValue([])
      expect(handleListConversations()).toEqual([])
    })
  })

  // ─── handleGetConversation ─────────────────────────────────

  describe('handleGetConversation', () => {
    it('should throw VALIDATION_ERROR when params is null', () => {
      expectAppError(() => handleGetConversation(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleGetConversation({}), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when id is empty', () => {
      expectAppError(() => handleGetConversation({ id: '' }), 'VALIDATION_ERROR')
    })

    it('should throw CONVERSATION_NOT_FOUND when conversation does not exist', () => {
      mockGetConversationById.mockImplementation(() => {
        throw new AppError(ErrorCodes.CONVERSATION_NOT_FOUND, 'Not found', { id: 'bad' })
      })
      expectAppError(() => handleGetConversation({ id: 'bad' }), 'CONVERSATION_NOT_FOUND')
    })

    it('should return conversation by id', () => {
      const conv = makeConversation({ id: 'conv-42', title: 'Found' })
      mockGetConversationById.mockReturnValue(conv)

      const result = handleGetConversation({ id: 'conv-42' })

      expect(result).toBe(conv)
      expect(mockGetConversationById).toHaveBeenCalledWith('conv-42')
    })
  })

  // ─── handleDeleteConversation ──────────────────────────────

  describe('handleDeleteConversation', () => {
    it('should throw VALIDATION_ERROR when params is null', () => {
      expectAppError(() => handleDeleteConversation(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when id is missing', () => {
      expectAppError(() => handleDeleteConversation({}), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when id is empty', () => {
      expectAppError(() => handleDeleteConversation({ id: '' }), 'VALIDATION_ERROR')
    })

    it('should throw CONVERSATION_NOT_FOUND when conversation does not exist', () => {
      mockDeleteConversation.mockImplementation(() => {
        throw new AppError(ErrorCodes.CONVERSATION_NOT_FOUND, 'Not found', { id: 'bad' })
      })
      expectAppError(() => handleDeleteConversation({ id: 'bad' }), 'CONVERSATION_NOT_FOUND')
    })

    it('should call deleteConversation with id', () => {
      mockDeleteConversation.mockReturnValue(undefined)

      handleDeleteConversation({ id: 'conv-to-delete' })

      expect(mockDeleteConversation).toHaveBeenCalledWith('conv-to-delete')
    })

    it('should return undefined on success', () => {
      mockDeleteConversation.mockReturnValue(undefined)
      expect(handleDeleteConversation({ id: 'conv-1' })).toBeUndefined()
    })
  })

  // ─── handleGetMessages ─────────────────────────────────────

  describe('handleGetMessages', () => {
    it('should throw VALIDATION_ERROR when params is null', () => {
      expectAppError(() => handleGetMessages(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when conversationId is missing', () => {
      expectAppError(() => handleGetMessages({}), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when conversationId is empty', () => {
      expectAppError(() => handleGetMessages({ conversationId: '' }), 'VALIDATION_ERROR')
    })

    it('should return messages from getMessagesByConversationId() directly', () => {
      const messages = [
        makeMessage({ id: 'm1', content: 'First' }),
        makeMessage({ id: 'm2', content: 'Second' }),
      ]
      mockGetMessagesByConversationId.mockReturnValue(messages)

      const result = handleGetMessages({ conversationId: 'conv-1' })

      expect(result).toBe(messages)
      expect(mockGetMessagesByConversationId).toHaveBeenCalledWith('conv-1')
    })

    it('should return empty array when no messages exist', () => {
      mockGetMessagesByConversationId.mockReturnValue([])
      expect(handleGetMessages({ conversationId: 'empty-conv' })).toEqual([])
    })
  })
})
