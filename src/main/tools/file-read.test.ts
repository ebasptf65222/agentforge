// AgentForge OPT-01: file_read 工具单元测试
// file_read 委托 workspace IPC handler (handleWsRead) 执行实际读取，
// 路径边界校验由 path-guard 模块在 handler 内部统一完成。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppError } from '../utils/error'
import { fileReadTool } from './file-read'

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

describe('file_read tool', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-file-read-test-'))
    mockGetSettings.mockReturnValue({
      workspace: { path: tempDir, excludePatterns: ['node_modules', '.git'] },
    })
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
      expect(fileReadTool.definition.description).toBe(
        'Read text file content from the workspace directory.',
      )
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

    it('should throw WORKSPACE_PATH_ESCAPE when path contains ".."', async () => {
      await expectAppErrorAsync(
        fileReadTool.execute({ path: '../etc/passwd' }),
        'WORKSPACE_PATH_ESCAPE',
      )
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    it('should read file content as UTF-8', async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello world\n你好', 'utf-8')

      const result = await fileReadTool.execute({ path: 'test.txt' })

      expect(result.isError).toBe(false)
      expect(result.content).toBe('hello world\n你好')
    })

    it('should include path in metadata', async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello world', 'utf-8')

      const result = await fileReadTool.execute({ path: 'test.txt' })

      expect(result.metadata).toMatchObject({ path: 'test.txt' })
    })

    it('should read empty file', async () => {
      writeFileSync(join(tempDir, 'empty.txt'), '', 'utf-8')

      const result = await fileReadTool.execute({ path: 'empty.txt' })

      expect(result.isError).toBe(false)
      expect(result.content).toBe('')
    })

    it('should read file with special characters', async () => {
      const text = 'line1\n\tline2\n"quoted" & <tagged>'
      writeFileSync(join(tempDir, 'special.txt'), text, 'utf-8')

      const result = await fileReadTool.execute({ path: 'special.txt' })

      expect(result.content).toBe(text)
    })
  })

  // ─── execute: error cases ──────────────────────────────────

  describe('execute error cases', () => {
    it('should throw FILE_NOT_FOUND when file does not exist', async () => {
      await expectAppErrorAsync(fileReadTool.execute({ path: 'nonexistent.txt' }), 'FILE_NOT_FOUND')
    })

    it('should throw FILE_ACCESS_ERROR when path is a directory', async () => {
      mkdirSync(join(tempDir, 'subdir'))

      await expectAppErrorAsync(fileReadTool.execute({ path: 'subdir' }), 'FILE_ACCESS_ERROR')
    })

    it('should throw FILE_TOO_LARGE when file exceeds 1MB', async () => {
      // 1MB + 1 byte
      const big = Buffer.alloc(1024 * 1024 + 1, 'x')
      writeFileSync(join(tempDir, 'large.txt'), big)

      await expectAppErrorAsync(fileReadTool.execute({ path: 'large.txt' }), 'FILE_TOO_LARGE')
    })

    it('should accept file exactly at 1MB limit', async () => {
      const exact = Buffer.alloc(1024 * 1024, 'a')
      writeFileSync(join(tempDir, 'exactly-1mb.txt'), exact)

      const result = await fileReadTool.execute({ path: 'exactly-1mb.txt' })

      expect(result.isError).toBe(false)
      expect(result.metadata).toMatchObject({ path: 'exactly-1mb.txt' })
    })
  })
})
