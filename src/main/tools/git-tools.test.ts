// AgentForge P1-03: git_* Agent 工具单元测试
// Mock git 核心模块和 workspace IPC，验证工具参数校验与调用行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError, ErrorCodes } from '../utils/error'
import type { GitStatus, GitDiffResult, GitLogEntry, GitBranch, GitCommitResult, GitCreateBranchResult } from '@shared/types'

// ─── Mock setup ─────────────────────────────────────────────────

const {
  mockGetGitStatus,
  mockGetGitDiff,
  mockGetGitLog,
  mockListBranches,
  mockCreateBranch,
  mockGitAdd,
  mockGitCommit,
  mockCreatePullRequest,
  mockGetWorkspacePath,
} = vi.hoisted(() => ({
  mockGetGitStatus: vi.fn(),
  mockGetGitDiff: vi.fn(),
  mockGetGitLog: vi.fn(),
  mockListBranches: vi.fn(),
  mockCreateBranch: vi.fn(),
  mockGitAdd: vi.fn(),
  mockGitCommit: vi.fn(),
  mockCreatePullRequest: vi.fn(),
  mockGetWorkspacePath: vi.fn(),
}))

vi.mock('../git', () => ({
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args),
  getGitLog: (...args: unknown[]) => mockGetGitLog(...args),
  listBranches: (...args: unknown[]) => mockListBranches(...args),
  createBranch: (...args: unknown[]) => mockCreateBranch(...args),
  gitAdd: (...args: unknown[]) => mockGitAdd(...args),
  gitCommit: (...args: unknown[]) => mockGitCommit(...args),
  createPullRequest: (...args: unknown[]) => mockCreatePullRequest(...args),
}))

vi.mock('../ipc/workspace', () => ({
  getWorkspacePath: () => mockGetWorkspacePath(),
}))

// ─── Import after mocks ─────────────────────────────────────────

const {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitAddTool,
  gitCommitTool,
  gitCreateBranchTool,
  gitCreatePrTool,
  gitBranchListTool,
  allGitTools,
} = await import('./git-tools')

// ─── Test helpers ────────────────────────────────────────────────

function makeMockStatus(): GitStatus {
  return {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    hasConflicts: false,
    headSha: 'abc1234',
    inProgress: 'none',
  }
}

function makeMockDiff(): GitDiffResult {
  return {
    mode: 'unstaged',
    patch: 'diff --git a/file.ts b/file.ts\n+new line',
    stats: [{ filePath: 'file.ts', additions: 1, deletions: 0 }],
    truncated: false,
  }
}

function makeMockLogEntry(): GitLogEntry {
  return {
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
    shortSha: 'abcdef1',
    author: 'Test User',
    authorEmail: 'test@test.com',
    date: '2024-01-01T00:00:00+00:00',
    message: 'Test commit',
    refs: [],
  }
}

function makeMockBranch(): GitBranch {
  return {
    name: 'main',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/main',
    lastCommitSha: 'abc1234',
  }
}

function makeMockCommitResult(): GitCommitResult {
  return {
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
    shortSha: 'abcdef1',
    message: 'Test commit',
    filesChanged: 1,
    insertions: 5,
    deletions: 2,
  }
}

