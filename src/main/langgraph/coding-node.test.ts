// AgentForge LangGraph 引擎: Copilot SDK 编码节点测试 (P2-03)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCodingNodeTool, resetCodingNode } from './coding-node'
import type { CodingNodeOptions } from './coding-node'

describe('Coding Node (P2-03)', () => {
  beforeEach(() => {
    resetCodingNode()
    vi.clearAllMocks()
  })

  describe('createCodingNodeTool', () => {
    it('应返回具有正确名称的工具', () => {
      const tool = createCodingNodeTool({})
      expect(tool.name).toBe('copilot_coding')
    })

    it('应包含工具描述', () => {
      const tool = createCodingNodeTool({})
      expect(tool.description).toContain('coding task')
      expect(tool.description).toContain('Copilot SDK')
    })

    it('应定义输入 schema', () => {
      const tool = createCodingNodeTool({})
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema).toHaveProperty('type', 'object')
      expect(tool.inputSchema).toHaveProperty('properties')
      expect(tool.inputSchema.properties).toHaveProperty('task')
    })

    it('空任务应返回错误消息', async () => {
      const tool = createCodingNodeTool({})
      const result = await tool.execute({ task: '' })
      expect(result).toContain('Error')
      expect(result).toContain('No coding task specified')
    })

    it('无 task 参数应返回错误消息', async () => {
      const tool = createCodingNodeTool({})
      const result = await tool.execute({})
      expect(result).toContain('Error')
    })
  })

  describe('工具配置', () => {
    it('应接受 callbacks 选项', () => {
      const callbacks = {
        onTrajectory: vi.fn(),
        onApprovalRequest: vi.fn(),
        onStreamChunk: vi.fn(),
      }
      const options: CodingNodeOptions = {
        callbacks,
        approvalTimeoutMs: 10000,
      }
      const tool = createCodingNodeTool(options)
      expect(tool).toBeDefined()
    })

    it('应接受 workingDirectory 选项', () => {
      const options: CodingNodeOptions = {
        workingDirectory: '/tmp/test',
      }
      const tool = createCodingNodeTool(options)
      expect(tool).toBeDefined()
    })

    it('空选项应使用默认值', () => {
      const tool = createCodingNodeTool({})
      expect(tool.name).toBe('copilot_coding')
    })
  })
})
