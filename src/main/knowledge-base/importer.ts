// AgentForge 文档导入协调器
// 协调解析 → 分块 → 存储的完整导入流程
// P4-02: 基础导入流程
// P5-02: 支持 PDF/DOCX/XLSX 异步解析

import { createHash } from 'node:crypto'
import type { KbDocument } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  createKbDocument,
  updateKbDocument,
  deleteKbDocument,
  getKbDocumentById,
  listKbDocuments,
} from '../db/repos/kb-document'
import { batchCreateKbChunks, deleteKbChunksByDocumentId, getChunksByDocumentId } from '../db/repos/kb-chunk'
import { parseDocument } from './parser'
import { chunkText } from './chunking'
import { clearSearchCache } from './search'
import type { ChunkingOptions } from './chunking'

/** 导入选项 */
export interface ImportOptions {
  /** 分块策略选项 */
  chunking?: ChunkingOptions
}

/** 导入结果 */
export interface ImportResult {
  documentId: string
  fileName: string
  status: KbDocument['status']
  chunkCount: number
  totalTokens: number
}

/**
 * 导入文档到知识库。
 * 完整流程：
 * 1. 创建文档记录（status = indexing）
 * 2. 解析文件内容（异步，支持 PDF/DOCX/XLSX）
 * 3. 文本分块
 * 4. 存储分块到数据库
 * 5. 更新文档状态为 ready
 *
 * @param filePath - 文件路径
 * @param fileName - 文件名
 * @param fileType - 文件类型
 * @param options - 导入选项
 * @returns 导入结果
 * @throws {AppError} KB_INDEX_ERROR - 导入失败
 */
export async function importDocument(
  filePath: string,
  fileName: string,
  fileType: KbDocument['fileType'],
  options: ImportOptions = {},
): Promise<ImportResult> {
  // 0. 解析文件内容，用于内容去重检查
  const parseResult = await parseDocument(filePath, fileType)
  const contentHash = createHash('sha256').update(parseResult.content).digest('hex')

  // 检查是否有相同内容的文档已存在
  const existingDocs = listKbDocuments({ status: 'ready' })
  for (const doc of existingDocs) {
    try {
      const chunks = getChunksByDocumentId(doc.id)
      const existingContent = chunks.map((c) => c.content).join('')
      const existingHash = createHash('sha256').update(existingContent).digest('hex')
      if (existingHash === contentHash) {
        throw new AppError(
          ErrorCodes.KB_DOCUMENT_DUPLICATE,
          `Document with identical content already exists: "${doc.fileName}" (id: ${doc.id})`,
          { filePath, fileName, existingDocId: doc.id },
        )
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      // 如果读取已有文档内容失败，跳过该文档的比对
      continue
    }
  }

  // 1. 创建文档记录
  const doc = createKbDocument({ filePath, fileName, fileType })

  try {
    // 2. 文本分块（复用步骤 0 中已解析的内容）
    const chunkingOpts: ChunkingOptions = options.chunking ?? {
      strategy: 'fixed',
      chunkSize: 500,
      overlap: 50,
    }
    const chunks = chunkText(parseResult.content, chunkingOpts)

    // 4. 存储分块
    if (chunks.length > 0) {
      batchCreateKbChunks({
        documentId: doc.id,
        chunks: chunks.map((c) => ({
          content: c.content,
          tokenCount: c.tokenCount,
          chunkIndex: c.chunkIndex,
        })),
      })
    }

    // 5. 更新文档状态为 ready
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
    updateKbDocument({
      id: doc.id,
      status: 'ready',
      chunkCount: chunks.length,
    })

    return {
      documentId: doc.id,
      fileName: doc.fileName,
      status: 'ready',
      chunkCount: chunks.length,
      totalTokens,
    }
  } catch (error) {
    // 导入失败：更新文档状态为 error，清理已创建的分块
    const errorMessage = error instanceof Error ? error.message : String(error)
    updateKbDocument({
      id: doc.id,
      status: 'error',
      errorMessage,
    })
    deleteKbChunksByDocumentId(doc.id)

    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.KB_INDEX_ERROR,
      `Failed to import document "${fileName}": ${errorMessage}`,
      { filePath, fileName, fileType },
    )
  }
}

/**
 * 重新导入文档。
 * 删除旧分块，重新解析和分块。
 *
 * @param documentId - 文档 ID
 * @param options - 导入选项
 * @returns 导入结果
 */
export async function reimportDocument(
  documentId: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  // 获取文档信息
  const doc = getKbDocumentById(documentId)

  // 删除旧分块
  deleteKbChunksByDocumentId(documentId)

  // 更新状态为 indexing
  updateKbDocument({
    id: documentId,
    status: 'indexing',
    errorMessage: null,
    chunkCount: 0,
  })

  try {
    // 重新解析（异步）
    const parseResult = await parseDocument(doc.filePath, doc.fileType)

    // 重新分块
    const chunkingOpts: ChunkingOptions = options.chunking ?? {
      strategy: 'fixed',
      chunkSize: 500,
      overlap: 50,
    }
    const chunks = chunkText(parseResult.content, chunkingOpts)

    // 存储新分块
    if (chunks.length > 0) {
      batchCreateKbChunks({
        documentId: doc.id,
        chunks: chunks.map((c) => ({
          content: c.content,
          tokenCount: c.tokenCount,
          chunkIndex: c.chunkIndex,
        })),
      })
    }

    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
    updateKbDocument({
      id: doc.id,
      status: 'ready',
      chunkCount: chunks.length,
    })

    return {
      documentId: doc.id,
      fileName: doc.fileName,
      status: 'ready',
      chunkCount: chunks.length,
      totalTokens,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    updateKbDocument({
      id: doc.id,
      status: 'error',
      errorMessage,
    })
    deleteKbChunksByDocumentId(doc.id)

    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.KB_INDEX_ERROR,
      `Failed to reimport document "${doc.fileName}": ${errorMessage}`,
      { documentId, filePath: doc.filePath },
    )
  }
}

/**
 * 删除文档及其所有分块。
 *
 * @param documentId - 文档 ID
 */
export function removeDocument(documentId: string): void {
  deleteKbChunksByDocumentId(documentId)
  deleteKbDocument(documentId)
  // OPT2-22: 删除文档后清理 fileNameCache，避免返回过时数据
  clearSearchCache()
}
