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
// - 工具加载后注入审批检查（复用 wrapTool）

import { MultiServerMCPClient, type Connection, type StdioConnection, type StreamableHTTPConnection } from 'langchain-mcp-adapters'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import type { MCPServerConfig } from '../../shared/types'
import type { RegisteredTool } from '../tools/types'
import type { ToolDefinition, ToolExecutionResult } from '../../shared/types'
import type { ApprovalMode, ApprovalRequest, ToolAction } from '../../shared/types'
import type { AgentEventCallbacks } from '../agent/types'
import { shouldRequireApproval, buildToolAction, type ApprovalManager } from '../agent/approval'
import type { WrappedTool, ToolWrapOptions } from './tool-adapter'
import { getMcpServerManager } from '../mcp/manager'

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
      throw new Error(`MCP Server "${config.name}" is configured for HTTP but has no URL.`)
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
      throw new Error(`MCP Server "${config.name}" is configured for stdio but has no command.`)
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

  throw new Error(`Unsupported transport type "${config.transport}" for server "${config.name}".`)
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
 * 将 LangChain DynamicStructuredTool 转换为 AgentForge WrappedTool。
 *
 * 保留工具名称、描述和输入 schema，
 * execute 方法注入审批检查（复用 wrapTool 的审批逻辑）。
 *
 * @param tool - LangChain DynamicStructuredTool 实例
 * @param options - 审批包装选项
 * @returns WrappedTool 实例
 */
export function convertLangChainToolToWrapped(
  tool: DynamicStructuredTool,
  options: ToolWrapOptions,
): WrappedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema as Record<string, unknown>,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      // 审批检查（与 wrapTool 一致的逻辑）
      const toolAction: ToolAction = buildToolAction(tool.name, args, 'high')
      const needsApproval = shouldRequireApproval(toolAction, options.approvalMode)

      if (needsApproval) {
        const step = Date.now()
        const approvalRequest: ApprovalRequest = {
          executionId: options.executionId,
          step,
          toolAction,
          reason: `MCP tool "${tool.name}" requires approval (risk: high)`,
        }

        const response = await options.approvalManager.requestApproval(
          approvalRequest,
          options.approvalTimeoutMs,
          options.callbacks.onApprovalRequest,
        )

        if (!response.approved) {
          return `Tool execution was ${response.reason === 'TIMEOUT' ? 'timed out' : 'rejected'}.`
        }
      }

      // 调用 LangChain 工具的 invoke
      const result = await tool.invoke(args)
      // DynamicStructuredTool.invoke 返回 string（默认 content 模式）
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
  }
}

/**
 * 批量转换 LangChain 工具为 WrappedTool。
 *
 * @param tools - DynamicStructuredTool 数组
 * @param options - 审批包装选项
 * @returns WrappedTool 数组
 */
export function convertAllLangChainTools(
  tools: DynamicStructuredTool[],
  options: ToolWrapOptions,
): WrappedTool[] {
  return tools.map((tool) => convertLangChainToolToWrapped(tool, options))
}

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

// ─── 注册到 ToolRegistry（可选） ──────────────────────────────────

/**
 * 将 LangChain MCP 工具注册回 ToolRegistry，
 * 供其他引擎（builtin）也能发现这些工具。
 *
 * 注意：这是可选操作，仅在需要跨引擎共享工具时调用。
 * 默认 LangGraph 引擎不注册到 ToolRegistry，而是直接使用 WrappedTool[]。
 *
 * @param tools - DynamicStructuredTool 数组
 * @param serverName - MCP Server 名称（用于注销）
 */
export function registerMcpToolsToRegistry(
  tools: DynamicStructuredTool[],
  serverName: string,
): void {
  // 延迟导入避免循环依赖
  const { getToolRegistry } = require('../tools/registry')
  const registry = getToolRegistry()

  for (const tool of tools) {
    const definition: ToolDefinition = {
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.schema as Record<string, unknown>,
      riskLevel: 'high',
      source: 'mcp',
    }

    const executeFn = async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
      const result = await tool.invoke(args)
      const content = typeof result === 'string' ? result : JSON.stringify(result)
      return {
        isError: false,
        content,
        metadata: { serverName },
      }
    }

    registry.registerMcp(serverName, definition, executeFn)
  }
}
