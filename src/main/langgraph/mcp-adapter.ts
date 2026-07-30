// AgentForge LangGraph 引擎: MCP 适配器迁移 (P2-01)
//
// 使用官方 langchain-mcp-adapters 包替代自定义 MCPClient，
// 将 MCP Server 工具加载为 LangChain DynamicStructuredTool，
// 再转换为 LangGraph 可用的 WrappedTool。
//
// 设计目标：
// - 不破坏现有 builtin / copilot-sdk 引擎的 MCP 管理
// - LangGraph 引擎独占使用 langchain-mcp-adapters
// - 支持 stdio 和 http 两种传输方式
// - Phase 3: 审批由 StateGraph interrupt() 在图级别处理，工具不含审批检查

import { MultiServerMCPClient, type Connection, type StdioConnection, type StreamableHTTPConnection } from 'langchain-mcp-adapters'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import type { MCPServerConfig } from '../../shared/types'
import type { WrappedTool } from './tool-adapter'
import { getMcpServerManager } from '../mcp/manager'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 配置转换 ─────────────────────────────────────────────────────

/**
 * 将 AgentForge MCPServerConfig 转换为 langchain-mcp-adapters Connection。
 *
 * 支持 stdio 和 http 两种传输方式：
 * - stdio: { transport: 'stdio', command, args, env }
 * - http:  { transport: 'http', url, headers }
 */
function configToConnection(config: MCPServerConfig): Connection {
  if (config.transport === 'http') {
    if (!config.url) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `MCP Server "${config.name}" is configured for HTTP but has no URL.`,
        { serverName: config.name, transport: 'http' },
      )
    }
    const conn: StreamableHTTPConnection = {
      transport: 'http',
      url: config.url,
      headers: config.headers ?? {},
    }
    return conn
  }

  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `MCP Server "${config.name}" is configured for stdio but has no command.`,
        { serverName: config.name, transport: 'stdio' },
      )
    }
    const conn: StdioConnection = {
      transport: 'stdio',
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
      stderr: 'pipe',
    }
    return conn
  }

  throw new AppError(
    ErrorCodes.VALIDATION_ERROR,
    `Unsupported transport type "${config.transport}" for server "${config.name}".`,
    { serverName: config.name, transport: config.transport },
  )
}

// ─── MCP 工具加载 ─────────────────────────────────────────────────

/** MultiServerMCPClient 单例（按引擎生命周期管理） */
let mcpClient: MultiServerMCPClient | null = null

/**
 * 从数据库加载所有已启用的 MCP Server 配置，
 * 构建 MultiServerMCPClient 并获取 LangChain 工具。
 *
 * @returns DynamicStructuredTool 数组（可能为空）
 */
export async function loadMcpToolsAsLangChain(): Promise<DynamicStructuredTool[]> {
  const manager = getMcpServerManager()
  const servers = manager.listServers()

  // 只加载已启用且状态为 connected 或 disconnected 的 Server
  const enabledServers = servers.filter((s) => s.config.enabled)
  if (enabledServers.length === 0) {
    return []
  }

  // 构建 langchain-mcp-adapters 配置
  const config: Record<string, Connection> = {}
  for (const server of enabledServers) {
    try {
      config[server.config.name] = configToConnection(server.config)
    } catch (err) {
      console.error(`[LangGraph MCP] Skipping server "${server.config.name}":`, err)
    }
  }

  if (Object.keys(config).length === 0) {
    return []
  }

  // 关闭旧客户端
  if (mcpClient) {
    try {
      await mcpClient.close()
    } catch {
      // Ignore close errors
    }
    mcpClient = null
  }

  // 创建新客户端并加载工具
  mcpClient = new MultiServerMCPClient(config)
  const tools = await mcpClient.getTools()
  return tools
}

/**
 * 关闭 MCP 客户端连接。
 * 在 LangGraph 引擎执行完成后调用，避免资源泄漏。
 */
export async function closeMcpClient(): Promise<void> {
  if (mcpClient) {
    try {
      await mcpClient.close()
    } catch {
      // Ignore close errors
    }
    mcpClient = null
  }
}

// ─── DynamicStructuredTool → WrappedTool 转换 ─────────────────────

/**
 * 将 LangChain DynamicStructuredTool 转换为 WrappedTool（不含审批检查）。
 *
 * Phase 3: 用于 LangGraph interrupt() 审批模式。
 * 审批由 StateGraph 的 tools 节点通过 interrupt() 处理。
 *
 * @param tool - LangChain DynamicStructuredTool 实例
 * @returns 不含审批检查的 WrappedTool 实例
 */
export function convertLangChainToolRaw(tool: DynamicStructuredTool): WrappedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema as Record<string, unknown>,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const result = await tool.invoke(args)
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
  }
}

/**
 * 批量转换 LangChain 工具为 WrappedTool（不含审批检查）。
 *
 * @param tools - DynamicStructuredTool 数组
 * @returns 不含审批检查的 WrappedTool 数组
 */
export function convertAllLangChainToolsRaw(tools: DynamicStructuredTool[]): WrappedTool[] {
  return tools.map((tool) => convertLangChainToolRaw(tool))
}
