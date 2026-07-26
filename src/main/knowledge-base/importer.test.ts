// AgentForge P4-02: 文档导入协调器测试

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

// ─── 静态读取 schema ─────────────────────────────────────────────
const __dirname_test = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(__dirname_test, '../db/schema.sql'), 'utf-8')

// ─── 测试用 DB 实例 ──────────────────────────────────────────────
let tempDir: string
let testDb: DatabaseType
let testFilesDir: string

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
  },
}))

vi.mock('../db/index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getSchemaVersion: vi.fn(() => 5),
}))

const { importDocument, reimportDocument, removeDocument } = await import('./importer')

const { getKbDocumentById, listKbDocuments } = await import('../db/repos/kb-document')
const { getKbChunksByDocumentId, countKbChunks } = await import('../db/repos/kb-chunk')

import { AppError, ErrorCodes } from '../utils/error'

describe('importer (P4-02)', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-importer-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)

    // 创建测试文件目录
    testFilesDir = join(tempDir, 'files')
    mkdtempSync(testFilesDir)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  /** 创建测试文件 */
  function createTestFile(fileName: string, content: string): string {
    const filePath = join(testFilesDir, fileName)
    writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  // ─── importDocument ───────────────────────────────────────────

  describe('importDocument', () => {
    it('should import a markdown file and create chunks', () => {
      const content = `# Test Document

This is the first paragraph with some content.

This is the second paragraph with more content to test chunking.

## Section 2

More text here for testing purposes.`

      const filePath = createTestFile('test.md', content)

      const result = importDocument(filePath, 'test.md', 'markdown')

      expect(result.documentId).toBeTruthy()
      expect(result.fileName).toBe('test.md')
      expect(result.status).toBe('ready')
      expect(result.chunkCount).toBeGreaterThan(0)
      expect(result.totalTokens).toBeGreaterThan(0)

      // 验证数据库状态
      const doc = getKbDocumentById(result.documentId)
      expect(doc.status).toBe('ready')
      expect(doc.chunkCount).toBe(result.chunkCount)

      const chunks = getKbChunksByDocumentId(result.documentId)
      expect(chunks).toHaveLength(result.chunkCount)
    })

    it('should import a txt file', () => {
      const content = 'Line 1\nLine 2\nLine 3'
      const filePath = createTestFile('test.txt', content)

      const result = importDocument(filePath, 'test.txt', 'txt')

      expect(result.status).toBe('ready')
      expect(result.chunkCount).toBeGreaterThan(0)
    })

    it('should import a csv file', () => {
      const content = 'name,age\nAlice,30\nBob,25'
      const filePath = createTestFile('test.csv', content)

      const result = importDocument(filePath, 'test.csv', 'csv')

      expect(result.status).toBe('ready')
      expect(result.chunkCount).toBeGreaterThan(0)
    })

    it('should handle empty file', () => {
      const filePath = createTestFile('empty.md', '')

      const result = importDocument(filePath, 'empty.md', 'markdown')

      expect(result.status).toBe('ready')
      expect(result.chunkCount).toBe(0)
      expect(result.totalTokens).toBe(0)
    })

    it('should handle large file with multiple chunks', () => {
      // 生成一个大文件（会被分成多个分块）
      const lines: string[] = []
      for (let i = 0; i < 200; i++) {
        lines.push(`Line ${i}: This is a test line with some content to make it longer.`)
      }
      const content = lines.join('\n')
      const filePath = createTestFile('large.md', content)

      const result = importDocument(filePath, 'large.md', 'markdown', {
        chunking: { strategy: 'fixed', chunkSize: 100, overlap: 10 },
      })

      expect(result.status).toBe('ready')
      expect(result.chunkCount).toBeGreaterThan(1)

      const chunks = getKbChunksByDocumentId(result.documentId)
      expect(chunks).toHaveLength(result.chunkCount)
    })

    it('should use paragraph strategy when specified', () => {
      const content = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3'
      const filePath = createTestFile('para.md', content)

      const result = importDocument(filePath, 'para.md', 'markdown', {
        chunking: { strategy: 'paragraph', chunkSize: 500 },
      })

      expect(result.status).toBe('ready')
      // 段落策略应该按空行分割
      expect(result.chunkCount).toBeGreaterThanOrEqual(1)
    })

    it('should mark document as error when file does not exist', () => {
      const filePath = join(testFilesDir, 'nonexistent.md')

      expect(() => importDocument(filePath, 'nonexistent.md', 'markdown')).toThrow(AppError)

      // 文档记录应该存在但状态为 error
      const docs = listKbDocuments()
      expect(docs).toHaveLength(1)
      expect(docs[0].status).toBe('error')
      expect(docs[0].errorMessage).toBeDefined()
    })

    it('should throw for unsupported file types like pdf', () => {
      const filePath = createTestFile('test.pdf', 'fake pdf content')

      expect(() => importDocument(filePath, 'test.pdf', 'pdf')).toThrow(AppError)
      try {
        importDocument(filePath, 'test.pdf', 'pdf')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_INDEX_ERROR)
      }
    })
  })

  // ─── reimportDocument ─────────────────────────────────────────

  describe('reimportDocument', () => {
    it('should reimport and update chunks', () => {
      const content = 'Original content\nMore original'
      const filePath = createTestFile('reimport.md', content)

      // 首次导入
      const firstResult = importDocument(filePath, 'reimport.md', 'markdown', {
        chunking: { strategy: 'fixed', chunkSize: 50, overlap: 5 },
      })
      const firstChunkCount = firstResult.chunkCount

      // 修改文件内容
      writeFileSync(filePath, 'Updated content with completely new text here.', 'utf-8')

      // 重新导入
      const secondResult = reimportDocument(firstResult.documentId, {
        chunking: { strategy: 'fixed', chunkSize: 50, overlap: 5 },
      })

      expect(secondResult.documentId).toBe(firstResult.documentId)
      expect(secondResult.status).toBe('ready')
      // 分块数量可能不同
      expect(secondResult.chunkCount).toBeGreaterThanOrEqual(1)

      // 验证数据库中的分块已更新
      const chunks = getKbChunksByDocumentId(firstResult.documentId)
      expect(chunks).toHaveLength(secondResult.chunkCount)
      // 新内容应该包含 "Updated"
      expect(chunks.some((c) => c.content.includes('Updated'))).toBe(true)
    })

    it('should throw for nonexistent document', () => {
      expect(() => reimportDocument('nonexistent')).toThrow(AppError)
    })
  })

  // ─── removeDocument ───────────────────────────────────────────

  describe('removeDocument', () => {
    it('should remove document and all chunks', () => {
      const content = 'Test content\nMore content'
      const filePath = createTestFile('remove.md', content)

      const result = importDocument(filePath, 'remove.md', 'markdown')
      const docId = result.documentId

      expect(countKbChunks(docId)).toBeGreaterThan(0)

      removeDocument(docId)

      // 文档和分块都应被删除
      expect(() => getKbDocumentById(docId)).toThrow(AppError)
      expect(countKbChunks(docId)).toBe(0)
    })
  })
})
