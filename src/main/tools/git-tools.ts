// AgentForge P1-03: Git 工作流 Agent 工具
// 7 个 git_* 内置工具，注册到 ToolRegistry
// 让 Agent 能够查看状态、diff、日志、暂存、提交、创建分支和 PR

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import { getWorkspacePath } from '../ipc/workspace'
import {
  getGitStatus,
  getGitDiff,
  getGitLog,
  listBranches,
  createBranch,
  gitAdd,
  gitCommit,
  createPullRequest,
} from '../git'

// ─── 辅助函数 ─────────────────────────────────────────────────

/** 获取工作区路径，用于 git 命令的 cwd */
function getCwd(customCwd?: unknown): string {
  const workspaceRoot = getWorkspacePath()
  if (typeof customCwd === 'string' && customCwd.trim() !== '') {
    return customCwd.trim()
  }
  return workspaceRoot
}

/** 格式化状态码为可读文本 */
function formatStatusCode(status: string | null): string {
  if (status === null) return '  '
  const map: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: '?',
    conflicted: 'U',
    type_changed: 'T',
    ignored: '!',
  }
  return map[status] ?? '?'
}

/** 格式化文件变更列表 */
function formatFileChanges(changes: Array<{ filePath: string; stagedStatus: string | null; unstagedStatus: string | null }>): string {
  if (changes.length === 0) return '  (none)'
  return changes
    .map((c) => `  ${formatStatusCode(c.stagedStatus)}${formatStatusCode(c.unstagedStatus)} ${c.filePath}`)
    .join('\n')
}

// ─── git_status 工具 ──────────────────────────────────────────

export const gitStatusTool: BuiltinTool = {
  definition: {
    name: 'git_status',
    description:
      '显示 Git 仓库的工作区状态，包括当前分支、暂存的变更、未暂存的变更和未跟踪的文件。当需要了解代码变更情况时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    try {
      const status = await getGitStatus(cwd)

      const lines: string[] = []
      lines.push(`分支: ${status.branch}`)
      if (status.upstream) {
        lines.push(`上游: ${status.upstream}`)
        if (status.ahead > 0) lines.push(`  领先 ${status.ahead} 个提交`)
        if (status.behind > 0) lines.push(`  落后 ${status.behind} 个提交`)
      }
      if (status.headSha) {
        lines.push(`HEAD: ${status.headSha}`)
      }
      if (status.inProgress !== 'none') {
        lines.push(`⚠ ${status.inProgress} 进行中`)
      }
      if (status.hasConflicts) {
        lines.push('⚠ 存在冲突')
      }
      lines.push('')
      lines.push('暂存的变更:')
      lines.push(formatFileChanges(status.staged))
      lines.push('')
      lines.push('未暂存的变更:')
      lines.push(formatFileChanges(status.unstaged))
      lines.push('')
      lines.push('未跟踪的文件:')
      lines.push(formatFileChanges(status.untracked))

      return {
        isError: false,
        content: lines.join('\n'),
        metadata: status,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to get git status: ${error instanceof Error ? error.message : String(error)}`,
        { cwd },
      )
    }
  },
}

// ─── git_diff 工具 ────────────────────────────────────────────

export const gitDiffTool: BuiltinTool = {
  definition: {
    name: 'git_diff',
    description:
      '显示 Git 仓库的代码差异（diff）。可查看未暂存、已暂存或特定提交之间的差异。当需要查看具体代码变更内容时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: 'diff 模式: unstaged(未暂存,默认), staged(已暂存), committed(最近提交), branch(分支间)',
          enum: ['unstaged', 'staged', 'committed', 'branch'],
        },
        filePath: {
          type: 'string',
          description: '可选：指定文件的路径',
        },
        baseRef: {
          type: 'string',
          description: '基础引用（commit SHA 或分支名），用于 committed 或 branch 模式',
        },
        targetRef: {
          type: 'string',
          description: '目标引用（commit SHA 或分支名），用于 branch 模式',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const options: Parameters<typeof getGitDiff>[1] = {}

    if (typeof args['mode'] === 'string') {
      options.mode = args['mode'] as 'unstaged' | 'staged' | 'committed' | 'branch'
    }
    if (typeof args['filePath'] === 'string' && args['filePath'].trim() !== '') {
      options.filePath = args['filePath']
    }
    if (typeof args['baseRef'] === 'string' && args['baseRef'].trim() !== '') {
      options.baseRef = args['baseRef']
    }
    if (typeof args['targetRef'] === 'string' && args['targetRef'].trim() !== '') {
      options.targetRef = args['targetRef']
    }

    try {
      const diff = await getGitDiff(cwd, options)

      if (diff.patch.length === 0) {
        return {
          isError: false,
          content: '没有差异。',
          metadata: diff,
        }
      }

      // 附加文件统计
      const statsText = diff.stats.length > 0
        ? '\n\n统计:\n' + diff.stats
            .map((s) => `  ${s.filePath}: +${s.additions} -${s.deletions}`)
            .join('\n')
        : ''

      return {
        isError: false,
        content: diff.patch + (diff.truncated ? '\n... (已截断)' : '') + statsText,
        metadata: diff,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to get git diff: ${error instanceof Error ? error.message : String(error)}`,
        { cwd, options },
      )
    }
  },
}

