// AgentForge P4-03: 语义搜索服务测试

import { describe, it, expect, beforeEach } from 'vitest'
import {
  cosineSimilarity,
  vectorNorm,
  normalizeVector,
  searchWithEmbedding,
  clearSearchCache,
} from './search'
import type { DocumentChunk } from '@shared/types'

// ─── 向量数学工具测试 ────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const a = [1, 2, 3]
    const b = [1, 2, 3]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6)
  })

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6)
  })

  it('should return -1 for opposite vectors', () => {
    const a = [1, 2, 3]
    const b = [-1, -2, -3]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6)
  })

  it('should return 0 for empty vectors', () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0)
    expect(cosineSimilarity([1, 2], [])).toBe(0)
  })

  it('should handle vectors with different dimensions', () => {
    const a = [1, 2, 3, 4]
    const b = [1, 2, 3]
    // 取最小维度 [1, 2, 3] vs [1, 2, 3] = 1
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6)
  })

  it('should handle zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  it('should handle high-dimensional embeddings', () => {
    const a = Array(768)
      .fill(0)
      .map((_, i) => Math.sin(i * 0.1))
    const b = Array(768)
      .fill(0)
      .map((_, i) => Math.sin(i * 0.1))
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 4)
  })
})

describe('vectorNorm', () => {
  it('should calculate L2 norm correctly', () => {
    expect(vectorNorm([3, 4])).toBe(5)
    expect(vectorNorm([1, 1, 1, 1])).toBeCloseTo(2, 6)
  })

  it('should return 0 for zero vector', () => {
    expect(vectorNorm([0, 0, 0])).toBe(0)
  })

  it('should return 0 for empty vector', () => {
    expect(vectorNorm([])).toBe(0)
  })
})

describe('normalizeVector', () => {
  it('should produce unit vector', () => {
    const normalized = normalizeVector([3, 4])
    expect(vectorNorm(normalized)).toBeCloseTo(1, 6)
    expect(normalized[0]).toBeCloseTo(0.6, 6)
    expect(normalized[1]).toBeCloseTo(0.8, 6)
  })

  it('should handle zero vector', () => {
    const normalized = normalizeVector([0, 0, 0])
    expect(normalized).toEqual([0, 0, 0])
  })
})

// ─── searchWithEmbedding 测试 ────────────────────────────────────

describe('searchWithEmbedding', () => {
  beforeEach(() => {
    clearSearchCache()
  })

  function createMockChunk(
    id: string,
    documentId: string,
    embedding: number[],
    content: string,
    chunkIndex: number,
  ): DocumentChunk {
    return {
      id,
      documentId,
      content,
      tokenCount: 10,
      chunkIndex,
      embedding,
    }
  }

  it('should return top-k results sorted by similarity', () => {
    const query = [1, 0, 0]
    const candidates = [
      createMockChunk('c1', 'd1', [1, 0, 0], 'exact match', 0),
      createMockChunk('c2', 'd1', [0.9, 0.1, 0], 'close match', 1),
      createMockChunk('c3', 'd1', [0, 1, 0], 'orthogonal', 2),
      createMockChunk('c4', 'd1', [-1, 0, 0], 'opposite', 3),
    ]

    const results = searchWithEmbedding(query, candidates, { topK: 3, threshold: 0 })

    expect(results).toHaveLength(3)
    expect(results[0].chunkId).toBe('c1')
    expect(results[0].score).toBeCloseTo(1, 6)
    expect(results[1].chunkId).toBe('c2')
    expect(results[2].chunkId).toBe('c3')
  })

  it('should filter by threshold', () => {
    const query = [1, 0, 0]
    const candidates = [
      createMockChunk('c1', 'd1', [1, 0, 0], 'high', 0),
      createMockChunk('c2', 'd1', [0.5, 0.5, 0], 'medium', 1),
      createMockChunk('c3', 'd1', [0, 1, 0], 'low', 2),
    ]

    const results = searchWithEmbedding(query, candidates, { topK: 10, threshold: 0.8 })

    expect(results).toHaveLength(1)
    expect(results[0].chunkId).toBe('c1')
  })

  it('should return empty for empty query vector', () => {
    const candidates = [createMockChunk('c1', 'd1', [1, 0, 0], 'text', 0)]

    const results = searchWithEmbedding([], candidates)
    expect(results).toHaveLength(0)
  })

  it('should return empty for empty candidates', () => {
    const results = searchWithEmbedding([1, 0, 0], [])
    expect(results).toHaveLength(0)
  })

  it('should skip candidates without embedding', () => {
    const query = [1, 0, 0]
    const candidates = [
      createMockChunk('c1', 'd1', [1, 0, 0], 'has embedding', 0),
      { ...createMockChunk('c2', 'd1', [], 'empty embedding', 1), embedding: [] as number[] },
      { ...createMockChunk('c3', 'd1', [0, 1, 0], 'no embedding', 2), embedding: undefined },
    ]

    const results = searchWithEmbedding(query, candidates)

    expect(results).toHaveLength(1)
    expect(results[0].chunkId).toBe('c1')
  })

  it('should include metadata in results', () => {
    const query = [1, 0, 0]
    const candidates = [createMockChunk('c1', 'd1', [1, 0, 0], 'test content', 5)]

    const results = searchWithEmbedding(query, candidates)

    expect(results[0]).toMatchObject({
      chunkId: 'c1',
      documentId: 'd1',
      content: 'test content',
      chunkIndex: 5,
    })
    expect(results[0].score).toBeCloseTo(1, 6)
  })
})
