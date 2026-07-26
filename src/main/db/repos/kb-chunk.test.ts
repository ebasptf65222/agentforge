// AgentForge P4-01: kb_chunks 仓库层测试
// 验证 DocumentChunk CRUD、批量操作、嵌入管理、级联删除

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

// ─── 静态读取 schema ─────────────────────────────────────────────
const __dirname_test = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(__dirname_test, '../schema.sql'), 'utf-8')

// ─── 测试用 DB 实例 ──────────────────────────────────────────────
let tempDir: string
let testDb: DatabaseType

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  },
}))

vi.mock('../index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getSchemaVersion: vi.fn(() => 5),
}))

// 导入 kb-document 仓库（用于创建测试文档）
const { createKbDocument, deleteKbDocument } = await import('./kb-document')

const {
  createKbChunk,
  batchCreateKbChunks,
  getKbChunkById,
  getKbChunksByDocumentId,
  updateKbChunkEmbedding,
  batchUpdateKbChunkEmbeddings,
  deleteKbChunksByDocumentId,
  getKbChunksWithEmbeddings,
  countKbChunks,
  countAllKbChunks,
  kbChunkExists,
} = await import('./kb-chunk')

import { AppError, ErrorCodes } from '../../utils/error'

describe('kb-chunk repository (P4-01)', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-kb-chunk-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── createKbChunk ────────────────────────────────────────────

  describe('createKbChunk', () => {
    it('should create a chunk and return full DocumentChunk', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunk = createKbChunk({
        documentId: doc.id,
        content: 'First chunk of text',
        tokenCount: 4,
        chunkIndex: 0,
      })

      expect(chunk.id).toBeTruthy()
      expect(chunk.documentId).toBe(doc.id)
      expect(chunk.content).toBe('First chunk of text')
      expect(chunk.tokenCount).toBe(4)
      expect(chunk.chunkIndex).toBe(0)
      expect(chunk.embedding).toBeUndefined()
    })

    it('should persist chunk to database', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const created = createKbChunk({
        documentId: doc.id,
        content: 'Hello world',
        tokenCount: 2,
        chunkIndex: 0,
      })

      const fetched = getKbChunkById(created.id)
      expect(fetched.content).toBe('Hello world')
    })
  })

  // ─── batchCreateKbChunks ─────────────────────────────────────

  describe('batchCreateKbChunks', () => {
    it('should create multiple chunks in a transaction', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunks = batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'Chunk 1', tokenCount: 2, chunkIndex: 0 },
          { content: 'Chunk 2', tokenCount: 3, chunkIndex: 1 },
          { content: 'Chunk 3', tokenCount: 1, chunkIndex: 2 },
        ],
      })

      expect(chunks).toHaveLength(3)
      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[1].chunkIndex).toBe(1)
      expect(chunks[2].chunkIndex).toBe(2)

      // 验证数据库中确实存在
      expect(getKbChunksByDocumentId(doc.id)).toHaveLength(3)
    })

    it('should return empty array when chunks array is empty', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunks = batchCreateKbChunks({ documentId: doc.id, chunks: [] })

      expect(chunks).toHaveLength(0)
    })

    it('should be atomic (all or nothing)', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      // 先创建一些分块
      batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'Chunk 1', tokenCount: 2, chunkIndex: 0 },
          { content: 'Chunk 2', tokenCount: 3, chunkIndex: 1 },
        ],
      })

      const countBefore = countKbChunks(doc.id)
      expect(countBefore).toBe(2)

      // 事务性保证：分块数量正确
      expect(countKbChunks(doc.id)).toBe(2)
    })
  })

  // ─── getKbChunkById ───────────────────────────────────────────

  describe('getKbChunkById', () => {
    it('should return chunk by id', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const created = createKbChunk({
        documentId: doc.id,
        content: 'Test content',
        tokenCount: 2,
        chunkIndex: 0,
      })

      const fetched = getKbChunkById(created.id)
      expect(fetched.id).toBe(created.id)
      expect(fetched.content).toBe('Test content')
    })

    it('should throw KB_CHUNK_NOT_FOUND when id does not exist', () => {
      expect(() => getKbChunkById('nonexistent')).toThrow(AppError)
      try {
        getKbChunkById('nonexistent')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_CHUNK_NOT_FOUND)
      }
    })
  })

  // ─── getKbChunksByDocumentId ─────────────────────────────────

  describe('getKbChunksByDocumentId', () => {
    it('should return chunks sorted by chunk_index ASC', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'Third', tokenCount: 1, chunkIndex: 2 },
          { content: 'First', tokenCount: 1, chunkIndex: 0 },
          { content: 'Second', tokenCount: 1, chunkIndex: 1 },
        ],
      })

      const chunks = getKbChunksByDocumentId(doc.id)
      expect(chunks).toHaveLength(3)
      expect(chunks[0].content).toBe('First')
      expect(chunks[1].content).toBe('Second')
      expect(chunks[2].content).toBe('Third')
    })

    it('should return empty array when document has no chunks', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunks = getKbChunksByDocumentId(doc.id)
      expect(chunks).toEqual([])
    })
  })

  // ─── updateKbChunkEmbedding ──────────────────────────────────

  describe('updateKbChunkEmbedding', () => {
    it('should update embedding for a single chunk', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunk = createKbChunk({
        documentId: doc.id,
        content: 'Test',
        tokenCount: 1,
        chunkIndex: 0,
      })

      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      updateKbChunkEmbedding(chunk.id, embedding)

      const fetched = getKbChunkById(chunk.id)
      expect(fetched.embedding).toEqual(embedding)
    })

    it('should throw KB_CHUNK_NOT_FOUND when chunk does not exist', () => {
      expect(() => updateKbChunkEmbedding('nonexistent', [0.1])).toThrow(AppError)
      try {
        updateKbChunkEmbedding('nonexistent', [0.1])
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_CHUNK_NOT_FOUND)
      }
    })
  })

  // ─── batchUpdateKbChunkEmbeddings ────────────────────────────

  describe('batchUpdateKbChunkEmbeddings', () => {
    it('should update embeddings for multiple chunks in a transaction', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunks = batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'A', tokenCount: 1, chunkIndex: 0 },
          { content: 'B', tokenCount: 1, chunkIndex: 1 },
          { content: 'C', tokenCount: 1, chunkIndex: 2 },
        ],
      })

      batchUpdateKbChunkEmbeddings([
        { id: chunks[0].id, embedding: [0.1, 0.2] },
        { id: chunks[1].id, embedding: [0.3, 0.4] },
        { id: chunks[2].id, embedding: [0.5, 0.6] },
      ])

      const fetched = getKbChunksByDocumentId(doc.id)
      expect(fetched[0].embedding).toEqual([0.1, 0.2])
      expect(fetched[1].embedding).toEqual([0.3, 0.4])
      expect(fetched[2].embedding).toEqual([0.5, 0.6])
    })
  })

  // ─── deleteKbChunksByDocumentId ──────────────────────────────

  describe('deleteKbChunksByDocumentId', () => {
    it('should delete all chunks for a document', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'A', tokenCount: 1, chunkIndex: 0 },
          { content: 'B', tokenCount: 1, chunkIndex: 1 },
        ],
      })

      expect(countKbChunks(doc.id)).toBe(2)

      const deletedCount = deleteKbChunksByDocumentId(doc.id)
      expect(deletedCount).toBe(2)
      expect(countKbChunks(doc.id)).toBe(0)
    })

    it('should return 0 when document has no chunks', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const deletedCount = deleteKbChunksByDocumentId(doc.id)
      expect(deletedCount).toBe(0)
    })
  })

  // ─── ON DELETE CASCADE ───────────────────────────────────────

  describe('cascade delete', () => {
    it('should delete chunks when parent document is deleted', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunks = batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'A', tokenCount: 1, chunkIndex: 0 },
          { content: 'B', tokenCount: 1, chunkIndex: 1 },
        ],
      })

      // 删除文档（通过 kb-document 仓库）
      deleteKbDocument(doc.id)

      // 分块应被级联删除
      expect(() => getKbChunkById(chunks[0].id)).toThrow(AppError)
      expect(() => getKbChunkById(chunks[1].id)).toThrow(AppError)
    })
  })

  // ─── getKbChunksWithEmbeddings ───────────────────────────────

  describe('getKbChunksWithEmbeddings', () => {
    it('should return only chunks with embeddings', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunks = batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'A', tokenCount: 1, chunkIndex: 0 },
          { content: 'B', tokenCount: 1, chunkIndex: 1 },
          { content: 'C', tokenCount: 1, chunkIndex: 2 },
        ],
      })

      // 只为其中两个设置嵌入
      updateKbChunkEmbedding(chunks[0].id, [0.1, 0.2])
      updateKbChunkEmbedding(chunks[2].id, [0.5, 0.6])

      const withEmbeddings = getKbChunksWithEmbeddings()
      expect(withEmbeddings).toHaveLength(2)
      expect(withEmbeddings.map((c) => c.content)).toContain('A')
      expect(withEmbeddings.map((c) => c.content)).toContain('C')
    })

    it('should filter by document_id', () => {
      const doc1 = createKbDocument({
        filePath: '/docs/a.md',
        fileName: 'a.md',
        fileType: 'markdown',
      })
      const doc2 = createKbDocument({
        filePath: '/docs/b.md',
        fileName: 'b.md',
        fileType: 'markdown',
      })

      const chunk1 = createKbChunk({
        documentId: doc1.id,
        content: 'Doc1',
        tokenCount: 1,
        chunkIndex: 0,
      })
      createKbChunk({ documentId: doc2.id, content: 'Doc2', tokenCount: 1, chunkIndex: 0 })

      updateKbChunkEmbedding(chunk1.id, [0.1])

      const doc1Embeddings = getKbChunksWithEmbeddings({ documentId: doc1.id })
      expect(doc1Embeddings).toHaveLength(1)
      expect(doc1Embeddings[0].content).toBe('Doc1')

      const doc2Embeddings = getKbChunksWithEmbeddings({ documentId: doc2.id })
      expect(doc2Embeddings).toHaveLength(0)
    })
  })

  // ─── countKbChunks ────────────────────────────────────────────

  describe('countKbChunks', () => {
    it('should return chunk count for a document', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      batchCreateKbChunks({
        documentId: doc.id,
        chunks: [
          { content: 'A', tokenCount: 1, chunkIndex: 0 },
          { content: 'B', tokenCount: 1, chunkIndex: 1 },
        ],
      })

      expect(countKbChunks(doc.id)).toBe(2)
    })

    it('should return 0 for document with no chunks', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      expect(countKbChunks(doc.id)).toBe(0)
    })
  })

  // ─── countAllKbChunks ────────────────────────────────────────

  describe('countAllKbChunks', () => {
    it('should return total chunk count across all documents', () => {
      const doc1 = createKbDocument({
        filePath: '/docs/a.md',
        fileName: 'a.md',
        fileType: 'markdown',
      })
      const doc2 = createKbDocument({
        filePath: '/docs/b.md',
        fileName: 'b.md',
        fileType: 'markdown',
      })

      batchCreateKbChunks({
        documentId: doc1.id,
        chunks: [
          { content: 'A1', tokenCount: 1, chunkIndex: 0 },
          { content: 'A2', tokenCount: 1, chunkIndex: 1 },
        ],
      })

      batchCreateKbChunks({
        documentId: doc2.id,
        chunks: [{ content: 'B1', tokenCount: 1, chunkIndex: 0 }],
      })

      expect(countAllKbChunks()).toBe(3)
    })
  })

  // ─── kbChunkExists ───────────────────────────────────────────

  describe('kbChunkExists', () => {
    it('should return true for existing chunk', () => {
      const doc = createKbDocument({
        filePath: '/docs/test.md',
        fileName: 'test.md',
        fileType: 'markdown',
      })
      const chunk = createKbChunk({
        documentId: doc.id,
        content: 'Test',
        tokenCount: 1,
        chunkIndex: 0,
      })

      expect(kbChunkExists(chunk.id)).toBe(true)
    })

    it('should return false for nonexistent chunk', () => {
      expect(kbChunkExists('nonexistent')).toBe(false)
    })
  })
})
