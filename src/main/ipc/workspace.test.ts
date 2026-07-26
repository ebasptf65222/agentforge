// AgentForge WS-06: Workspace IPC Handler 单元测试
// 测试 handleWsRead/Write/List/Mkdir/Delete/Rename/Tree
// 使用真实文件系统（临时目录）+ mock getSettings

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppSettings } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
}))

vi.mock('../db/repos/app-settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const {
  handleWsRead,
  handleWsWrite,
  handleWsList,
  handleWsMkdir,
  handleWsDelete,
  handleWsRename,
  handleWsTree,
  getWorkspacePath,
} = await import('./workspace')

// ─── Helpers ────────────────────────────────────────────────────

function makeSettings(wsPath: string | null): AppSettings {
  return {
    theme: 'dark',
    defaultApprovalMode: 'auto-edit',
    maxExecutionSteps: 20,
    defaultModelId: null,
    shortcuts: {
      newConversation: 'CmdOrCtrl+N',
      sendMessage: 'Enter',
      stopGeneration: 'CmdOrCtrl+.',
      toggleSidebar: 'CmdOrCtrl+B',
    },
    approvalTimeoutMs: 300000,
    voice: {
      tts: {
        enabled: false,
        provider: 'openai',
        baseUrl: '',
        apiKey: '',
        model: 'tts-1',
        voice: 'alloy',
        speed: 1.0,
        format: 'mp3',
        autoPlay: false,
      },
      stt: {
        enabled: false,
        provider: 'openai',
        baseUrl: '',
        apiKey: '',
        model: 'whisper-1',
        language: '',
        temperature: 0.0,
      },
      mode: {
        vadSilenceThreshold: 1.5,
        autoAwait: false,
      },
    },
    workspace: {
      path: wsPath,
      recentPaths: wsPath ? [wsPath] : [],
      autoRestore: false,
      excludePatterns: ['node_modules', '.git', 'dist', '.DS_Store'],
    },
    updatedAt: Date.now(),
  }
}

