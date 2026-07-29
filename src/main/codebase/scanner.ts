// AgentForge CB: 增量扫描引擎
// 目录遍历 + 文件哈希 + 变更检测 + 解析入库 + 嵌入生成

import { createHash } from 'node:crypto'
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename, extname } from 'node:path'
import type { CodebaseLanguage, CodebaseStats, CodebaseIndexProgress } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { generateId } from '../utils/id'
import { estimateTokens } from '../agent/tokenizer'
import { parseCodeFile, detectLanguage, getSupportedCodeExtensions } from './parser'
import type { ParseResult, ExtractedSymbol, ExtractedChunk } from './parser'

// 仓库层
import {
  upsertCodebaseFile,
  getCodebaseFileByPath,
  deleteCodebaseFile,
  deleteAllCodebaseFiles,
  listCodebaseFiles,
  updateCodebaseFile,
  countCodebaseFiles,
  getCodebaseFileStatsByLanguage,
} from '../db/repos/codebase-file'
import {
  deleteCodebaseSymbolsByFileId,
  batchCreateCodebaseSymbols,
  countCodebaseSymbols,
} from '../db/repos/codebase-symbol'
import {
  deleteCodebaseChunksByFileId,
  batchCreateCodebaseChunks,
  clearCodebaseChunkEmbeddings,
  countCodebaseChunks,
  countCodebaseChunksWithEmbeddings,
  listCodebaseChunks,
  batchUpdateCodebaseChunkEmbeddings,
} from '../db/repos/codebase-chunk'
import { generateEmbeddings } from '../knowledge-base/embedding'

// ─── 默认排除目录/文件 ─────────────────────────────────────────

const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next',
  '.nuxt', '.output', '.svelte-kit', '.vercel', '.deno',
  'coverage', '.nyc_output', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.ruff_cache', 'vendor', 'target', 'deps',
  '.idea', '.vscode', '.cache', 'tmp', 'temp',
])

const DEFAULT_EXCLUDE_EXTENSIONS = new Set([
  '.min.js', '.min.css', '.map', '.lock', '.log',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.node',
  '.wasm', '.bin', '.dat',
])

/** 最大文件大小（1MB） */
const MAX_FILE_SIZE = 1024 * 1024

// ─── 类型定义 ─────────────────────────────────────────────────

/** 扫描选项 */
export interface ScanOptions {
  /** 要扫描的根目录 */
  rootPath: string
  /** 排除的目录名（覆盖默认值） */
  excludeDirs?: string[]
  /** 排除的文件扩展名 */
  excludeExtensions?: string[]
  /** 只包含特定语言 */
  languages?: CodebaseLanguage[]
  /** 最大文件大小（字节） */
  maxFileSize?: number
  /** 是否生成嵌入向量 */
  generateEmbeddings?: boolean
  /** 嵌入批次大小 */
  embeddingBatchSize?: number
}

/** 扫描结果 */
export interface ScanResult {
  totalFiles: number
  newFiles: number
  modifiedFiles: number
  unchangedFiles: number
  deletedFiles: number
  totalSymbols: number
  totalChunks: number
  errors: Array<{ filePath: string; error: string }>
  duration: number
}

/** 进度回调类型 */
export type ProgressCallback = (progress: CodebaseIndexProgress) => void

// ─── 文件发现 ─────────────────────────────────────────────────

/**
 * 递归遍历目录，收集所有支持的代码文件。
 */
function discoverFiles(
  rootPath: string,
  excludeDirs: Set<string>,
  excludeExtensions: Set<string>,
  languages: Set<CodebaseLanguage> | null,
  maxFileSize: number,
): string[] {
  const result: string[] = []
  const supportedExtensions = new Set(getSupportedCodeExtensions())

  function walkDir(dirPath: string): void {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // 跳过排除的目录
        if (excludeDirs.has(entry.name.toLowerCase())) continue
        // 跳过隐藏目录（以 . 开头，但允许 .github 等）
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        walkDir(fullPath)
      } else if (entry.isFile()) {
        // 跳过排除的扩展名组合
        const lowerName = entry.name.toLowerCase()
        if (isExcludedFile(lowerName, excludeExtensions)) continue

        const ext = extname(lowerName)
        if (!supportedExtensions.has(ext)) continue

        // 检查语言过滤
        if (languages) {
          const lang = detectLanguage(entry.name)
          if (!languages.has(lang)) continue
        }

        // 检查文件大小
        try {
          const stat = statSync(fullPath)
          if (stat.size > maxFileSize || stat.size === 0) continue
        } catch {
          continue
        }

        result.push(fullPath)
      }
    }
  }

  walkDir(rootPath)
  return result.sort()
}

