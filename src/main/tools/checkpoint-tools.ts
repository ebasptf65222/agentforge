// AgentForge P2-02: Checkpoint Agent 工具
// 3 个 checkpoint_* 内置工具，注册到 ToolRegistry
// 让 Agent 能够列出快照、回滚到历史状态、查看差异

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  listCheckpoints,
  rollbackToCheckpoint,
  getCheckpointDiff,
} from '../checkpoint'

// ─── checkpoint_list 工具 ─────────────────────────────────────

export const checkpointListTool: BuiltinTool = {
  definition: {
    name: 'checkpoint_list',
    description:
      '列出文件或执行的快照历史。可按文件路径、执行 ID 或会话 ID 筛选。当需要查看文件修改历史、了解 Agent 做过哪些变更时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        relativePath: {
          type: 'string',
          description: '工作区相对文件路径（如指定则只返回该文件的快照）',
        },
        executionId: {
          type: 'string',
          description: 'Agent 执行 ID（如指定则只返回该执行期间的快照）',
        },
        limit: {
          type: 'number',
          description: '最大返回数量（默认 20，最大 100）',
          minimum: 1,
          maximum: 100,
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const options: Parameters<typeof listCheckpoints>[0] = {}

    if (typeof args['relativePath'] === 'string' && args['relativePath'].trim() !== '') {
      options.relativePath = args['relativePath']
    }
    if (typeof args['executionId'] === 'string' && args['executionId'].trim() !== '') {
      options.executionId = args['executionId']
    }
    if (args['limit'] !== undefined) {
      const limit = Number(args['limit'])
      if (!Number.isNaN(limit) && limit >= 1 && limit <= 100) {
        options.limit = Math.floor(limit)
      }
    }
    options.limit ??= 20

    const checkpoints = listCheckpoints(options)

    if (checkpoints.length === 0) {
      return {
        isError: false,
        content: '未找到快照记录。',
        metadata: { count: 0 },
      }
    }

    const lines: string[] = []
    lines.push(`快照数量: ${checkpoints.length}`)
    lines.push('')

    for (const cp of checkpoints) {
      const date = new Date(cp.createdAt).toLocaleString('zh-CN')
      const actionLabel = cp.action === 'write' ? '写入' : cp.action === 'delete' ? '删除' : '重命名'
      const hasContent = cp.originalContent !== undefined ? '有内容' : '无内容'
      const execInfo = cp.executionId ? ` [执行: ${cp.executionId.slice(0, 8)}]` : ''
      lines.push(
        `  ID:${cp.id} | ${actionLabel} | ${cp.relativePath} | ${date} | ${hasContent}${execInfo}`,
      )
    }

    return {
      isError: false,
      content: lines.join('\n'),
      metadata: {
        count: checkpoints.length,
        checkpoints: checkpoints.map((cp) => ({
          id: cp.id,
          relativePath: cp.relativePath,
          action: cp.action,
          createdAt: cp.createdAt,
          executionId: cp.executionId,
          hasOriginalContent: cp.originalContent !== undefined,
        })),
      },
    }
  },
}

// ─── checkpoint_rollback 工具 ─────────────────────────────────

export const checkpointRollbackTool: BuiltinTool = {
  definition: {
    name: 'checkpoint_rollback',
    description:
      '回滚到指定快照状态。将文件恢复到快照时的原始内容。仅支持 write 和 delete 操作的快照回滚。在使用前应先调用 checkpoint_list 查看可用的快照 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        checkpointId: {
          type: 'number',
          description: '要回滚的快照 ID（从 checkpoint_list 获取）',
        },
      },
      required: ['checkpointId'],
    },
    riskLevel: 'high',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const checkpointId = Number(args['checkpointId'])
    if (Number.isNaN(checkpointId) || checkpointId <= 0) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'checkpointId must be a positive number.',
        { checkpointId: args['checkpointId'] },
      )
    }

    try {
      const result = await rollbackToCheckpoint(checkpointId)

      return {
        isError: false,
        content: `回滚成功: ${result.relativePath} 已恢复到快照 #${checkpointId} 的状态（操作: ${result.action}）`,
        metadata: result,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.CHECKPOINT_ROLLBACK_FAILED,
        `Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
        { checkpointId },
      )
    }
  },
}

// ─── checkpoint_get_diff 工具 ─────────────────────────────────

export const checkpointGetDiffTool: BuiltinTool = {
  definition: {
    name: 'checkpoint_get_diff',
    description:
      '查看快照与当前文件的差异。返回快照时的原始内容、当前内容，以及文件是否被再次修改过。',
    inputSchema: {
      type: 'object',
      properties: {
        checkpointId: {
          type: 'number',
          description: '快照 ID',
        },
      },
      required: ['checkpointId'],
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const checkpointId = Number(args['checkpointId'])
    if (Number.isNaN(checkpointId) || checkpointId <= 0) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'checkpointId must be a positive number.',
        { checkpointId: args['checkpointId'] },
      )
    }

    try {
      const diff = await getCheckpointDiff(checkpointId)

      const lines: string[] = []
      lines.push(`文件: ${diff.relativePath}`)
      lines.push(`快照 ID: ${diff.checkpointId}`)
      lines.push(`当前文件存在: ${diff.currentExists ? '是' : '否'}`)
      lines.push(`自快照后已变更: ${diff.hasChanged ? '是' : '否'}`)
      lines.push('')

      if (diff.originalContent !== undefined) {
        lines.push('--- 快照时原始内容 ---')
        lines.push(diff.originalContent.slice(0, 500))
        if (diff.originalContent.length > 500) {
          lines.push('... (已截断)')
        }
      } else {
        lines.push('--- 快照时原始内容: 无（文件当时不存在或超大文件）---')
      }

      lines.push('')

      if (diff.currentContent !== undefined) {
        lines.push('--- 当前内容 ---')
        lines.push(diff.currentContent.slice(0, 500))
        if (diff.currentContent.length > 500) {
          lines.push('... (已截断)')
        }
      } else {
        lines.push('--- 当前内容: 无（文件不存在或无法读取）---')
      }

      return {
        isError: false,
        content: lines.join('\n'),
        metadata: {
          relativePath: diff.relativePath,
          currentExists: diff.currentExists,
          hasChanged: diff.hasChanged,
          hasOriginalContent: diff.originalContent !== undefined,
          hasCurrentContent: diff.currentContent !== undefined,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to get diff: ${error instanceof Error ? error.message : String(error)}`,
        { checkpointId },
      )
    }
  },
}

// ─── 导出所有 checkpoint_* 工具 ────────────────────────────────

export const allCheckpointTools: BuiltinTool[] = [
  checkpointListTool,
  checkpointRollbackTool,
  checkpointGetDiffTool,
]