// ─── git_log 工具 ─────────────────────────────────────────────

export const gitLogTool: BuiltinTool = {
  definition: {
    name: 'git_log',
    description:
      '显示 Git 提交历史日志。支持按分支、文件、作者等条件过滤。当需要查看提交历史、了解变更来源时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回的提交数量（1-200，默认 20）',
          minimum: 1,
          maximum: 200,
        },
        branch: {
          type: 'string',
          description: '分支名（查看特定分支的日志）',
        },
        filePath: {
          type: 'string',
          description: '文件路径（查看特定文件的变更历史）',
        },
        author: {
          type: 'string',
          description: '作者名（按提交者过滤）',
        },
        grep: {
          type: 'string',
          description: '搜索提交消息中的关键词',
        },
        since: {
          type: 'string',
          description: '起始日期（如 "2024-01-01" 或 "2 weeks ago"）',
        },
        until: {
          type: 'string',
          description: '结束日期',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const options: Parameters<typeof getGitLog>[1] = {}

    if (args['limit'] !== undefined) {
      const limit = Number(args['limit'])
      if (!Number.isNaN(limit) && limit >= 1) {
        options.limit = Math.floor(limit)
      }
    }
    if (typeof args['branch'] === 'string' && args['branch'].trim() !== '') {
      options.branch = args['branch']
    }
    if (typeof args['filePath'] === 'string' && args['filePath'].trim() !== '') {
      options.filePath = args['filePath']
    }
    if (typeof args['author'] === 'string' && args['author'].trim() !== '') {
      options.author = args['author']
    }
    if (typeof args['grep'] === 'string' && args['grep'].trim() !== '') {
      options.grep = args['grep']
    }
    if (typeof args['since'] === 'string' && args['since'].trim() !== '') {
      options.since = args['since']
    }
    if (typeof args['until'] === 'string' && args['until'].trim() !== '') {
      options.until = args['until']
    }

    try {
      const log = await getGitLog(cwd, options)

      if (log.length === 0) {
        return {
          isError: false,
          content: '没有提交记录。',
          metadata: { entries: [] },
        }
      }

      const lines: string[] = []
      for (const entry of log) {
        const refs = entry.refs.length > 0 ? ` (${entry.refs.join(', ')})` : ''
        lines.push(`${entry.shortSha} ${entry.message}${refs}`)
        lines.push(`  作者: ${entry.author} <${entry.authorEmail}>`)
        lines.push(`  日期: ${entry.date}`)
        lines.push('')
      }

      return {
        isError: false,
        content: lines.join('\n'),
        metadata: { entries: log, count: log.length },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to get git log: ${error instanceof Error ? error.message : String(error)}`,
        { cwd },
      )
    }
  },
}

// ─── git_add 工具 ─────────────────────────────────────────────

export const gitAddTool: BuiltinTool = {
  definition: {
    name: 'git_add',
    description:
      '将文件添加到 Git 暂存区。传入 ["."] 可暂存所有变更。当需要暂存变更以准备提交时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '要暂存的文件路径数组。传入 ["."] 表示暂存所有变更。',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
      required: ['files'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const files = args['files']
    if (!Array.isArray(files) || files.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'files must be a non-empty array.', { files })
    }

    const fileStrings = files.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
    if (fileStrings.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'files must contain at least one non-empty string.', { files })
    }

    try {
      await gitAdd(cwd, fileStrings)

      return {
        isError: false,
        content: `已暂存 ${fileStrings.length} 个文件: ${fileStrings.join(', ')}`,
        metadata: { files: fileStrings },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to git add: ${error instanceof Error ? error.message : String(error)}`,
        { cwd, files: fileStrings },
      )
    }
  },
}

// ─── git_commit 工具 ──────────────────────────────────────────

