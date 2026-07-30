// AgentForge 知识库 IPC Handlers
// 通道命名: kb:import, kb:list, kb:get, kb:delete, kb:search, kb:index, kb:reindex, kb:stats
// 实现 P5-01: 知识库 IPC 层，连接 KB 后端与渲染进程

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { KbDocument, SearchResult, KbStats } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  validateNonEmptyString,
  validateOptionalNumber,
} from '../utils/ipc-validator'
import { listKbDocuments, getKbDocumentById, countKbDocuments } from '../db/repos/kb-document'
import { countAllKbChunks, getKbChunksWithEmbeddings } from '../db/repos/kb-chunk'
import { importDocument, reimportDocument, removeDocument } from '../knowledge-base/importer'
import type { ImportOptions, ImportResult } from '../knowledge-base/importer'
import { semanticSearch } from '../knowledge-base/search'
import type { SearchOptions } from '../knowledge-base/search'
import { indexDocumentEmbeddings, reindexDocumentEmbeddings } from '../knowledge-base/indexing'
import type { IndexOptions } from '../knowledge-base/indexing'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

const VALID_FILE_TYPES = ['pdf', 'markdown', 'txt', 'docx', 'xlsx', 'csv'] as const

function assertFileType(value: unknown): asserts value is KbDocument['fileType'] {
  if (
    typeof value !== 'string' ||
    !VALID_FILE_TYPES.includes(value as (typeof VALID_FILE_TYPES)[number])
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid file type "${String(value)}". Must be one of: ${VALID_FILE_TYPES.join(', ')}.`,
      { fileType: value },
    )
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────

/**
 * 导入文档到知识库。
 * 参数: { filePath, fileName, fileType, chunking? }
 */
async function handleImport(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<ImportResult> {
  const filePath = validateNonEmptyString(params['filePath'], 'filePath')
  const fileName = validateNonEmptyString(params['fileName'], 'fileName')
  assertFileType(params['fileType'])

  // 知识库导入不限制工作区路径——用户可通过系统文件对话框自由选择文档导入
  const fileType = params['fileType'] as KbDocument['fileType']

  const options: ImportOptions = {}
  if (params['chunking'] !== undefined && typeof params['chunking'] === 'object') {
    options.chunking = params['chunking'] as ImportOptions['chunking']
  }

  return await importDocument(filePath, fileName, fileType, options)
}

/**
 * 列出所有知识库文档。
 * 参数: { status? }
 */
function handleList(_event: unknown, params?: Record<string, unknown>): KbDocument[] {
  const status = params?.['status'] as KbDocument['status'] | undefined
  return listKbDocuments(status ? { status } : undefined)
}

/**
 * 获取单个文档详情。
 * 参数: { id }
 */
function handleGet(_event: unknown, params: Record<string, unknown>): KbDocument {
  const id = validateNonEmptyString(params['id'], 'id')
  return getKbDocumentById(id)
}

/**
 * 删除文档及其所有分块。
 * 参数: { id }
 */
function handleDelete(_event: unknown, params: Record<string, unknown>): void {
  const id = validateNonEmptyString(params['id'], 'id')
  removeDocument(id)
}

/**
 * 重新导入文档（重新解析和分块）。
 * 参数: { id, chunking? }
 */
async function handleReimport(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<ImportResult> {
  const id = validateNonEmptyString(params['id'], 'id')

  const options: ImportOptions = {}
  if (params['chunking'] !== undefined && typeof params['chunking'] === 'object') {
    options.chunking = params['chunking'] as ImportOptions['chunking']
  }

  return await reimportDocument(id, options)
}

/**
 * 语义搜索知识库。
 * 参数: { query, topK?, documentId?, threshold? }
 */
async function handleSearch(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<SearchResult[]> {
  const query = validateNonEmptyString(params['query'], 'query')

  const options: SearchOptions = {}

  const topK = validateOptionalNumber(params['topK'], 'topK', 1, 50)
  if (topK !== undefined) {
    options.topK = Math.floor(topK)
  }

  if (typeof params['documentId'] === 'string' && params['documentId'].trim().length > 0) {
    options.documentId = params['documentId']
  }

  const threshold = validateOptionalNumber(params['threshold'], 'threshold', 0, 1)
  if (threshold !== undefined) {
    options.threshold = threshold
  }

  return semanticSearch(query, options)
}

/**
 * 为文档生成分块嵌入向量。
 * 参数: { id, batchSize? }
 */
async function handleIndex(_event: unknown, params: Record<string, unknown>): Promise<number> {
  const id = validateNonEmptyString(params['id'], 'id')

  const options: IndexOptions = {}
  const batchSize = validateOptionalNumber(params['batchSize'], 'batchSize', 1, 256)
  if (batchSize !== undefined) {
    options.batchSize = Math.floor(batchSize)
  }

  return indexDocumentEmbeddings(id, options)
}

/**
 * 重新索引文档（强制重新生成所有嵌入）。
 * 参数: { id, batchSize? }
 */
async function handleReindex(_event: unknown, params: Record<string, unknown>): Promise<number> {
  const id = validateNonEmptyString(params['id'], 'id')

  const options: IndexOptions = {}
  const batchSize = validateOptionalNumber(params['batchSize'], 'batchSize', 1, 256)
  if (batchSize !== undefined) {
    options.batchSize = Math.floor(batchSize)
  }

  return reindexDocumentEmbeddings(id, options)
}

/**
 * 获取知识库统计信息。
 */
function handleStats(): KbStats {
  const totalDocs = countKbDocuments()
  const readyDocs = countKbDocuments({ status: 'ready' })
  const errorDocs = countKbDocuments({ status: 'error' })
  const indexingDocs = countKbDocuments({ status: 'indexing' })
  const totalChunks = countAllKbChunks()
  const embeddedChunks = getKbChunksWithEmbeddings().length

  return {
    totalDocs,
    readyDocs,
    errorDocs,
    indexingDocs,
    totalChunks,
    embeddedChunks,
    pendingEmbeddings: totalChunks - embeddedChunks,
  }
}

// ─── 注册函数 ────────────────────────────────────────────────────

const handlers: Array<{ channel: string; handler: IpcMainInvokeHandler }> = [
  { channel: 'kb:import', handler: handleImport },
  { channel: 'kb:list', handler: handleList },
  { channel: 'kb:get', handler: handleGet },
  { channel: 'kb:delete', handler: handleDelete },
  { channel: 'kb:reimport', handler: handleReimport },
  { channel: 'kb:search', handler: handleSearch },
  { channel: 'kb:index', handler: handleIndex },
  { channel: 'kb:reindex', handler: handleReindex },
  { channel: 'kb:stats', handler: handleStats },
]

// OPT2-29: 移除 registered 标志位，统一使用 removeHandler + handle 幂等模式
/**
 * 注册知识库 IPC handlers。
 * 幂等：重复调用安全。
 */
export function registerKbHandlers(): void {
  for (const { channel, handler } of handlers) {
    // 包装 handler，统一捕获 AppError 并转换为 IPC 错误
    const wrappedHandler: IpcMainInvokeHandler = async (event, ...args) => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        if (error instanceof AppError) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new AppError(ErrorCodes.INTERNAL_ERROR, message, { channel })
      }
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, wrappedHandler)
  }
}
