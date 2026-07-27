// AgentForge P2-05: directory_list 内置工具
// 列出目录条目（name / isDirectory / size）
// OPT-01: 路径校验统一委托 workspace IPC handler（内部使用 path-guard 模块）

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { handleWsList } from '../ipc/workspace'
import type { BuiltinTool } from './types'

/** directory_list 工具定义与执行函数 */
export const directoryListTool: BuiltinTool = {
  definition: {
    name: 'directory_list',
    description: 'List directory contents within the workspace directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative directory path within the workspace directory',
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

    // OPT-01: 委托 handleWsList，其内部通过 resolveWorkspacePath
    // 进行完整路径边界校验：绝对路径拒绝、../ 逃逸、符号链接逃逸
    try {
      const entries = await handleWsList(path)
      return {
        isError: false,
        content: JSON.stringify({ path, entries }),
        metadata: { count: entries.length },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
        { path },
      )
    }
  },
}