export const gitCommitTool: BuiltinTool = {
  definition: {
    name: 'git_commit',
    description:
      '提交暂存区的变更到 Git 仓库。可选择自动暂存所有变更（addAll）。当需要保存代码变更时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '提交消息',
        },
        addAll: {
          type: 'boolean',
          description: '是否自动暂存所有变更（git add -A）后再提交，默认 false',
        },
        amend: {
          type: 'boolean',
          description: '是否修改上一次提交（--amend），默认 false',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
      required: ['message'],
    },
    riskLevel: 'high',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const message = args['message']
    if (typeof message !== 'string' || message.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Commit message must be a non-empty string.', { message })
    }

    const options: Parameters<typeof gitCommit>[2] = {}
    if (args['addAll'] === true) options.addAll = true
    if (args['amend'] === true) options.amend = true

    try {
      const result = await gitCommit(cwd, message, options)

      return {
        isError: false,
        content: `提交成功: ${result.shortSha}\n${result.message}\n${result.filesChanged} files changed, ${result.insertions} insertions(+), ${result.deletions} deletions(-)`,
        metadata: result,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to commit: ${error instanceof Error ? error.message : String(error)}`,
        { cwd, message },
      )
    }
  },
}

// ─── git_create_branch 工具 ───────────────────────────────────

export const gitCreateBranchTool: BuiltinTool = {
  definition: {
    name: 'git_create_branch',
    description:
      '创建新的 Git 分支。可选择是否切换到新分支。当需要创建功能分支、修复分支时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        branchName: {
          type: 'string',
          description: '新分支名称',
        },
        switchTo: {
          type: 'boolean',
          description: '是否切换到新分支（默认 true）',
        },
        baseRef: {
          type: 'string',
          description: '基于的分支或提交（默认 HEAD）',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
      required: ['branchName'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const branchName = args['branchName']
    if (typeof branchName !== 'string' || branchName.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Branch name must be a non-empty string.', { branchName })
    }

    // 验证分支名合法性
    if (!/^[A-Za-z0-9._/-]+$/.test(branchName)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Branch name contains invalid characters.', { branchName })
    }

    const options: Parameters<typeof createBranch>[2] = {}
    if (args['switchTo'] === false) options.switchTo = false
    if (typeof args['baseRef'] === 'string' && args['baseRef'].trim() !== '') {
      options.baseRef = args['baseRef']
    }

    try {
      const result = await createBranch(cwd, branchName, options)

      return {
        isError: false,
        content: `分支 "${result.branchName}" 已创建${result.switched ? '并切换' : ''}（基于 ${result.baseRef}）`,
        metadata: result,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to create branch: ${error instanceof Error ? error.message : String(error)}`,
        { cwd, branchName },
      )
    }
  },
}

// ─── git_create_pr 工具 ───────────────────────────────────────

export const gitCreatePrTool: BuiltinTool = {
  definition: {
    name: 'git_create_pr',
    description:
      '创建 Pull Request。需要安装 GitHub CLI (gh) 或配置远程仓库。当需要发起代码审查时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'PR 标题',
        },
        body: {
          type: 'string',
          description: 'PR 描述内容',
        },
        base: {
          type: 'string',
          description: '目标分支（默认为主分支）',
        },
        head: {
          type: 'string',
          description: '源分支（默认为当前分支）',
        },
        draft: {
          type: 'boolean',
          description: '是否创建为草稿 PR',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
      required: ['title'],
    },
    riskLevel: 'high',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const title = args['title']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'PR title must be a non-empty string.', { title })
    }

    const options: Parameters<typeof createPullRequest>[1] = { title }
    if (typeof args['body'] === 'string') options.body = args['body']
    if (typeof args['base'] === 'string' && args['base'].trim() !== '') options.base = args['base']
    if (typeof args['head'] === 'string' && args['head'].trim() !== '') options.head = args['head']
    if (args['draft'] === true) options.draft = true

    try {
      const result = await createPullRequest(cwd, options)

      return {
        isError: false,
        content: `PR #${result.number} 已创建: ${result.title}\n${result.url}\n${result.head} → ${result.base}${result.draft ? ' (草稿)' : ''}`,
        metadata: result,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_PR_CREATE_FAILED,
        `Failed to create PR: ${error instanceof Error ? error.message : String(error)}`,
        { title },
      )
    }
  },
}

// ─── git_branch_list 工具 ─────────────────────────────────────

export const gitBranchListTool: BuiltinTool = {
  definition: {
    name: 'git_branch_list',
    description:
      '列出 Git 仓库的所有分支，标记当前分支和远程分支。当需要了解分支结构、查看可用分支时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        remote: {
          type: 'boolean',
          description: '是否只列出远程分支（默认 false，列出本地和远程）',
        },
        cwd: {
          type: 'string',
          description: 'Git 仓库路径（默认为工作区根目录）',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const cwd = getCwd(args['cwd'])

    const options: Parameters<typeof listBranches>[1] = {}
    if (args['remote'] === true) options.remote = true

    try {
      const branches = await listBranches(cwd, options)

      if (branches.length === 0) {
        return {
          isError: false,
          content: '没有分支。',
          metadata: { branches: [] },
        }
      }

      const lines: string[] = []
      for (const b of branches) {
        const marker = b.isCurrent ? '* ' : '  '
        const remote = b.isRemote ? ' (remote)' : ''
        const upstream = b.upstream ? ` → ${b.upstream}` : ''
        const sha = b.lastCommitSha ? ` ${b.lastCommitSha}` : ''
        lines.push(`${marker}${b.name}${remote}${upstream}${sha}`)
      }

      return {
        isError: false,
        content: lines.join('\n'),
        metadata: { branches, count: branches.length },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Failed to list branches: ${error instanceof Error ? error.message : String(error)}`,
        { cwd },
      )
    }
  },
}

// ─── 导出所有 git_* 工具 ──────────────────────────────────────

export const allGitTools: BuiltinTool[] = [
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitAddTool,
  gitCommitTool,
  gitCreateBranchTool,
  gitCreatePrTool,
  gitBranchListTool,
]
