// AgentForge P1-03: Git 工作流核心模块
// 使用 Node.js child_process.execFile 调用 git CLI
// 安全：不使用 shell，参数以数组传递，避免注入

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  GitStatus,
  GitFileChange,
  GitStatusCode,
  GitDiffResult,
  GitDiffMode,
  GitDiffStat,
  GitLogEntry,
  GitBranch,
  GitCommitResult,
  GitCreateBranchResult,
  GitCreatePrResult,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

const execFileAsync = promisify(execFile)

/** Git 命令最大输出长度（字节） */
const MAX_OUTPUT = 512 * 1024 // 512KB

/** Git 命令默认超时（毫秒） */
const DEFAULT_TIMEOUT = 30_000

/** diff patch 最大长度（字符） */
const MAX_DIFF_PATCH = 100_000

/** log 默认条数 */
const DEFAULT_LOG_LIMIT = 20

/** log 最大条数 */
const MAX_LOG_LIMIT = 200

// ─── 辅助类型 ─────────────────────────────────────────────────

/** Git 命令执行选项 */
interface GitExecOptions {
  cwd: string
  timeout?: number
  env?: Record<string, string>
}

/** Git 命令执行结果 */
interface GitExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

// ─── 核心执行函数 ─────────────────────────────────────────────

/**
 * 执行 git 命令（不使用 shell，安全防注入）。
 *
 * @param args - git 命令参数数组
 * @param options - 执行选项
 * @returns 命令输出
 * @throws {AppError} GIT_NOT_A_REPO - 不是 git 仓库
 * @throws {AppError} GIT_COMMAND_FAILED - git 命令执行失败
 */
async function gitExec(args: string[], options: GitExecOptions): Promise<GitExecResult> {
  const { cwd, timeout = DEFAULT_TIMEOUT, env } = options

  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT,
      encoding: 'utf-8',
      env: env ? { ...process.env, ...env } : process.env,
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string }

    // 不是 git 仓库
    if (err.stderr?.includes('not a git repository') || err.stderr?.includes('fatal: not a git')) {
      throw new AppError(
        ErrorCodes.GIT_NOT_A_REPO,
        'The specified directory is not a Git repository.',
        { cwd },
      )
    }

    // 超时
    if (err.killed) {
      throw new AppError(
        ErrorCodes.GIT_COMMAND_FAILED,
        `Git command timed out after ${timeout}ms.`,
        { args, cwd, timeout },
      )
    }

    // git 命令返回非零退出码
    const exitCode = typeof err.code === 'number' ? err.code : 1
    const stderr = err.stderr ?? ''
    const stdout = err.stdout ?? ''

    throw new AppError(
      ErrorCodes.GIT_COMMAND_FAILED,
      `Git command failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`,
      { args, cwd, exitCode, stderr, stdout },
    )
  }
}

// ─── 验证函数 ─────────────────────────────────────────────────

/**
 * 验证目录是否为 Git 仓库。
 *
 * @param cwd - 工作目录
 * @throws {AppError} GIT_NOT_A_REPO
 */
export async function validateGitRepo(cwd: string): Promise<void> {
  await gitExec(['rev-parse', '--is-inside-work-tree'], { cwd })
}

/**
 * 获取仓库根目录。
 *
 * @param cwd - 工作目录（可以是子目录）
 * @returns 仓库根目录绝对路径
 */
export async function getRepoRoot(cwd: string): Promise<string> {
  const result = await gitExec(['rev-parse', '--show-toplevel'], { cwd })
  return result.stdout.trim()
}

// ─── 状态码解析 ───────────────────────────────────────────────

/**
 * 将 porcelain 状态字符转换为状态码。
 *
 * porcelain v1 格式：XY filename
 * X = 暂存区状态, Y = 工作区状态
 * ' ' = 未修改, M = 修改, A = 新增, D = 删除, R = 重命名,
 * C = 复制, U = 冲突, ? = 未跟踪, ! = 被忽略
 */
function parseStatusCode(code: string): GitStatusCode | null {
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'U': return 'conflicted'
    case 'T': return 'type_changed'
    case '?': return 'untracked'
    case '!': return 'ignored'
    case ' ': return null // 未修改
    default: return null
  }
}

