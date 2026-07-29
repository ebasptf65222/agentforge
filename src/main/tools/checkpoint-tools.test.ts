// AgentForge P2-02: Checkpoint Tools 测试
// 测试 3 个 checkpoint_* 工具的定义、参数校验和错误处理

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  checkpointListTool,
  checkpointRollbackTool,
  checkpointGetDiffTool,
  allCheckpointTools,
} from './checkpoint-tools'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

// ─── Mock 快照核心模块 ───────────────────────────────────────

vi.mock('../checkpoint', () => ({
  listCheckpoints: vi.fn(),
  getCheckpointById: vi.fn(),
  rollbackToCheckpoint: vi.fn(),
  getCheckpointDiff: vi.fn(),
  getFileHistory: vi.fn(),
  cleanupCheckpoints: vi.fn(),
  deleteCheckpoint: vi.fn(),
}))

import {
  listCheckpoints,
  rollbackToCheckpoint,
  getCheckpointDiff,
} from '../checkpoint'

// ─── 辅助函数 ─────────────────────────────────────────────────

async function executeTool(
  tool: BuiltinTool,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; content: string; metadata?: Record<string, unknown> }> {
  return tool.execute(args)
}

// ─── 测试 ─────────────────────────────────────────────────────

describe('Checkpoint Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── 工具注册完整性 ──────────────────────────────────────────

  describe('Tool Registration', () => {
    it('should export exactly 3 checkpoint tools', () => {
      expect(allCheckpointTools).toHaveLength(3)
    })

    it('should have all tools with correct names', () => {
      const names = allCheckpointTools.map((t) => t.definition.name)
      expect(names).toEqual([
        'checkpoint_list',
        'checkpoint_rollback',
        'checkpoint_get_diff',
      ])
    })

    it('should have all tools with source "builtin"', () => {
      for (const tool of allCheckpointTools) {
        expect(tool.definition.source).toBe('builtin')
      }
    })

    it('should have all tools with valid risk levels', () => {
      for (const tool of allCheckpointTools) {
        expect(['low', 'medium', 'high']).toContain(tool.definition.riskLevel)
      }
    })

    it('should have rollback as high risk', () => {
      expect(checkpointRollbackTool.definition.riskLevel).toBe('high')
    })

    it('should have list and diff as low risk', () => {
      expect(checkpointListTool.definition.riskLevel).toBe('low')
      expect(checkpointGetDiffTool.definition.riskLevel).toBe('low')
    })
  })

  // ─── checkpoint_list ─────────────────────────────────────────

  describe('checkpoint_list', () => {
    it('should return empty message when no checkpoints', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([])

      const result = await executeTool(checkpointListTool, {})

      expect(result.isError).toBe(false)
      expect(result.content).toBe('未找到快照记录。')
      expect(result.metadata?.['count']).toBe(0)
    })

    it('should list checkpoints with formatted output', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([
        {
          id: 1,
          relativePath: 'src/main.ts',
          action: 'write',
          originalContent: 'old',
          newContent: 'new',
          createdAt: 1700000000000,
          executionId: 'exec-abc123',
        },
        {
          id: 2,
          relativePath: 'src/utils.ts',
          action: 'delete',
          originalContent: undefined,
          newContent: '',
          createdAt: 1700000001000,
        },
      ])

      const result = await executeTool(checkpointListTool, {})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('快照数量: 2')
      expect(result.content).toContain('ID:1')
      expect(result.content).toContain('src/main.ts')
      expect(result.content).toContain('写入')
      expect(result.content).toContain('有内容')
      expect(result.content).toContain('exec-abc')
      expect(result.content).toContain('ID:2')
      expect(result.content).toContain('删除')
      expect(result.content).toContain('无内容')
    })

    it('should pass relativePath filter', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([])

      await executeTool(checkpointListTool, { relativePath: 'src/main.ts' })

      expect(listCheckpoints).toHaveBeenCalledWith(
        expect.objectContaining({ relativePath: 'src/main.ts' }),
      )
    })

    it('should pass executionId filter', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([])

      await executeTool(checkpointListTool, { executionId: 'exec-123' })

      expect(listCheckpoints).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: 'exec-123' }),
      )
    })

    it('should pass limit with default 20', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([])

      await executeTool(checkpointListTool, {})

      expect(listCheckpoints).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
    })

    it('should respect custom limit', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([])

      await executeTool(checkpointListTool, { limit: 50 })

      expect(listCheckpoints).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }))
    })

    it('should ignore invalid limit', async () => {
      vi.mocked(listCheckpoints).mockReturnValue([])

      await executeTool(checkpointListTool, { limit: 200 })

      // 超出最大值的 limit 应被忽略，使用默认值 20
      expect(listCheckpoints).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
    })
  })

  // ─── checkpoint_rollback ────────────────────────────────────

  describe('checkpoint_rollback', () => {
    it('should rollback successfully', async () => {
      vi.mocked(rollbackToCheckpoint).mockResolvedValue({
        success: true,
        relativePath: 'src/main.ts',
        action: 'write',
        restored: true,
      })

      const result = await executeTool(checkpointRollbackTool, { checkpointId: 42 })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('回滚成功')
      expect(result.content).toContain('src/main.ts')
      expect(result.content).toContain('#42')
      expect(rollbackToCheckpoint).toHaveBeenCalledWith(42)
    })

    it('should throw VALIDATION_ERROR for non-numeric checkpointId', async () => {
      await expect(
        executeTool(checkpointRollbackTool, { checkpointId: 'invalid' }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should throw VALIDATION_ERROR for zero checkpointId', async () => {
      await expect(
        executeTool(checkpointRollbackTool, { checkpointId: 0 }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should throw VALIDATION_ERROR for negative checkpointId', async () => {
      await expect(
        executeTool(checkpointRollbackTool, { checkpointId: -1 }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should rethrow AppError as-is', async () => {
      const appError = new AppError(ErrorCodes.CHECKPOINT_NOT_FOUND, 'Not found')
      vi.mocked(rollbackToCheckpoint).mockRejectedValue(appError)

      await expect(
        executeTool(checkpointRollbackTool, { checkpointId: 999 }),
      ).rejects.toBe(appError)
    })

    it('should wrap non-AppError as ROLLBACK_FAILED', async () => {
      vi.mocked(rollbackToCheckpoint).mockRejectedValue(new Error('Disk full'))

      await expect(
        executeTool(checkpointRollbackTool, { checkpointId: 1 }),
      ).rejects.toMatchObject({ code: ErrorCodes.CHECKPOINT_ROLLBACK_FAILED })
    })
  })

  // ─── checkpoint_get_diff ────────────────────────────────────

  describe('checkpoint_get_diff', () => {
    it('should show diff successfully', async () => {
      vi.mocked(getCheckpointDiff).mockResolvedValue({
        relativePath: 'src/main.ts',
        checkpointId: 1,
        currentExists: true,
        originalContent: 'const x = 1',
        currentContent: 'const x = 2',
        hasChanged: true,
      })

      const result = await executeTool(checkpointGetDiffTool, { checkpointId: 1 })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('src/main.ts')
      expect(result.content).toContain('快照时原始内容')
      expect(result.content).toContain('const x = 1')
      expect(result.content).toContain('当前内容')
      expect(result.content).toContain('const x = 2')
      expect(result.metadata?.['hasChanged']).toBe(true)
    })

    it('should handle missing original content', async () => {
      vi.mocked(getCheckpointDiff).mockResolvedValue({
        relativePath: 'src/new.ts',
        checkpointId: 2,
        currentExists: true,
        originalContent: undefined,
        currentContent: 'hello',
        hasChanged: true,
      })

      const result = await executeTool(checkpointGetDiffTool, { checkpointId: 2 })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('无（文件当时不存在或超大文件）')
    })

    it('should handle missing current content', async () => {
      vi.mocked(getCheckpointDiff).mockResolvedValue({
        relativePath: 'src/deleted.ts',
        checkpointId: 3,
        currentExists: false,
        originalContent: 'old',
        currentContent: undefined,
        hasChanged: true,
      })

      const result = await executeTool(checkpointGetDiffTool, { checkpointId: 3 })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('当前文件存在: 否')
    })

    it('should truncate long content', async () => {
      const longContent = 'a'.repeat(1000)
      vi.mocked(getCheckpointDiff).mockResolvedValue({
        relativePath: 'src/big.ts',
        checkpointId: 4,
        currentExists: true,
        originalContent: longContent,
        currentContent: longContent,
        hasChanged: false,
      })

      const result = await executeTool(checkpointGetDiffTool, { checkpointId: 4 })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('... (已截断)')
    })

    it('should throw VALIDATION_ERROR for invalid checkpointId', async () => {
      await expect(
        executeTool(checkpointGetDiffTool, { checkpointId: 'bad' }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should rethrow AppError as-is', async () => {
      const appError = new AppError(ErrorCodes.CHECKPOINT_NOT_FOUND, 'Not found')
      vi.mocked(getCheckpointDiff).mockRejectedValue(appError)

      await expect(
        executeTool(checkpointGetDiffTool, { checkpointId: 999 }),
      ).rejects.toBe(appError)
    })
  })

  // ─── 工具描述验证 ─────────────────────────────────────────────

  describe('Tool Descriptions', () => {
    it('should have non-empty descriptions for all tools', () => {
      for (const tool of allCheckpointTools) {
        expect(tool.definition.description.length).toBeGreaterThan(10)
      }
    })

    it('should have Chinese descriptions', () => {
      expect(checkpointListTool.definition.description).toMatch(/快照|历史/)
      expect(checkpointRollbackTool.definition.description).toMatch(/回滚|恢复/)
      expect(checkpointGetDiffTool.definition.description).toMatch(/差异/)
    })

    it('should have all tools with inputSchema of type "object"', () => {
      for (const tool of allCheckpointTools) {
        expect(tool.definition.inputSchema['type']).toBe('object')
      }
    })

    it('should have all tools with an execute function', () => {
      for (const tool of allCheckpointTools) {
        expect(typeof tool.execute).toBe('function')
      }
    })
  })
})
