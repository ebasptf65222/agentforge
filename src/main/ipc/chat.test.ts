// AgentForge P1-08: Chat IPC Handler 单元测试
// Mock 所有依赖，验证 handleSend 和 handleStop 行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamChunk, Conversation, ChatMessage } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { ModelAdapter } from '../models/adapter'

// ─── Mock setup ─────────────────────────────────────────────────

const {
  mockGetConversationById,
  mockUpdateConversationTitle,
  mockIncrementMessageCount,
  mockUpdateLastMessageAt,
  mockCreateMessage,
  mockGetMessagesByConversationId,
  mockGetModelAdapter,
  mockSend,
  mockWebContents,
} = vi.hoisted(() => {
  const mockGetConversationById = vi.fn()
  const mockUpdateConversationTitle = vi.fn()
  const mockIncrementMessageCount = vi.fn()
  const mockUpdateLastMessageAt = vi.fn()
  const mockCreateMessage = vi.fn()
  const mockGetMessagesByConversationId = vi.fn()
  const mockGetModelAdapter = vi.fn()

  const sendEvents: Array<{ channel: string; data: unknown }> = []
  const mockWebContents = {
    send: vi.fn((channel: string, data: unknown) => {
      sendEvents.push({ channel, data })
    }),
    isDestroyed: vi.fn(() => false),
  }

  return {
    mockGetConversationById,
    mockUpdateConversationTitle,
    mockIncrementMessageCount,
    mockUpdateLastMessageAt,
    mockCreateMessage,
    mockGetMessagesByConversationId,
    mockGetModelAdapter,
    mockSend: sendEvents,
    mockWebContents,
  }
})

vi.mock('../db/repos/conversation', () => ({
  getConversationById: (...args: unknown[]) => mockGetConversationById(...args),
  updateConversationTitle: (...args: unknown[]) => mockUpdateConversationTitle(...args),
  incrementMessageCount: (...args: unknown[]) => mockIncrementMessageCount(...args),
  updateLastMessageAt: (...args: unknown[]) => mockUpdateLastMessageAt(...args),
}))

vi.mock('../db/repos/message', () => ({
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  getMessagesByConversationId: (...args: unknown[]) => mockGetMessagesByConversationId(...args),
}))

vi.mock('../db', () => ({
  getDatabase: vi.fn(() => ({
    transaction: vi.fn((fn: (...a: unknown[]) => unknown) => {
      const tx = (...args: unknown[]) => fn(...args)
      tx.immediate = tx
      return tx
    }),
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  })),
}))

vi.mock('../models/router', () => ({
  getModelAdapter: (...args: unknown[]) => mockGetModelAdapter(...args),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: mockWebContents,
      },
    ]),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const { handleSend, handleStop, getCurrentAbortController, resetAbortController } =
  await import('./chat')

// ─── Helpers ────────────────────────────────────────────────────

function makeMockAdapter(chunks: StreamChunk[], throwError?: Error): ModelAdapter {
  return {
    streamChat: vi.fn(async function* (_messages, _signal?) {
      for (const chunk of chunks) {
        yield chunk
      }
      if (throwError) {
        throw throwError
      }
    }),
  } as unknown as ModelAdapter
}

const mockEvent = {} as Electron.IpcMainInvokeEvent

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

// ─── Tests ──────────────────────────────────────────────────────

