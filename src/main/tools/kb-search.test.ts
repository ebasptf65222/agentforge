// AgentForge P4-04: 知识库搜索工具测试

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { kbSearchTool } from './kb-search'
import * as searchModule from '../knowledge-base/search'
import { AppError, ErrorCodes } from '../utils/error'

describe('kbSearchTool', () => {
  let searchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    searchSpy = vi.spyOn(searchModule, 'semanticSearch').mockResolvedValue([])
  })

  afterEach(() => {
    searchSpy.mockRestore()
  })

  describe('definition', () => {
    it('should have correct name', () => {
      expect(kbSearchTool.definition.name).toBe('kb_search')
    })

    it('should be low risk', () => {
      expect(kbSearchTool.definition.riskLevel).toBe('low')
    })

    it('should have query as required parameter', () => {
      expect(kbSearchTool.definition.inputSchema.required).toContain('query')
    })

    it('should have optional topK parameter', () => {
      const props = kbSearchTool.definition.inputSchema.properties as Record<string, unknown>
      expect(props['topK']).toBeDefined()
    })

    it('should have optional documentId parameter', () => {
      const props = kbSearchTool.definition.inputSchema.properties as Record<string, unknown>
      expect(props['documentId']).toBeDefined()
    })

    it('should have optional threshold parameter', () => {
      const props = kbSearchTool.definition.inputSchema.properties as Record<string, unknown>
      expect(props['threshold']).toBeDefined()
    })
  })

  describe('execute', () => {
    it('should call semanticSearch with query only', async () => {
      await kbSearchTool.execute({ query: 'test query' })

      expect(searchSpy).toHaveBeenCalledTimes(1)
      expect(searchSpy).toHaveBeenCalledWith('test query', {
        topK: undefined,
        documentId: undefined,
        threshold: undefined,
      })
    })

    it('should pass topK when provided', async () => {
      await kbSearchTool.execute({ query: 'test', topK: 3 })

      expect(searchSpy).toHaveBeenCalledWith('test', expect.objectContaining({ topK: 3 }))
    })

    it('should pass documentId when provided', async () => {
      await kbSearchTool.execute({ query: 'test', documentId: 'doc-123' })

      expect(searchSpy).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ documentId: 'doc-123' }),
      )
    })

    it('should pass threshold when provided', async () => {
      await kbSearchTool.execute({ query: 'test', threshold: 0.7 })

      expect(searchSpy).toHaveBeenCalledWith('test', expect.objectContaining({ threshold: 0.7 }))
    })

    it('should return formatted results when found', async () => {
      searchSpy.mockResolvedValue([
        {
          chunkId: 'c1',
          documentId: 'd1',
          fileName: 'test.md',
          content: 'This is a test chunk',
          score: 0.85,
          chunkIndex: 0,
        },
        {
          chunkId: 'c2',
          documentId: 'd1',
          fileName: 'test.md',
          content: 'Another chunk',
          score: 0.72,
          chunkIndex: 1,
        },
      ])

      const result = await kbSearchTool.execute({ query: 'test' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('找到 2 条相关知识库内容')
      expect(result.content).toContain('test.md')
      expect(result.content).toContain('This is a test chunk')
      expect(result.content).toContain('85.0%')
      expect(result.content).toContain('72.0%')
      expect(result.metadata).toMatchObject({
        query: 'test',
        resultCount: 2,
      })
    })

    it('should return message when no results found', async () => {
      searchSpy.mockResolvedValue([])

      const result = await kbSearchTool.execute({ query: 'nonexistent' })

      expect(result.isError).toBe(false)
      expect(result.content).toBe('未找到相关知识库内容。')
      expect(result.metadata?.resultCount).toBe(0)
    })

    it('should throw AppError for empty query', async () => {
      await expect(kbSearchTool.execute({ query: '' })).rejects.toThrow(AppError)
      await expect(kbSearchTool.execute({ query: '' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw AppError for whitespace-only query', async () => {
      await expect(kbSearchTool.execute({ query: '   ' })).rejects.toThrow(AppError)
    })

    it('should throw AppError for non-string query', async () => {
      await expect(
        kbSearchTool.execute({ query: 123 } as unknown as Record<string, unknown>),
      ).rejects.toThrow(AppError)
    })

    it('should ignore invalid topK values', async () => {
      await kbSearchTool.execute({ query: 'test', topK: 'invalid' as unknown as number })

      expect(searchSpy).toHaveBeenCalledWith('test', {})
    })

    it('should clamp topK to valid range', async () => {
      await kbSearchTool.execute({ query: 'test', topK: 50 })

      expect(searchSpy).toHaveBeenCalledWith('test', {})
    })

    it('should ignore invalid threshold values', async () => {
      await kbSearchTool.execute({ query: 'test', threshold: -0.5 })

      expect(searchSpy).toHaveBeenCalledWith('test', {})
    })

    it('should handle semanticSearch errors', async () => {
      searchSpy.mockRejectedValue(new Error('Embedding service unavailable'))

      await expect(kbSearchTool.execute({ query: 'test' })).rejects.toThrow(AppError)
      await expect(kbSearchTool.execute({ query: 'test' })).rejects.toMatchObject({
        code: ErrorCodes.TOOL_EXECUTION_ERROR,
      })
    })

    it('should pass all options together', async () => {
      await kbSearchTool.execute({
        query: 'test query',
        topK: 3,
        documentId: 'doc-abc',
        threshold: 0.8,
      })

      expect(searchSpy).toHaveBeenCalledWith('test query', {
        topK: 3,
        documentId: 'doc-abc',
        threshold: 0.8,
      })
    })
  })
})
