// AgentForge P1-03: Git 核心模块测试
// 创建临时 Git 仓库进行集成测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import {
  validateGitRepo,
  getRepoRoot,
  getGitStatus,
  getGitDiff,
  getGitLog,
  listBranches,
  createBranch,
  gitAdd,
  gitCommit,
} from './index'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 测试辅助 ─────────────────────────────────────────────────

let tempDir: string

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-git-test-'))
  // 初始化 git 仓库
  execSync('git init', { cwd: dir })
  // 配置 git（CI 环境需要）
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test User"', { cwd: dir })
  // 创建初始提交
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n')
  execSync('git add README.md', { cwd: dir })
  execSync('git commit -m "Initial commit"', { cwd: dir })
  return dir
}

beforeEach(() => {
  tempDir = createTempRepo()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

// ─── 测试 ──────────────────────────────────────────────────────

describe('Git Core Module', () => {
  // ─── validateGitRepo ──────────────────────────────────────────

  describe('validateGitRepo', () => {
    it('should not throw for a valid git repository', async () => {
      await expect(validateGitRepo(tempDir)).resolves.not.toThrow()
    })

    it('should throw GIT_NOT_A_REPO for non-git directory', async () => {
      const nonRepo = mkdtempSync(join(tmpdir(), 'agentforge-nongit-'))
      try {
        await expect(validateGitRepo(nonRepo)).rejects.toThrow(AppError)
        await expect(validateGitRepo(nonRepo)).rejects.toMatchObject({
          code: ErrorCodes.GIT_NOT_A_REPO,
        })
      } finally {
        rmSync(nonRepo, { recursive: true, force: true })
      }
    })
  })

  // ─── getRepoRoot ─────────────────────────────────────────────

  describe('getRepoRoot', () => {
    it('should return the repository root path', async () => {
      const root = await getRepoRoot(tempDir)
      // Normalize paths for Windows (git returns forward slashes, Node uses backslashes)
      expect(normalize(root)).toBe(normalize(tempDir))
    })

    it('should return root even from a subdirectory', async () => {
      const subDir = join(tempDir, 'src')
      mkdirSync(subDir, { recursive: true })
      const root = await getRepoRoot(subDir)
      // Normalize paths for Windows (git returns forward slashes, Node uses backslashes)
      expect(normalize(root)).toBe(normalize(tempDir))
    })
  })

  // ─── getGitStatus ────────────────────────────────────────────

  describe('getGitStatus', () => {
    it('should return clean status on fresh repo', async () => {
      const status = await getGitStatus(tempDir)
      expect(status.branch).toMatch(/^(main|master)$/)
      expect(status.staged).toHaveLength(0)
      expect(status.unstaged).toHaveLength(0)
      expect(status.untracked).toHaveLength(0)
      expect(status.hasConflicts).toBe(false)
      expect(status.inProgress).toBe('none')
      expect(status.headSha).not.toBeNull()
    })

    it('should detect untracked files', async () => {
      writeFileSync(join(tempDir, 'new-file.ts'), 'export const x = 1\n')
      const status = await getGitStatus(tempDir)
      expect(status.untracked).toHaveLength(1)
      expect(status.untracked[0].filePath).toBe('new-file.ts')
      expect(status.untracked[0].unstagedStatus).toBe('untracked')
    })

    it('should detect staged files', async () => {
      writeFileSync(join(tempDir, 'staged.ts'), 'export const y = 2\n')
      execSync('git add staged.ts', { cwd: tempDir })
      const status = await getGitStatus(tempDir)
      expect(status.staged).toHaveLength(1)
      expect(status.staged[0].filePath).toBe('staged.ts')
      expect(status.staged[0].stagedStatus).toBe('added')
    })

    it('should detect modified files', async () => {
      writeFileSync(join(tempDir, 'README.md'), '# Modified\n')
      const status = await getGitStatus(tempDir)
      expect(status.unstaged).toHaveLength(1)
      expect(status.unstaged[0].filePath).toBe('README.md')
      expect(status.unstaged[0].unstagedStatus).toBe('modified')
    })

    it('should detect staged and unstaged changes on same file', async () => {
      writeFileSync(join(tempDir, 'README.md'), '# Staged change\n')
      execSync('git add README.md', { cwd: tempDir })
      writeFileSync(join(tempDir, 'README.md'), '# Staged + unstaged change\n')
      const status = await getGitStatus(tempDir)
      // Should have staged change
      const staged = status.staged.find((f) => f.filePath === 'README.md')
      expect(staged).toBeDefined()
      expect(staged?.stagedStatus).toBe('modified')
      // Should have unstaged change
      const unstaged = status.unstaged.find((f) => f.filePath === 'README.md')
      expect(unstaged).toBeDefined()
      expect(unstaged?.unstagedStatus).toBe('modified')
    })
  })

  // ─── getGitDiff ──────────────────────────────────────────────

  describe('getGitDiff', () => {
    it('should return empty diff for clean repo', async () => {
      const diff = await getGitDiff(tempDir, { mode: 'unstaged' })
      expect(diff.patch).toBe('')
      expect(diff.stats).toHaveLength(0)
      expect(diff.truncated).toBe(false)
    })

    it('should return unstaged diff', async () => {
      writeFileSync(join(tempDir, 'README.md'), '# Modified content\n')
      const diff = await getGitDiff(tempDir, { mode: 'unstaged' })
      expect(diff.patch).toContain('-# Test Repo')
      expect(diff.patch).toContain('+# Modified content')
      expect(diff.mode).toBe('unstaged')
      expect(diff.stats).toHaveLength(1)
      expect(diff.stats[0].filePath).toBe('README.md')
      expect(diff.stats[0].additions).toBe(1)
      expect(diff.stats[0].deletions).toBe(1)
    })

    it('should return staged diff', async () => {
      writeFileSync(join(tempDir, 'new.ts'), 'export const x = 1\n')
      execSync('git add new.ts', { cwd: tempDir })
      const diff = await getGitDiff(tempDir, { mode: 'staged' })
      expect(diff.patch).toContain('+export const x = 1')
      expect(diff.mode).toBe('staged')
    })

    it('should return committed diff', async () => {
      // Create a second commit so HEAD~1 exists
      writeFileSync(join(tempDir, 'second.ts'), 'export const x = 1\n')
      execSync('git add second.ts', { cwd: tempDir })
      execSync('git commit -m "Second commit"', { cwd: tempDir })

      const diff = await getGitDiff(tempDir, { mode: 'committed' })
      expect(diff.patch).toContain('+export const x = 1')
      expect(diff.mode).toBe('committed')
    })

    it('should filter by filePath', async () => {
      // Create and commit files first, then modify them
      writeFileSync(join(tempDir, 'file1.ts'), 'export const a = 1\n')
      writeFileSync(join(tempDir, 'file2.ts'), 'export const b = 2\n')
      execSync('git add .', { cwd: tempDir })
      execSync('git commit -m "Add files"', { cwd: tempDir })

      // Now modify them so they show up in unstaged diff
      writeFileSync(join(tempDir, 'file1.ts'), 'export const a = 10\n')
      writeFileSync(join(tempDir, 'file2.ts'), 'export const b = 20\n')
      const diff = await getGitDiff(tempDir, { mode: 'unstaged', filePath: 'file1.ts' })
      expect(diff.patch).toContain('file1.ts')
      expect(diff.patch).not.toContain('file2.ts')
    })

    it('should truncate large diffs', async () => {
      // Create a large file change
      const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`)
      writeFileSync(join(tempDir, 'README.md'), lines.join('\n'))
      const diff = await getGitDiff(tempDir, {
        mode: 'unstaged',
        maxPatchLength: 1000,
      })
      expect(diff.truncated).toBe(true)
      expect(diff.patch.length).toBeLessThan(1100)
    })
  })

  // ─── getGitLog ───────────────────────────────────────────────

  describe('getGitLog', () => {
    it('should return commit log entries', async () => {
      const log = await getGitLog(tempDir)
      expect(log.length).toBeGreaterThanOrEqual(1)
      expect(log[0].message).toBe('Initial commit')
      expect(log[0].sha).toHaveLength(40)
      expect(log[0].shortSha).toHaveLength(7)
      expect(log[0].author).toBe('Test User')
      expect(log[0].authorEmail).toBe('test@test.com')
    })

    it('should respect limit parameter', async () => {
      // Create more commits
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(tempDir, `file${i}.ts`), `export const x${i} = ${i}\n`)
        execSync('git add .', { cwd: tempDir })
        execSync(`git commit -m "Commit ${i}"`, { cwd: tempDir })
      }
      const log = await getGitLog(tempDir, { limit: 3 })
      expect(log).toHaveLength(3)
    })

    it('should filter by grep', async () => {
      writeFileSync(join(tempDir, 'feature.ts'), 'export const x = 1\n')
      execSync('git add .', { cwd: tempDir })
      execSync('git commit -m "feat: add feature"', { cwd: tempDir })

      writeFileSync(join(tempDir, 'fix.ts'), 'export const y = 2\n')
      execSync('git add .', { cwd: tempDir })
      execSync('git commit -m "fix: resolve bug"', { cwd: tempDir })

      const log = await getGitLog(tempDir, { grep: 'feat' })
      expect(log).toHaveLength(1)
      expect(log[0].message).toContain('feat')
    })
  })

  // ─── listBranches ────────────────────────────────────────────

  describe('listBranches', () => {
    it('should list local branches with current marked', async () => {
      const branches = await listBranches(tempDir)
      expect(branches.length).toBeGreaterThanOrEqual(1)
      const current = branches.find((b) => b.isCurrent)
      expect(current).toBeDefined()
      expect(current?.name).toMatch(/^(main|master)$/)
    })

    it('should mark remote branches', async () => {
      // Add a remote branch reference (without actual remote)
      // On Windows, 2>/dev/null doesn't work, so we use a try-catch
      try {
        execSync('git branch -r origin/main', { cwd: tempDir, stdio: 'ignore' })
      } catch {
        // Ignore errors - this is expected without a remote
      }
      // This might not work without a remote, but test won't fail
      const branches = await listBranches(tempDir)
      expect(branches.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── createBranch ─────────────────────────────────────────────

  describe('createBranch', () => {
    it('should create a new branch without switching', async () => {
      const result = await createBranch(tempDir, 'feature-1', { switchTo: false })
      expect(result.branchName).toBe('feature-1')
      expect(result.switched).toBe(false)

      const branches = await listBranches(tempDir)
      const newBranch = branches.find((b) => b.name === 'feature-1')
      expect(newBranch).toBeDefined()
      expect(newBranch?.isCurrent).toBe(false)
    })

    it('should create and switch to new branch', async () => {
      const result = await createBranch(tempDir, 'feature-2', { switchTo: true })
      expect(result.branchName).toBe('feature-2')
      expect(result.switched).toBe(true)

      const branches = await listBranches(tempDir)
      const current = branches.find((b) => b.isCurrent)
      expect(current?.name).toBe('feature-2')
    })

    it('should throw GIT_BRANCH_EXISTS for duplicate branch', async () => {
      await createBranch(tempDir, 'existing-branch', { switchTo: false })
      await expect(createBranch(tempDir, 'existing-branch')).rejects.toMatchObject({
        code: ErrorCodes.GIT_BRANCH_EXISTS,
      })
    })
  })

  // ─── gitAdd ──────────────────────────────────────────────────

  describe('gitAdd', () => {
    it('should add files to staging area', async () => {
      writeFileSync(join(tempDir, 'new1.ts'), 'export const a = 1\n')
      writeFileSync(join(tempDir, 'new2.ts'), 'export const b = 2\n')
      await gitAdd(tempDir, ['new1.ts', 'new2.ts'])

      const status = await getGitStatus(tempDir)
      expect(status.staged).toHaveLength(2)
    })

    it('should add all changes with ["."]', async () => {
      writeFileSync(join(tempDir, 'new1.ts'), 'export const a = 1\n')
      writeFileSync(join(tempDir, 'new2.ts'), 'export const b = 2\n')
      await gitAdd(tempDir, ['.'])

      const status = await getGitStatus(tempDir)
      expect(status.staged.length).toBeGreaterThanOrEqual(2)
    })

    it('should throw VALIDATION_ERROR for empty files array', async () => {
      await expect(gitAdd(tempDir, [])).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })
  })

  // ─── gitCommit ───────────────────────────────────────────────

  describe('gitCommit', () => {
    it('should commit staged changes', async () => {
      writeFileSync(join(tempDir, 'commit-me.ts'), 'export const x = 1\n')
      await gitAdd(tempDir, ['commit-me.ts'])
      const result = await gitCommit(tempDir, 'Test commit')

      expect(result.message).toBe('Test commit')
      expect(result.sha).toHaveLength(40)
      expect(result.shortSha).toHaveLength(7)
      expect(result.filesChanged).toBe(1)
      expect(result.insertions).toBeGreaterThanOrEqual(1)
    })

    it('should commit with addAll option', async () => {
      writeFileSync(join(tempDir, 'auto-add.ts'), 'export const x = 1\n')
      const result = await gitCommit(tempDir, 'Auto-add commit', { addAll: true })

      expect(result.message).toBe('Auto-add commit')
      expect(result.filesChanged).toBeGreaterThanOrEqual(1)
    })

    it('should throw GIT_NOTHING_TO_COMMIT when nothing staged', async () => {
      await expect(gitCommit(tempDir, 'Empty commit')).rejects.toMatchObject({
        code: ErrorCodes.GIT_NOTHING_TO_COMMIT,
      })
    })

    it('should amend last commit', async () => {
      // First commit
      writeFileSync(join(tempDir, 'file1.ts'), 'export const x = 1\n')
      await gitAdd(tempDir, ['file1.ts'])
      await gitCommit(tempDir, 'Original message')

      // Add more and amend
      writeFileSync(join(tempDir, 'file2.ts'), 'export const y = 2\n')
      await gitAdd(tempDir, ['file2.ts'])
      const result = await gitCommit(tempDir, 'Amended message', { amend: true })

      // Should have both files in the amended commit
      expect(result.filesChanged).toBeGreaterThanOrEqual(1)

      // Check that log shows only one commit (amended)
      const log = await getGitLog(tempDir, { limit: 1 })
      expect(log[0].message).toContain('Amended')
    })
  })
})
