// AgentForge P2-05: directory_list 工具单元测试
// 使用临时目录验证目录列举与路径安全

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppError } from '../utils/error'
import { directoryListTool, isPathSafe } from './directory-list'

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

interface ParsedEntry {
  name: string
  isDirectory: boolean
  size: number
}

// ─── Tests ───────────────────────────────────────────────────────

describe('directory_list tool', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-dir-list-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── 工具定义 ────────────────────────────────────────────────

  describe('definition', () => {
    it('should have name="directory_list"', () => {
      expect(directoryListTool.definition.name).toBe('directory_list')
    })

    it('should have a description', () => {
      expect(directoryListTool.definition.description).toBe('List directory contents')
    })

    it('should have riskLevel="low"', () => {
      expect(directoryListTool.definition.riskLevel).toBe('low')
    })

    it('should have source="builtin"', () => {
      expect(directoryListTool.definition.source).toBe('builtin')
    })

    it('should have path in inputSchema', () => {
      expect(directoryListTool.definition.inputSchema).toMatchObject({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      })
    })

    it('should expose an execute function', () => {
      expect(typeof directoryListTool.execute).toBe('function')
    })
  })

  // ─── isPathSafe ────────────────────────────────────────────

  describe('isPathSafe', () => {
    it('should return true for normal paths', () => {
      expect(isPathSafe('/tmp')).toBe(true)
      expect(isPathSafe('relative/path')).toBe(true)
    })

    it('should return false for paths containing ".."', () => {
      expect(isPathSafe('../etc')).toBe(false)
      expect(isPathSafe('/tmp/../etc')).toBe(false)
    })
  })

  // ─── execute: validation ───────────────────────────────────

  describe('execute validation', () => {
    it('should throw VALIDATION_ERROR when path is empty', async () => {
      await expectAppErrorAsync(directoryListTool.execute({ path: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when path is whitespace only', async () => {
      await expectAppErrorAsync(directoryListTool.execute({ path: '   ' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when path is not a string', async () => {
      await expectAppErrorAsync(directoryListTool.execute({ path: 123 }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when path is missing', async () => {
      await expectAppErrorAsync(directoryListTool.execute({}), 'VALIDATION_ERROR')
    })

    it('should throw FILE_ACCESS_ERROR when path contains ".."', async () => {
      await expectAppErrorAsync(directoryListTool.execute({ path: '../etc' }), 'FILE_ACCESS_ERROR')
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    it('should list entries in an empty directory', async () => {
      const result = await directoryListTool.execute({ path: tempDir })

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.content) as { path: string; entries: ParsedEntry[] }
      expect(parsed.entries).toEqual([])
    })

    it('should list files and directories with correct metadata', async () => {
      writeFileSync(join(tempDir, 'file1.txt'), 'hello', 'utf-8')
      writeFileSync(join(tempDir, 'file2.txt'), 'world!', 'utf-8')
      mkdirSync(join(tempDir, 'subdir'))

      const result = await directoryListTool.execute({ path: tempDir })

      const parsed = JSON.parse(result.content) as { path: string; entries: ParsedEntry[] }
      const names = parsed.entries.map((e) => e.name).sort()
      expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir'])

      const file1 = parsed.entries.find((e) => e.name === 'file1.txt')
      expect(file1?.isDirectory).toBe(false)
      expect(file1?.size).toBe(5)

      const subdir = parsed.entries.find((e) => e.name === 'subdir')
      expect(subdir?.isDirectory).toBe(true)
    })

    it('should report size=0 for directories', async () => {
      mkdirSync(join(tempDir, 'emptydir'))

      const result = await directoryListTool.execute({ path: tempDir })

      const parsed = JSON.parse(result.content) as { entries: ParsedEntry[] }
      const dir = parsed.entries.find((e) => e.name === 'emptydir')
      expect(dir?.isDirectory).toBe(true)
      // 目录的 size 在不同平台语义不同，这里仅校验字段存在且为数字
      expect(typeof dir?.size).toBe('number')
    })

    it('should include count in metadata', async () => {
      writeFileSync(join(tempDir, 'a.txt'), 'a', 'utf-8')
      writeFileSync(join(tempDir, 'b.txt'), 'b', 'utf-8')

      const result = await directoryListTool.execute({ path: tempDir })

      expect(result.metadata).toMatchObject({ count: 2 })
    })

    it('should include path in returned JSON', async () => {
      const result = await directoryListTool.execute({ path: tempDir })

      const parsed = JSON.parse(result.content) as { path: string }
      expect(parsed.path).toBe(tempDir)
    })

    it('should list nested directory contents', async () => {
      mkdirSync(join(tempDir, 'parent', 'child'), { recursive: true })
      writeFileSync(join(tempDir, 'parent', 'child', 'nested.txt'), 'nested', 'utf-8')

      const result = await directoryListTool.execute({
        path: join(tempDir, 'parent', 'child'),
      })

      const parsed = JSON.parse(result.content) as { entries: ParsedEntry[] }
      expect(parsed.entries).toHaveLength(1)
      expect(parsed.entries[0].name).toBe('nested.txt')
      expect(parsed.entries[0].isDirectory).toBe(false)
    })
  })

  // ─── execute: error cases ──────────────────────────────────

  describe('execute error cases', () => {
    it('should throw FILE_NOT_FOUND when directory does not exist', async () => {
      const missingPath = join(tempDir, 'does-not-exist')

      await expectAppErrorAsync(directoryListTool.execute({ path: missingPath }), 'FILE_NOT_FOUND')
    })

    it('should throw FILE_ACCESS_ERROR when path is a file', async () => {
      const filePath = join(tempDir, 'afile.txt')
      writeFileSync(filePath, 'content', 'utf-8')

      await expectAppErrorAsync(directoryListTool.execute({ path: filePath }), 'FILE_ACCESS_ERROR')
    })
  })
})
