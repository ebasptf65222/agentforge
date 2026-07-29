// AgentForge WS-02: path-guard 路径安全校验模块单元测试
// 测试 isPathInWorkspace 和 resolveWorkspacePath 的路径安全行为
// 使用真实文件系统（临时目录）确保 realpath 和符号链接行为准确

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { isPathInWorkspace, resolveWorkspacePath } from './path-guard'
import { AppError, ErrorCodes } from '../utils/error'

describe('path-guard', () => {
  let workspaceDir: string
  let outsideDir: string

  beforeEach(() => {
    // 创建临时工作区目录
    workspaceDir = mkdtempSync(join(tmpdir(), 'agentforge-ws-test-'))
    // 创建工作区外部目录（用于逃逸测试）
    outsideDir = mkdtempSync(join(tmpdir(), 'agentforge-outside-test-'))

    // 在工作区内创建一些测试文件和目录
    mkdirSync(join(workspaceDir, 'subdir'))
    writeFileSync(join(workspaceDir, 'test.txt'), 'hello')
    writeFileSync(join(workspaceDir, 'subdir', 'nested.txt'), 'nested')
  })

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  })

  // ─── isPathInWorkspace ────────────────────────────────────────

  describe('isPathInWorkspace', () => {
    it('should return true for a path inside workspace', () => {
      const testPath = join(workspaceDir, 'test.txt')
      expect(isPathInWorkspace(workspaceDir, testPath)).toBe(true)
    })

    it('should return true for workspace root itself', () => {
      expect(isPathInWorkspace(workspaceDir, workspaceDir)).toBe(true)
    })

    it('should return true for a nested path inside workspace', () => {
      const nestedPath = join(workspaceDir, 'subdir', 'nested.txt')
      expect(isPathInWorkspace(workspaceDir, nestedPath)).toBe(true)
    })

    it('should return false for a path outside workspace', () => {
      const outsidePath = join(outsideDir, 'outside.txt')
      writeFileSync(outsidePath, 'outside')
      expect(isPathInWorkspace(workspaceDir, outsidePath)).toBe(false)
    })

    it('should reject path traversal via ..', () => {
      // workspaceDir/subdir/../../outsideDir → should escape
      const escapePath = join(workspaceDir, 'subdir', '..', '..', outsideDir)
      expect(isPathInWorkspace(workspaceDir, escapePath)).toBe(false)
    })

    it('should reject path traversal to parent directory', () => {
      const escapePath = join(workspaceDir, '..')
      expect(isPathInWorkspace(workspaceDir, escapePath)).toBe(false)
    })

    it('should reject path that looks like workspace but is a sibling', () => {
      // Create a directory with a name that starts with workspaceDir name
      const siblingName = workspaceDir + '-sibling'
      mkdirSync(siblingName)
      expect(isPathInWorkspace(workspaceDir, siblingName)).toBe(false)
      rmSync(siblingName, { recursive: true, force: true })
    })

    it('should return false for empty workspace path', () => {
      expect(isPathInWorkspace('', '/some/path')).toBe(false)
    })

    it('should return false for empty resolved path', () => {
      expect(isPathInWorkspace(workspaceDir, '')).toBe(false)
    })

    it('should return false for null-like workspace path', () => {
      expect(isPathInWorkspace('/nonexistent/path', '/some/path')).toBe(false)
    })

    it('should return false when workspace does not exist', () => {
      expect(isPathInWorkspace('/nonexistent/workspace', '/some/path')).toBe(false)
    })

    it('should return false when realpath of workspace fails', () => {
      // Use a path that exists but can't be realpath'd (deleted between check and realpath)
      // This is hard to test directly, but we can test with a non-existent path
      expect(isPathInWorkspace('/nonexistent/workspace', '/some/path')).toBe(false)
    })

    // ─── 符号链接测试 ─────────────────────────────────────────

    it('should reject symlink that points outside workspace', () => {
      // Create a symlink inside workspace that points outside
      const symlinkPath = join(workspaceDir, 'evil-link')
      const targetOutside = join(outsideDir, 'secret.txt')
      writeFileSync(targetOutside, 'secret')

      // Check if symlinks are supported on this system
      let symlinkSupported = true
      try {
        symlinkSync(targetOutside, symlinkPath)
      } catch {
        symlinkSupported = false
      }

      if (!symlinkSupported) {
        // Skip test on systems without symlink support (e.g., Windows without admin rights)
        return
      }

      expect(isPathInWorkspace(workspaceDir, symlinkPath)).toBe(false)
    })

    it('should accept symlink that points inside workspace', () => {
      // Create a symlink inside workspace that points to another file inside workspace
      const symlinkPath = join(workspaceDir, 'good-link')
      const targetInside = join(workspaceDir, 'test.txt')

      // Check if symlinks are supported on this system
      let symlinkSupported = true
      try {
        symlinkSync(targetInside, symlinkPath)
      } catch {
        symlinkSupported = false
      }

      if (!symlinkSupported) {
        // Skip test on systems without symlink support (e.g., Windows without admin rights)
        return
      }

      expect(isPathInWorkspace(workspaceDir, symlinkPath)).toBe(true)
    })

    it('should accept path for a new file that does not exist yet', () => {
      // When writing a new file, the path doesn't exist yet
      // isPathInWorkspace should still return true if the parent is within workspace
      const newPath = join(workspaceDir, 'new-file.txt')
      expect(isPathInWorkspace(workspaceDir, newPath)).toBe(true)
    })

    it('should accept path for a new file in a nested directory', () => {
      const newPath = join(workspaceDir, 'subdir', 'new-file.txt')
      expect(isPathInWorkspace(workspaceDir, newPath)).toBe(true)
    })

    it('should reject path for a new file outside workspace via ..', () => {
      const newPath = join(workspaceDir, '..', 'new-file.txt')
      expect(isPathInWorkspace(workspaceDir, newPath)).toBe(false)
    })
  })

  // ─── resolveWorkspacePath ─────────────────────────────────────

  describe('resolveWorkspacePath', () => {
    it('should resolve a relative path to absolute path within workspace', () => {
      const result = resolveWorkspacePath(workspaceDir, 'test.txt')
      expect(result).toBe(join(workspaceDir, 'test.txt'))
    })

    it('should resolve a nested relative path', () => {
      const result = resolveWorkspacePath(workspaceDir, join('subdir', 'nested.txt'))
      expect(result).toBe(join(workspaceDir, 'subdir', 'nested.txt'))
    })

    it('should resolve root path (.) to workspace root', () => {
      const result = resolveWorkspacePath(workspaceDir, '.')
      expect(result).toBe(workspaceDir)
    })

    it('should resolve empty relative path to workspace root', () => {
      const result = resolveWorkspacePath(workspaceDir, '')
      expect(result).toBe(workspaceDir)
    })

    it('should resolve a new file path that does not exist yet', () => {
      const result = resolveWorkspacePath(workspaceDir, 'new-file.txt')
      expect(result).toBe(join(workspaceDir, 'new-file.txt'))
    })

    it('should throw WORKSPACE_PATH_ESCAPE for .. traversal', () => {
      const escapePath = join('..', '..', 'etc', 'passwd')
      try {
        resolveWorkspacePath(workspaceDir, escapePath)
        expect.fail('Expected WORKSPACE_PATH_ESCAPE error')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.WORKSPACE_PATH_ESCAPE)
      }
    })

    it('should throw WORKSPACE_PATH_ESCAPE for path going to parent', () => {
      try {
        resolveWorkspacePath(workspaceDir, '..')
        expect.fail('Expected WORKSPACE_PATH_ESCAPE error')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.WORKSPACE_PATH_ESCAPE)
      }
    })

    it('should throw WORKSPACE_PATH_ESCAPE for absolute path outside workspace', () => {
      try {
        resolveWorkspacePath(workspaceDir, outsideDir)
        expect.fail('Expected WORKSPACE_PATH_ESCAPE error')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.WORKSPACE_PATH_ESCAPE)
      }
    })

    it('should include path details in error details', () => {
      try {
        resolveWorkspacePath(workspaceDir, '../../../etc/passwd')
        expect.fail('Expected WORKSPACE_PATH_ESCAPE error')
      } catch (error) {
        const appError = error as AppError
        expect(appError.details).toBeDefined()
        expect(appError.details?.['workspacePath']).toBeDefined()
        expect(appError.details?.['relativePath']).toBeDefined()
        expect(appError.details?.['resolvedPath']).toBeDefined()
      }
    })

    it('should handle complex relative paths correctly', () => {
      // subdir/../test.txt should resolve to workspace root/test.txt
      const result = resolveWorkspacePath(workspaceDir, join('subdir', '..', 'test.txt'))
      expect(result).toBe(join(workspaceDir, 'test.txt'))
    })

    it('should allow paths with subdirectories that go up and down within workspace', () => {
      // subdir/../subdir/nested.txt should be fine
      const result = resolveWorkspacePath(workspaceDir, join('subdir', '..', 'subdir', 'nested.txt'))
      expect(result).toBe(join(workspaceDir, 'subdir', 'nested.txt'))
    })
  })
})
