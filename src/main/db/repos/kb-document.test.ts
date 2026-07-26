// AgentForge P4-01: kb_documents 仓库层测试
// 验证 KbDocument CRUD、过滤、统计功能

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

const {
  createKbDocument,
  getKbDocumentById,
  getKbDocumentByPath,
  listKbDocuments,
  updateKbDocument,
  deleteKbDocument,
  kbDocumentExists,
  countKbDocuments,
} = await import('./kb-document')

import { AppError, ErrorCodes } from '../../utils/error'

/** 创建测试用文档参数 */
function makeCreateParams(
  overrides: Partial<Parameters<typeof createKbDocument>[0]> = {},
): Parameters<typeof createKbDocument>[0] {
  return {
    filePath: '/docs/test.md',
    fileName: 'test.md',
    fileType: 'markdown',
    ...overrides,
  }
}

describe('kb-document repository (P4-01)', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-kb-doc-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── createKbDocument ──────────────────────────────────────────

  describe('createKbDocument', () => {
    it('should create a document and return full KbDocument', () => {
      const created = createKbDocument(makeCreateParams())

      expect(created.id).toBeTruthy()
      expect(created.filePath).toBe('/docs/test.md')
      expect(created.fileName).toBe('test.md')
      expect(created.fileType).toBe('markdown')
      expect(created.chunkCount).toBe(0)
      expect(created.status).toBe('indexing')
      expect(created.errorMessage).toBeUndefined()
      expect(created.createdAt).toBeGreaterThan(0)
      expect(created.updatedAt).toBeGreaterThan(0)
    })

    it('should support all valid file types', () => {
      const types: Array<Parameters<typeof createKbDocument>[0]['fileType']> = [
        'pdf',
        'markdown',
        'txt',
        'docx',
        'xlsx',
        'csv',
      ]
      for (const fileType of types) {
        const created = createKbDocument(
          makeCreateParams({ filePath: `/docs/${fileType}`, fileType }),
        )
        expect(created.fileType).toBe(fileType)
      }
    })

    it('should throw KB_INVALID_FILE_TYPE for invalid type', () => {
      expect(() => createKbDocument(makeCreateParams({ fileType: 'html' as never }))).toThrow(
        AppError,
      )
      try {
        createKbDocument(makeCreateParams({ fileType: 'html' as never }))
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_INVALID_FILE_TYPE)
      }
    })

    it('should throw KB_DOCUMENT_DUPLICATE when file_path already exists', () => {
      createKbDocument(makeCreateParams())

      expect(() => createKbDocument(makeCreateParams())).toThrow(AppError)
      try {
        createKbDocument(makeCreateParams())
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_DOCUMENT_DUPLICATE)
      }
    })

    it('should persist document to database (queryable by id)', () => {
      const created = createKbDocument(makeCreateParams())
      const fetched = getKbDocumentById(created.id)

      expect(fetched.filePath).toBe(created.filePath)
      expect(fetched.fileName).toBe(created.fileName)
    })
  })

  // ─── getKbDocumentById ────────────────────────────────────────

  describe('getKbDocumentById', () => {
    it('should return document by id', () => {
      const created = createKbDocument(makeCreateParams())
      const fetched = getKbDocumentById(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.fileName).toBe('test.md')
    })

    it('should throw KB_DOCUMENT_NOT_FOUND when id does not exist', () => {
      expect(() => getKbDocumentById('nonexistent')).toThrow(AppError)
      try {
        getKbDocumentById('nonexistent')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_DOCUMENT_NOT_FOUND)
      }
    })
  })

  // ─── getKbDocumentByPath ──────────────────────────────────────

  describe('getKbDocumentByPath', () => {
    it('should return document by file_path', () => {
      createKbDocument(makeCreateParams())
      const fetched = getKbDocumentByPath('/docs/test.md')

      expect(fetched).toBeDefined()
      expect(fetched?.filePath).toBe('/docs/test.md')
    })

    it('should return undefined when path does not exist', () => {
      const fetched = getKbDocumentByPath('/nonexistent/path.md')
      expect(fetched).toBeUndefined()
    })
  })

  // ─── listKbDocuments ──────────────────────────────────────────

  describe('listKbDocuments', () => {
    it('should return all documents sorted by updated_at DESC', () => {
      const d1 = createKbDocument(makeCreateParams({ filePath: '/docs/a.md', fileName: 'a.md' }))
      createKbDocument(makeCreateParams({ filePath: '/docs/b.md', fileName: 'b.md' }))
      createKbDocument(makeCreateParams({ filePath: '/docs/c.md', fileName: 'c.md' }))

      // 更新 d1 的 updated_at
      updateKbDocument({ id: d1.id, status: 'ready' })

      const list = listKbDocuments()

      // 按 updated_at DESC，d1 应该在最前面
      expect(list).toHaveLength(3)
      expect(list[0].id).toBe(d1.id)
    })

    it('should filter by status', () => {
      const d1 = createKbDocument(makeCreateParams({ filePath: '/docs/a.md' }))
      createKbDocument(makeCreateParams({ filePath: '/docs/b.md' }))
      createKbDocument(makeCreateParams({ filePath: '/docs/c.md' }))

      updateKbDocument({ id: d1.id, status: 'ready' })

      const readyList = listKbDocuments({ status: 'ready' })
      expect(readyList).toHaveLength(1)
      expect(readyList[0].status).toBe('ready')

      const indexingList = listKbDocuments({ status: 'indexing' })
      expect(indexingList).toHaveLength(2)
    })

    it('should return empty array when no documents exist', () => {
      const list = listKbDocuments()
      expect(list).toEqual([])
    })
  })

  // ─── updateKbDocument ─────────────────────────────────────────

  describe('updateKbDocument', () => {
    it('should update status', () => {
      const created = createKbDocument(makeCreateParams())
      updateKbDocument({ id: created.id, status: 'ready' })

      const fetched = getKbDocumentById(created.id)
      expect(fetched.status).toBe('ready')
    })

    it('should update error_message', () => {
      const created = createKbDocument(makeCreateParams())
      updateKbDocument({ id: created.id, status: 'error', errorMessage: 'Parse failed' })

      const fetched = getKbDocumentById(created.id)
      expect(fetched.status).toBe('error')
      expect(fetched.errorMessage).toBe('Parse failed')
    })

    it('should clear error_message with null', () => {
      const created = createKbDocument(makeCreateParams())
      updateKbDocument({ id: created.id, status: 'error', errorMessage: 'Parse failed' })

      updateKbDocument({ id: created.id, status: 'ready', errorMessage: null })

      const fetched = getKbDocumentById(created.id)
      expect(fetched.errorMessage).toBeUndefined()
    })

    it('should update chunk_count', () => {
      const created = createKbDocument(makeCreateParams())
      updateKbDocument({ id: created.id, chunkCount: 12 })

      const fetched = getKbDocumentById(created.id)
      expect(fetched.chunkCount).toBe(12)
    })

    it('should update updated_at timestamp', async () => {
      const created = createKbDocument(makeCreateParams())
      const originalUpdatedAt = created.updatedAt

      await new Promise((r) => setTimeout(r, 5))
      updateKbDocument({ id: created.id, status: 'ready' })

      const fetched = getKbDocumentById(created.id)
      expect(fetched.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('should throw KB_DOCUMENT_NOT_FOUND when updating nonexistent document', () => {
      expect(() => updateKbDocument({ id: 'nonexistent', status: 'ready' })).toThrow(AppError)
      try {
        updateKbDocument({ id: 'nonexistent', status: 'ready' })
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_DOCUMENT_NOT_FOUND)
      }
    })

    it('should throw VALIDATION_ERROR for invalid status', () => {
      const created = createKbDocument(makeCreateParams())
      expect(() => updateKbDocument({ id: created.id, status: 'invalid' as never })).toThrow(
        AppError,
      )
    })
  })

  // ─── deleteKbDocument ─────────────────────────────────────────

  describe('deleteKbDocument', () => {
    it('should delete document by id', () => {
      const created = createKbDocument(makeCreateParams())
      deleteKbDocument(created.id)

      expect(() => getKbDocumentById(created.id)).toThrow(AppError)
    })

    it('should throw KB_DOCUMENT_NOT_FOUND when deleting nonexistent document', () => {
      expect(() => deleteKbDocument('nonexistent')).toThrow(AppError)
      try {
        deleteKbDocument('nonexistent')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.KB_DOCUMENT_NOT_FOUND)
      }
    })
  })

  // ─── kbDocumentExists ─────────────────────────────────────────

  describe('kbDocumentExists', () => {
    it('should return true for existing document', () => {
      const created = createKbDocument(makeCreateParams())
      expect(kbDocumentExists(created.id)).toBe(true)
    })

    it('should return false for nonexistent document', () => {
      expect(kbDocumentExists('nonexistent')).toBe(false)
    })
  })

  // ─── countKbDocuments ─────────────────────────────────────────

  describe('countKbDocuments', () => {
    it('should return total document count', () => {
      createKbDocument(makeCreateParams({ filePath: '/docs/a.md' }))
      createKbDocument(makeCreateParams({ filePath: '/docs/b.md' }))

      expect(countKbDocuments()).toBe(2)
    })

    it('should return count filtered by status', () => {
      const d1 = createKbDocument(makeCreateParams({ filePath: '/docs/a.md' }))
      createKbDocument(makeCreateParams({ filePath: '/docs/b.md' }))

      updateKbDocument({ id: d1.id, status: 'ready' })

      expect(countKbDocuments({ status: 'ready' })).toBe(1)
      expect(countKbDocuments({ status: 'indexing' })).toBe(1)
      expect(countKbDocuments()).toBe(2)
    })
  })
})