/** 检查文件名是否应被排除（基于扩展名组合） */
function isExcludedFile(lowerName: string, excludeExtensions: Set<string>): boolean {
  for (const ext of excludeExtensions) {
    if (lowerName.endsWith(ext)) return true
  }
  return false
}

// ─── 文件哈希 ─────────────────────────────────────────────────

/**
 * 计算文件内容的 SHA-256 哈希。
 */
function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

// ─── 增量扫描核心 ─────────────────────────────────────────────

/**
 * 执行增量扫描：检测新增/修改/删除的文件，解析变更文件并更新索引。
 *
 * @param options - 扫描选项
 * @param onProgress - 可选的进度回调
 * @returns 扫描结果
 * @throws {AppError} CB_NOT_INITIALIZED - 根目录不存在
 */
export async function scanCodebase(
  options: ScanOptions,
  onProgress?: ProgressCallback,
): Promise<ScanResult> {
  const startTime = Date.now()

  // 验证根目录
  if (!existsSync(options.rootPath)) {
    throw new AppError(
      ErrorCodes.CB_NOT_INITIALIZED,
      `Root path does not exist: ${options.rootPath}`,
      { rootPath: options.rootPath },
    )
  }

  const excludeDirs = new Set([
    ...DEFAULT_EXCLUDE_DIRS,
    ...(options.excludeDirs ?? []).map(d => d.toLowerCase()),
  ])

  const excludeExtensions = new Set([
    ...DEFAULT_EXCLUDE_EXTENSIONS,
    ...(options.excludeExtensions ?? []),
  ])

  const languages = options.languages
    ? new Set(options.languages)
    : null

  const maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE

  // 1. 发现所有文件
  onProgress?.({ stage: 'scanning', current: 0, total: 0, message: 'Scanning directory...' })

  const discoveredFiles = discoverFiles(
    options.rootPath,
    excludeDirs,
    excludeExtensions,
    languages,
    maxFileSize,
  )

  // 2. 获取已索引文件列表
  const existingFiles = new Map<string, { id: string; fileHash: string }>(
    listCodebaseFiles().map(f => [f.filePath, { id: f.id, fileHash: f.fileHash }]),
  )

  const discoveredPaths = new Set(discoveredFiles)

  // 检测删除的文件
  const deletedPaths: string[] = []
  for (const [filePath] of existingFiles) {
    if (!discoveredPaths.has(filePath)) {
      deletedPaths.push(filePath)
    }
  }

  // 3. 处理每个文件
  let newFiles = 0
  let modifiedFiles = 0
  let unchangedFiles = 0
  const errors: Array<{ filePath: string; error: string }> = []
  let totalSymbols = 0
  let totalChunks = 0

  const total = discoveredFiles.length + deletedPaths.length

  for (let i = 0; i < discoveredFiles.length; i++) {
    const filePath = discoveredFiles[i]
    const fileName = basename(filePath)

    onProgress?.({
      stage: 'parsing',
      current: i + 1,
      total,
      currentFile: fileName,
    })

    try {
      const fileHash = computeFileHash(filePath)
      const existing = existingFiles.get(filePath)

      // 检查是否需要更新
      if (existing && existing.fileHash === fileHash) {
        unchangedFiles++
        continue
      }

      // 解析文件
      const content = readFileSync(filePath, 'utf-8')
      const parseResult = parseCodeFile(content, fileName)

      // Upsert 文件记录
      const file = upsertCodebaseFile({
        filePath,
        fileName,
        language: parseResult.language,
        fileHash,
        lineCount: parseResult.lineCount,
      })

      // 删除旧的符号和分块
      deleteCodebaseSymbolsByFileId(file.id)
      deleteCodebaseChunksByFileId(file.id)

      // 更新状态为 indexing
      updateCodebaseFile({ id: file.id, status: 'indexing' })

      // 创建符号
      if (parseResult.symbols.length > 0) {
        const symbolParams = parseResult.symbols.map(s => ({
          fileId: file.id,
          name: s.name,
          qualifiedName: s.qualifiedName,
          symbolType: s.symbolType,
          visibility: s.visibility,
          signature: s.signature,
          startLine: s.startLine,
          endLine: s.endLine,
          docComment: s.docComment,
        }))

        const createdSymbols = batchCreateCodebaseSymbols({
          fileId: file.id,
          symbols: symbolParams,
        })

        // 建立 符号名 → ID 映射，用于关联分块
        const symbolIdMap = new Map<string, string>()
        for (let j = 0; j < parseResult.symbols.length; j++) {
          const sym = parseResult.symbols[j]
          if (createdSymbols[j]) {
            symbolIdMap.set(`${sym.startLine}-${sym.name}`, createdSymbols[j].id)
          }
        }

        // 更新分块的 symbolId 引用
        for (const chunk of parseResult.chunks) {
          // 尝试找到关联的符号
          const symbolKey = findSymbolForChunk(parseResult.symbols, chunk)
          if (symbolKey) {
            chunk.symbolId = symbolIdMap.get(symbolKey)
          }
        }

        totalSymbols += parseResult.symbols.length
      }

      // 创建分块
      if (parseResult.chunks.length > 0) {
        const chunkParams = parseResult.chunks.map(c => ({
          fileId: file.id,
          content: c.content,
          chunkType: c.chunkType,
          symbolId: c.symbolId,
          startLine: c.startLine,
          endLine: c.endLine,
          tokenCount: c.tokenCount,
          chunkIndex: c.chunkIndex,
        }))

        batchCreateCodebaseChunks({ fileId: file.id, chunks: chunkParams })
        totalChunks += parseResult.chunks.length
      }

      // 更新文件状态为 ready
      updateCodebaseFile({
        id: file.id,
        status: 'ready',
        symbolCount: parseResult.symbols.length,
        chunkCount: parseResult.chunks.length,
        indexedAt: Date.now(),
        errorMessage: null,
      })

      if (existing) {
        modifiedFiles++
      } else {
        newFiles++
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ filePath, error: message })

      // 记录错误状态
      const file = getCodebaseFileByPath(filePath)
      if (file) {
        updateCodebaseFile({
          id: file.id,
          status: 'error',
          errorMessage: message,
        })
      }
    }
  }

  // 4. 处理删除的文件
  for (const filePath of deletedPaths) {
    const existing = getCodebaseFileByPath(filePath)
    if (existing) {
      deleteCodebaseFile(existing.id)
    }
  }

  // 5. 生成嵌入向量
  if (options.generateEmbeddings) {
    onProgress?.({
      stage: 'embedding',
      current: 0,
      total: totalChunks,
      message: 'Generating embeddings...',
    })

    await generateCodebaseEmbeddings(options.rootPath, options.embeddingBatchSize ?? 32, onProgress)
  }

  const duration = Date.now() - startTime

  onProgress?.({
    stage: 'completed',
    current: total,
    total,
    message: `Indexed ${newFiles + modifiedFiles} files in ${(duration / 1000).toFixed(1)}s`,
  })

  return {
    totalFiles: discoveredFiles.length,
    newFiles,
    modifiedFiles,
    unchangedFiles,
    deletedFiles: deletedPaths.length,
    totalSymbols,
    totalChunks,
    errors,
    duration,
  }
}

