// AgentForge P4-03: 文档索引导向器
// 协调分块的嵌入向量生成与存储

import { AppError, ErrorCodes } from '../utils/error'
import { getKbChunksByDocumentId, batchUpdateKbChunkEmbeddings, clearKbChunkEmbeddings } from '../db/repos/kb-chunk'
import { generateEmbeddings } from './embedding'
import type { EmbeddingConfig } from './embedding'

/** 索引进度回调 */
export interface IndexProgressCallback {
  (progress: {
    documentId: string
    stage: 'embedding' | 'completed' | 'error'
    current: number
    total: number
    message?: string
  }): void
}

/** 索引选项 */
export interface IndexOptions {
  /** 嵌入配置 */
  embeddingConfig?: EmbeddingConfig
  /** 进度回调 */
  onProgress?: IndexProgressCallback
  /** 批量大小（默认 32） */
  batchSize?: number
}

/** 默认批量大小 */
const DEFAULT_BATCH_SIZE = 32

/**
 * 为文档的所有分块生成嵌入向量。
 * 流程：
 * 1. 加载文档的所有分块
 * 2. 批量调用嵌入 API
 * 3. 批量更新数据库中的 embedding 字段
 *
 * @param documentId - 文档 ID
 * @param options - 索引选项
 * @returns 已处理的分块数量
 * @throws {AppError} KB_EMBEDDING_ERROR - 嵌入生成失败
 */
export async function indexDocumentEmbeddings(
  documentId: string,
  options: IndexOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE

  // 1. 加载分块
  const chunks = getKbChunksByDocumentId(documentId)

  if (chunks.length === 0) {
    return 0
  }

  // 过滤掉已嵌入的分块（可选：强制重新嵌入）
  const pendingChunks = chunks.filter((chunk) => !chunk.embedding || chunk.embedding.length === 0)

  if (pendingChunks.length === 0) {
    return 0
  }

  const total = pendingChunks.length
  let current = 0

  options.onProgress?.({
    documentId,
    stage: 'embedding',
    current,
    total,
    message: `开始为 ${total} 个分块生成嵌入向量`,
  })

  try {
    // 2. 分批生成嵌入
    for (let i = 0; i < pendingChunks.length; i += batchSize) {
      const batch = pendingChunks.slice(i, i + batchSize)
      const texts = batch.map((chunk) => chunk.content)

      const results = await generateEmbeddings(texts, options.embeddingConfig)

      // 3. 批量更新数据库
      const updates = batch
        .map((chunk, idx) => ({
          id: chunk.id,
          embedding: results[idx]?.embedding ?? [],
        }))
        .filter((u) => u.embedding.length > 0)

      if (updates.length > 0) {
        batchUpdateKbChunkEmbeddings(updates)
      }

      current += batch.length
      options.onProgress?.({
        documentId,
        stage: 'embedding',
        current,
        total,
        message: `已处理 ${current}/${total} 个分块`,
      })
    }

    options.onProgress?.({
      documentId,
      stage: 'completed',
      current: total,
      total,
      message: '嵌入向量生成完成',
    })

    return total
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.onProgress?.({
      documentId,
      stage: 'error',
      current,
      total,
      message: `嵌入生成失败: ${message}`,
    })

    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.KB_EMBEDDING_ERROR,
      `Failed to index embeddings for document "${documentId}": ${message}`,
      { documentId, chunkCount: total },
    )
  }
}

/**
 * 批量索引多个文档的嵌入向量。
 *
 * @param documentIds - 文档 ID 数组
 * @param options - 索引选项
 * @returns 每个文档的处理结果
 */
export async function indexMultipleDocuments(
  documentIds: string[],
  options: IndexOptions = {},
): Promise<Array<{ documentId: string; indexed: number; error?: string }>> {
  const results: Array<{ documentId: string; indexed: number; error?: string }> = []

  for (const documentId of documentIds) {
    try {
      const indexed = await indexDocumentEmbeddings(documentId, options)
      results.push({ documentId, indexed })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ documentId, indexed: 0, error: message })
    }
  }

  return results
}

/**
 * 重新索引文档（强制重新生成所有嵌入）。
 * 清除现有嵌入后重新生成。
 *
 * @param documentId - 文档 ID
 * @param options - 索引选项
 * @returns 已处理的分块数量
 */
export async function reindexDocumentEmbeddings(
  documentId: string,
  options: IndexOptions = {},
): Promise<number> {
  // 清除现有嵌入（设为 NULL，而非空数组）
  const chunks = getKbChunksByDocumentId(documentId)

  if (chunks.length === 0) {
    return 0
  }

  clearKbChunkEmbeddings(documentId)

  // 重新生成
  return indexDocumentEmbeddings(documentId, options)
}
