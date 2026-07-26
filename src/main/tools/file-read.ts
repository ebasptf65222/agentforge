// AgentForge P2-05: file_read 内置工具
// 读取 UTF-8 文本文件，最大 1MB，拒绝路径穿越
// 与 Spec v0.2 §5.5 工具类型一致

import { readFile, stat } from 'node:fs/promises'
import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

/** 文件大小上限：1MB */
const MAX_FILE_SIZE = 1024 * 1024

/**
 * 路径安全检查：拒绝包含 `..` 的路径，防止目录穿越。
 */
export function isPathSafe(path: string): boolean {
  return !path.includes('..')
}

/** file_read 工具定义与执行函数 */
export const fileReadTool: BuiltinTool = {
  definition: {
    name: 'file_read',
    description: 'Read text file content',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative file path',
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

    let stats
    try {
      stats = await stat(path)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        throw new AppError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${path}`, { path })
      }
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Cannot access file: ${err.message}`, {
        path,
        errno: err.code,
      })
    }

    if (!stats.isFile()) {
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Path is not a file: ${path}`, { path })
    }

    if (stats.size > MAX_FILE_SIZE) {
      throw new AppError(
        ErrorCodes.FILE_TOO_LARGE,
        `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`,
        { path, size: stats.size, max: MAX_FILE_SIZE },
      )
    }

    try {
      const content = await readFile(path, 'utf-8')
      return {
        isError: false,
        content,
        metadata: { path, size: stats.size },
      }
    } catch (error) {
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        { path },
      )
    }
  },
}