/**
 * 解析 git status --porcelain=v1 输出。
 */
function parsePorcelainStatus(output: string): Array<{
  filePath: string
  stagedStatus: GitStatusCode | null
  unstagedStatus: GitStatusCode | null
}> {
  const results: Array<{
    filePath: string
    stagedStatus: GitStatusCode | null
    unstagedStatus: GitStatusCode | null
  }> = []

  const lines = output.split('\n').filter((l) => l.length > 0)

  for (const line of lines) {
    if (line.length < 3) continue

    const x = line[0] // 暂存区状态
    const y = line[1] // 工作区状态
    const filePath = line.slice(3) // 文件路径

    // 处理重命名（R 和 C 后面可能有 -> 分隔的旧路径）
    let actualPath = filePath
    if (filePath.includes(' -> ')) {
      actualPath = filePath.split(' -> ')[1] ?? filePath
    }

    results.push({
      filePath: actualPath,
      stagedStatus: parseStatusCode(x),
      unstagedStatus: parseStatusCode(y),
    })
  }

  return results
}

// ─── Git Status ──────────────────────────────────────────────

/**
 * 获取 Git 工作区状态。
 *
 * @param cwd - 仓库路径
 * @returns 完整的 Git 状态信息
 */
export async function getGitStatus(cwd: string): Promise<GitStatus> {
  await validateGitRepo(cwd)

  // 并行获取多项信息
  const [porcelainResult, branchResult, headResult] = await Promise.all([
    gitExec(['status', '--porcelain=v1', '--branch', '-z'], { cwd }),
    gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).catch(() => ({ stdout: '', stderr: '', exitCode: 1 })),
    gitExec(['rev-parse', '--short', 'HEAD'], { cwd }).catch(() => ({ stdout: '', stderr: '', exitCode: 1 })),
  ])

  const porcelainOutput = porcelainResult.stdout

  // 解析分支和上游信息
  let branch = 'HEAD'
  let upstream: string | null = null
  let ahead = 0
  let behind = 0

  // porcelain 输出第一行可能是 ## branch...upstream [ahead N, behind M]
  const firstLineEnd = porcelainOutput.indexOf('\n')
  const firstLine = firstLineEnd >= 0 ? porcelainOutput.slice(0, firstLineEnd) : porcelainOutput

  if (firstLine.startsWith('## ')) {
    const branchPart = firstLine.slice(3)

    // 提取 ahead/behind
    const aheadMatch = branchPart.match(/ahead (\d+)/)
    const behindMatch = branchPart.match(/behind (\d+)/)
    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10)
    if (behindMatch) behind = parseInt(behindMatch[1], 10)

    // 提取分支和上游
    const arrowIdx = branchPart.indexOf('...')
    const bracketIdx = branchPart.indexOf(' [')

    if (arrowIdx >= 0) {
      branch = bracketIdx >= 0
        ? branchPart.slice(0, Math.min(arrowIdx, bracketIdx))
        : branchPart.slice(0, arrowIdx)
      const upstreamPart = bracketIdx >= 0
        ? branchPart.slice(arrowIdx + 3, bracketIdx)
        : branchPart.slice(arrowIdx + 3)
      upstream = upstreamPart.trim() || null
    } else if (bracketIdx >= 0) {
      branch = branchPart.slice(0, bracketIdx).trim()
    } else {
      branch = branchPart.trim()
    }
  }

  // 也尝试从 rev-parse 获取分支名
  if (branchResult.stdout.trim() && branchResult.stdout.trim() !== 'HEAD') {
    branch = branchResult.stdout.trim()
  }

  // 解析文件状态
  // -z 选项以 null 字符分隔条目
  const entries = porcelainOutput.split('\0').filter((e) => e.length > 0 && !e.startsWith('## '))

  const fileChanges = parsePorcelainStatus(entries.join('\n'))

  // 分类文件
  const staged: GitFileChange[] = []
  const unstaged: GitFileChange[] = []
  const untracked: GitFileChange[] = []
  let hasConflicts = false

  for (const fc of fileChanges) {
    // 检测冲突
    if (fc.stagedStatus === 'conflicted' || fc.unstagedStatus === 'conflicted') {
      hasConflicts = true
    }

    // 分类
    if (fc.stagedStatus === 'untracked') {
      untracked.push({
        filePath: fc.filePath,
        stagedStatus: null,
        unstagedStatus: 'untracked',
        area: 'untracked',
      })
    } else {
      if (fc.stagedStatus !== null) {
        staged.push({
          filePath: fc.filePath,
          stagedStatus: fc.stagedStatus,
          unstagedStatus: fc.unstagedStatus,
          area: 'staged',
        })
      }
      if (fc.unstagedStatus !== null && fc.stagedStatus !== 'untracked') {
        unstaged.push({
          filePath: fc.filePath,
          stagedStatus: fc.stagedStatus,
          unstagedStatus: fc.unstagedStatus,
          area: 'unstaged',
        })
      }
    }
  }

  // 检测 in-progress 操作
  let inProgress: GitStatus['inProgress'] = 'none'
  if (existsSync(join(cwd, '.git', 'rebase-merge')) || existsSync(join(cwd, '.git', 'rebase-apply'))) {
    inProgress = 'rebase'
  } else if (existsSync(join(cwd, '.git', 'MERGE_HEAD'))) {
    inProgress = 'merge'
  } else if (existsSync(join(cwd, '.git', 'CHERRY_PICK_HEAD'))) {
    inProgress = 'cherry-pick'
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    hasConflicts,
    headSha: headResult.stdout.trim() || null,
    inProgress,
  }
}

