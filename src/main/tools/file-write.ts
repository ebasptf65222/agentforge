// AgentForge P2-05: file_write 内置工具
// 写入内容到文件，自动创建目录
// OPT-01: 路径校验统一委托 workspace IPC handler（内部使用 path-guard 模块）

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { handleWsWrite } from '../ipc/workspace'
import type { BuiltinTool } from './types'

/** file_write 工具定义与执行函数 */
export const fileWriteTool: BuiltinTool = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file in the workspace directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path within the workspace directory',
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

    // OPT-01: 委托 handleWsWrite，其内部通过 resolveWorkspacePath
    // 进行完整路径边界校验：绝对路径拒绝、../ 逃逸、符号链接逃逸
    try {
      const bytes = await handleWsWrite(path, content)
      return {
        isError: false,
        content: `Successfully wrote ${bytes} bytes to ${path}`,
        metadata: { path, bytes },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.FILE_ACCESS_ERROR,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        { path },
      )
    }
  },
}
