// AgentForge 共享类型定义 - Git 工作流类型 (P1-03)
// 与 Spec v0.2 §5.7a 一致

import type { GitStatusCode, GitFileArea, GitDiffMode } from './enums'

// ─── 5.7a Git 工作流类型 (P1-03) ────────────────────────────────

/** Git 文件变更信息 */
export interface GitFileChange {
  /** 文件路径 */
  filePath: string
  /** 暂存区状态码 */
  stagedStatus: GitStatusCode | null
  /** 工作区状态码 */
  unstagedStatus: GitStatusCode | null
  /** 所属区域 */
  area: GitFileArea
}

/** Git 状态摘要 */
export interface GitStatus {
  /** 当前分支名 */
  branch: string
  /** 上游分支（如 origin/main），无则为 null */
  upstream: string | null
  /** 领先上游的提交数 */
  ahead: number
  /** 落后上游的提交数 */
  behind: number
  /** 暂存的文件变更 */
  staged: GitFileChange[]
  /** 未暂存的文件变更 */
  unstaged: GitFileChange[]
  /** 未跟踪的文件 */
  untracked: GitFileChange[]
  /** 是否有冲突 */
  hasConflicts: boolean
  /** HEAD 提交哈希（短） */
  headSha: string | null
  /** 是否处于 rebase/cherry-pick/merge 状态 */
  inProgress: 'none' | 'rebase' | 'merge' | 'cherry-pick'
}

/** Git diff 结果 */
export interface GitDiffResult {
  /** diff 模式 */
  mode: GitDiffMode
  /** diff 原始输出 */
  patch: string
  /** 变更文件统计 */
  stats: GitDiffStat[]
  /** 是否被截断 */
  truncated: boolean
}

/** Git diff 单文件统计 */
export interface GitDiffStat {
  filePath: string
  additions: number
  deletions: number
}

/** Git 提交日志条目 */
export interface GitLogEntry {
  /** 完整 SHA */
  sha: string
  /** 短 SHA */
  shortSha: string
  /** 作者名 */
  author: string
  /** 作者邮箱 */
  authorEmail: string
  /** 提交时间（ISO 字符串） */
  date: string
  /** 提交消息 */
  message: string
  /** 引用分支列表 */
  refs: string[]
}

/** Git 分支信息 */
export interface GitBranch {
  /** 分支名 */
  name: string
  /** 是否为当前分支 */
  isCurrent: boolean
  /** 是否为远程分支 */
  isRemote: boolean
  /** 上游跟踪分支 */
  upstream: string | null
  /** 最后提交 SHA（短） */
  lastCommitSha: string | null
}

/** Git 提交结果 */
export interface GitCommitResult {
  /** 提交 SHA（完整） */
  sha: string
  /** 提交 SHA（短） */
  shortSha: string
  /** 提交消息 */
  message: string
  /** 变更文件数 */
  filesChanged: number
  /** 新增行数 */
  insertions: number
  /** 删除行数 */
  deletions: number
}

/** Git 创建分支结果 */
export interface GitCreateBranchResult {
  /** 分支名 */
  branchName: string
  /** 是否已切换到新分支 */
  switched: boolean
  /** 基于的分支/提交 */
  baseRef: string
}

/** Git 创建 PR 结果 */
export interface GitCreatePrResult {
  /** PR URL */
  url: string
  /** PR 编号 */
  number: number
  /** PR 标题 */
  title: string
  /** 目标分支 */
  base: string
  /** 源分支 */
  head: string
  /** 是否为草稿 */
  draft: boolean
}
