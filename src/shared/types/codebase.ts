// AgentForge 共享类型定义 - 代码库索引类型 (CB)
// 与 Spec v0.2 §5.7.1 一致

import type {
  CodebaseFileStatus,
  CodebaseLanguage,
  SymbolType,
  SymbolVisibility,
  CodeChunkType,
} from './enums'

// ─── 5.7.1 代码库索引类型 (CB) ────────────────────────────────

/** 代码库文件记录 */
export interface CodebaseFile {
  id: string
  filePath: string
  fileName: string
  language: CodebaseLanguage
  fileHash: string
  lineCount: number
  symbolCount: number
  chunkCount: number
  status: CodebaseFileStatus
  errorMessage?: string
  indexedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 代码符号 */
export interface CodebaseSymbol {
  id: string
  fileId: string
  name: string
  qualifiedName: string
  symbolType: SymbolType
  visibility: SymbolVisibility
  signature?: string
  startLine: number
  endLine: number
  docComment?: string
  createdAt: number
}

/** 代码分块 */
export interface CodebaseChunk {
  id: string
  fileId: string
  content: string
  chunkType: CodeChunkType
  symbolId?: string
  startLine: number
  endLine: number
  tokenCount: number
  chunkIndex: number
  embedding?: number[]
}

/** 代码库搜索结果 */
export interface CodebaseSearchResult {
  chunkId: string
  fileId: string
  filePath: string
  fileName: string
  language: CodebaseLanguage
  content: string
  chunkType: CodeChunkType
  startLine: number
  endLine: number
  score: number
}

/** 代码库索引进度事件 */
export interface CodebaseIndexProgress {
  stage: 'scanning' | 'parsing' | 'embedding' | 'completed' | 'error'
  current: number
  total: number
  currentFile?: string
  message?: string
}

/** 代码库统计信息 */
export interface CodebaseStats {
  totalFiles: number
  readyFiles: number
  errorFiles: number
  pendingFiles: number
  totalSymbols: number
  totalChunks: number
  embeddedChunks: number
  pendingEmbeddings: number
  languages: Array<{ language: CodebaseLanguage; fileCount: number }>
}
