// AgentForge P4-03: 语义搜索服务
// 基于向量余弦相似度的 Top-K 检索

import type { DocumentChunk, SearchResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { generateEmbedding } from './embedding'
import { getKbChunksWithEmbeddings, countKbChunksWithEmbeddings } from '../db/repos/kb-chunk'
import { getKbDocumentById } from '../db/repos/kb-document'
import type { EmbeddingConfig } from './embedding'

/** 搜索选项 */
export interface SearchOptions {
  /** 返回结果数量（默认 5） */
  topK?: number
  /** 相似度阈值（0-1，默认 0.5） */
  threshold?: number
  /** 指定搜索的文档 ID（可选，默认搜索全部） */
  documentId?: string
  /** 自定义嵌入配置 */
  embeddingConfig?: EmbeddingConfig
}

/** 默认搜索配置 */
const DEFAULT_SEARCH_OPTIONS: Required<Pick<SearchOptions, 'topK' | 'threshold'>> = {
  topK: 5,
  threshold: 0.5,
}

/**
 * 执行语义搜索。
 * 流程：
 * 1. 将查询文本生成嵌入向量
 * 2. 加载所有（或指定文档的）已嵌入分块
 * 3. 计算余弦相似度
 * 4. 按相似度排序，过滤阈值，返回 Top-K
 *
 * @param query - 查询文本
 * @param options - 搜索选项
 * @returns 搜索结果数组（按相似度降序）
 * @throws {AppError} KB_SEARCH_ERROR - 搜索失败
 */
export async function semanticSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) {
    return []
  }

  const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options }

  try {
    // 1. 生成查询向量
    const queryEmbedding = await generateEmbedding(query, opts.embeddingConfig)

    if (queryEmbedding.length === 0) {
      return []
    }

    // 2. 分页加载候选分块并逐批计算相似度（避免全量加载导致 OOM）
    const BATCH_SIZE = 500
    const filterOpts = opts.documentId ? { documentId: opts.documentId } : undefined
    const totalCount = countKbChunksWithEmbeddings(filterOpts)

    if (totalCount === 0) {
      return []
    }

    let scored: Array<{ chunk: DocumentChunk & { embedding: number[] }; score: number }> = []

    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      const batch = getKbChunksWithEmbeddings({
        ...filterOpts,
        limit: BATCH_SIZE,
        offset,
      })

      const batchScored = batch
        .filter(
          (chunk): chunk is DocumentChunk & { embedding: number[] } =>
            Array.isArray(chunk.embedding) && chunk.embedding.length > 0,
        )
        .map((chunk) => ({
          chunk,
          score: cosineSimilarity(queryEmbedding, chunk.embedding),
        }))
        .filter((item) => item.score >= opts.threshold)

      scored.push(...batchScored)

      // 保持内存可控：如果已积累的结果远超 topK，进行中间排序截断
      if (scored.length > opts.topK * 10) {
        scored.sort((a, b) => b.score - a.score)
        scored = scored.slice(0, opts.topK * 5)
      }
    }

    // 3. 最终排序取 Top-K
    scored.sort((a, b) => b.score - a.score)
    const topResults = scored.slice(0, opts.topK)

    return topResults.map((item) => ({
      chunkId: item.chunk.id,
      documentId: item.chunk.documentId,
      fileName: getDocumentFileName(item.chunk.documentId),
      content: item.chunk.content,
      score: item.score,
      chunkIndex: item.chunk.chunkIndex,
    }))
  } catch (error) {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError(
      ErrorCodes.KB_SEARCH_ERROR,
      `Failed to perform semantic search: ${message}`,
      { query, options: opts },
    )
  }
}

/**
 * 计算两个向量的余弦相似度。
 * 范围 [-1, 1]，对于非负嵌入向量实际范围 [0, 1]。
 *
 * @param a - 向量 A
 * @param b - 向量 B
 * @returns 余弦相似度
 * @throws {AppError} KB_SEARCH_ERROR - 维度不匹配（可能是嵌入模型变更后未重建索引）
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0
  }

  if (a.length !== b.length) {
    throw new AppError(
      ErrorCodes.KB_SEARCH_ERROR,
      `Embedding dimension mismatch: query vector has ${a.length} dimensions, ` +
        `but stored chunk has ${b.length} dimensions. ` +
        `This usually happens after switching embedding models. ` +
        `Please rebuild the knowledge base index.`,
      { queryDim: a.length, chunkDim: b.length },
    )
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 计算向量自身的 L2 范数（模长）。
 *
 * @param vec - 输入向量
 * @returns L2 范数
 */
export function vectorNorm(vec: number[]): number {
  let sum = 0
  for (const v of vec) {
    sum += v * v
  }
  return Math.sqrt(sum)
}

/**
 * 归一化向量（L2 归一化）。
 * 归一化后的向量模长为 1，可加速相似度计算。
 *
 * @param vec - 输入向量
 * @returns 归一化后的向量
 */
export function normalizeVector(vec: number[]): number[] {
  const norm = vectorNorm(vec)
  if (norm === 0) {
    return vec.slice()
  }
  return vec.map((v) => v / norm)
}

/**
 * 缓存文档文件名，避免重复查询。
 */
const fileNameCache = new Map<string, string>()

function getDocumentFileName(documentId: string): string {
  const cached = fileNameCache.get(documentId)
  if (cached !== undefined) {
    return cached
  }

  try {
    const doc = getKbDocumentById(documentId)
    fileNameCache.set(documentId, doc.fileName)
    return doc.fileName
  } catch {
    return 'Unknown'
  }
}

/**
 * 清除文件名缓存。
 * 在文档删除或重命名后调用。
 */
export function clearSearchCache(): void {
  fileNameCache.clear()
}

/**
 * 对单个查询向量与候选分块进行相似度排序（同步版本）。
 * 用于已预先加载候选向量的场景。
 *
 * @param queryEmbedding - 查询向量
 * @param candidates - 候选分块（必须包含 embedding）
 * @param options - 搜索选项
 * @returns 搜索结果数组
 */
export function searchWithEmbedding(
  queryEmbedding: number[],
  candidates: DocumentChunk[],
  options: SearchOptions = {},
): SearchResult[] {
  const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options }

  if (queryEmbedding.length === 0 || candidates.length === 0) {
    return []
  }

  const scored = candidates
    .filter(
      (chunk): chunk is DocumentChunk & { embedding: number[] } =>
        Array.isArray(chunk.embedding) && chunk.embedding.length > 0,
    )
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((item) => item.score >= opts.threshold)
    .sort((a, b) => b.score - a.score)

  const topResults = scored.slice(0, opts.topK)

  return topResults.map((item) => ({
    chunkId: item.chunk.id,
    documentId: item.chunk.documentId,
    fileName: getDocumentFileName(item.chunk.documentId),
    content: item.chunk.content,
    score: item.score,
    chunkIndex: item.chunk.chunkIndex,
  }))
}
