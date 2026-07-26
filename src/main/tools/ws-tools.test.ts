// AgentForge WS-06: ws_* Agent 工具单元测试
// 测试 7 个 ws_* 工具的 execute 函数
// Mock workspace IPC handlers，验证工具参数校验与调用行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkspaceDirectoryEntry, FileTreeNode } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const {
  mockHandleWsRead,
  mockHandleWsWrite,
  mockHandleWsList,
  mockHandleWsMkdir,
  mockHandleWsDelete,
  mockHandleWsRename,
  mockHandleWsTree,
} = vi.hoisted(() => ({
  mockHandleWsRead: vi.fn(),
  mockHandleWsWrite: vi.fn(),
  mockHandleWsList: vi.fn(),
  mockHandleWsMkdir: vi.fn(),
  mockHandleWsDelete: vi.fn(),
  mockHandleWsRename: vi.fn(),
  mockHandleWsTree: vi.fn(),
}))

vi.mock('../ipc/workspace', () => ({
  handleWsRead: (...args: unknown[]) => mockHandleWsRead(...args),
  handleWsWrite: (...args: unknown[]) => mockHandleWsWrite(...args),
  handleWsList: (...args: unknown[]) => mockHandleWsList(...args),
  handleWsMkdir: (...args: unknown[]) => mockHandleWsMkdir(...args),
  handleWsDelete: (...args: unknown[]) => mockHandleWsDelete(...args),
  handleWsRename: (...args: unknown[]) => mockHandleWsRename(...args),
  handleWsTree: (...args: unknown[]) => mockHandleWsTree(...args),
}))

// ─── Import after mocks ─────────────────────────────────────────

const {
  wsReadTool,
  wsWriteTool,
  wsListTool,
  wsMkdirTool,
  wsDeleteTool,
  wsRenameTool,
  wsFileTreeTool,
  allWsTools,
} = await import('./ws-tools')

// ─── Helpers ────────────────────────────────────────────────────

function makeDirEntry(name: string, isDir: boolean, size = 0): WorkspaceDirectoryEntry {
  return { name, isDirectory: isDir, size, modifiedAt: Date.now() }
}

