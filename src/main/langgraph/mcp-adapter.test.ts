// AgentForge LangGraph 引擎: MCP 适配器测试 (Phase 3)
// 测试 langchain-mcp-adapters 集成和工具转换（不含审批检查版本）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  convertLangChainToolRaw,
  convertAllLangChainToolsRaw,
  loadMcpToolsAsLangChain,
  closeMcpClient,
} from './mcp-adapter'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { resetMcpServerManager } from '../mcp/manager'

// ─── Mock 工厂 ──────────────────────────────────────────────────

function createMockDynamicTool(name: string, result: string = 'tool result'): DynamicStructuredTool {
  return {
    name,
    description: `Mock tool: ${name}`,
    schema: { type: 'object', properties: {} } as Record<string, unknown>,
    invoke: vi.fn().mockResolvedValue(result),
  } as unknown as DynamicStructuredTool
}

// ─── Tests ──────────────────────────────────────────────────────

describe('MCP Adapter (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMcpServerManager()
  })

  afterEach(async () => {
    await closeMcpClient()
  })

  describe('convertLangChainToolRaw', () => {
    it('应正确转换工具名称和描述', () => {
      const tool = createMockDynamicTool('search_web')
      const wrapped = convertLangChainToolRaw(tool)

      expect(wrapped.name).toBe('search_web')
      expect(wrapped.description).toBe('Mock tool: search_web')
    })

    it('应保留输入 schema', () => {
      const tool = createMockDynamicTool('test_tool')
      const wrapped = convertLangChainToolRaw(tool)

      expect(wrapped.inputSchema).toBeDefined()
      expect(wrapped.inputSchema).toHaveProperty('type', 'object')
    })

    it('应正确执行并返回字符串结果', async () => {
      const tool = createMockDynamicTool('mcp_tool', 'mcp result')
      const wrapped = convertLangChainToolRaw(tool)

      const result = await wrapped.execute({})
      expect(result).toBe('mcp result')
      expect(tool.invoke).toHaveBeenCalledWith({})
    })

    it('应处理工具返回非字符串结果', async () => {
      const tool = createMockDynamicTool('object_tool')
      ;(tool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'complex' })

      const wrapped = convertLangChainToolRaw(tool)

      const result = await wrapped.execute({})
      // 非字符串结果应被 JSON.stringify
      expect(result).toBe(JSON.stringify({ data: 'complex' }))
    })

    it('不含审批检查：直接执行工具', async () => {
      const tool = createMockDynamicTool('any_tool', 'executed')
      const wrapped = convertLangChainToolRaw(tool)

      const result = await wrapped.execute({ input: 'test' })

      expect(result).toBe('executed')
      expect(tool.invoke).toHaveBeenCalledTimes(1)
    })
  })

  describe('convertAllLangChainToolsRaw', () => {
    it('应批量转换工具数组', () => {
      const tools = [
        createMockDynamicTool('tool_a'),
        createMockDynamicTool('tool_b'),
        createMockDynamicTool('tool_c'),
      ]
      const wrapped = convertAllLangChainToolsRaw(tools)

      expect(wrapped).toHaveLength(3)
      expect(wrapped[0].name).toBe('tool_a')
      expect(wrapped[1].name).toBe('tool_b')
      expect(wrapped[2].name).toBe('tool_c')
    })

    it('空数组应返回空数组', () => {
      const wrapped = convertAllLangChainToolsRaw([])
      expect(wrapped).toHaveLength(0)
    })
  })

  describe('loadMcpToolsAsLangChain', () => {
    it('无 MCP Server 配置时应返回空数组', async () => {
      // MCP Server Manager 未加载任何配置
      const tools = await loadMcpToolsAsLangChain()
      expect(tools).toEqual([])
    })
  })

  describe('closeMcpClient', () => {
    it('无客户端时调用不应报错', async () => {
      await expect(closeMcpClient()).resolves.not.toThrow()
    })
  })
})
