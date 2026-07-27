// AgentForge OPT-01: file_write 工具单元测试
// file_write 委托 workspace IPC handler (handleWsWrite) 执行实际写入，
// 路径边界校验由 path-guard 模块在 handler 内部统一完成。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppError } from '../utils/error'
import { fileWriteTool } from './file-write'

// ─── Mocks ───────────────────────────────────────────────────────

const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
}))

vi.mock('../db/repos/app-settings', () => ({
  getSettings: () => mockGetSettings(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

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
    mockGetSettings.mockReturnValue({
      workspace: { path: tempDir, excludePatterns: ['node_modules', '.git'] },
    })
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
      expect(fileWriteTool.definition.description).toBe(
        'Write content to a file in the workspace directory.',
      )
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
        fileWriteTool.execute({ path: 'x.txt', content: 123 }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when content is missing', async () => {
      await expectAppErrorAsync(fileWriteTool.execute({ path: 'x.txt' }), 'VALIDATION_ERROR')
    })

    it('should accept empty string content', async () => {
      const result = await fileWriteTool.execute({ path: 'empty.txt', content: '' })
      expect(result.isError).toBe(false)
      expect(readFileSync(join(tempDir, 'empty.txt'), 'utf-8')).toBe('')
    })

    it('should throw WORKSPACE_PATH_ESCAPE when path contains ".."', async () => {
      await expectAppErrorAsync(
        fileWriteTool.execute({ path: '../etc/passwd', content: 'x' }),
        'WORKSPACE_PATH_ESCAPE',
      )
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    it('should write content to a new file', async () => {
      const result = await fileWriteTool.execute({ path: 'new.txt', content: 'hello world' })

      expect(result.isError).toBe(false)
      expect(readFileSync(join(tempDir, 'new.txt'), 'utf-8')).toBe('hello world')
    })

    it('should overwrite existing file', async () => {
      writeFileSync(join(tempDir, 'existing.txt'), 'old content', 'utf-8')

      await fileWriteTool.execute({ path: 'existing.txt', content: 'new content' })

      expect(readFileSync(join(tempDir, 'existing.txt'), 'utf-8')).toBe('new content')
    })

    it('should auto-create parent directories', async () => {
      const result = await fileWriteTool.execute({ path: 'a/b/c/deep.txt', content: 'deep' })

      expect(result.isError).toBe(false)
      const absPath = join(tempDir, 'a', 'b', 'c', 'deep.txt')
      expect(existsSync(absPath)).toBe(true)
      expect(readFileSync(absPath, 'utf-8')).toBe('deep')
    })

    it('should write UTF-8 content with special characters', async () => {
      const text = '你好世界\n\t"quoted" & <tagged>'

      await fileWriteTool.execute({ path: 'unicode.txt', content: text })

      expect(readFileSync(join(tempDir, 'unicode.txt'), 'utf-8')).toBe(text)
    })

    it('should include path and bytes in metadata', async () => {
      const text = 'hello'

      const result = await fileWriteTool.execute({ path: 'meta.txt', content: text })

      expect(result.metadata).toMatchObject({
        path: 'meta.txt',
        bytes: Buffer.byteLength(text, 'utf-8'),
      })
    })

    it('should return success message in content', async () => {
      const text = 'hello'

      const result = await fileWriteTool.execute({ path: 'msg.txt', content: text })

      expect(result.content).toContain('Successfully wrote')
      expect(result.content).toContain('bytes')
      expect(result.content).toContain('msg.txt')
    })

    it('should write file at root of workspace (no subdirectory)', async () => {
      await fileWriteTool.execute({ path: 'root.txt', content: 'root' })

      expect(readFileSync(join(tempDir, 'root.txt'), 'utf-8')).toBe('root')
    })
  })

  // ─── execute: error cases ──────────────────────────────────

  describe('execute error cases', () => {
    it('should throw FILE_ACCESS_ERROR when parent is a file (cannot mkdir)', async () => {
      writeFileSync(join(tempDir, 'blocker'), 'im a file', 'utf-8')

      await expectAppErrorAsync(
        fileWriteTool.execute({ path: 'blocker/sub/file.txt', content: 'x' }),
        'FILE_ACCESS_ERROR',
      )
    })

    it('should update mtime after overwrite', async () => {
      await fileWriteTool.execute({ path: 'mtime.txt', content: 'first' })
      const before = statSync(join(tempDir, 'mtime.txt')).mtimeMs

      // 等待一小段时间确保时间戳变化
      await new Promise((resolve) => setTimeout(resolve, 20))
      await fileWriteTool.execute({ path: 'mtime.txt', content: 'second' })
      const after = statSync(join(tempDir, 'mtime.txt')).mtimeMs

      expect(after).toBeGreaterThanOrEqual(before)
    })
  })
})
