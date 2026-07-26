// AgentForge P2-05: directory_list 内置工具
// 列出目录条目（name / isDirectory / size），拒绝路径穿越
// 与 Spec v0.2 §5.5 工具类型一致

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

/** 目录条目 */
export interface DirectoryEntry {
  name: string
  isDirectory: boolean
  size: number
}

/**
 * 路径安全检查：拒绝包含 `..` 的路径，防止目录穿越。
 */
export function isPathSafe(path: string): boolean {
  return !path.includes('..')
}

/** directory_list 工具定义与执行函数 */
export const directoryListTool: BuiltinTool = {
  definition: {
    name: 'directory_list',
    description: 'List directory contents',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative directory path',
        },
      },
      required: ['path'],
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = args['path']
    if (typeof path !== 'string' || path.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Path must be a non-empty string.', { path })
    }

    if (!isPathSafe(path)) {
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Path traversal not allowed: ${path}`, {
        path,
      })
    }

    let names: string[]
    try {
      names = await readdir(path)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        throw new AppError(ErrorCodes.FILE_NOT_FOUND, `Directory not found: ${path}`, { path })
      }
      if (err.code === 'ENOTDIR') {
        throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Path is not a directory: ${path}`, {
          path,
        })
      }
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot list directory: ${err.message}`, {
        path,
        errno: err.code,
      })
    }

    const entries: DirectoryEntry[] = []
    for (const name of names) {
      const fullPath = join(path, name)
      try {
        const stats = await stat(fullPath)
        entries.push({
          name,
          isDirectory: stats.isDirectory(),
          size: stats.size,
        })
      } catch {
        // 跳过无法 stat 的条目（如权限不足、已删除等）
      }
    }

    return {
      isError: false,
      content: JSON.stringify({ path, entries }),
      metadata: { count: entries.length },
    }
  },
}