// ─── Git Diff ────────────────────────────────────────────────

/**
 * 解析 git diff --numstat 输出。
 */
function parseDiffStats(output: string): GitDiffStat[] {
  const stats: GitDiffStat[] = []
  const lines = output.split('\n').filter((l) => l.trim().length > 0)

  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 3) continue

    const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
    const filePath = parts.slice(2).join('\t')

    stats.push({ filePath, additions, deletions })
  }

  return stats
}

/**
 * 获取 Git diff。
 *
 * @param cwd - 仓库路径
 * @param options - diff 选项
 * @returns diff 结果
 */
export async function getGitDiff(
  cwd: string,
  options: {
    mode?: GitDiffMode
    filePath?: string
    baseRef?: string
    targetRef?: string
    maxPatchLength?: number
  } = {},
): Promise<GitDiffResult> {
  await validateGitRepo(cwd)

  const mode = options.mode ?? 'unstaged'
  const maxPatch = options.maxPatchLength ?? MAX_DIFF_PATCH

  // 构建 git diff 参数
  const diffArgs: string[] = ['diff']

  switch (mode) {
    case 'staged':
      diffArgs.push('--cached')
      break
    case 'committed':
      if (options.baseRef) {
        diffArgs.push(options.baseRef)
        if (options.targetRef) {
          diffArgs.push(options.targetRef)
        }
      } else {
        // 使用 HEAD~1..HEAD 范围，兼容单提交仓库
        diffArgs.push('HEAD~1', 'HEAD')
      }
      break
    case 'branch':
      if (options.baseRef && options.targetRef) {
        diffArgs.push(options.baseRef, options.targetRef)
      } else if (options.baseRef) {
        diffArgs.push(options.baseRef)
      } else {
        diffArgs.push('HEAD~1', 'HEAD')
      }
      break
    case 'unstaged':
    default:
      // 默认就是 unstaged，不需要额外参数
      break
  }

  // 指定文件
  if (options.filePath) {
    diffArgs.push('--', options.filePath)
  }

  // 并行获取 patch 和 numstat
  const numstatArgs = [...diffArgs, '--numstat']

  let patchResult: GitExecResult
  let numstatResult: GitExecResult
  try {
    [patchResult, numstatResult] = await Promise.all([
      gitExec(diffArgs, { cwd }),
      gitExec(numstatArgs, { cwd }),
    ])
  } catch (error) {
    // HEAD~1 在单提交仓库中不存在，回退到与空树比较
    if (error instanceof AppError && error.details?.['exitCode'] === 128) {
      const emptyTreeArgs = diffArgs.map((a) => a === 'HEAD~1' ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : a)
      const emptyNumstatArgs = [...emptyTreeArgs, '--numstat']
      ;[patchResult, numstatResult] = await Promise.all([
        gitExec(emptyTreeArgs, { cwd }),
        gitExec(emptyNumstatArgs, { cwd }),
      ])
    } else {
      throw error
    }
  }

  const patch = patchResult.stdout
  const truncated = patch.length > maxPatch

  return {
    mode,
    patch: truncated ? patch.slice(0, maxPatch) + '\n... (truncated)' : patch,
    stats: parseDiffStats(numstatResult.stdout),
    truncated,
  }
}

