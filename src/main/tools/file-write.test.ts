// AgentForge P2-05: file_write 工具单元测试
// 使用临时目录验证文件写入、目录自动创建与路径安全

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppError } from '../utils/error'
import { fileWriteTool, isPathSafe } from './file-write'

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

describe('file_write tool', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-file-write-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── 工具定义 ────────────────────────────────────────────────

  describe('definition', () => {
    it('should have name="file_write"', () => {
      expect(fileWriteTool.definition.name).toBe('file_write')
    })

    it('should have a description', () => {
      expect(fileWriteTool.definition.description).toBe('Write content to a file')
    })

    it('should have riskLevel="medium"', () => {
      expect(fileWriteTool.definition.riskLevel).toBe('medium')
    })

    it('should have source="builtin"', () => {
      expect(fileWriteTool.definition.source).toBe('builtin')
    })

    it('should have path and content in inputSchema', () => {
      expect(fileWriteTool.definition.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      })
    })

    it('should expose an execute function', () => {
      expect(typeof fileWriteTool.execute).toBe('function')
    })
  })

  // ─── isPathSafe ────────────────────────────────────────────

  describe('isPathSafe', () => {
    it('should return true for normal paths', () => {
      expect(isPathSafe('/tmp/file.txt')).toBe(true)
      expect(isPathSafe('relative/path/file.txt')).toBe(true)
    })

    it('should return false for paths containing ".."', () => {
      expect(isPathSafe('../etc/passwd')).toBe(false)
      expect(isPathSafe('/tmp/../etc/passwd')).toBe(false)
    })
  })

  // ─── execute: validation ───────────────────────────────────

  describe('execute validation', () => {
    it('should throw VALIDATION_ERROR when path is empty', async () => {
      await expectAppErrorAsync(
        fileWriteTool.execute({ path: '', content: 'x' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when path is whitespace only', async () => {
      await expectAppErrorAsync(
        fileWriteTool.execute({ path: '   ', content: 'x' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when path is not a string', async () => {
      await expectAppErrorAsync(
        fileWriteTool.execute({ path: 123, content: 'x' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when path is missing', async () => {
      await expectAppErrorAsync(fileWriteTool.execute({ content: 'x' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when content is not a string', async () => {
      await expectAppErrorAsync(
        fileWriteTool.execute({ path: '/tmp/x', content: 123 }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when content is missing', async () => {
      await expectAppErrorAsync(fileWriteTool.execute({ path: '/tmp/x' }), 'VALIDATION_ERROR')
    })

    it('should accept empty string content', async () => {
      const filePath = join(tempDir, 'empty.txt')
      const result = await fileWriteTool.execute({ path: filePath, content: '' })
      expect(result.isError).toBe(false)
      expect(readFileSync(filePath, 'utf-8')).toBe('')
    })

    it('should throw FILE_ACCESS_ERROR when path contains ".."', async () => {
      await expectAppErrorAsync(
        fileWriteTool.execute({ path: '../etc/passwd', content: 'x' }),
        'FILE_ACCESS_ERROR',
      )
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    it('should write content to a new file', async () => {
      const filePath = join(tempDir, 'new.txt')

      const result = await fileWriteTool.execute({ path: filePath, content: 'hello world' })

      expect(result.isError).toBe(false)
      expect(readFileSync(filePath, 'utf-8')).toBe('hello world')
    })

    it('should overwrite existing file', async () => {
      const filePath = join(tempDir, 'existing.txt')
      writeFileSync(filePath, 'old content', 'utf-8')

      await fileWriteTool.execute({ path: filePath, content: 'new content' })

      expect(readFileSync(filePath, 'utf-8')).toBe('new content')
    })

    it('should auto-create parent directories', async () => {
      const filePath = join(tempDir, 'a', 'b', 'c', 'deep.txt')

      const result = await fileWriteTool.execute({ path: filePath, content: 'deep' })

      expect(result.isError).toBe(false)
      expect(existsSync(filePath)).toBe(true)
      expect(readFileSync(filePath, 'utf-8')).toBe('deep')
    })

    it('should write UTF-8 content with special characters', async () => {
      const filePath = join(tempDir, 'unicode.txt')
      const text = '你好世界\n\t"quoted" & <tagged>'

      await fileWriteTool.execute({ path: filePath, content: text })

      expect(readFileSync(filePath, 'utf-8')).toBe(text)
    })

    it('should include path and bytes in metadata', async () => {
      const filePath = join(tempDir, 'meta.txt')
      const text = 'hello'

      const result = await fileWriteTool.execute({ path: filePath, content: text })

      expect(result.metadata).toMatchObject({
        path: filePath,
        bytes: text.length,
      })
    })

    it('should return success message in content', async () => {
      const filePath = join(tempDir, 'msg.txt')
      const text = 'hello'

      const result = await fileWriteTool.execute({ path: filePath, content: text })

      expect(result.content).toContain('Successfully wrote')
      expect(result.content).toContain(String(text.length))
      expect(result.content).toContain(filePath)
    })

    it('should write file at root of temp dir (no subdirectory)', async () => {
      const filePath = join(tempDir, 'root.txt')

      await fileWriteTool.execute({ path: filePath, content: 'root' })

      expect(readFileSync(filePath, 'utf-8')).toBe('root')
    })
  })

  // ─── execute: error cases ──────────────────────────────────

  describe('execute error cases', () => {
    it('should throw FILE_ACCESS_ERROR when parent is a file (cannot mkdir)', async () => {
      const blockerPath = join(tempDir, 'blocker')
      writeFileSync(blockerPath, 'im a file', 'utf-8')
      const filePath = join(blockerPath, 'sub', 'file.txt')

      await expectAppErrorAsync(
        fileWriteTool.execute({ path: filePath, content: 'x' }),
        'FILE_ACCESS_ERROR',
      )
    })

    it('should update mtime after overwrite', async () => {
      const filePath = join(tempDir, 'mtime.txt')
      await fileWriteTool.execute({ path: filePath, content: 'first' })
      const before = statSync(filePath).mtimeMs

      // 等待一小段时间确保时间戳变化
      await new Promise((resolve) => setTimeout(resolve, 20))
      await fileWriteTool.execute({ path: filePath, content: 'second' })
      const after = statSync(filePath).mtimeMs

      expect(after).toBeGreaterThanOrEqual(before)
    })
  })
})