describe('Chat IPC Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.length = 0
    resetAbortController()
  })

  // ─── handleSend: validation ───────────────────────────────────

  describe('handleSend validation', () => {
    async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
      try {
        await promise
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(code)
      }
    }

    it('should throw VALIDATION_ERROR when params is null', async () => {
      await expectAppError(handleSend(mockEvent, null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when conversationId is missing', async () => {
      await expectAppError(
        handleSend(mockEvent, { content: 'hello', modelId: 'm1' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when content is empty', async () => {
      await expectAppError(
        handleSend(mockEvent, { conversationId: 'c1', content: '', modelId: 'm1' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw CONVERSATION_NOT_FOUND when conversation does not exist', async () => {
      mockGetConversationById.mockImplementation(() => {
        throw new AppError(ErrorCodes.CONVERSATION_NOT_FOUND, 'Not found', { id: 'bad' })
      })

      await expectAppError(
        handleSend(mockEvent, { conversationId: 'bad', content: 'hi', modelId: 'm1' }),
        'CONVERSATION_NOT_FOUND',
      )
    })

    it('should throw MODEL_NOT_FOUND when modelId has no config', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      mockGetModelAdapter.mockImplementation(() => {
        throw new AppError(ErrorCodes.MODEL_NOT_FOUND, 'Model not found', { id: 'bad' })
      })

      await expectAppError(
        handleSend(mockEvent, { conversationId: 'c1', content: 'hi', modelId: 'bad' }),
        'MODEL_NOT_FOUND',
      )
    })

    it('should throw CHAT_ALREADY_RUNNING when generation is in progress', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      mockGetMessagesByConversationId.mockReturnValue([])

      // 用一个永远 await 的流来模拟挂起
      const neverResolve = new Promise<StreamChunk>(() => {})
      const hangingAdapter = {
        // eslint-disable-next-line require-yield
        streamChat: vi.fn(async function* () {
          await neverResolve
        }),
      } as unknown as ModelAdapter
      mockGetModelAdapter.mockReturnValue(hangingAdapter)

      // 启动第一个 send（会挂在 stream 等待上）
      void handleSend(mockEvent, {
        conversationId: 'c1',
        content: 'first',
        modelId: 'm1',
      })

      // 等待让 handleSend 进入流式循环
      await new Promise((resolve) => setTimeout(resolve, 20))

      // 第二次调用应该抛出 CHAT_ALREADY_RUNNING
      await expectAppError(
        handleSend(mockEvent, { conversationId: 'c1', content: 'second', modelId: 'm1' }),
        'CHAT_ALREADY_RUNNING',
      )

      // 清理
      resetAbortController()
    })
  })

  // ─── handleSend: successful flow ─────────────────────────────

  describe('handleSend successful flow', () => {
    it('should persist both user and assistant messages', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const adapter = makeMockAdapter([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: '!' },
        { type: 'text', content: '', done: true },
      ])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'Hi',
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      mockCreateMessage
        .mockReturnValueOnce({ id: 'user-msg-id' } as ChatMessage)
        .mockReturnValueOnce({ id: 'assistant-msg-id' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'Hi',
        modelId: 'model-1',
      })

      expect(mockCreateMessage).toHaveBeenCalledTimes(2)
      // 第一次调用：用户消息
      expect(mockCreateMessage.mock.calls[0][0]).toEqual({
        conversationId: 'conv-1',
        role: 'user',
        content: 'Hi',
      })
      // 第二次调用：助手消息
      const assistantCall = mockCreateMessage.mock.calls[1][0] as {
        conversationId: string
        role: string
        content: string
        metadata: unknown
      }
      expect(assistantCall.role).toBe('assistant')
      expect(assistantCall.content).toBe('Hello!')
      expect((assistantCall.metadata as { modelId: string }).modelId).toBe('model-1')
      expect((assistantCall.metadata as { stopped: boolean }).stopped).toBe(false)
    })

    it('should push stream chunks via chat:stream-chunk', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const chunks: StreamChunk[] = [
        { type: 'text', content: 'A' },
        { type: 'text', content: 'B' },
        { type: 'text', content: '', done: true },
      ]
      const adapter = makeMockAdapter(chunks)
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      const chunkEvents = mockSend.filter((e) => e.channel === 'chat:stream-chunk')
      expect(chunkEvents).toHaveLength(3)
      expect(chunkEvents[0].data).toEqual({ type: 'text', content: 'A' })
      expect(chunkEvents[1].data).toEqual({ type: 'text', content: 'B' })
      expect(chunkEvents[2].data).toEqual({ type: 'text', content: '', done: true })
    })

    it('should send chat:stream-end with correct metadata', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const adapter = makeMockAdapter([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: '', done: true },
      ])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'assistant-msg-id' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      const endEvent = mockSend.find((e) => e.channel === 'chat:stream-end')
      expect(endEvent).toBeDefined()
      expect(endEvent).not.toBeNull()
      const meta = endEvent?.data as {
        messageId: string
        tokensUsed: number
        duration: number
        modelId: string
        stopped: boolean
      }
      expect(meta.messageId).toBe('assistant-msg-id')
      expect(meta.modelId).toBe('model-1')
      expect(meta.stopped).toBe(false)
      expect(meta.tokensUsed).toBe(Math.ceil('Hello'.length / 4))
      expect(meta.duration).toBeGreaterThanOrEqual(0)
    })

    it('should update conversation message_count and last_message_at', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const adapter = makeMockAdapter([{ type: 'text', content: 'OK', done: true }])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      // incrementMessageCount 应被调用两次：用户 +1, 助手 +1
      expect(mockIncrementMessageCount).toHaveBeenCalledTimes(2)
      expect(mockIncrementMessageCount.mock.calls[0]).toEqual(['conv-1', 1])
      expect(mockIncrementMessageCount.mock.calls[1]).toEqual(['conv-1', 1])
      expect(mockUpdateLastMessageAt).toHaveBeenCalledTimes(1)
      expect(mockUpdateLastMessageAt).toHaveBeenCalledWith('conv-1')
    })

    it('should truncate first 20 chars of content as title when first message', async () => {
      mockGetConversationById.mockReturnValue(
        makeConversation({ messageCount: 0, title: '新会话' }),
      )
      const adapter = makeMockAdapter([{ type: 'text', content: 'Reply', done: true }])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'This is a very long first message that exceeds 20 characters',
        modelId: 'model-1',
      })

      expect(mockUpdateConversationTitle).toHaveBeenCalledWith('conv-1', 'This is a very long')
    })

    it('should use full content as title when <= 20 chars', async () => {
      mockGetConversationById.mockReturnValue(
        makeConversation({ messageCount: 0, title: '新会话' }),
      )
      const adapter = makeMockAdapter([{ type: 'text', content: 'Reply', done: true }])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'Short',
        modelId: 'model-1',
      })

      expect(mockUpdateConversationTitle).toHaveBeenCalledWith('conv-1', 'Short')
    })

    it('should NOT update title when conversation already has messages', async () => {
      mockGetConversationById.mockReturnValue(
        makeConversation({ messageCount: 5, title: 'Existing' }),
      )
      const adapter = makeMockAdapter([{ type: 'text', content: 'Reply', done: true }])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'New message',
        modelId: 'model-1',
      })

      expect(mockUpdateConversationTitle).not.toHaveBeenCalled()
    })

    it('should release the abort controller after stream ends', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const adapter = makeMockAdapter([{ type: 'text', content: 'Done', done: true }])
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      expect(getCurrentAbortController()).toBeNull()
    })
  })

  // ─── handleSend: error handling ──────────────────────────────

  describe('handleSend error handling', () => {
    it('should push chat:stream-error when AppError occurs during streaming', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const apiError = new AppError(ErrorCodes.MODEL_API_ERROR, 'API Error', { status: 500 })
      const adapter = makeMockAdapter([], apiError)
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      const errorEvent = mockSend.find((e) => e.channel === 'chat:stream-error')
      expect(errorEvent).toBeDefined()
      const err = errorEvent?.data as { code: string; message: string }
      expect(err.code).toBe('MODEL_API_ERROR')
      expect(err.message).toBe('API Error')
    })

    it('should push chat:stream-error with INTERNAL_ERROR for unknown errors', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const adapter = makeMockAdapter([], new Error('Something broke'))
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      const errorEvent = mockSend.find((e) => e.channel === 'chat:stream-error')
      expect(errorEvent).toBeDefined()
      const err = errorEvent?.data as { code: string; message: string }
      expect(err.code).toBe('INTERNAL_ERROR')
      expect(err.message).toBe('Something broke')
    })

    it('should still save assistant message after error', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      // Stream produces some content before error
      const chunks: StreamChunk[] = [{ type: 'text', content: 'Partial' }]
      const adapter = makeMockAdapter(chunks, new Error('Stream failed'))
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'any' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      // createMessage should be called twice (user + assistant)
      expect(mockCreateMessage).toHaveBeenCalledTimes(2)
      const assistantCall = mockCreateMessage.mock.calls[1][0] as {
        role: string
        content: string
      }
      expect(assistantCall.role).toBe('assistant')
      expect(assistantCall.content).toBe('Partial')
    })

    it('should still send chat:stream-end after error', async () => {
      mockGetConversationById.mockReturnValue(makeConversation())
      const adapter = makeMockAdapter([], new Error('fail'))
      mockGetModelAdapter.mockReturnValue(adapter)
      mockGetMessagesByConversationId.mockReturnValue([])
      mockCreateMessage.mockReturnValue({ id: 'msg-id' } as ChatMessage)

      await handleSend(mockEvent, {
        conversationId: 'conv-1',
        content: 'test',
        modelId: 'model-1',
      })

      const endEvent = mockSend.find((e) => e.channel === 'chat:stream-end')
      expect(endEvent).toBeDefined()
      expect((endEvent?.data as { stopped: boolean }).stopped).toBe(false)
    })
  })

  // ─── handleStop ──────────────────────────────────────────────

  describe('handleStop', () => {
    it('should handle stop gracefully when no generation is running', () => {
      expect(getCurrentAbortController()).toBeNull()
      handleStop() // 不应抛错
      expect(getCurrentAbortController()).toBeNull()
    })

    it('should handle stop gracefully when no generation is running', () => {
      expect(() => handleStop()).not.toThrow()
      expect(getCurrentAbortController()).toBeNull()
    })
  })
})
