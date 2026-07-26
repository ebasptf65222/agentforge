// AgentForge 工作区路径安全校验模块
// 确保所有文件操作路径都在工作区根目录内
// 防止通过 `..` 或符号链接逃逸工作区

import { resolve, sep } from 'node:path'
import { realpathSync, existsSync } from 'node:fs'
import { AppError, ErrorCodes } from '../utils/error'

/**
 * 判断已解析的绝对路径是否在工作区内。
 *
 * 校验逻辑：
 * 1. 规范化两个路径（resolve 消除 `..` 等）
 * 2. 使用 realpath 解析符号链接
 * 3. 检查 resolvedPath 是否等于 workspacePath 或以其为前缀
 *
 * @param workspacePath - 工作区根目录绝对路径
 * @param resolvedPath - 待校验的绝对路径
 * @returns true 如果路径在工作区内；false 如果路径为空、null 或逃逸
 */
export function isPathInWorkspace(workspacePath: string, resolvedPath: string): boolean {
  // 空路径或 null 返回 false
  if (!workspacePath || !resolvedPath) {
    return false
  }

  const normalizedWorkspace = resolve(workspacePath)
  const normalizedResolved = resolve(resolvedPath)

  // 如果工作区路径本身不存在，直接返回 false
  if (!existsSync(normalizedWorkspace)) {
    return false
  }

  // 使用 realpath 解析符号链接，防止通过符号链接逃逸
  let realWorkspace: string
  let realResolved: string
  try {
    realWorkspace = realpathSync(normalizedWorkspace)
  } catch {
    // realpath 解析失败，无法确认安全性
    return false
  }

  try {
    realResolved = realpathSync(normalizedResolved)
  } catch {
    // 目标路径可能尚不存在（如 ws_write 创建新文件）
    // 此时用 normalize 后的路径进行前缀检查
    realResolved = normalizedResolved
  }

  // 检查路径是否在工作区内（等于根目录或以根目录 + 分隔符为前缀）
  return (
    realResolved === realWorkspace ||
    realResolved.startsWith(realWorkspace + sep)
  )
}

/**
 * 将相对路径解析为工作区内的绝对路径。
 *
 * 处理流程：
 * 1. 拼接工作区根路径与相对路径
 * 2. 规范化路径（消除 `..` 等）
 * 3. 校验结果路径是否在工作区内
 * 4. 校验通过返回绝对路径，否则抛出 WORKSPACE_PATH_ESCAPE
 *
 * @param workspacePath - 工作区根目录绝对路径
 * @param relativePath - 相对于工作区根的路径
 * @returns 工作区内的绝对路径
 * @throws {AppError} WORKSPACE_PATH_ESCAPE - 路径逃逸到工作区外
 */
export function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  const normalizedWorkspace = resolve(workspacePath)
  const resolved = resolve(normalizedWorkspace, relativePath)

  if (!isPathInWorkspace(normalizedWorkspace, resolved)) {
    throw new AppError(
      ErrorCodes.WORKSPACE_PATH_ESCAPE,
      `Path "${relativePath}" resolves outside the workspace boundary.`,
      { workspacePath: normalizedWorkspace, relativePath, resolvedPath: resolved },
    )
  }

  return resolved
}
