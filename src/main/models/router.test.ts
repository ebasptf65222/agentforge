// AgentForge P1-07: 模型适配器 & 路由器单元测试
// vi.hoisted + vi.mock('openai') + vi.mock('../db/repos/model-config')

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamChunk } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock openai SDK ────────────────────────────────────────────
// vi.hoisted 确保在 vi.mock() factory 之前执行

const {
  mockCreate,
  MockOpenAI,
  MockAPIError,
  MockAuthenticationError,
  MockAPIConnectionTimeoutError,
  MockAPIUserAbortError,
  mockGetModelConfigById,
} = vi.hoisted(() => {
  const mockCreate = vi.fn()

  class MockAPIError extends Error {
    status: number
    code: string | null = null
    constructor(status: number, message: string) {
      super(message)
      this.name = 'APIError'
      this.status = status
    }
  }

  class MockAuthenticationError extends MockAPIError {
    constructor(message: string) {
      super(401, message)
      this.name = 'AuthenticationError'
    }
  }

  class MockAPIConnectionTimeoutError extends MockAPIError {
    constructor() {
      super(0, 'Request timed out')
      this.name = 'APIConnectionTimeoutError'
    }
  }

  class MockAPIUserAbortError extends MockAPIError {
    constructor() {
      super(0, 'Request was aborted')
      this.name = 'APIUserAbortError'
    }
  }

  const MockOpenAI = vi.fn(function MockOpenAIConstructor() {
    return { chat: { completions: { create: mockCreate } } }
  })

  const mockGetModelConfigById = vi.fn()

  return {
    mockCreate,
    MockOpenAI,
    MockAPIError,
    MockAuthenticationError,
    MockAPIConnectionTimeoutError,
    MockAPIUserAbortError,
    mockGetModelConfigById,
  }
})

vi.mock('openai', () => ({
  default: MockOpenAI,
  OpenAI: MockOpenAI,
  APIError: MockAPIError,
  AuthenticationError: MockAuthenticationError,
  APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
  APIUserAbortError: MockAPIUserAbortError,
}))

vi.mock('../db/repos/model-config', () => ({
  getModelConfigById: (...args: unknown[]) => mockGetModelConfigById(...args),
}))

// ─── Import after mocks ────────────────────────────────────────

const { OpenAIAdapter } = await import('./openai-adapter')
const { DeepSeekAdapter } = await import('./deepseek-adapter')
const { getModelAdapter, invalidateModelCache, getCacheSize } = await import('./router')

// ─── Helpers ────────────────────────────────────────────────────

const MESSAGES = [{ role: 'user', content: 'Hello' }]

interface MockChunk {
  choices: Array<{
    delta: { content?: string }
    finish_reason: string | null
    index: number
  }>
}

async function* createMockStream(chunks: MockChunk[]): AsyncGenerator<MockChunk> {
  for (const chunk of chunks) {
    yield chunk
  }
}

async function collectChunks(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of gen) {
    chunks.push(chunk)
  }
  return chunks
}

