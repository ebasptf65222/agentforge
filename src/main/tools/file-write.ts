// AgentForge P2-05: file_write 内置工具
// 写入内容到文件，自动创建目录，拒绝路径穿越
// 与 Spec v0.2 §5.5 工具类型一致

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

/**
 * 路径安全检查：拒绝包含 `..` 的路径，防止目录穿越。
 */
export function isPathSafe(path: string): boolean {
  return !path.includes('..')
}

/** file_write 工具定义与执行函数 */
export const fileWriteTool: BuiltinTool = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative file path',
        },
        content: {
          type: 'string',
          description: 'Content to write',
        },
      },
      required: ['path', 'content'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = args['path']
    const content = args['content']

    if (typeof path !== 'string' || path.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Path must be a non-empty string.', { path })
    }
    if (typeof content !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Content must be a string.', {
        contentType: typeof content,
      })
    }

    if (!isPathSafe(path)) {
      throw new AppError(ErrorCodes.FILE_ACCESS_ERROR, `Path traversal not allowed: ${path}`, {
        path,
      })
    }

    try {
      // 自动创建父目录
      const dir = dirname(path)
      if (dir) {
        await mkdir(dir, { recursive: true })
      }
      await writeFile(path, content, 'utf-8')
      return {
        isError: false,
        content: `Successfully wrote ${content.length} characters to ${path}`,
        metadata: { path, bytes: content.length },
      }
    } catch (error) {
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        { path },
      )
    }
  },
}