function makeMockCreateBranchResult(): GitCreateBranchResult {
  return {
    branchName: 'feature-1',
    switched: true,
    baseRef: 'HEAD',
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Git Agent Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspacePath.mockReturnValue('/workspace')
  })

  // ─── allGitTools ──────────────────────────────────────────────

  describe('allGitTools', () => {
    it('should export 8 git tools', () => {
      expect(allGitTools).toHaveLength(8)
    })

    it('should have unique tool names', () => {
      const names = allGitTools.map((t) => t.definition.name)
      const unique = new Set(names)
      expect(unique.size).toBe(names.length)
    })

    it('should all have source=builtin', () => {
      for (const tool of allGitTools) {
        expect(tool.definition.source).toBe('builtin')
      }
    })
  })

  // ─── git_status ───────────────────────────────────────────────

  describe('git_status', () => {
    it('should return formatted status', async () => {
      const mockStatus = makeMockStatus()
      mockGetGitStatus.mockResolvedValue(mockStatus)

      const result = await gitStatusTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('main')
      expect(result.content).toContain('origin/main')
      expect(result.content).toContain('abc1234')
      expect(result.metadata).toEqual(mockStatus)
    })

    it('should show conflicts warning', async () => {
      mockGetGitStatus.mockResolvedValue({
        ...makeMockStatus(),
        hasConflicts: true,
        inProgress: 'merge',
      })

      const result = await gitStatusTool.execute({})

      expect(result.content).toContain('冲突')
      expect(result.content).toContain('merge')
    })

    it('should show staged and unstaged files', async () => {
      mockGetGitStatus.mockResolvedValue({
        ...makeMockStatus(),
        staged: [{ filePath: 'src/a.ts', stagedStatus: 'added', unstagedStatus: null, area: 'staged' as const }],
        unstaged: [{ filePath: 'src/b.ts', stagedStatus: null, unstagedStatus: 'modified', area: 'unstaged' as const }],
        untracked: [{ filePath: 'src/c.ts', stagedStatus: null, unstagedStatus: 'untracked', area: 'untracked' as const }],
      })

      const result = await gitStatusTool.execute({})

      expect(result.content).toContain('src/a.ts')
      expect(result.content).toContain('src/b.ts')
      expect(result.content).toContain('src/c.ts')
    })

    it('should use custom cwd if provided', async () => {
      mockGetGitStatus.mockResolvedValue(makeMockStatus())

      await gitStatusTool.execute({ cwd: '/custom/repo' })

      expect(mockGetGitStatus).toHaveBeenCalledWith('/custom/repo')
    })

    it('should wrap non-AppError errors', async () => {
      mockGetGitStatus.mockRejectedValue(new Error('Network error'))

      await expect(gitStatusTool.execute({})).rejects.toMatchObject({
        code: ErrorCodes.GIT_COMMAND_FAILED,
      })
    })
  })

  // ─── git_diff ────────────────────────────────────────────────

  describe('git_diff', () => {
    it('should return formatted diff', async () => {
      const mockDiff = makeMockDiff()
      mockGetGitDiff.mockResolvedValue(mockDiff)

      const result = await gitDiffTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('diff --git')
      expect(result.content).toContain('file.ts')
      expect(result.metadata).toEqual(mockDiff)
    })

    it('should return "no diff" message for empty patch', async () => {
      mockGetGitDiff.mockResolvedValue({ ...makeMockDiff(), patch: '', stats: [] })

      const result = await gitDiffTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('没有差异')
    })

    it('should pass mode option', async () => {
      mockGetGitDiff.mockResolvedValue(makeMockDiff())

      await gitDiffTool.execute({ mode: 'staged' })

      expect(mockGetGitDiff).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ mode: 'staged' }),
      )
    })

    it('should pass filePath option', async () => {
      mockGetGitDiff.mockResolvedValue(makeMockDiff())

      await gitDiffTool.execute({ filePath: 'src/index.ts' })

      expect(mockGetGitDiff).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ filePath: 'src/index.ts' }),
      )
    })

    it('should show truncated message', async () => {
      mockGetGitDiff.mockResolvedValue({ ...makeMockDiff(), truncated: true })

      const result = await gitDiffTool.execute({})

      expect(result.content).toContain('截断')
    })
  })

  // ─── git_log ─────────────────────────────────────────────────

  describe('git_log', () => {
    it('should return formatted log entries', async () => {
      const entries = [makeMockLogEntry()]
      mockGetGitLog.mockResolvedValue(entries)

      const result = await gitLogTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('abcdef1')
      expect(result.content).toContain('Test commit')
      expect(result.content).toContain('Test User')
      expect(result.metadata).toEqual({ entries, count: 1 })
    })

    it('should return "no commits" message for empty log', async () => {
      mockGetGitLog.mockResolvedValue([])

      const result = await gitLogTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('没有提交记录')
    })

    it('should pass limit option', async () => {
      mockGetGitLog.mockResolvedValue([makeMockLogEntry()])

      await gitLogTool.execute({ limit: 5 })

      expect(mockGetGitLog).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ limit: 5 }),
      )
    })

    it('should pass grep option', async () => {
      mockGetGitLog.mockResolvedValue([makeMockLogEntry()])

      await gitLogTool.execute({ grep: 'feature' })

      expect(mockGetGitLog).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ grep: 'feature' }),
      )
    })
  })

  // ─── git_add ─────────────────────────────────────────────────

  describe('git_add', () => {
    it('should add files to staging', async () => {
      mockGitAdd.mockResolvedValue(undefined)

      const result = await gitAddTool.execute({ files: ['src/a.ts', 'src/b.ts'] })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('2')
      expect(mockGitAdd).toHaveBeenCalledWith('/workspace', ['src/a.ts', 'src/b.ts'])
    })

    it('should accept ["."] for all files', async () => {
      mockGitAdd.mockResolvedValue(undefined)

      const result = await gitAddTool.execute({ files: ['.'] })

      expect(result.isError).toBe(false)
    })

    it('should throw VALIDATION_ERROR for empty files array', async () => {
      await expect(gitAddTool.execute({ files: [] })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw VALIDATION_ERROR for non-array files', async () => {
      await expect(gitAddTool.execute({ files: 'not-an-array' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw VALIDATION_ERROR for empty string entries', async () => {
      await expect(gitAddTool.execute({ files: ['', '  '] })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should filter out non-string entries', async () => {
      mockGitAdd.mockResolvedValue(undefined)

      await gitAddTool.execute({ files: ['valid.ts', 123, null] })

      expect(mockGitAdd).toHaveBeenCalledWith('/workspace', ['valid.ts'])
    })
  })

  // ─── git_commit ──────────────────────────────────────────────

  describe('git_commit', () => {
    it('should commit and return result', async () => {
      mockGitCommit.mockResolvedValue(makeMockCommitResult())

      const result = await gitCommitTool.execute({ message: 'Fix bug' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('abcdef1')
      expect(result.content).toContain('Test commit')
      expect(result.content).toContain('1 files')
      expect(mockGitCommit).toHaveBeenCalledWith('/workspace', 'Fix bug', {})
    })

    it('should pass addAll option', async () => {
      mockGitCommit.mockResolvedValue(makeMockCommitResult())

      await gitCommitTool.execute({ message: 'Auto add', addAll: true })

      expect(mockGitCommit).toHaveBeenCalledWith('/workspace', 'Auto add', { addAll: true })
    })

    it('should pass amend option', async () => {
      mockGitCommit.mockResolvedValue(makeMockCommitResult())

      await gitCommitTool.execute({ message: 'Amended', amend: true })

      expect(mockGitCommit).toHaveBeenCalledWith('/workspace', 'Amended', { amend: true })
    })

    it('should throw VALIDATION_ERROR for empty message', async () => {
      await expect(gitCommitTool.execute({ message: '' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw VALIDATION_ERROR for non-string message', async () => {
      await expect(gitCommitTool.execute({ message: 123 })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should have riskLevel=high', () => {
      expect(gitCommitTool.definition.riskLevel).toBe('high')
    })
  })

  // ─── git_create_branch ──────────────────────────────────────

  describe('git_create_branch', () => {
    it('should create branch and return result', async () => {
      mockCreateBranch.mockResolvedValue(makeMockCreateBranchResult())

      const result = await gitCreateBranchTool.execute({ branchName: 'feature-1' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('feature-1')
      expect(result.content).toContain('已创建')
      expect(mockCreateBranch).toHaveBeenCalledWith('/workspace', 'feature-1', {})
    })

    it('should pass switchTo=false option', async () => {
      mockCreateBranch.mockResolvedValue({ ...makeMockCreateBranchResult(), switched: false })

      await gitCreateBranchTool.execute({ branchName: 'feature-2', switchTo: false })

      expect(mockCreateBranch).toHaveBeenCalledWith('/workspace', 'feature-2', { switchTo: false })
    })

    it('should pass baseRef option', async () => {
      mockCreateBranch.mockResolvedValue(makeMockCreateBranchResult())

      await gitCreateBranchTool.execute({ branchName: 'feature-3', baseRef: 'main' })

      expect(mockCreateBranch).toHaveBeenCalledWith('/workspace', 'feature-3', { baseRef: 'main' })
    })

    it('should throw VALIDATION_ERROR for empty branch name', async () => {
      await expect(gitCreateBranchTool.execute({ branchName: '' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw VALIDATION_ERROR for invalid characters in branch name', async () => {
      await expect(
        gitCreateBranchTool.execute({ branchName: 'bad;branch' }),
      ).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })
  })

  // ─── git_create_pr ──────────────────────────────────────────

  describe('git_create_pr', () => {
    it('should create PR and return result', async () => {
      mockCreatePullRequest.mockResolvedValue({
        url: 'https://github.com/owner/repo/pull/42',
        number: 42,
        title: 'Add feature',
        base: 'main',
        head: 'feature-1',
        draft: false,
      })

      const result = await gitCreatePrTool.execute({ title: 'Add feature' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('#42')
      expect(result.content).toContain('Add feature')
      expect(result.content).toContain('github.com')
      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ title: 'Add feature' }),
      )
    })

    it('should pass body and draft options', async () => {
      mockCreatePullRequest.mockResolvedValue({
        url: 'https://github.com/owner/repo/pull/43',
        number: 43,
        title: 'Draft PR',
        base: 'main',
        head: 'feature-2',
        draft: true,
      })

      await gitCreatePrTool.execute({
        title: 'Draft PR',
        body: 'This is a draft',
        draft: true,
      })

      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({
          title: 'Draft PR',
          body: 'This is a draft',
          draft: true,
        }),
      )
    })

    it('should throw VALIDATION_ERROR for empty title', async () => {
      await expect(gitCreatePrTool.execute({ title: '' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should have riskLevel=high', () => {
      expect(gitCreatePrTool.definition.riskLevel).toBe('high')
    })

    it('should wrap PR creation failures with GIT_PR_CREATE_FAILED', async () => {
      mockCreatePullRequest.mockRejectedValue(new Error('gh not found'))

      await expect(gitCreatePrTool.execute({ title: 'Test' })).rejects.toMatchObject({
        code: ErrorCodes.GIT_PR_CREATE_FAILED,
      })
    })
  })

  // ─── git_branch_list ────────────────────────────────────────

  describe('git_branch_list', () => {
    it('should list branches with current marked', async () => {
      const branches: GitBranch[] = [
        makeMockBranch(),
        { ...makeMockBranch(), name: 'develop', isCurrent: false },
      ]
      mockListBranches.mockResolvedValue(branches)

      const result = await gitBranchListTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('* main')
      expect(result.content).toContain('develop')
      expect(result.metadata).toEqual({ branches, count: 2 })
    })

    it('should return "no branches" message for empty list', async () => {
      mockListBranches.mockResolvedValue([])

      const result = await gitBranchListTool.execute({})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('没有分支')
    })

    it('should pass remote option', async () => {
      mockListBranches.mockResolvedValue([])

      await gitBranchListTool.execute({ remote: true })

      expect(mockListBranches).toHaveBeenCalledWith('/workspace', { remote: true })
    })
  })

  // ─── Risk levels ─────────────────────────────────────────────

  describe('Risk levels', () => {
    it('git_status should be low risk', () => {
      expect(gitStatusTool.definition.riskLevel).toBe('low')
    })

    it('git_diff should be low risk', () => {
      expect(gitDiffTool.definition.riskLevel).toBe('low')
    })

    it('git_log should be low risk', () => {
      expect(gitLogTool.definition.riskLevel).toBe('low')
    })

    it('git_add should be medium risk', () => {
      expect(gitAddTool.definition.riskLevel).toBe('medium')
    })

    it('git_create_branch should be medium risk', () => {
      expect(gitCreateBranchTool.definition.riskLevel).toBe('medium')
    })

    it('git_branch_list should be low risk', () => {
      expect(gitBranchListTool.definition.riskLevel).toBe('low')
    })
  })
})
