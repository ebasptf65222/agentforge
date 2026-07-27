// AgentForge P2-05: file_read 内置工具
// 读取 UTF-8 文本文件，最大 1MB
// OPT-01: 路径校验统一委托 workspace IPC handler（内部使用 path-guard 模块）

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { handleWsRead } from '../ipc/workspace'
import type { BuiltinTool } from './types'

/** file_read 工具定义与执行函数 */
export const fileReadTool: BuiltinTool = {
  definition: {
    name: 'file_read',
    description: 'Read text file content from the workspace directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path within the workspace directory',
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

    // OPT-01: 委托 handleWsRead，其内部通过 resolveWorkspacePath
    // 进行完整路径边界校验：绝对路径拒绝、../ 逃逸、符号链接逃逸
    try {
      const content = await handleWsRead(path)
      return {
        isError: false,
        content,
        metadata: { path },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        { path },
      )
    }
  },
}
