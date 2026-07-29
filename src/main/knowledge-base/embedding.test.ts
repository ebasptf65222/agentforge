// AgentForge P4-03: 向量嵌入服务测试

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateEmbedding,
  generateEmbeddings,
  setEmbeddingConfig,
  getEmbeddingConfig,
  resetEmbeddingConfig,
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
} from './embedding'
import { AppError, ErrorCodes } from '../utils/error'

describe('embedding config', () => {
  beforeEach(() => {
    resetEmbeddingConfig()
  })

  it('should have default config', () => {
    const config = getEmbeddingConfig()
    expect(config.provider).toBe('ollama')
    expect(config.baseUrl).toBe('http://localhost:11434')
    expect(config.model).toBe('nomic-embed-text')
    expect(config.dimensions).toBe(768)
  })

  it('should set custom config', () => {
    const custom: EmbeddingConfig = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    }
    setEmbeddingConfig(custom)

    const config = getEmbeddingConfig()
    expect(config.provider).toBe('openai')
    expect(config.baseUrl).toBe('https://api.openai.com/v1')
    expect(config.apiKey).toBe('sk-test')
    expect(config.model).toBe('text-embedding-3-small')
  })

  it('should reset to default', () => {
    setEmbeddingConfig({
      provider: 'openai',
      baseUrl: 'https://example.com',
      model: 'test-model',
    })
    resetEmbeddingConfig()

    const config = getEmbeddingConfig()
    expect(config).toEqual(DEFAULT_EMBEDDING_CONFIG)
  })
})

describe('generateEmbedding', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 使用不带 dimensions 的配置，避免维度校验与 mock 返回值冲突
    setEmbeddingConfig({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    })
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('should return empty array for empty text', async () => {
    const result = await generateEmbedding('')
    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should return empty array for whitespace-only text', async () => {
    const result = await generateEmbedding('   \n\t  ')
    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should call Ollama API with correct payload', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    } as Response)

    const result = await generateEmbedding('test text')

    expect(result).toEqual([0.1, 0.2, 0.3])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'test text' }),
      }),
    )
  })

  it('should call OpenAI API with correct payload', async () => {
    const openaiConfig: EmbeddingConfig = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-key',
      model: 'text-embedding-3-small',
    }

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.4, 0.5, 0.6], index: 0 }],
      }),
    } as Response)

    const result = await generateEmbedding('hello world', openaiConfig)

    expect(result).toEqual([0.4, 0.5, 0.6])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-test-key',
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: 'hello world' }),
      }),
    )
  })

  it('should throw AppError on HTTP error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response)

    await expect(generateEmbedding('test')).rejects.toThrow(AppError)
    await expect(generateEmbedding('test')).rejects.toMatchObject({
      code: ErrorCodes.KB_EMBEDDING_ERROR,
    })
  })

  it('should throw AppError on invalid Ollama response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: 'response' }),
    } as Response)

    await expect(generateEmbedding('test')).rejects.toThrow(AppError)
  })

  it('should throw AppError on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'))

    await expect(generateEmbedding('test')).rejects.toThrow(AppError)
    await expect(generateEmbedding('test')).rejects.toMatchObject({
      code: ErrorCodes.KB_EMBEDDING_ERROR,
    })
  })

  it('should use global config when no config provided', async () => {
    setEmbeddingConfig({
      provider: 'openai',
      baseUrl: 'https://custom.api.com/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
    })

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.7, 0.8], index: 0 }],
      }),
    } as Response)

    await generateEmbedding('test')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://custom.api.com/v1/embeddings',
      expect.any(Object),
    )
  })
})

describe('generateEmbeddings', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 使用不带 dimensions 的配置，避免维度校验与 mock 返回值冲突
    setEmbeddingConfig({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
    })
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('should return empty array for empty input', async () => {
    const results = await generateEmbeddings([])
    expect(results).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should return empty embeddings for all-empty texts', async () => {
    const results = await generateEmbeddings(['', '   ', '\n'])
    expect(results).toHaveLength(3)
    expect(results[0].embedding).toEqual([])
    expect(results[1].embedding).toEqual([])
    expect(results[2].embedding).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should batch process with Ollama serially', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2] }),
    } as Response)

    const results = await generateEmbeddings(['text1', 'text2'])

    expect(results).toHaveLength(2)
    expect(results[0].embedding).toEqual([0.1, 0.2])
    expect(results[1].embedding).toEqual([0.1, 0.2])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('should batch process with OpenAI in single request', async () => {
    const openaiConfig: EmbeddingConfig = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
    }

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      }),
    } as Response)

    const results = await generateEmbeddings(['hello', 'world'], openaiConfig)

    expect(results).toHaveLength(2)
    expect(results[0].text).toBe('hello')
    expect(results[0].embedding).toEqual([0.1, 0.2])
    expect(results[1].text).toBe('world')
    expect(results[1].embedding).toEqual([0.3, 0.4])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('should skip empty texts in mixed batch', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.5] }),
    } as Response)

    const results = await generateEmbeddings(['', 'valid', ''])

    expect(results).toHaveLength(3)
    expect(results[0].embedding).toEqual([])
    expect(results[1].embedding).toEqual([0.5])
    expect(results[2].embedding).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('should handle OpenAI batch across multiple chunks', async () => {
    const openaiConfig: EmbeddingConfig = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
    }

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: Array.from({ length: 2048 }, (_, i) => ({
          embedding: [i * 0.001],
          index: i,
        })),
      }),
    } as Response)

    const texts = Array(3000).fill('test')
    const results = await generateEmbeddings(texts, openaiConfig)

    expect(results).toHaveLength(3000)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