// ─── Git Log ─────────────────────────────────────────────────

/**
 * 获取 Git 提交日志。
 *
 * @param cwd - 仓库路径
 * @param options - log 选项
 * @returns 提交日志数组
 */
export async function getGitLog(
  cwd: string,
  options: {
    limit?: number
    branch?: string
    filePath?: string
    author?: string
    since?: string
    until?: string
    grep?: string
  } = {},
): Promise<GitLogEntry[]> {
  await validateGitRepo(cwd)

  const limit = Math.min(options.limit ?? DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT)

  // 使用 tab 分隔字段，每行一个提交
  // %s = subject（单行），%D = refs（单行）
  const format = '%H\t%h\t%an\t%ae\t%aI\t%s\t%D'

  const args: string[] = ['log', `--format=${format}`]

  if (options.limit) {
    args.push(`-n${limit}`)
  } else {
    args.push(`-n${DEFAULT_LOG_LIMIT}`)
  }

  if (options.branch) {
    args.push(options.branch)
  }

  if (options.filePath) {
    args.push('--', options.filePath)
  }

  if (options.author) {
    args.push(`--author=${options.author}`)
  }

  if (options.since) {
    args.push(`--since=${options.since}`)
  }

  if (options.until) {
    args.push(`--until=${options.until}`)
  }

  if (options.grep) {
    args.push(`--grep=${options.grep}`)
  }

  const result = await gitExec(args, { cwd })

  // 解析输出：每行一个提交，字段以 tab 分隔
  const entries: GitLogEntry[] = []
  const rawEntries = result.stdout.split('\n').filter((e) => e.trim().length > 0)

  for (const rawEntry of rawEntries) {
    const fields = rawEntry.split('\t')
    if (fields.length < 6) continue

    const refsStr = fields[6]?.trim() ?? ''
    const refs = refsStr.length > 0
      ? refsStr.split(',').map((r) => r.trim()).filter((r) => r.length > 0)
      : []

    entries.push({
      sha: fields[0],
      shortSha: fields[1],
      author: fields[2],
      authorEmail: fields[3],
      date: fields[4],
      message: fields[5],
      refs,
    })
  }

  return entries
}

// ─── Git Branch ──────────────────────────────────────────────

/**
 * 列出所有分支。
 *
 * @param cwd - 仓库路径
 * @param options - 选项
 * @returns 分支列表
 */
export async function listBranches(
  cwd: string,
  options: { remote?: boolean } = {},
): Promise<GitBranch[]> {
  await validateGitRepo(cwd)

  const args: string[] = [
    'branch',
    '--format=%(HEAD) %(refname:short)|%(upstream:short)|%(objectname:short)',
  ]

  if (options.remote) {
    args.push('-r')
  }

  const result = await gitExec(args, { cwd })
  const branches: GitBranch[] = []

  const lines = result.stdout.split('\n').filter((l) => l.trim().length > 0)

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    const parts = trimmed.split('|')
    if (parts.length < 1) continue

    const headAndName = parts[0].trim()
    const upstream = parts[1]?.trim() || null
    const lastCommitSha = parts[2]?.trim() || null

    const isCurrent = headAndName.startsWith('*')
    const name = headAndName.replace('*', '').trim()
    const isRemote = name.includes('/')

    branches.push({
      name,
      isCurrent,
      isRemote,
      upstream: upstream || null,
      lastCommitSha,
    })
  }

  return branches
}