function makeTreeNode(
  name: string,
  isDir: boolean,
  children: FileTreeNode[] | null = null,
): FileTreeNode {
  return {
    id: name,
    name,
    relativePath: name,
    isDirectory: isDir,
    size: 0,
    modifiedAt: Date.now(),
    children,
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ws_* Tools (WS-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── allWsTools ──────────────────────────────────────────────

  describe('allWsTools', () => {
    it('should export 7 tools', () => {
      expect(allWsTools).toHaveLength(7)
    })

    it('should have unique tool names', () => {
      const names = allWsTools.map((t) => t.definition.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(names.length)
    })

    it('should have correct tool names', () => {
      const names = allWsTools.map((t) => t.definition.name)
      expect(names).toEqual([
        'ws_read',
        'ws_write',
        'ws_list',
        'ws_mkdir',
        'ws_delete',
        'ws_rename',
        'ws_file_tree',
      ])
    })
  })

  // ─── ws_read ────────────────────────────────────────────────

  describe('ws_read', () => {
    it('should have correct definition', () => {
      expect(wsReadTool.definition.name).toBe('ws_read')
      expect(wsReadTool.definition.riskLevel).toBe('low')
      expect(wsReadTool.definition.source).toBe('builtin')
    })

    it('should read file and return content', async () => {
      mockHandleWsRead.mockResolvedValue('file content here')
      const result = await wsReadTool.execute({ path: 'test.txt' })
      expect(result.isError).toBe(false)
      expect(result.content).toBe('file content here')
      expect(result.metadata).toEqual({ path: 'test.txt' })
      expect(mockHandleWsRead).toHaveBeenCalledWith('test.txt')
    })

    it('should throw VALIDATION_ERROR for missing path', async () => {
      try {
        await wsReadTool.execute({})
        expect.fail('Expected AppError')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR for empty path', async () => {
      try {
        await wsReadTool.execute({ path: '' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR for non-string path', async () => {
      try {
        await wsReadTool.execute({ path: 123 })
        expect.fail('Expected AppError')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should propagate AppError from handler', async () => {
      mockHandleWsRead.mockRejectedValue(
        new AppError(ErrorCodes.FILE_NOT_FOUND, 'Not found', { path: 'missing.txt' }),
      )
      try {
        await wsReadTool.execute({ path: 'missing.txt' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.FILE_NOT_FOUND)
      }
    })
  })

  // ─── ws_write ───────────────────────────────────────────────

  describe('ws_write', () => {
    it('should have correct definition', () => {
      expect(wsWriteTool.definition.name).toBe('ws_write')
      expect(wsWriteTool.definition.riskLevel).toBe('medium')
    })

    it('should write file and return success', async () => {
      mockHandleWsWrite.mockResolvedValue(12)
      const result = await wsWriteTool.execute({ path: 'out.txt', content: 'test content' })
      expect(result.isError).toBe(false)
      expect(result.content).toContain('out.txt')
      expect(result.content).toContain('12 bytes')
      expect(result.metadata).toEqual({ path: 'out.txt', bytes: 12 })
      expect(mockHandleWsWrite).toHaveBeenCalledWith('out.txt', 'test content')
    })

    it('should throw VALIDATION_ERROR for missing path', async () => {
      try {
        await wsWriteTool.execute({ content: 'data' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR for missing content', async () => {
      try {
        await wsWriteTool.execute({ path: 'out.txt' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR for non-string content', async () => {
      try {
        await wsWriteTool.execute({ path: 'out.txt', content: 123 })
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })
  })

  // ─── ws_list ────────────────────────────────────────────────

  describe('ws_list', () => {
    it('should have correct definition', () => {
      expect(wsListTool.definition.name).toBe('ws_list')
      expect(wsListTool.definition.riskLevel).toBe('low')
    })

    it('should list directory and format output', async () => {
      const entries = [
        makeDirEntry('src', true),
        makeDirEntry('file.txt', false, 100),
      ]
      mockHandleWsList.mockResolvedValue(entries)
      const result = await wsListTool.execute({})
      expect(result.isError).toBe(false)
      expect(result.content).toContain('[DIR] src')
      expect(result.content).toContain('file.txt')
      expect(result.content).toContain('100 bytes')
      expect(mockHandleWsList).toHaveBeenCalledWith(undefined)
    })

    it('should use provided path', async () => {
      mockHandleWsList.mockResolvedValue([])
      await wsListTool.execute({ path: 'subdir' })
      expect(mockHandleWsList).toHaveBeenCalledWith('subdir')
    })

    it('should show empty directory message', async () => {
      mockHandleWsList.mockResolvedValue([])
      const result = await wsListTool.execute({})
      expect(result.content).toBe('(empty directory)')
    })

    it('should include metadata with entries and count', async () => {
      const entries = [makeDirEntry('a', true), makeDirEntry('b.txt', false, 10)]
      mockHandleWsList.mockResolvedValue(entries)
      const result = await wsListTool.execute({})
      expect(result.metadata).toEqual({ entries, count: 2 })
    })
  })

  // ─── ws_mkdir ───────────────────────────────────────────────

  describe('ws_mkdir', () => {
    it('should have correct definition', () => {
      expect(wsMkdirTool.definition.name).toBe('ws_mkdir')
      expect(wsMkdirTool.definition.riskLevel).toBe('low')
    })

    it('should create directory and return success', async () => {
      mockHandleWsMkdir.mockResolvedValue(undefined)
      const result = await wsMkdirTool.execute({ path: 'newdir' })
      expect(result.isError).toBe(false)
      expect(result.content).toBe('Directory created: newdir')
      expect(result.metadata).toEqual({ path: 'newdir' })
    })

    it('should throw VALIDATION_ERROR for missing path', async () => {
      try {
        await wsMkdirTool.execute({})
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })
  })

  // ─── ws_delete ──────────────────────────────────────────────

  describe('ws_delete', () => {
    it('should have correct definition', () => {
      expect(wsDeleteTool.definition.name).toBe('ws_delete')
      expect(wsDeleteTool.definition.riskLevel).toBe('medium')
    })

    it('should delete file and return success', async () => {
      mockHandleWsDelete.mockResolvedValue(undefined)
      const result = await wsDeleteTool.execute({ path: 'old.txt' })
      expect(result.isError).toBe(false)
      expect(result.content).toBe('Deleted: old.txt')
      expect(mockHandleWsDelete).toHaveBeenCalledWith('old.txt')
    })

    it('should throw VALIDATION_ERROR for missing path', async () => {
      try {
        await wsDeleteTool.execute({})
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should propagate DIRECTORY_NOT_EMPTY error', async () => {
      mockHandleWsDelete.mockRejectedValue(
        new AppError(ErrorCodes.DIRECTORY_NOT_EMPTY, 'Not empty', { path: 'dir' }),
      )
      try {
        await wsDeleteTool.execute({ path: 'dir' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.DIRECTORY_NOT_EMPTY)
      }
    })
  })

  // ─── ws_rename ──────────────────────────────────────────────

  describe('ws_rename', () => {
    it('should have correct definition', () => {
      expect(wsRenameTool.definition.name).toBe('ws_rename')
      expect(wsRenameTool.definition.riskLevel).toBe('medium')
    })

    it('should rename file and return success', async () => {
      mockHandleWsRename.mockResolvedValue(undefined)
      const result = await wsRenameTool.execute({ from: 'old.txt', to: 'new.txt' })
      expect(result.isError).toBe(false)
      expect(result.content).toBe('Renamed: old.txt → new.txt')
      expect(mockHandleWsRename).toHaveBeenCalledWith('old.txt', 'new.txt')
    })

    it('should throw VALIDATION_ERROR for missing from', async () => {
      try {
        await wsRenameTool.execute({ to: 'new.txt' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })

    it('should throw VALIDATION_ERROR for missing to', async () => {
      try {
        await wsRenameTool.execute({ from: 'old.txt' })
        expect.fail('Expected AppError')
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    })
  })

  // ─── ws_file_tree ───────────────────────────────────────────

  describe('ws_file_tree', () => {
    it('should have correct definition', () => {
      expect(wsFileTreeTool.definition.name).toBe('ws_file_tree')
      expect(wsFileTreeTool.definition.riskLevel).toBe('low')
    })

    it('should return tree as JSON', async () => {
      const tree = makeTreeNode('root', true, [
        makeTreeNode('file.txt', false),
        makeTreeNode('subdir', true, null),
      ])
      mockHandleWsTree.mockResolvedValue(tree)
      const result = await wsFileTreeTool.execute({})
      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.content)
      expect(parsed.name).toBe('root')
      expect(parsed.children).toHaveLength(2)
      expect(mockHandleWsTree).toHaveBeenCalledWith(undefined, undefined)
    })

    it('should pass path and maxDepth', async () => {
      mockHandleWsTree.mockResolvedValue(makeTreeNode('root', true))
      await wsFileTreeTool.execute({ path: 'subdir', maxDepth: 3 })
      expect(mockHandleWsTree).toHaveBeenCalledWith('subdir', 3)
    })

    it('should include tree in metadata', async () => {
      const tree = makeTreeNode('root', true)
      mockHandleWsTree.mockResolvedValue(tree)
      const result = await wsFileTreeTool.execute({})
      expect(result.metadata).toEqual({ tree })
    })
  })
})
