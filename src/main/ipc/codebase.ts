// AgentForge 代码库索引 IPC Handlers
// 通道命名: cb:scan, cb:status, cb:stats, cb:search, cb:symbols, cb:files, cb:clear, cb:reindex

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { CodebaseSearchResult, CodebaseStats, CodebaseSymbol, CodebaseFile } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  validateNonEmptyString,
  validateOptionalNumber,
} from '../utils/ipc-validator'
import { scanCodebase, getCodebaseStats, clearCodebaseIndex, reindexFile } from '../codebase/scanner'
import type { ScanOptions } from '../codebase/scanner'
import { searchCodebase } from '../codebase/search'
import type { CodebaseSearchOptions } from '../codebase/search'
import { listCodebaseFiles } from '../db/repos/codebase-file'
import { listCodebaseSymbols, searchCodebaseSymbols } from '../db/repos/codebase-symbol'

// ─── 并发控制 ─────────────────────────────────────────────────────

/** 当前扫描的 AbortController，null 表示空闲 */
let currentScanAbortController: AbortController | null = null

// ─── IPC Handlers ────────────────────────────────────────────────

/**
 * 扫描代码库（增量索引）。
 * 参数: { rootPath, generateEmbeddings?, excludeDirs?, languages? }
 */
async function handleScan(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof scanCodebase>>> {
  const rootPath = validateNonEmptyString(params['rootPath'], 'rootPath')

  // 取消正在进行的扫描
  if (currentScanAbortController) {
    currentScanAbortController.abort()
  }
  currentScanAbortController = new AbortController()

  const options: ScanOptions = {
    rootPath,
    abortSignal: currentScanAbortController.signal,
  }

  if (params['generateEmbeddings'] !== undefined) {
    options.generateEmbeddings = !!params['generateEmbeddings']
  }

  if (params['excludeDirs'] !== undefined && Array.isArray(params['excludeDirs'])) {
    options.excludeDirs = params['excludeDirs'] as string[]
  }

  if (params['languages'] !== undefined && Array.isArray(params['languages'])) {
    options.languages = params['languages'] as ScanOptions['languages']
  }

  const maxFileSize = validateOptionalNumber(params['maxFileSize'], 'maxFileSize', 1)
  if (maxFileSize !== undefined) {
    options.maxFileSize = maxFileSize
  }

  const embeddingBatchSize = validateOptionalNumber(
    params['embeddingBatchSize'],
    'embeddingBatchSize',
    1,
    256,
  )
  if (embeddingBatchSize !== undefined) {
    options.embeddingBatchSize = Math.floor(embeddingBatchSize)
  }

  try {
    return await scanCodebase(options)
  } finally {
    currentScanAbortController = null
  }
}

/**
 * 获取代码库统计信息。
 */
function handleStats(): CodebaseStats {
  return getCodebaseStats()
}

/**
 * 代码库语义搜索。
 * 参数: { query, topK?, language?, chunkType?, threshold? }
 */
async function handleSearch(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<CodebaseSearchResult[]> {
  const query = validateNonEmptyString(params['query'], 'query')

  const options: CodebaseSearchOptions = {}

  const topK = validateOptionalNumber(params['topK'], 'topK', 1, 50)
  if (topK !== undefined) {
    options.topK = Math.floor(topK)
  }

  if (typeof params['language'] === 'string' && params['language'].trim().length > 0) {
    options.language = params['language'] as CodebaseSearchOptions['language']
  }

  if (typeof params['chunkType'] === 'string' && params['chunkType'].trim().length > 0) {
    options.chunkType = params['chunkType'] as CodebaseSearchOptions['chunkType']
  }

  const threshold = validateOptionalNumber(params['threshold'], 'threshold', 0, 1)
  if (threshold !== undefined) {
    options.threshold = threshold
  }

  return searchCodebase(query, options)
}

/**
 * 搜索代码符号。
 * 参数: { name, limit? }
 */
function handleSearchSymbols(
  _event: unknown,
  params: Record<string, unknown>,
): CodebaseSymbol[] {
  const name = validateNonEmptyString(params['name'], 'name')

  const limit = params['limit'] !== undefined
    ? Math.min(Math.floor(Number(params['limit'])), 100)
    : 20

  return searchCodebaseSymbols(name, limit)
}

/**
 * 列出代码库文件。
 * 参数: { language?, status?, limit?, offset? }
 */
function handleListFiles(
  _event: unknown,
  params?: Record<string, unknown>,
): CodebaseFile[] {
  return listCodebaseFiles({
    language: params?.['language'] as CodebaseFile['language'] | undefined,
    status: params?.['status'] as CodebaseFile['status'] | undefined,
    limit: params?.['limit'] !== undefined ? Math.floor(Number(params['limit'])) : undefined,
    offset: params?.['offset'] !== undefined ? Math.floor(Number(params['offset'])) : undefined,
  })
}

/**
 * 列出代码符号。
 * 参数: { fileId?, symbolType?, name?, limit?, offset? }
 */
function handleListSymbols(
  _event: unknown,
  params?: Record<string, unknown>,
): CodebaseSymbol[] {
  return listCodebaseSymbols({
    fileId: params?.['fileId'] as string | undefined,
    symbolType: params?.['symbolType'] as CodebaseSymbol['symbolType'] | undefined,
    name: params?.['name'] as string | undefined,
    limit: params?.['limit'] !== undefined ? Math.floor(Number(params['limit'])) : undefined,
    offset: params?.['offset'] !== undefined ? Math.floor(Number(params['offset'])) : undefined,
  })
}

/**
 * 清空代码库索引。
 */
function handleClear(): void {
  clearCodebaseIndex()
}

/**
 * 重新索引单个文件。
 * 参数: { filePath, generateEmbeddings? }
 */
async function handleReindex(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<void> {
  const filePath = validateNonEmptyString(params['filePath'], 'filePath')

  const generateEmbeddings = params['generateEmbeddings'] !== false
  await reindexFile(filePath, generateEmbeddings)
}

/**
 * 取消正在进行的扫描。
 */
function handleCancelScan(): void {
  if (currentScanAbortController) {
    currentScanAbortController.abort()
  }
}

// ─── 注册函数 ────────────────────────────────────────────────────

const handlers: Array<{ channel: string; handler: IpcMainInvokeHandler }> = [
  { channel: 'cb:scan', handler: handleScan },
  { channel: 'cb:cancel-scan', handler: handleCancelScan },
  { channel: 'cb:stats', handler: handleStats },
  { channel: 'cb:search', handler: handleSearch },
  { channel: 'cb:symbols:search', handler: handleSearchSymbols },
  { channel: 'cb:files:list', handler: handleListFiles },
  { channel: 'cb:symbols:list', handler: handleListSymbols },
  { channel: 'cb:clear', handler: handleClear },
  { channel: 'cb:reindex', handler: handleReindex },
]

/**
 * 注册代码库索引 IPC handlers。
 * 幂等：重复调用安全。
 */
export function registerCodebaseHandlers(): void {
  for (const { channel, handler } of handlers) {
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