/**
 * 找到与分块关联的符号。
 * 通过行号范围匹配：如果分块的起始行在某个符号的行范围内，则关联。
 */
function findSymbolForChunk(
  symbols: ExtractedSymbol[],
  chunk: ExtractedChunk,
): string | undefined {
  for (const sym of symbols) {
    if (chunk.startLine >= sym.startLine && chunk.startLine <= sym.endLine) {
      return `${sym.startLine}-${sym.name}`
    }
  }
  return undefined
}

// ─── 嵌入生成 ─────────────────────────────────────────────────

/**
 * 为代码库中未嵌入的分块生成嵌入向量。
 * 批量处理，避免一次请求过多。
 */
export async function generateCodebaseEmbeddings(
  rootPath: string | null,
  batchSize: number = 32,
  onProgress?: ProgressCallback,
): Promise<number> {
  const files = listCodebaseFiles({ status: 'ready' })
  let totalEmbedded = 0

  for (const file of files) {
    // 获取该文件未嵌入的分块
    const allChunks = listCodebaseChunks({ fileId: file.id })
    const pendingChunks = allChunks.filter(c => !c.embedding || c.embedding.length === 0)

    if (pendingChunks.length === 0) continue

    // 分批生成嵌入
    for (let i = 0; i < pendingChunks.length; i += batchSize) {
      const batch = pendingChunks.slice(i, i + batchSize)
      const texts = batch.map(c => `// ${file.fileName}\n${c.content}`)

      try {
        const results = await generateEmbeddings(texts)

        const updates = results
          .filter(r => r.embedding.length > 0)
          .map((r, idx) => ({
            id: batch[idx].id,
            embedding: r.embedding,
          }))

        if (updates.length > 0) {
          batchUpdateCodebaseChunkEmbeddings(updates)
          totalEmbedded += updates.length
        }

        onProgress?.({
          stage: 'embedding',
          current: totalEmbedded,
          total: pendingChunks.length,
          currentFile: file.fileName,
        })
      } catch (error) {
        // 嵌入失败不中断整个流程
        console.warn(
          `[scanner] Embedding failed for ${file.fileName}:`,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  return totalEmbedded
}

// ─── 统计与清理 ───────────────────────────────────────────────

/**
 * 获取代码库索引统计信息。
 */
export function getCodebaseStats(): CodebaseStats {
  const totalFiles = countCodebaseFiles()
  const readyFiles = countCodebaseFiles({ status: 'ready' })
  const errorFiles = countCodebaseFiles({ status: 'error' })
  const pendingFiles = countCodebaseFiles({ status: 'pending' }) +
    countCodebaseFiles({ status: 'indexing' })
  const totalSymbols = countCodebaseSymbols()
  const totalChunks = countCodebaseChunks()
  const embeddedChunks = countCodebaseChunksWithEmbeddings()

  const langStats = getCodebaseFileStatsByLanguage()

  return {
    totalFiles,
    readyFiles,
    errorFiles,
    pendingFiles,
    totalSymbols,
    totalChunks,
    embeddedChunks,
    pendingEmbeddings: totalChunks - embeddedChunks,
    languages: langStats.map(s => ({
      language: s.language as CodebaseLanguage,
      fileCount: s.fileCount,
    })),
  }
}

/**
 * 清空代码库索引（删除所有文件、符号、分块记录）。
 */
export function clearCodebaseIndex(): void {
  deleteAllCodebaseFiles()
}

/**
 * 重新索引单个文件（手动触发）。
 */
export async function reindexFile(filePath: string, generateEmbeddings: boolean = true): Promise<void> {
  const existing = getCodebaseFileByPath(filePath)
  if (!existing) {
    throw new AppError(
      ErrorCodes.CB_FILE_NOT_FOUND,
      `File not found in codebase index: ${filePath}`,
      { filePath },
    )
  }

  // 删除旧的符号和分块
  deleteCodebaseSymbolsByFileId(existing.id)
  deleteCodebaseChunksByFileId(existing.id)

  // 重新解析
  const content = readFileSync(filePath, 'utf-8')
  const fileName = basename(filePath)
  const parseResult = parseCodeFile(content, fileName)

  // 更新文件哈希和行数
  const fileHash = computeFileHash(filePath)
  updateCodebaseFile({
    id: existing.id,
    fileHash,
    lineCount: parseResult.lineCount,
    status: 'indexing',
  })

  // 创建符号和分块
  if (parseResult.symbols.length > 0) {
    batchCreateCodebaseSymbols({
      fileId: existing.id,
      symbols: parseResult.symbols.map(s => ({
        fileId: existing.id,
        name: s.name,
        qualifiedName: s.qualifiedName,
        symbolType: s.symbolType,
        visibility: s.visibility,
        signature: s.signature,
        startLine: s.startLine,
        endLine: s.endLine,
        docComment: s.docComment,
      })),
    })
  }

  if (parseResult.chunks.length > 0) {
    batchCreateCodebaseChunks({
      fileId: existing.id,
      chunks: parseResult.chunks.map(c => ({
        fileId: existing.id,
        content: c.content,
        chunkType: c.chunkType,
        symbolId: c.symbolId,
        startLine: c.startLine,
        endLine: c.endLine,
        tokenCount: c.tokenCount,
        chunkIndex: c.chunkIndex,
      })),
    })
  }

  updateCodebaseFile({
    id: existing.id,
    status: 'ready',
    symbolCount: parseResult.symbols.length,
    chunkCount: parseResult.chunks.length,
    indexedAt: Date.now(),
  })

  // 生成嵌入
  if (generateEmbeddings) {
    await generateCodebaseEmbeddings(null, 32)
  }
}
