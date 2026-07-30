// AgentForge 共享类型定义 - 知识库类型
// 与 Spec v0.2 §5.7 一致

// ─── 5.7 知识库类型 ──────────────────────────────────────────────

/** 文档记录 */
export interface KbDocument {
  id: string
  filePath: string
  fileName: string
  fileType: 'pdf' | 'markdown' | 'txt' | 'docx' | 'xlsx' | 'csv'
  chunkCount: number
  status: 'indexing' | 'ready' | 'error'
  errorMessage?: string
  /** 内容 SHA-256 哈希（用于快速去重） */
  contentHash?: string
  createdAt: number
  updatedAt: number
}

/** 文档分块 */
export interface DocumentChunk {
  id: string
  documentId: string
  content: string
  tokenCount: number
  chunkIndex: number
  embedding?: number[]
}

/** 检索结果 */
export interface SearchResult {
  chunkId: string
  documentId: string
  fileName: string
  content: string
  score: number
  chunkIndex: number
}

/** 索引进度事件 */
export interface KbIndexProgress {
  documentId: string
  stage: 'parsing' | 'chunking' | 'embedding' | 'storing' | 'completed' | 'error'
  current: number
  total: number
  message?: string
}

/** 分块策略选项 */
export interface ChunkingOptions {
  /** 分块策略 */
  strategy: 'fixed' | 'paragraph'
  /** 目标分块大小（token 数），默认 500 */
  chunkSize?: number
  /** 分块重叠大小（token 数），默认 50 */
  overlap?: number
  /** 最大分块大小（硬限制），默认 chunkSize * 1.5 */
  maxChunkSize?: number
}

/** 导入结果 */
export interface ImportResult {
  documentId: string
  fileName: string
  status: KbDocument['status']
  chunkCount: number
  totalTokens: number
}

/** 知识库统计信息 */
export interface KbStats {
  totalDocs: number
  readyDocs: number
  errorDocs: number
  indexingDocs: number
  totalChunks: number
  embeddedChunks: number
  pendingEmbeddings: number
}
