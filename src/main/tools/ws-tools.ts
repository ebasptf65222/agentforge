// AgentForge WS-03: 工作区文件操作 Agent 工具
// 7 个 ws_* 内置工具，注册到 ToolRegistry
// 与 workspace IPC handlers 共享底层文件操作逻辑

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  handleWsRead,
  handleWsWrite,
  handleWsList,
  handleWsMkdir,
  handleWsDelete,
  handleWsRename,
  handleWsTree,
} from '../ipc/workspace'

// ─── ws_read 工具 ──────────────────────────────────────────────

export const wsReadTool: BuiltinTool = {
  definition: {
    name: 'ws_read',
    description:
      '读取工作区内指定文件的内容（UTF-8 文本）。路径为相对于工作区根目录的相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的文件路径',
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
    const content = await handleWsRead(path)
    return {
      isError: false,
      content,
      metadata: { path },
    }
  },
}

// ─── ws_write 工具 ─────────────────────────────────────────────

export const wsWriteTool: BuiltinTool = {
  definition: {
    name: 'ws_write',
    description:
      '在工作区内创建或覆盖文件，自动创建父目录。路径为相对于工作区根目录的相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的文件路径',
        },
        content: {
          type: 'string',
          description: '文件内容（UTF-8 文本）',
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
      console.error('[ws_write] 参数校验失败: path 无效', { path })
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Path must be a non-empty string.', { path })
    }
    if (typeof content !== 'string') {
      console.error('[ws_write] 参数校验失败: content 不是字符串', { contentType: typeof content })
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Content must be a string.', { content })
    }
    console.warn('[ws_write] 写入', { path, contentLength: content.length })
    try {
      const bytes = await handleWsWrite(path, content)
      console.warn('[ws_write] 写入成功', { path, bytes })
      return {
        isError: false,
        content: `File written successfully: ${path} (${bytes} bytes)`,
        metadata: { path, bytes },
      }
    } catch (error) {
      console.error('[ws_write] ========== 写入失败 ==========', { path, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },
}

// ─── ws_list 工具 ──────────────────────────────────────────────

export const wsListTool: BuiltinTool = {
  definition: {
    name: 'ws_list',
    description:
      '列出工作区内指定目录的文件和子目录。路径为相对于工作区根目录的相对路径，默认为根目录。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的目录路径（默认为根目录）',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = typeof args['path'] === 'string' ? args['path'] : undefined
    const entries = await handleWsList(path)
    const formatted = entries
      .map((e) => `${e.isDirectory ? '[DIR] ' : '      '}${e.name}  ${e.size > 0 ? `(${e.size} bytes)` : ''}`)
      .join('\n')
    return {
      isError: false,
      content: formatted || '(empty directory)',
      metadata: { entries, count: entries.length },
    }
  },
}

// ─── ws_mkdir 工具 ─────────────────────────────────────────────

export const wsMkdirTool: BuiltinTool = {
  definition: {
    name: 'ws_mkdir',
    description:
      '在工作区内创建目录（支持递归创建）。路径为相对于工作区根目录的相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的目录路径',
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
    await handleWsMkdir(path)
    return {
      isError: false,
      content: `Directory created: ${path}`,
      metadata: { path },
    }
  },
}

// ─── ws_delete 工具 ─────────────────────────────────────────────

export const wsDeleteTool: BuiltinTool = {
  definition: {
    name: 'ws_delete',
    description:
      '删除工作区内的文件或空目录。不递归删除非空目录。路径为相对于工作区根目录的相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的文件或空目录路径',
        },
      },
      required: ['path'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = args['path']
    if (typeof path !== 'string' || path.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Path must be a non-empty string.', { path })
    }
    await handleWsDelete(path)
    return {
      isError: false,
      content: `Deleted: ${path}`,
      metadata: { path },
    }
  },
}

// ─── ws_rename 工具 ─────────────────────────────────────────────

export const wsRenameTool: BuiltinTool = {
  definition: {
    name: 'ws_rename',
    description:
      '重命名或移动工作区内的文件或目录。源路径和目标路径都必须在工作区内。',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: '源文件/目录的相对路径',
        },
        to: {
          type: 'string',
          description: '目标文件/目录的相对路径',
        },
      },
      required: ['from', 'to'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const from = args['from']
    const to = args['to']
    if (typeof from !== 'string' || from.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Source path must be a non-empty string.', { from })
    }
    if (typeof to !== 'string' || to.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Target path must be a non-empty string.', { to })
    }
    await handleWsRename(from, to)
    return {
      isError: false,
      content: `Renamed: ${from} → ${to}`,
      metadata: { from, to },
    }
  },
}

// ─── ws_file_tree 工具 ─────────────────────────────────────────

export const wsFileTreeTool: BuiltinTool = {
  definition: {
    name: 'ws_file_tree',
    description:
      '获取工作区文件树结构（递归，排除 node_modules 等）。路径为相对于工作区根目录的相对路径，默认为根目录。最大深度 5。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '起始目录的相对路径（默认为根目录）',
        },
        maxDepth: {
          type: 'number',
          description: '最大递归深度（1-5，默认 5）',
          minimum: 1,
          maximum: 5,
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = typeof args['path'] === 'string' ? args['path'] : undefined
    const maxDepth = typeof args['maxDepth'] === 'number' ? args['maxDepth'] : undefined
    const tree = await handleWsTree(path, maxDepth)
    return {
      isError: false,
      content: JSON.stringify(tree, null, 2),
      metadata: { tree },
    }
  },
}

// ─── 导出所有 ws_* 工具 ────────────────────────────────────────

export const allWsTools: BuiltinTool[] = [
  wsReadTool,
  wsWriteTool,
  wsListTool,
  wsMkdirTool,
  wsDeleteTool,
  wsRenameTool,
  wsFileTreeTool,
]
