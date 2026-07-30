// AgentForge 架构优化批次B-2: WorkspaceService
//
// 工作区服务抽象层，将文件操作业务逻辑从 IPC handler 中分离。
//
// 职责：
// 1. 工作区路径管理与验证
// 2. 路径安全解析（path-guard 防逃逸）
// 3. 文件读写、目录列表、创建、删除、重命名、文件树
// 4. 写入/删除前自动快照（checkpoint 集成）
//
// IPC handler 仅负责参数校验，实际文件操作委托给本服务。

import { readFile, writeFile, readdir, stat, mkdir, rm, rmdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import type { FileTreeNode, WorkspaceDirectoryEntry } from '@shared/types'
import { getSettings } from '../db/repos/app-settings'
import { resolveWorkspacePath } from '../tools/path-guard'
import { AppError, ErrorCodes } from '../utils/error'
import { snapshotBeforeWrite, snapshotBeforeDelete } from '../checkpoint'

/** 文件大小上限：1MB（读取） */
const MAX_FILE_SIZE = 1024 * 1024

/** 写入内容大小上限：5MB */
const MAX_WRITE_SIZE = 5 * 1024 * 1024

/** 文件树最大深度 */
const MAX_TREE_DEPTH = 5

/** 默认排除模式 */
const DEFAULT_EXCLUDE_PATTERNS = ['node_modules', '.git', 'dist', '.DS_Store']

/**
 * 工作区服务。
 *
 * 封装工作区文件操作的业务逻辑，供 IPC handler 和其他模块调用。
 * 使用单例模式，通过 getWorkspaceService() 获取实例。
 */
export class WorkspaceService {
  // ─── 路径管理 ────────────────────────────────────────────────

  /**
   * 获取当前工作区路径，并验证其有效性。
   * @returns 工作区根目录绝对路径
   * @throws {AppError} WORKSPACE_NOT_SET - 未设置工作区
   * @throws {AppError} WORKSPACE_PATH_INVALID - 工作区路径不存在或不可访问
   */
  getPath(): string {
    const settings = getSettings()
    const wsPath = settings.workspace.path

    if (wsPath === null) {
      throw new AppError(
        ErrorCodes.WORKSPACE_NOT_SET,
        'Workspace is not set. Please select a workspace directory in Settings.',
      )
    }

    if (!existsSync(wsPath)) {
      throw new AppError(
        ErrorCodes.WORKSPACE_PATH_INVALID,
        `Workspace path does not exist or is not accessible: ${wsPath}`,
        { path: wsPath },
      )
    }

    return wsPath
  }

  /**
   * 获取排除模式列表。
   */
  getExcludePatterns(): string[] {
    const settings = getSettings()
    return settings.workspace.excludePatterns.length > 0
      ? settings.workspace.excludePatterns
      : DEFAULT_EXCLUDE_PATTERNS
  }

  /**
   * 将相对路径解析为绝对路径，并进行安全校验。
   * @param relativePath - 相对于工作区根的路径
   * @returns 绝对路径
   * @throws {AppError} WORKSPACE_PATH_ESCAPE - 路径逃逸
   */
  resolvePath(relativePath: string): string {
    return resolveWorkspacePath(this.getPath(), relativePath)
  }

  // ─── 文件操作 ────────────────────────────────────────────────

  /**
   * 读取工作区内文件内容。
   * @param relativePath - 相对于工作区根的路径
   * @returns 文件内容字符串
   * @throws {AppError} FILE_NOT_FOUND, FILE_ACCESS_ERROR, FILE_TOO_LARGE, WORKSPACE_PATH_ESCAPE
   */
  async readFile(relativePath: string): Promise<string> {
    const absPath = this.resolvePath(relativePath)

    let stats
    try {
      stats = await stat(absPath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        throw new AppError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${relativePath}`, { path: relativePath })
      }
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot access file: ${err.message}`, { path: relativePath })
    }

    if (!stats.isFile()) {
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Path is not a file: ${relativePath}`, { path: relativePath })
    }

    if (stats.size > MAX_FILE_SIZE) {
      throw new AppError(
        ErrorCodes.FILE_TOO_LARGE,
        `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`,
        { path: relativePath, size: stats.size, max: MAX_FILE_SIZE },
      )
    }

    try {
      return await readFile(absPath, 'utf-8')
    } catch (error) {
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        { path: relativePath },
      )
    }
  }

  /**
   * 写入/创建工作区内文件，自动创建父目录。
   * @param relativePath - 相对于工作区根的路径
   * @param content - 文件内容
   * @returns 写入字节数
   * @throws {AppError} FILE_TOO_LARGE, FILE_ACCESS_ERROR, WORKSPACE_PATH_ESCAPE
   */
  async writeFile(relativePath: string, content: string): Promise<number> {
    const contentSize = Buffer.byteLength(content, 'utf-8')
    if (contentSize > MAX_WRITE_SIZE) {
      throw new AppError(
        ErrorCodes.FILE_TOO_LARGE,
        `Content too large: ${contentSize} bytes (max ${MAX_WRITE_SIZE} bytes)`,
        { path: relativePath, size: contentSize, max: MAX_WRITE_SIZE },
      )
    }

    const absPath = this.resolvePath(relativePath)

    // P2-02: 写入前自动创建快照（仅当文件已存在时）
    try {
      await snapshotBeforeWrite(relativePath, content)
    } catch {
      // 快照失败不应阻止写入，静默忽略
    }

    // 自动创建父目录
    const parentDir = resolve(absPath, '..')
    try {
      await mkdir(parentDir, { recursive: true })
    } catch (error) {
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to create parent directory: ${error instanceof Error ? error.message : String(error)}`,
        { path: relativePath },
      )
    }

    try {
      await writeFile(absPath, content, 'utf-8')
      const stats = await stat(absPath)
      return stats.size
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Permission denied: ${relativePath}`, { path: relativePath })
      }
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to write file: ${err.message}`,
        { path: relativePath },
      )
    }
  }

  /**
   * 列出工作区内指定目录的条目。
   * @param relativePath - 相对于工作区根的路径（默认为根目录）
   * @returns 目录条目列表
   * @throws {AppError} FILE_NOT_FOUND, FILE_ACCESS_ERROR, WORKSPACE_PATH_ESCAPE
   */
  async listDirectory(relativePath?: string): Promise<WorkspaceDirectoryEntry[]> {
    const targetPath = relativePath ?? '.'
    const absPath = this.resolvePath(targetPath)

    let entries
    try {
      entries = await readdir(absPath, { withFileTypes: true })
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        throw new AppError(ErrorCodes.FILE_NOT_FOUND, `Directory not found: ${targetPath}`, { path: targetPath })
      }
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot list directory: ${err.message}`, { path: targetPath })
    }

    const result: WorkspaceDirectoryEntry[] = []
    for (const entry of entries) {
      let stats
      try {
        stats = await stat(join(absPath, entry.name))
      } catch {
        continue
      }
      result.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: stats.isFile() ? stats.size : 0,
        modifiedAt: stats.mtimeMs,
      })
    }

    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * 在工作区内创建目录（支持递归创建）。
   * @param relativePath - 相对于工作区根的路径
   * @throws {AppError} FILE_ACCESS_ERROR, WORKSPACE_PATH_ESCAPE
   */
  async makeDirectory(relativePath: string): Promise<void> {
    const absPath = this.resolvePath(relativePath)

    try {
      await mkdir(absPath, { recursive: true })
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Permission denied: ${relativePath}`, { path: relativePath })
      }
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to create directory: ${err.message}`,
        { path: relativePath },
      )
    }
  }

  /**
   * 删除工作区内的文件或空目录。
   * 不递归删除非空目录。
   * @param relativePath - 相对于工作区根的路径
   * @throws {AppError} FILE_NOT_FOUND, DIRECTORY_NOT_EMPTY, FILE_ACCESS_ERROR, WORKSPACE_PATH_ESCAPE
   */
  async delete(relativePath: string): Promise<void> {
    const absPath = this.resolvePath(relativePath)

    let stats
    try {
      stats = await stat(absPath)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        throw new AppError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${relativePath}`, { path: relativePath })
      }
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot access: ${err.message}`, { path: relativePath })
    }

    if (stats.isDirectory()) {
      let entries
      try {
        entries = await readdir(absPath)
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot read directory: ${err.message}`, { path: relativePath })
      }
      if (entries.length > 0) {
        throw new AppError(
          ErrorCodes.DIRECTORY_NOT_EMPTY,
          `Directory is not empty: ${relativePath}. Use recursive delete or remove contents first.`,
          { path: relativePath, entryCount: entries.length },
        )
      }
    }

    // P2-02: 删除前自动创建快照（仅当文件存在时）
    if (stats.isFile()) {
      try {
        await snapshotBeforeDelete(relativePath)
      } catch {
        // 快照失败不应阻止删除，静默忽略
      }
    }

    try {
      if (stats.isDirectory()) {
        await rmdir(absPath)
      } else {
        await rm(absPath, { recursive: false })
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Permission denied: ${relativePath}`, { path: relativePath })
      }
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to delete: ${err.message}`,
        { path: relativePath },
      )
    }
  }

  /**
   * 重命名/移动工作区内的文件或目录。
   * @param from - 源路径（相对路径）
   * @param to - 目标路径（相对路径）
   * @throws {AppError} FILE_NOT_FOUND, FILE_ACCESS_ERROR, WORKSPACE_PATH_ESCAPE
   */
  async rename(from: string, to: string): Promise<void> {
    const fromAbs = this.resolvePath(from)
    const toAbs = this.resolvePath(to)

    try {
      await rename(fromAbs, toAbs)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        throw new AppError(ErrorCodes.FILE_NOT_FOUND, `Source not found: ${from}`, { from, to })
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Permission denied: ${from} → ${to}`, { from, to })
      }
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to rename: ${err.message}`,
        { from, to },
      )
    }
  }

  /**
   * 获取工作区文件树结构。
   * @param relativePath - 起始路径（默认为根目录）
   * @param maxDepth - 最大递归深度（默认 5）
   * @returns 文件树根节点
   * @throws {AppError} FILE_NOT_FOUND, FILE_ACCESS_ERROR, WORKSPACE_PATH_ESCAPE
   */
  async getTree(relativePath?: string, maxDepth?: number): Promise<FileTreeNode> {
    const wsPath = this.getPath()
    const targetPath = relativePath ?? '.'
    const absPath = this.resolvePath(targetPath)
    const depth = Math.min(Math.max(maxDepth ?? MAX_TREE_DEPTH, 1), MAX_TREE_DEPTH)
    const excludePatterns = this.getExcludePatterns()

    async function buildTree(currentAbsPath: string, currentRelPath: string, currentDepth: number): Promise<FileTreeNode> {
      let stats
      try {
        stats = await stat(currentAbsPath)
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
          throw new AppError(ErrorCodes.FILE_NOT_FOUND, `Not found: ${currentRelPath}`, { path: currentRelPath })
        }
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot access: ${err.message}`, { path: currentRelPath })
      }

      const name = currentRelPath === '.' ? basename(wsPath) : basename(currentRelPath)
      const node: FileTreeNode = {
        id: currentRelPath,
        name,
        relativePath: currentRelPath,
        isDirectory: stats.isDirectory(),
        size: stats.isFile() ? stats.size : 0,
        modifiedAt: stats.mtimeMs,
        children: null,
      }

      if (stats.isDirectory() && currentDepth < depth) {
        let entries
        try {
          entries = await readdir(currentAbsPath, { withFileTypes: true })
        } catch {
          node.children = []
          return node
        }

        const children: FileTreeNode[] = []
        for (const entry of entries) {
          if (WorkspaceService.isExcluded(entry.name, excludePatterns)) continue

          const childRelPath = currentRelPath === '.' ? entry.name : join(currentRelPath, entry.name)
          const childAbsPath = join(currentAbsPath, entry.name)
          const childNode = await buildTree(childAbsPath, childRelPath, currentDepth + 1)
          children.push(childNode)
        }

        children.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })

        node.children = children
      }

      return node
    }

    return buildTree(absPath, targetPath, 0)
  }

  // ─── 辅助方法 ────────────────────────────────────────────────

  /**
   * 检查文件名是否匹配排除模式。
   */
  private static isExcluded(name: string, patterns: string[]): boolean {
    return patterns.some((p) => name === p || name.startsWith(p + '/'))
  }
}

// ─── 单例 ──────────────────────────────────────────────────────

let workspaceService: WorkspaceService | null = null

/**
 * 获取工作区服务单例。
 */
export function getWorkspaceService(): WorkspaceService {
  if (!workspaceService) {
    workspaceService = new WorkspaceService()
  }
  return workspaceService
}

/**
 * 重置工作区服务单例（仅供测试使用）。
 */
export function resetWorkspaceService(): void {
  workspaceService = null
}