/**
 * 创建新分支。
 *
 * @param cwd - 仓库路径
 * @param branchName - 新分支名
 * @param options - 选项
 * @returns 创建结果
 * @throws {AppError} GIT_BRANCH_EXISTS - 分支已存在
 */
export async function createBranch(
  cwd: string,
  branchName: string,
  options: { switchTo?: boolean; baseRef?: string } = {},
): Promise<GitCreateBranchResult> {
  await validateGitRepo(cwd)

  const switchTo = options.switchTo ?? true
  const baseRef = options.baseRef ?? 'HEAD'

  // 检查分支是否已存在
  const existingBranches = await listBranches(cwd)
  if (existingBranches.some((b) => b.name === branchName)) {
    throw new AppError(
      ErrorCodes.GIT_BRANCH_EXISTS,
      `Branch "${branchName}" already exists.`,
      { branchName },
    )
  }

  // 创建分支
  const args: string[] = switchTo
    ? ['checkout', '-b', branchName]
    : ['branch', branchName]

  if (baseRef !== 'HEAD') {
    args.push(baseRef)
  }

  await gitExec(args, { cwd })

  return {
    branchName,
    switched: switchTo,
    baseRef,
  }
}

// ─── Git Add ─────────────────────────────────────────────────

/**
 * 将文件添加到暂存区。
 *
 * @param cwd - 仓库路径
 * @param files - 文件路径数组，传入 ['.'] 表示所有变更
 */
export async function gitAdd(cwd: string, files: string[]): Promise<void> {
  await validateGitRepo(cwd)

  if (files.length === 0) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'At least one file path is required.',
      { files },
    )
  }

  const args: string[] = ['add', '--', ...files]
  await gitExec(args, { cwd })
}

// ─── Git Commit ──────────────────────────────────────────────

/**
 * 提交暂存区的变更。
 *
 * @param cwd - 仓库路径
 * @param message - 提交消息
 * @param options - 选项
 * @returns 提交结果
 * @throws {AppError} GIT_NOTHING_TO_COMMIT - 没有变更可提交
 */
export async function gitCommit(
  cwd: string,
  message: string,
  options: { amend?: boolean; addAll?: boolean } = {},
): Promise<GitCommitResult> {
  await validateGitRepo(cwd)

  // 如果指定 addAll，先添加所有变更
  if (options.addAll) {
    await gitExec(['add', '-A'], { cwd })
  }

  // 检查是否有暂存的变更
  const statusResult = await gitExec(['status', '--porcelain=v1'], { cwd })
  const hasStaged = statusResult.stdout
    .split('\n')
    .some((line) => line.length >= 2 && line[0] !== ' ' && line[0] !== '?')

  if (!hasStaged && !options.amend) {
    throw new AppError(
      ErrorCodes.GIT_NOTHING_TO_COMMIT,
      'Nothing to commit. Use addAll option to stage all changes first.',
      { cwd },
    )
  }

  // 提交
  const commitArgs: string[] = ['commit', '-m', message]
  if (options.amend) {
    commitArgs.push('--amend', '--no-edit')
  }

  await gitExec(commitArgs, { cwd })

  // 获取提交结果信息
  const [shaResult, statResult] = await Promise.all([
    gitExec(['rev-parse', 'HEAD'], { cwd }),
    gitExec(['show', '--stat', '--format=', 'HEAD'], { cwd }),
  ])

  const sha = shaResult.stdout.trim()
  const shortSha = sha.slice(0, 7)

  // 解析统计信息
  let filesChanged = 0
  let insertions = 0
  let deletions = 0

  const statLines = statResult.stdout.split('\n')
  for (const line of statLines) {
    const m = line.match(/(\d+) files? changed/)
    if (m) {
      filesChanged = parseInt(m[1], 10)
    }
    const insMatch = line.match(/(\d+) insertions?\(\+\)/)
    if (insMatch) {
      insertions = parseInt(insMatch[1], 10)
    }
    const delMatch = line.match(/(\d+) deletions?\(-\)/)
    if (delMatch) {
      deletions = parseInt(delMatch[1], 10)
    }
  }

  return {
    sha,
    shortSha,
    message: options.amend ? '(amended) ' + message : message,
    filesChanged,
    insertions,
    deletions,
  }
}