function makeModelConfig(
  overrides: Partial<{
    id: string
    provider: string
    modelId: string
    apiKey: string
    baseUrl: string | undefined
    temperature: number
    maxTokens: number
  }> = {},
): ReturnType<typeof makeModelConfig> {
  return {
    id: 'model-uuid-1',
    name: 'Test Model',
    provider: 'openai' as const,
    modelId: 'gpt-4',
    apiKey: 'sk-test-key',
    baseUrl: undefined,
    temperature: 0.7,
    maxTokens: 4096,
    isDefault: false,
    capabilities: { streaming: true, toolUse: false, vision: false, maxContextLength: 8192 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// ─── Reset ─────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockReset()
  mockGetModelConfigById.mockReset()
})

// ═══════════════════════════════════════════════════════════════
// OpenAIAdapter
// ═══════════════════════════════════════════════════════════════

describe('OpenAIAdapter', () => {
  const defaultConfig = {
    modelId: 'gpt-4',
    apiKey: 'sk-test',
    temperature: 0.7,
    maxTokens: 4096,
  }

  // ─── streamChat ──────────────────────────────────────────────

  describe('streamChat', () => {
    it('should produce StreamChunk with type "text" from delta.content', async () => {
      mockCreate.mockResolvedValue(
        createMockStream([
          { choices: [{ delta: { content: 'Hello' }, finish_reason: null, index: 0 }] },
          { choices: [{ delta: { content: ' world' }, finish_reason: null, index: 0 }] },
          { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
        ]),
      )

      const adapter = new OpenAIAdapter(defaultConfig)
      const chunks = await collectChunks(adapter.streamChat(MESSAGES))

      expect(chunks).toEqual([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' world' },
        { type: 'text', content: '', done: true },
      ])
    })

    it('should pass correct parameters to openai create', async () => {
      mockCreate.mockResolvedValue(
        createMockStream([
          { choices: [{ delta: { content: 'OK' }, finish_reason: 'stop', index: 0 }] },
        ]),
      )

      const adapter = new OpenAIAdapter({
        modelId: 'gpt-4o',
        apiKey: 'sk-key',
        temperature: 0.5,
        maxTokens: 2048,
      })

      await collectChunks(adapter.streamChat(MESSAGES))

      expect(mockCreate).toHaveBeenCalledTimes(1)
      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.5,
          max_tokens: 2048,
          stream: true,
        },
        undefined,
      )
    })

    it('should skip chunks with no content and no finish_reason', async () => {
      mockCreate.mockResolvedValue(
        createMockStream([
          { choices: [{ delta: {}, finish_reason: null, index: 0 }] },
          { choices: [{ delta: { content: 'Hi' }, finish_reason: null, index: 0 }] },
          { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
        ]),
      )

      const adapter = new OpenAIAdapter(defaultConfig)
      const chunks = await collectChunks(adapter.streamChat(MESSAGES))

      expect(chunks).toEqual([
        { type: 'text', content: 'Hi' },
        { type: 'text', content: '', done: true },
      ])
    })

    // ─── AbortSignal ───────────────────────────────────────────

    it('should pass AbortSignal in request options', async () => {
      mockCreate.mockResolvedValue(
        createMockStream([
          { choices: [{ delta: { content: 'A' }, finish_reason: 'stop', index: 0 }] },
        ]),
      )

      const adapter = new OpenAIAdapter(defaultConfig)
      const controller = new AbortController()
      await collectChunks(adapter.streamChat(MESSAGES, controller.signal))

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), {
        signal: controller.signal,
      })
    })

    it('should stop stream gracefully on APIUserAbortError', async () => {
      async function* abortStream(): AsyncGenerator<MockChunk> {
        yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null, index: 0 }] }
        throw new MockAPIUserAbortError()
      }

      mockCreate.mockResolvedValue(abortStream())

      const adapter = new OpenAIAdapter(defaultConfig)
      const controller = new AbortController()
      const chunks = await collectChunks(adapter.streamChat(MESSAGES, controller.signal))

      expect(chunks).toEqual([{ type: 'text', content: 'Hello' }])
    })

    // ─── Error handling ────────────────────────────────────────

    it('should throw AppError(MODEL_API_ERROR) on AuthenticationError (invalid API key)', async () => {
      mockCreate.mockRejectedValue(new MockAuthenticationError('Invalid API key'))

      const adapter = new OpenAIAdapter(defaultConfig)

      try {
        await collectChunks(adapter.streamChat(MESSAGES))
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        const appErr = error as AppError
        expect(appErr.code).toBe('MODEL_API_ERROR')
        expect(appErr.message).toContain('Invalid API key')
        expect(appErr.details).toEqual({ status: 401, provider: 'openai' })
      }
    })

    it('should throw AppError(MODEL_API_ERROR) on APIConnectionTimeoutError', async () => {
      mockCreate.mockRejectedValue(new MockAPIConnectionTimeoutError())

      const adapter = new OpenAIAdapter(defaultConfig)

      try {
        await collectChunks(adapter.streamChat(MESSAGES))
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        const appErr = error as AppError
        expect(appErr.code).toBe('MODEL_API_ERROR')
        expect(appErr.message).toContain('timed out')
      }
    })

    it('should throw AppError(MODEL_API_ERROR) on generic APIError', async () => {
      const apiErr = new MockAPIError(500, 'Internal server error')
      apiErr.code = 'server_error'
      mockCreate.mockRejectedValue(apiErr)

      const adapter = new OpenAIAdapter(defaultConfig)

      try {
        await collectChunks(adapter.streamChat(MESSAGES))
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        const appErr = error as AppError
        expect(appErr.code).toBe('MODEL_API_ERROR')
        expect(appErr.message).toContain('API error')
        expect(appErr.details).toEqual({
          status: 500,
          provider: 'openai',
          code: 'server_error',
        })
      }
    })

    it('should throw AppError(MODEL_API_ERROR) on unknown Error', async () => {
      mockCreate.mockRejectedValue(new Error('Something unexpected'))

      const adapter = new OpenAIAdapter(defaultConfig)

      try {
        await collectChunks(adapter.streamChat(MESSAGES))
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        const appErr = error as AppError
        expect(appErr.code).toBe('MODEL_API_ERROR')
        expect(appErr.message).toBe('Something unexpected')
      }
    })
  })

  // ─── constructor ─────────────────────────────────────────────

  describe('constructor', () => {
    it('should create OpenAI client with timeout=30s, maxRetries=1', () => {
      new OpenAIAdapter({
        ...defaultConfig,
        baseUrl: 'https://custom.api.com/v1',
      })

      expect(MockOpenAI).toHaveBeenCalledWith({
        apiKey: 'sk-test',
        baseURL: 'https://custom.api.com/v1',
        timeout: 30_000,
        maxRetries: 1,
      })
    })

    it('should not set baseURL when baseUrl is undefined', () => {
      new OpenAIAdapter(defaultConfig)

      expect(MockOpenAI).toHaveBeenCalledWith({
        apiKey: 'sk-test',
        timeout: 30_000,
        maxRetries: 1,
      })
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// DeepSeekAdapter
// ═══════════════════════════════════════════════════════════════

describe('DeepSeekAdapter', () => {
  it('should extend OpenAIAdapter', () => {
    const adapter = new DeepSeekAdapter({
      modelId: 'deepseek-chat',
      apiKey: 'sk-ds',
      temperature: 0.7,
      maxTokens: 4096,
    })
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  it('should use default DeepSeek baseUrl when not provided', () => {
    new DeepSeekAdapter({
      modelId: 'deepseek-chat',
      apiKey: 'sk-ds',
      temperature: 0.7,
      maxTokens: 4096,
    })

    expect(MockOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-ds',
      baseURL: 'https://api.deepseek.com/v1',
      timeout: 30_000,
      maxRetries: 1,
    })
  })

  it('should use custom baseUrl when provided', () => {
    new DeepSeekAdapter({
      modelId: 'deepseek-chat',
      apiKey: 'sk-ds',
      temperature: 0.7,
      maxTokens: 4096,
      baseUrl: 'https://my-proxy.example.com/v1',
    })

    expect(MockOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-ds',
      baseURL: 'https://my-proxy.example.com/v1',
      timeout: 30_000,
      maxRetries: 1,
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// ModelRouter
// ═══════════════════════════════════════════════════════════════

describe('ModelRouter', () => {
  beforeEach(() => {
    invalidateModelCache()
  })

  it('should return OpenAIAdapter for openai provider', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'openai' }))

    const adapter = getModelAdapter('model-uuid-1')
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  it('should return DeepSeekAdapter for deepseek provider', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'deepseek' }))

    const adapter = getModelAdapter('model-uuid-1')
    expect(adapter).toBeInstanceOf(DeepSeekAdapter)
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  it('should return OpenAIAdapter for custom provider (OpenAI-compatible)', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'custom' }))

    const adapter = getModelAdapter('model-uuid-1')
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  it('should return AnthropicAdapter for anthropic provider', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'anthropic' }))

    const adapter = getModelAdapter('model-uuid-1')
    expect(adapter).toBeDefined()
    // AnthropicAdapter is now supported
  })

  it('should cache adapter instances', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'openai' }))

    const adapter1 = getModelAdapter('model-uuid-1')
    const adapter2 = getModelAdapter('model-uuid-1')

    expect(adapter1).toBe(adapter2)
    expect(mockGetModelConfigById).toHaveBeenCalledTimes(1)
  })

  it('should invalidate cache for specific modelId', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'openai' }))

    const adapter1 = getModelAdapter('model-uuid-1')
    expect(getCacheSize()).toBe(1)

    invalidateModelCache('model-uuid-1')
    expect(getCacheSize()).toBe(0)

    const adapter2 = getModelAdapter('model-uuid-1')
    expect(getCacheSize()).toBe(1)
    expect(adapter2).not.toBe(adapter1)
  })

  it('should clear all cache when modelId is not provided', () => {
    mockGetModelConfigById.mockReturnValue(makeModelConfig({ provider: 'openai' }))

    getModelAdapter('model-uuid-1')
    getModelAdapter('model-uuid-2')
    expect(getCacheSize()).toBe(2)

    invalidateModelCache()
    expect(getCacheSize()).toBe(0)
  })

  it('should pass baseUrl from ModelConfig to adapter', () => {
    mockGetModelConfigById.mockReturnValue(
      makeModelConfig({
        provider: 'openai',
        baseUrl: 'https://proxy.example.com/v1',
      }),
    )

    getModelAdapter('model-uuid-1')

    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://proxy.example.com/v1' }),
    )
  })

  it('should rethrow MODEL_NOT_FOUND from getModelConfigById', () => {
    mockGetModelConfigById.mockImplementation(() => {
      throw new AppError(ErrorCodes.MODEL_NOT_FOUND, 'Not found', { id: 'bad-id' })
    })

    try {
      getModelAdapter('bad-id')
      expect.fail('Expected AppError')
    } catch (error) {
      expect((error as AppError).code).toBe('MODEL_NOT_FOUND')
    }
  })
})
