// AgentForge P2-05: file_read 工具单元测试
// 使用临时目录验证文件读取与路径安全

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppError } from '../utils/error'
import { fileReadTool, isPathSafe } from './file-read'

// ─── Helpers ─────────────────────────────────────────────────────

async function expectAppErrorAsync(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('file_read tool', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-file-read-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── 工具定义 ────────────────────────────────────────────────

  describe('definition', () => {
    it('should have name="file_read"', () => {
      expect(fileReadTool.definition.name).toBe('file_read')
    })

    it('should have a description', () => {
      expect(fileReadTool.definition.description).toBe('Read text file content')
    })

    it('should have riskLevel="low"', () => {
      expect(fileReadTool.definition.riskLevel).toBe('low')
    })

    it('should have source="builtin"', () => {
      expect(fileReadTool.definition.source).toBe('builtin')
    })

    it('should have path in inputSchema', () => {
      expect(fileReadTool.definition.inputSchema).toMatchObject({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      })
    })

    it('should expose an execute function', () => {
      expect(typeof fileReadTool.execute).toBe('function')
    })
  })

  // ─── isPathSafe ────────────────────────────────────────────

  describe('isPathSafe', () => {
    it('should return true for normal paths', () => {
      expect(isPathSafe('/tmp/file.txt')).toBe(true)
      expect(isPathSafe('relative/path/file.txt')).toBe(true)
      expect(isPathSafe('./file.txt')).toBe(true)
    })

    it('should return false for paths containing ".."', () => {
      expect(isPathSafe('../etc/passwd')).toBe(false)
      expect(isPathSafe('/tmp/../etc/passwd')).toBe(false)
      expect(isPathSafe('a/../../b')).toBe(false)
    })
  })

  // ─── execute: validation ───────────────────────────────────

  describe('execute validation', () => {
    it('should throw VALIDATION_ERROR when path is empty', async () => {
      await expectAppErrorAsync(fileReadTool.execute({ path: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when path is whitespace only', async () => {
      await expectAppErrorAsync(fileReadTool.execute({ path: '   ' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when path is not a string', async () => {
      await expectAppErrorAsync(fileReadTool.execute({ path: 123 }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when path is missing', async () => {
      await expectAppErrorAsync(fileReadTool.execute({}), 'VALIDATION_ERROR')
    })

    it('should throw FILE_ACCESS_ERROR when path contains ".."', async () => {
      await expectAppErrorAsync(
        fileReadTool.execute({ path: '../etc/passwd' }),
        'FILE_ACCESS_ERROR',
      )
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    it('should read file content as UTF-8', async () => {
      const filePath = join(tempDir, 'test.txt')
      writeFileSync(filePath, 'hello world\n你好', 'utf-8')

      const result = await fileReadTool.execute({ path: filePath })

      expect(result.isError).toBe(false)
      expect(result.content).toBe('hello world\n你好')
    })

    it('should include path and size in metadata', async () => {
      const filePath = join(tempDir, 'test.txt')
      const text = 'hello world'
      writeFileSync(filePath, text, 'utf-8')

      const result = await fileReadTool.execute({ path: filePath })

      expect(result.metadata).toMatchObject({
        path: filePath,
        size: Buffer.byteLength(text, 'utf-8'),
      })
    })

    it('should read empty file', async () => {
      const filePath = join(tempDir, 'empty.txt')
      writeFileSync(filePath, '', 'utf-8')

      const result = await fileReadTool.execute({ path: filePath })

      expect(result.isError).toBe(false)
      expect(result.content).toBe('')
    })

    it('should read file with special characters', async () => {
      const filePath = join(tempDir, 'special.txt')
      const text = 'line1\n\tline2\n"quoted" & <tagged>'
      writeFileSync(filePath, text, 'utf-8')

      const result = await fileReadTool.execute({ path: filePath })

      expect(result.content).toBe(text)
    })
  })

  // ─── execute: error cases ──────────────────────────────────

  describe('execute error cases', () => {
    it('should throw FILE_NOT_FOUND when file does not exist', async () => {
      const filePath = join(tempDir, 'nonexistent.txt')

      await expectAppErrorAsync(fileReadTool.execute({ path: filePath }), 'FILE_NOT_FOUND')
    })

    it('should throw FILE_ACCESS_ERROR when path is a directory', async () => {
      const dirPath = join(tempDir, 'subdir')
      mkdirSync(dirPath)

      await expectAppErrorAsync(fileReadTool.execute({ path: dirPath }), 'FILE_ACCESS_ERROR')
    })

    it('should throw FILE_TOO_LARGE when file exceeds 1MB', async () => {
      const filePath = join(tempDir, 'large.txt')
      // 1MB + 1 byte
      const big = Buffer.alloc(1024 * 1024 + 1, 'x')
      writeFileSync(filePath, big)

      await expectAppErrorAsync(fileReadTool.execute({ path: filePath }), 'FILE_TOO_LARGE')
    })

    it('should accept file exactly at 1MB limit', async () => {
      const filePath = join(tempDir, 'exactly-1mb.txt')
      const exact = Buffer.alloc(1024 * 1024, 'a')
      writeFileSync(filePath, exact)

      const result = await fileReadTool.execute({ path: filePath })

      expect(result.isError).toBe(false)
    })
  })
})
