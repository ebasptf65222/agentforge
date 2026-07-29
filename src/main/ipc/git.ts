// AgentForge P1-03: Git IPC Handlers
// 通道命名: git:status, git:diff, git:log, git:add, git:commit,
//           git:branch:create, git:branch:list, git:pr:create

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type {
  GitStatus,
  GitDiffResult,
  GitLogEntry,
  GitBranch,
  GitCommitResult,
  GitCreateBranchResult,
  GitCreatePrResult,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getWorkspacePath } from './workspace'
import {
  getGitStatus,
  getGitDiff,
  getGitLog,
  listBranches,
  createBranch,
  gitAdd,
  gitCommit,
  createPullRequest,
  validateGitRepo,
} from '../git'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

function assertOptionalString(value: unknown, field: string): asserts value is string {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string if provided.`,
      { field, value },
    )
  }
}

function getCwdFromParams(params: Record<string, unknown>): string {
  if (typeof params['cwd'] === 'string' && params['cwd'].trim() !== '') {
    return params['cwd']
  }
  return getWorkspacePath()
}

// ─── IPC Handlers ────────────────────────────────────────────────

/**
 * 获取 Git 状态。
 * 参数: { cwd? }
 */
async function handleStatus(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitStatus> {
  const cwd = getCwdFromParams(params)
  return await getGitStatus(cwd)
}

/**
 * 获取 Git diff。
 * 参数: { cwd?, mode?, filePath?, baseRef?, targetRef? }
 */
async function handleDiff(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitDiffResult> {
  const cwd = getCwdFromParams(params)

  const options: Parameters<typeof getGitDiff>[1] = {}

  if (typeof params['mode'] === 'string') {
    options.mode = params['mode'] as 'unstaged' | 'staged' | 'committed' | 'branch'
  }
  if (typeof params['filePath'] === 'string' && params['filePath'].trim() !== '') {
    options.filePath = params['filePath']
  }
  if (typeof params['baseRef'] === 'string' && params['baseRef'].trim() !== '') {
    options.baseRef = params['baseRef']
  }
  if (typeof params['targetRef'] === 'string' && params['targetRef'].trim() !== '') {
    options.targetRef = params['targetRef']
  }
  if (params['maxPatchLength'] !== undefined) {
    const n = Number(params['maxPatchLength'])
    if (!Number.isNaN(n) && n > 0) {
      options.maxPatchLength = n
    }
  }

  return await getGitDiff(cwd, options)
}

/**
 * 获取 Git 提交日志。
 * 参数: { cwd?, limit?, branch?, filePath?, author?, grep?, since?, until? }
 */
async function handleLog(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitLogEntry[]> {
  const cwd = getCwdFromParams(params)

  const options: Parameters<typeof getGitLog>[1] = {}

  if (params['limit'] !== undefined) {
    const limit = Number(params['limit'])
    if (!Number.isNaN(limit) && limit >= 1 && limit <= 200) {
      options.limit = Math.floor(limit)
    }
  }
  if (typeof params['branch'] === 'string' && params['branch'].trim() !== '') {
    options.branch = params['branch']
  }
  if (typeof params['filePath'] === 'string' && params['filePath'].trim() !== '') {
    options.filePath = params['filePath']
  }
  if (typeof params['author'] === 'string' && params['author'].trim() !== '') {
    options.author = params['author']
  }
  if (typeof params['grep'] === 'string' && params['grep'].trim() !== '') {
    options.grep = params['grep']
  }
  if (typeof params['since'] === 'string' && params['since'].trim() !== '') {
    options.since = params['since']
  }
  if (typeof params['until'] === 'string' && params['until'].trim() !== '') {
    options.until = params['until']
  }

  return await getGitLog(cwd, options)
}

/**
 * 暂存文件。
 * 参数: { cwd?, files }
 */
async function handleAdd(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<void> {
  const cwd = getCwdFromParams(params)

  const files = params['files']
  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'files must be a non-empty array.', { files })
  }

  const fileStrings = files.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
  if (fileStrings.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'files must contain at least one non-empty string.', { files })
  }

  await gitAdd(cwd, fileStrings)
}

/**
 * 提交变更。
 * 参数: { cwd?, message, addAll?, amend? }
 */
async function handleCommit(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitCommitResult> {
  const cwd = getCwdFromParams(params)

  assertNonEmptyString(params['message'], 'message')

  const options: Parameters<typeof gitCommit>[2] = {}
  if (params['addAll'] === true) options.addAll = true
  if (params['amend'] === true) options.amend = true

  return await gitCommit(cwd, params['message'], options)
}

/**
 * 创建分支。
 * 参数: { cwd?, branchName, switchTo?, baseRef? }
 */
async function handleCreateBranch(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitCreateBranchResult> {
  const cwd = getCwdFromParams(params)

  assertNonEmptyString(params['branchName'], 'branchName')

  const options: Parameters<typeof createBranch>[2] = {}
  if (params['switchTo'] === false) options.switchTo = false
  if (typeof params['baseRef'] === 'string' && params['baseRef'].trim() !== '') {
    options.baseRef = params['baseRef']
  }

  return await createBranch(cwd, params['branchName'], options)
}

/**
 * 列出分支。
 * 参数: { cwd?, remote? }
 */
async function handleListBranches(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitBranch[]> {
  const cwd = getCwdFromParams(params)

  const options: Parameters<typeof listBranches>[1] = {}
  if (params['remote'] === true) options.remote = true

  return await listBranches(cwd, options)
}

/**
 * 创建 PR。
 * 参数: { cwd?, title, body?, base?, head?, draft? }
 */
async function handleCreatePr(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<GitCreatePrResult> {
  const cwd = getCwdFromParams(params)

  assertNonEmptyString(params['title'], 'title')

  const options: Parameters<typeof createPullRequest>[1] = {
    title: params['title'],
  }
  if (typeof params['body'] === 'string') options.body = params['body']
  assertOptionalString(params['base'], 'base')
  if (params['base'] !== undefined) options.base = params['base']
  assertOptionalString(params['head'], 'head')
  if (params['head'] !== undefined) options.head = params['head']
  if (params['draft'] === true) options.draft = true

  return await createPullRequest(cwd, options)
}

/**
 * 验证是否为 Git 仓库。
 * 参数: { cwd? }
 */
async function handleValidateRepo(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ isRepo: boolean; rootPath: string | null }> {
  const cwd = getCwdFromParams(params)

  try {
    await validateGitRepo(cwd)
    // 获取仓库根路径
    const { getRepoRoot } = await import('../git')
    const rootPath = await getRepoRoot(cwd)
    return { isRepo: true, rootPath }
  } catch {
    return { isRepo: false, rootPath: null }
  }
}

// ─── 注册函数 ────────────────────────────────────────────────────

const handlers: Array<{ channel: string; handler: IpcMainInvokeHandler }> = [
  { channel: 'git:status', handler: handleStatus },
  { channel: 'git:diff', handler: handleDiff },
  { channel: 'git:log', handler: handleLog },
  { channel: 'git:add', handler: handleAdd },
  { channel: 'git:commit', handler: handleCommit },
  { channel: 'git:branch:create', handler: handleCreateBranch },
  { channel: 'git:branch:list', handler: handleListBranches },
  { channel: 'git:pr:create', handler: handleCreatePr },
  { channel: 'git:validate', handler: handleValidateRepo },
]

/**
 * 注册 Git IPC handlers。
 * 幂等：重复调用安全。
 */
export function registerGitHandlers(): void {
  for (const { channel, handler } of handlers) {
    const wrappedHandler: IpcMainInvokeHandler = async (event, ...args) => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        if (error instanceof AppError) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new AppError(ErrorCodes.INTERNAL_ERROR, message, { channel })
      }
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, wrappedHandler)
  }
}
