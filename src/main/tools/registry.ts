// AgentForge P2-05/P2-06: 工具注册表
// 统一管理内置工具和 MCP 工具的注册与查询
// 与 Spec v0.2 §5.5 + §9.3 风险等级映射一致

import type { ToolDefinition } from '@shared/types'
import type { BuiltinTool, RegisteredTool, ToolExecuteFn } from './types'

/**
 * 工具注册表。
 * 管理所有可用工具（内置 + MCP），提供统一的查询接口。
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  /**
   * 注册一个内置工具。
   * @param tool - 内置工具实例
   */
  registerBuiltin(tool: BuiltinTool): void {
    this.tools.set(tool.definition.name, {
      definition: tool.definition,
      execute: tool.execute,
      source: 'builtin',
    })
  }

  /**
   * 注册一个 MCP 工具。
   * MCP 工具默认标记为 high 风险（除非 Server 声明 safe）。
   * @param serverId - MCP Server ID
   * @param definition - 工具定义
   * @param execute - 执行函数
   */
  registerMcp(serverId: string, definition: ToolDefinition, execute: ToolExecuteFn): void {
    const riskLevel = definition.riskLevel || 'high'
    this.tools.set(definition.name, {
      definition: { ...definition, riskLevel, source: 'mcp' },
      execute,
      source: 'mcp',
      mcpServerId: serverId,
    })
  }

  /**
   * 注销指定 MCP Server 的所有工具。
   */
  unregisterMcpServer(serverId: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.source === 'mcp' && tool.mcpServerId === serverId) {
        this.tools.delete(name)
      }
    }
  }

  /**
   * 获取工具。
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  /**
   * 检查工具是否存在。
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 获取所有工具定义。
   */
  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition)
  }

  /**
   * 获取所有已注册工具。
   */
  list(): RegisteredTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 获取工具数量。
   */
  size(): number {
    return this.tools.size
  }

  /**
   * 清除所有工具。
   */
  clear(): void {
    this.tools.clear()
  }
}

/** 全局工具注册表单例 */
let globalRegistry: ToolRegistry | null = null

/**
 * 获取全局工具注册表。
 */
export function getToolRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry()
  }
  return globalRegistry
}

/**
 * 重置全局工具注册表（仅供测试使用）。
 */
export function resetToolRegistry(): void {
  globalRegistry = null
}
