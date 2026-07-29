// AgentForge CB: 代码库语义搜索
// 基于向量余弦相似度的 Top-K 代码检索

import type { CodebaseSearchResult, CodebaseLanguage, CodeChunkType } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { generateEmbedding } from '../knowledge-base/embedding'
import type { EmbeddingConfig } from '../knowledge-base/embedding'
import { cosineSimilarity } from '../knowledge-base/search'
import { getCodebaseChunksWithEmbeddings, countCodebaseChunksWithEmbeddings, listCodebaseChunks } from '../db/repos/codebase-chunk'
import type { CodebaseChunk } from '@shared/types'
import { getCodebaseFileById } from '../db/repos/codebase-file'

/** 搜索选项 */
export interface CodebaseSearchOptions {
  /** 返回结果数量（默认 10） */
  topK?: number
  /** 相似度阈值（0-1，默认 0.3） */
  threshold?: number
  /** 指定搜索的文件 ID */
  fileId?: string
  /** 指定搜索的语言 */
  language?: CodebaseLanguage
  /** 指定搜索的分块类型 */
  chunkType?: CodeChunkType
  /** 自定义嵌入配置 */
  embeddingConfig?: EmbeddingConfig
}

/** 默认搜索配置 */
const DEFAULT_SEARCH_OPTIONS: Required<Pick<CodebaseSearchOptions, 'topK' | 'threshold'>> = {
  topK: 10,
  threshold: 0.3,
}

/** 文件信息缓存 */
const fileInfoCache = new Map<string, { filePath: string; fileName: string; language: CodebaseLanguage }>()

/**
 * 执行代码库语义搜索。
 * 流程：
 * 1. 将查询文本生成嵌入向量
 * 2. 加载已嵌入的代码分块
 * 3. 计算余弦相似度
 * 4. 按相似度排序，过滤阈值，返回 Top-K
 *
 * @param query - 查询文本
 * @param options - 搜索选项
 * @returns 搜索结果数组（按相似度降序）
 * @throws {AppError} CB_SEARCH_ERROR - 搜索失败
 */
export async function searchCodebase(
  query: string,
  options: CodebaseSearchOptions = {},
): Promise<CodebaseSearchResult[]> {
  if (!query || query.trim().length === 0) {
    return []
  }

  const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options }

  try {
    // 1. 生成查询向量
    const queryEmbedding = await generateEmbedding(query, opts.embeddingConfig)

    if (queryEmbedding.length === 0) {
      // 嵌入不可用时回退到关键词搜索
      return keywordSearchCodebase(query, opts)
    }

    // 2. 分页加载候选分块并计算相似度
    const BATCH_SIZE = 500
    const filterOpts = opts.fileId ? { fileId: opts.fileId } : undefined
    const totalCount = countCodebaseChunksWithEmbeddings(filterOpts)

    if (totalCount === 0) {
      // 没有嵌入数据时回退到关键词搜索
      return keywordSearchCodebase(query, opts)
    }

    let scored: Array<{
      chunk: CodebaseChunk
      score: number
      fileInfo: { filePath: string; fileName: string; language: CodebaseLanguage }
    }> = []

    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      const batch = getCodebaseChunksWithEmbeddings({
        ...filterOpts,
        limit: BATCH_SIZE,
        offset,
      })

      const batchScored = batch
        .filter(
          (chunk): chunk is CodebaseChunk =>
            Array.isArray(chunk.embedding) && chunk.embedding.length > 0,
        )
        .map((chunk) => {
          const score = cosineSimilarity(queryEmbedding, chunk.embedding!)
          const fileInfo = getFileInfo(chunk.fileId)
          return { chunk, score, fileInfo }
        })
        .filter((item) => {
          if (item.score < opts.threshold) return false
          if (opts.language && item.fileInfo.language !== opts.language) return false
          if (opts.chunkType && item.chunk.chunkType !== opts.chunkType) return false
          return true
        })

      scored.push(...batchScored)

      // 保持内存可控
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
      fileId: item.chunk.fileId,
      filePath: item.fileInfo.filePath,
      fileName: item.fileInfo.fileName,
      language: item.fileInfo.language,
      content: item.chunk.content,
      chunkType: item.chunk.chunkType,
      startLine: item.chunk.startLine,
      endLine: item.chunk.endLine,
      score: item.score,
    }))
  } catch (error) {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError(
      ErrorCodes.CB_SEARCH_ERROR,
      `Failed to search codebase: ${message}`,
      { query, options: opts },
    )
  }
}

/**
 * 关键词搜索回退方案。
 * 当嵌入服务不可用时使用简单的文本匹配。
 */
function keywordSearchCodebase(
  query: string,
  opts: Required<Pick<CodebaseSearchOptions, 'topK' | 'threshold'>>,
): CodebaseSearchResult[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1)

  if (keywords.length === 0) return []

  // 获取所有已索引文件的分块
  const allChunks = listCodebaseChunks({ limit: 1000 })

  const scored = allChunks
    .map((chunk: CodebaseChunk) => {
      const content = chunk.content.toLowerCase()
      let matches = 0
      for (const kw of keywords) {
        if (content.includes(kw)) matches++
      }
      const score = matches / keywords.length
      return { chunk, score }
    })
    .filter((item: { score: number }) => item.score > 0)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .slice(0, opts.topK)

  return scored.map((item: { chunk: CodebaseChunk; score: number }) => {
    const fileInfo = getFileInfo(item.chunk.fileId)
    return {
      chunkId: item.chunk.id,
      fileId: item.chunk.fileId,
      filePath: fileInfo.filePath,
      fileName: fileInfo.fileName,
      language: fileInfo.language,
      content: item.chunk.content,
      chunkType: item.chunk.chunkType,
      startLine: item.chunk.startLine,
      endLine: item.chunk.endLine,
      score: item.score,
    }
  })
}

/**
 * 获取文件信息（带缓存）。
 */
function getFileInfo(fileId: string): {
  filePath: string
  fileName: string
  language: CodebaseLanguage
} {
  const cached = fileInfoCache.get(fileId)
  if (cached) return cached

  try {
    const file = getCodebaseFileById(fileId)
    const info = {
      filePath: file.filePath,
      fileName: file.fileName,
      language: file.language,
    }
    fileInfoCache.set(fileId, info)
    return info
  } catch {
    const fallback = {
      filePath: 'unknown',
      fileName: 'unknown',
      language: 'unknown' as CodebaseLanguage,
    }
    fileInfoCache.set(fileId, fallback)
    return fallback
  }
}

/**
 * 清除搜索缓存。
 */
export function clearCodebaseSearchCache(): void {
  fileInfoCache.clear()
}