// ─── Git Create PR ───────────────────────────────────────────

/**
 * 创建 Pull Request。
 * 优先使用 gh CLI（GitHub），回退到打开浏览器 URL。
 *
 * @param cwd - 仓库路径
 * @param options - PR 选项
 * @returns PR 创建结果
 * @throws {AppError} GIT_PR_CREATE_FAILED - PR 创建失败
 */
export async function createPullRequest(
  cwd: string,
  options: {
    title: string
    body?: string
    base?: string
    head?: string
    draft?: boolean
  },
): Promise<GitCreatePrResult> {
  await validateGitRepo(cwd)

  // 获取当前分支作为 head
  const branchResult = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  const currentBranch = branchResult.stdout.trim()
  const head = options.head ?? currentBranch

  // 获取默认分支作为 base
  let base = options.base ?? 'main'
  if (!options.base) {
    try {
      const defaultResult = await gitExec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd })
      const ref = defaultResult.stdout.trim()
      base = ref.replace('origin/', '')
    } catch {
      // 回退到 main
    }
  }

  // 尝试使用 gh CLI 创建 PR
  const ghArgs: string[] = [
    'pr', 'create',
    '--title', options.title,
    '--base', base,
    '--head', head,
  ]

  if (options.body) {
    ghArgs.push('--body', options.body)
  }

  if (options.draft) {
    ghArgs.push('--draft')
  }

  try {
    const result = await gitExec(ghArgs, { cwd, env: { GH_TOKEN: process.env.GH_TOKEN ?? '' } })

    // gh pr create 输出 PR URL，如:
    // https://github.com/owner/repo/pull/123
    const urlMatch = result.stdout.match(/https:\/\/\S+\/pull\/(\d+)/)
    if (urlMatch) {
      return {
        url: urlMatch[0],
        number: parseInt(urlMatch[1], 10),
        title: options.title,
        base,
        head,
        draft: options.draft ?? false,
      }
    }

    // 如果输出不是标准 URL 格式，尝试解析
    return {
      url: result.stdout.trim(),
      number: 0,
      title: options.title,
      base,
      head,
      draft: options.draft ?? false,
    }
  } catch {
    // gh CLI 不可用或失败，回退到生成 PR URL
    // 获取远程仓库 URL
    try {
      const remoteResult = await gitExec(['remote', 'get-url', 'origin'], { cwd })
      const remoteUrl = remoteResult.stdout.trim()

      // 解析 GitHub URL
      const ghMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^.\s]+)/)
      if (ghMatch) {
        const owner = ghMatch[1]
        const repo = ghMatch[2].replace(/\.git$/, '')
        const prUrl = `https://github.com/${owner}/${repo}/compare/${base}...${head}?expand=1`

        throw new AppError(
          ErrorCodes.GIT_PR_CREATE_FAILED,
          `GitHub CLI (gh) is not available or failed. Open this URL to create PR manually: ${prUrl}`,
          { url: prUrl, base, head, title: options.title },
        )
      }

      // 解析 Gitee URL
      const giteeMatch = remoteUrl.match(/gitee\.com[:/]([^/]+)\/([^.\s]+)/)
      if (giteeMatch) {
        const owner = giteeMatch[1]
        const repo = giteeMatch[2].replace(/\.git$/, '')
        const prUrl = `https://gitee.com/${owner}/${repo}/compare/${base}...${head}`

        throw new AppError(
          ErrorCodes.GIT_PR_CREATE_FAILED,
          `Gitee CLI is not available. Open this URL to create PR manually: ${prUrl}`,
          { url: prUrl, base, head, title: options.title },
        )
      }

      throw new AppError(
        ErrorCodes.GIT_PR_CREATE_FAILED,
        'Failed to create PR: unable to determine remote repository URL. Ensure gh CLI is installed or provide a remote URL.',
        { base, head, title: options.title },
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.GIT_PR_CREATE_FAILED,
        `Failed to create PR: ${error instanceof Error ? error.message : String(error)}`,
        { base, head, title: options.title },
      )
    }
  }
}