async function expectAppError(fn: () => unknown | Promise<unknown>, code: string): Promise<AppError> {
  try {
    await fn()
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return error as AppError
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Workspace IPC Handlers (WS-06)', () => {
  let workspaceDir: string
  let outsideDir: string

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'agentforge-ws-ipc-'))
    outsideDir = mkdtempSync(join(tmpdir(), 'agentforge-ws-out-'))

    // Create test files
    writeFileSync(join(workspaceDir, 'hello.txt'), 'Hello, World!')
    writeFileSync(join(workspaceDir, 'empty.txt'), '')
    mkdirSync(join(workspaceDir, 'subdir'))
    writeFileSync(join(workspaceDir, 'subdir', 'nested.txt'), 'nested content')
    mkdirSync(join(workspaceDir, 'emptydir'))
    mkdirSync(join(workspaceDir, 'node_modules'))
    writeFileSync(join(workspaceDir, 'node_modules', 'hidden.js'), 'hidden')

    mockGetSettings.mockReturnValue(makeSettings(workspaceDir))
  })

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  // ─── getWorkspacePath ────────────────────────────────────────

  describe('getWorkspacePath', () => {
    it('should return workspace path when set', () => {
      expect(getWorkspacePath()).toBe(workspaceDir)
    })

    it('should throw WORKSPACE_NOT_SET when path is null', async () => {
      mockGetSettings.mockReturnValue(makeSettings(null))
      await expectAppError(() => getWorkspacePath(), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_PATH_INVALID when path does not exist', async () => {
      mockGetSettings.mockReturnValue(makeSettings('/nonexistent/path/xyz'))
      await expectAppError(() => getWorkspacePath(), ErrorCodes.WORKSPACE_PATH_INVALID)
    })
  })

  // ─── handleWsRead ───────────────────────────────────────────

  describe('handleWsRead', () => {
    it('should read file content', async () => {
      const content = await handleWsRead('hello.txt')
      expect(content).toBe('Hello, World!')
    })

    it('should read nested file content', async () => {
      const content = await handleWsRead('subdir/nested.txt')
      expect(content).toBe('nested content')
    })

    it('should read empty file', async () => {
      const content = await handleWsRead('empty.txt')
      expect(content).toBe('')
    })

    it('should throw VALIDATION_ERROR for empty path', async () => {
      await expectAppError(async () => handleWsRead(''), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR for non-string path', async () => {
      await expectAppError(async () => handleWsRead(123 as unknown as string), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw FILE_NOT_FOUND for non-existent file', async () => {
      await expectAppError(async () => handleWsRead('nonexistent.txt'), ErrorCodes.FILE_NOT_FOUND)
    })

    it('should throw FILE_ACCESS_ERROR when path is a directory', async () => {
      await expectAppError(async () => handleWsRead('subdir'), ErrorCodes.FILE_ACCESS_ERROR)
    })

    it('should throw FILE_TOO_LARGE for files exceeding 1MB', async () => {
      const largeContent = 'x'.repeat(1024 * 1024 + 1)
      writeFileSync(join(workspaceDir, 'large.txt'), largeContent)
      await expectAppError(async () => handleWsRead('large.txt'), ErrorCodes.FILE_TOO_LARGE)
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path traversal', async () => {
      await expectAppError(async () => handleWsRead('../../../etc/passwd'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should throw WORKSPACE_PATH_ESCAPE for absolute path', async () => {
      await expectAppError(async () => handleWsRead('/etc/passwd'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })
  })

  // ─── handleWsWrite ──────────────────────────────────────────

  describe('handleWsWrite', () => {
    it('should write file content', async () => {
      const bytes = await handleWsWrite('output.txt', 'test content')
      expect(bytes).toBe('test content'.length)
      expect(existsSync(join(workspaceDir, 'output.txt'))).toBe(true)
    })

    it('should overwrite existing file', async () => {
      await handleWsWrite('hello.txt', 'overwritten')
      const content = await handleWsRead('hello.txt')
      expect(content).toBe('overwritten')
    })

    it('should auto-create parent directories', async () => {
      await handleWsWrite('newdir/subdir/file.txt', 'deep')
      expect(existsSync(join(workspaceDir, 'newdir', 'subdir', 'file.txt'))).toBe(true)
    })

    it('should throw VALIDATION_ERROR for empty path', async () => {
      await expectAppError(async () => handleWsWrite('', 'content'), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR for non-string content', async () => {
      await expectAppError(
        async () => handleWsWrite('test.txt', 123 as unknown as string),
        ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path traversal', async () => {
      await expectAppError(
        async () => handleWsWrite('../../../evil.txt', 'content'),
        ErrorCodes.WORKSPACE_PATH_ESCAPE,
      )
    })
  })

  // ─── handleWsList ───────────────────────────────────────────

  describe('handleWsList', () => {
    it('should list root directory contents', async () => {
      const entries = await handleWsList()
      expect(entries.length).toBeGreaterThan(0)
      const names = entries.map((e) => e.name)
      expect(names).toContain('hello.txt')
      expect(names).toContain('subdir')
      expect(names).toContain('emptydir')
    })

    it('should list subdirectory contents', async () => {
      const entries = await handleWsList('subdir')
      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('nested.txt')
      expect(entries[0].isDirectory).toBe(false)
    })

    it('should list empty directory', async () => {
      const entries = await handleWsList('emptydir')
      expect(entries).toHaveLength(0)
    })

    it('should sort directories first', async () => {
      const entries = await handleWsList()
      const firstDirIdx = entries.findIndex((e) => e.isDirectory)
      const lastFileIdx = entries.length - 1 - [...entries].reverse().findIndex((e) => !e.isDirectory)
      if (firstDirIdx !== -1 && lastFileIdx !== -1) {
        expect(firstDirIdx).toBeLessThanOrEqual(lastFileIdx)
      }
    })

    it('should include file size and modifiedAt', async () => {
      const entries = await handleWsList('subdir')
      expect(entries[0].size).toBe('nested content'.length)
      expect(entries[0].modifiedAt).toBeGreaterThan(0)
    })

    it('should throw FILE_NOT_FOUND for non-existent directory', async () => {
      await expectAppError(async () => handleWsList('nonexistent'), ErrorCodes.FILE_NOT_FOUND)
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path traversal', async () => {
      await expectAppError(async () => handleWsList('../../../'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })
  })

  // ─── handleWsMkdir ──────────────────────────────────────────

  describe('handleWsMkdir', () => {
    it('should create a directory', async () => {
      await handleWsMkdir('newdir')
      expect(existsSync(join(workspaceDir, 'newdir'))).toBe(true)
    })

    it('should create nested directories recursively', async () => {
      await handleWsMkdir('a/b/c')
      expect(existsSync(join(workspaceDir, 'a', 'b', 'c'))).toBe(true)
    })

    it('should not throw if directory already exists', async () => {
      await handleWsMkdir('existing')
      await expect(handleWsMkdir('existing')).resolves.toBeUndefined()
    })

    it('should throw VALIDATION_ERROR for empty path', async () => {
      await expectAppError(async () => handleWsMkdir(''), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path traversal', async () => {
      await expectAppError(async () => handleWsMkdir('../../../evil'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })
  })

  // ─── handleWsDelete ─────────────────────────────────────────

  describe('handleWsDelete', () => {
    it('should delete a file', async () => {
      await handleWsDelete('hello.txt')
      expect(existsSync(join(workspaceDir, 'hello.txt'))).toBe(false)
    })

    it('should delete an empty directory', async () => {
      await handleWsDelete('emptydir')
      expect(existsSync(join(workspaceDir, 'emptydir'))).toBe(false)
    })

    it('should throw DIRECTORY_NOT_EMPTY for non-empty directory', async () => {
      await expectAppError(async () => handleWsDelete('subdir'), ErrorCodes.DIRECTORY_NOT_EMPTY)
    })

    it('should throw FILE_NOT_FOUND for non-existent path', async () => {
      await expectAppError(async () => handleWsDelete('nonexistent.txt'), ErrorCodes.FILE_NOT_FOUND)
    })

    it('should throw VALIDATION_ERROR for empty path', async () => {
      await expectAppError(async () => handleWsDelete(''), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path traversal', async () => {
      await expectAppError(async () => handleWsDelete('../../../'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })
  })

  // ─── handleWsRename ─────────────────────────────────────────

  describe('handleWsRename', () => {
    it('should rename a file', async () => {
      await handleWsRename('hello.txt', 'renamed.txt')
      expect(existsSync(join(workspaceDir, 'renamed.txt'))).toBe(true)
      expect(existsSync(join(workspaceDir, 'hello.txt'))).toBe(false)
    })

    it('should move a file to subdirectory', async () => {
      await handleWsRename('hello.txt', 'subdir/moved.txt')
      expect(existsSync(join(workspaceDir, 'subdir', 'moved.txt'))).toBe(true)
      expect(existsSync(join(workspaceDir, 'hello.txt'))).toBe(false)
    })

    it('should rename a directory', async () => {
      await handleWsRename('subdir', 'renamed-dir')
      expect(existsSync(join(workspaceDir, 'renamed-dir'))).toBe(true)
      expect(existsSync(join(workspaceDir, 'subdir'))).toBe(false)
    })

    it('should throw VALIDATION_ERROR for empty source path', async () => {
      await expectAppError(async () => handleWsRename('', 'target.txt'), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw VALIDATION_ERROR for empty target path', async () => {
      await expectAppError(async () => handleWsRename('hello.txt', ''), ErrorCodes.VALIDATION_ERROR)
    })

    it('should throw FILE_NOT_FOUND for non-existent source', async () => {
      await expectAppError(async () => handleWsRename('nonexistent.txt', 'target.txt'), ErrorCodes.FILE_NOT_FOUND)
    })

    it('should throw WORKSPACE_PATH_ESCAPE when target escapes workspace', async () => {
      await expectAppError(
        async () => handleWsRename('hello.txt', '../../../evil.txt'),
        ErrorCodes.WORKSPACE_PATH_ESCAPE,
      )
    })
  })

  // ─── handleWsTree ───────────────────────────────────────────

  describe('handleWsTree', () => {
    it('should return root node with children', async () => {
      const tree = await handleWsTree()
      expect(tree.isDirectory).toBe(true)
      expect(tree.children).not.toBeNull()
      expect(tree.children!.length).toBeGreaterThan(0)
    })

    it('should exclude node_modules from tree', async () => {
      const tree = await handleWsTree()
      const names = tree.children!.map((c) => c.name)
      expect(names).not.toContain('node_modules')
    })

    it('should include file and directory info', async () => {
      const tree = await handleWsTree()
      const helloNode = tree.children!.find((c) => c.name === 'hello.txt')
      expect(helloNode).toBeDefined()
      expect(helloNode!.isDirectory).toBe(false)
      expect(helloNode!.size).toBe('Hello, World!'.length)
    })

    it('should respect maxDepth parameter', async () => {
      // depth 1 means root + 1 level of children
      const tree = await handleWsTree(undefined, 1)
      const subdir = tree.children!.find((c) => c.name === 'subdir')
      // At depth 1, subdir's children should be null (not loaded)
      expect(subdir!.children).toBeNull()
    })

    it('should load children at depth 2', async () => {
      const tree = await handleWsTree(undefined, 2)
      const subdir = tree.children!.find((c) => c.name === 'subdir')
      expect(subdir!.children).not.toBeNull()
      expect(subdir!.children!.length).toBe(1)
      expect(subdir!.children![0].name).toBe('nested.txt')
    })

    it('should cap maxDepth at 5', async () => {
      const tree = await handleWsTree(undefined, 100)
      // Should not throw, depth is capped internally
      expect(tree).toBeDefined()
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path traversal', async () => {
      await expectAppError(async () => handleWsTree('../../../'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })
  })

  // ─── Path Security Penetration Tests ────────────────────────

  describe('Path Security Penetration Tests', () => {
    it('should reject ../ traversal in read', async () => {
      await expectAppError(async () => handleWsRead('../secret.txt'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should reject ../../ traversal in read', async () => {
      await expectAppError(async () => handleWsRead('../../secret.txt'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should reject absolute path in read', async () => {
      await expectAppError(async () => handleWsRead('/etc/passwd'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should reject absolute path in write', async () => {
      await expectAppError(
        async () => handleWsWrite('/tmp/evil.txt', 'content'),
        ErrorCodes.WORKSPACE_PATH_ESCAPE,
      )
    })

    it('should reject absolute path in mkdir', async () => {
      await expectAppError(async () => handleWsMkdir('/tmp/evil'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should reject absolute path in delete', async () => {
      await expectAppError(async () => handleWsDelete('/tmp/evil'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should reject absolute path in rename source', async () => {
      await expectAppError(
        async () => handleWsRename('/etc/passwd', 'stolen.txt'),
        ErrorCodes.WORKSPACE_PATH_ESCAPE,
      )
    })

    it('should reject absolute path in rename target', async () => {
      await expectAppError(
        async () => handleWsRename('hello.txt', '/tmp/stolen.txt'),
        ErrorCodes.WORKSPACE_PATH_ESCAPE,
      )
    })

    it('should reject symlink escape in read', async () => {
      // Create a symlink inside workspace pointing outside
      const symlinkPath = join(workspaceDir, 'evil-link.txt')
      const outsideFile = join(outsideDir, 'secret.txt')
      writeFileSync(outsideFile, 'secret data')
      symlinkSync(outsideFile, symlinkPath)

      await expectAppError(async () => handleWsRead('evil-link.txt'), ErrorCodes.WORKSPACE_PATH_ESCAPE)
    })

    it('should reject symlink escape in write', async () => {
      const symlinkPath = join(workspaceDir, 'evil-write-link.txt')
      const outsideFile = join(outsideDir, 'target.txt')
      writeFileSync(outsideFile, 'original')
      symlinkSync(outsideFile, symlinkPath)

      await expectAppError(
        async () => handleWsWrite('evil-write-link.txt', 'malicious'),
        ErrorCodes.WORKSPACE_PATH_ESCAPE,
      )
    })
  })

  // ─── Workspace Not Set Edge Cases ───────────────────────────

  describe('Workspace Not Set Edge Cases', () => {
    beforeEach(() => {
      mockGetSettings.mockReturnValue(makeSettings(null))
    })

    it('should throw WORKSPACE_NOT_SET for read', async () => {
      await expectAppError(async () => handleWsRead('test.txt'), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_NOT_SET for write', async () => {
      await expectAppError(async () => handleWsWrite('test.txt', 'content'), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_NOT_SET for list', async () => {
      await expectAppError(async () => handleWsList(), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_NOT_SET for mkdir', async () => {
      await expectAppError(async () => handleWsMkdir('test'), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_NOT_SET for delete', async () => {
      await expectAppError(async () => handleWsDelete('test'), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_NOT_SET for rename', async () => {
      await expectAppError(async () => handleWsRename('a', 'b'), ErrorCodes.WORKSPACE_NOT_SET)
    })

    it('should throw WORKSPACE_NOT_SET for tree', async () => {
      await expectAppError(async () => handleWsTree(), ErrorCodes.WORKSPACE_NOT_SET)
    })
  })
})
