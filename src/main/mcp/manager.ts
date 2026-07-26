// AgentForge MCP Server Manager
// 实现 P2-08: MCPServerManager - 管理多个 MCP Server 的生命周期
// 职责：配置持久化、自动连接、工具发现与注册、聚合查询

import type { MCPServerConfig, MCPServerStatus, ToolDefinition } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { StdioTransport } from './transport'
import { MCPClient } from './client'
import {
  createMcpServer,
  listMcpServers,
  updateMcpServer,
  deleteMcpServer,
  type CreateMcpServerParams,
} from './db-repo'
import { getToolRegistry } from '../tools/registry'
import type { ToolExecuteFn } from '../tools/types'

// ─── 内部类型 ─────────────────────────────────────────────────────

/** 管理器内部存储的 Server 条目 */
interface ManagedServer {
  config: MCPServerConfig
  client: MCPClient | null
  status: MCPServerStatus
  tools: ToolDefinition[]
}

/** Server 列表项（返回给调用方） */
export interface ServerListEntry {
  config: MCPServerConfig
  status: MCPServerStatus
  toolCount: number
}

// ─── MCPServerManager ─────────────────────────────────────────────

/**
 * MCP Server 管理器。
 *
 * 管理多个 MCP Server 的配置、连接和工具注册：
 * - addServer: 持久化配置 + 自动连接 + 工具发现 + 注册到 ToolRegistry
 * - removeServer: 断开连接 + 注销工具 + 删除配置
 * - connectAll: 启动时连接所有已启用的 Server
 *
 * 第三方 MCP 工具默认标记为 high 风险等级。
 */
export class MCPServerManager {
  private servers = new Map<string, ManagedServer>()

  /**
   * 添加 MCP Server。
   * 1. 持久化配置到 SQLite
   * 2. 加入内存管理表
   * 3. 如果 enabled，自动连接并发现工具
   * 4. 将发现的工具注册到 ToolRegistry
   *
   * @param params - 创建参数
   * @returns 新建的 MCPServerConfig
   */
  async addServer(params: CreateMcpServerParams): Promise<MCPServerConfig> {
    // 1. 持久化到 DB
    const config = createMcpServer(params)

    // 2. 加入内存管理表
    this.servers.set(config.id, {
      config,
      client: null,
      status: 'disconnected',
      tools: [],
    })

    // 3. 自动连接（如果 enabled）
    if (config.enabled) {
      try {
        await this.connectServer(config.id)
      } catch {
        // 连接失败不阻止添加，状态已标记为 error
      }
    }

    return config
  }

  /**
   * 移除 MCP Server。
   * 1. 断开连接
   * 2. 从 ToolRegistry 注销工具
   * 3. 从内存管理表移除
   * 4. 从 DB 删除配置
   *
   * @param id - Server ID
   * @throws {AppError} MCP_CONNECT_FAILED - Server 不存在
   */
  async removeServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) {
      throw new AppError(ErrorCodes.MCP_CONNECT_FAILED, `MCP Server with id "${id}" not found.`, {
        id,
      })
    }

    // 1. 断开连接
    await this.disconnectServer(id)

    // 2. 注销工具
    getToolRegistry().unregisterMcpServer(id)

    // 3. 从内存移除
    this.servers.delete(id)

    // 4. 从 DB 删除
    deleteMcpServer(id)
  }

  /**
   * 列出所有已管理的 Server。
   *
   * @returns ServerListEntry 数组
   */
  listServers(): ServerListEntry[] {
    return Array.from(this.servers.values()).map((s) => ({
      config: s.config,
      status: s.status,
      toolCount: s.tools.length,
    }))
  }

  /**
   * 获取指定 Server 的状态。
   *
   * @param id - Server ID
   * @returns MCPServerStatus；不存在时返回 'disconnected'
   */
  getServerStatus(id: string): MCPServerStatus {
    return this.servers.get(id)?.status ?? 'disconnected'
  }

  /**
   * 切换 Server 的启用状态。
   * - 启用时自动连接
   * - 禁用时断开连接
   *
   * @param id - Server ID
   * @returns 新的启用状态
   * @throws {AppError} MCP_CONNECT_FAILED - Server 不存在
   */
  async toggleEnable(id: string): Promise<boolean> {
    const server = this.servers.get(id)
    if (!server) {
      throw new AppError(ErrorCodes.MCP_CONNECT_FAILED, `MCP Server with id "${id}" not found.`, {
        id,
      })
    }

    const newEnabled = !server.config.enabled

    // 更新 DB
    server.config = updateMcpServer(id, { enabled: newEnabled })

    if (newEnabled) {
      // 启用 -> 连接
      try {
        await this.connectServer(id)
      } catch {
        // 连接失败不阻止启用，状态已标记为 error
      }
    } else {
      // 禁用 -> 断开
      await this.disconnectServer(id)
    }

    return newEnabled
  }

  /**
   * 获取所有已连接 Server 的聚合工具列表。
   *
   * @returns ToolDefinition 数组
   */
  getAggregatedTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    for (const server of this.servers.values()) {
      if (server.status === 'connected') {
        tools.push(...server.tools)
      }
    }
    return tools
  }

  /**
   * 连接所有已启用的 Server。
   * 应在应用启动时调用。
   */
  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [id, server] of this.servers) {
      if (server.config.enabled && server.status !== 'connected') {
        promises.push(
          this.connectServer(id).catch(() => {
            // 单个 Server 连接失败不影响其他
          }),
        )
      }
    }
    await Promise.all(promises)
  }

  /**
   * 从数据库加载所有 Server 配置到内存（不连接）。
   * 应在 connectAll 之前调用。
   */
  loadFromDatabase(): void {
    const configs = listMcpServers()
    for (const config of configs) {
      if (!this.servers.has(config.id)) {
        this.servers.set(config.id, {
          config,
          client: null,
          status: 'disconnected',
          tools: [],
        })
      }
    }
  }

  /**
   * 初始化管理器：从 DB 加载配置 + 连接所有已启用的 Server。
   * 应在应用启动时调用。
   */
  async initialize(): Promise<void> {
    this.loadFromDatabase()
    await this.connectAll()
  }

  /**
   * 关闭所有 Server 连接。
   * 应在应用退出时调用。
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.servers.keys())
    await Promise.all(ids.map((id) => this.disconnectServer(id)))
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /**
   * 连接指定 Server。
   * 1. 创建 StdioTransport
   * 2. 创建 MCPClient
   * 3. initialize + listTools
   * 4. 注册工具到 ToolRegistry
   *
   * @param id - Server ID
   * @throws 连接或初始化失败时抛出
   */
  private async connectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) return

    // 如果已连接，先断开
    if (server.client) {
      await this.disconnectServer(id)
    }

    server.status = 'connecting'

    try {
      const config = server.config

      // 目前仅支持 stdio 传输
      if (config.transport !== 'stdio') {
        throw new AppError(
          ErrorCodes.MCP_CONNECT_FAILED,
          `Transport type "${config.transport}" is not yet supported.`,
          { transport: config.transport },
        )
      }

      if (!config.command) {
        throw new AppError(
          ErrorCodes.MCP_CONNECT_FAILED,
          'MCP Server command is required for stdio transport.',
          { id },
        )
      }

      // 1. 创建 transport
      const transport = new StdioTransport(config.command, config.args ?? [], config.env ?? {})
      await transport.connect()

      // 2. 创建 client
      const client = new MCPClient(transport)

      // 3. initialize + listTools
      await client.initialize()
      const tools = await client.listTools()

      // 4. 更新管理表
      server.client = client
      server.tools = tools
      server.status = 'connected'

      // 5. 注册工具到 ToolRegistry
      const registry = getToolRegistry()
      const serverId = id
      for (const tool of tools) {
        const executeFn: ToolExecuteFn = (args: Record<string, unknown>) =>
          client.callTool(tool.name, args)
        registry.registerMcp(serverId, tool, executeFn)
      }
    } catch (err) {
      server.status = 'error'
      server.client = null
      server.tools = []

      // 包装非 AppError 错误
      if (err instanceof AppError) {
        throw err
      }
      throw new AppError(
        ErrorCodes.MCP_CONNECT_FAILED,
        `Failed to connect MCP Server: ${err instanceof Error ? err.message : String(err)}`,
        { id },
      )
    }
  }

  /**
   * 断开指定 Server 的连接。
   *
   * @param id - Server ID
   */
  private async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) return

    if (server.client) {
      try {
        await server.client.close()
      } catch {
        // 忽略关闭错误
      }
    }

    server.client = null
    server.tools = []
    server.status = 'disconnected'
  }
}

// ─── 单例管理 ─────────────────────────────────────────────────────

/** 全局 MCPServerManager 单例 */
let globalManager: MCPServerManager | null = null

/**
 * 获取全局 MCPServerManager 单例。
 */
export function getMcpServerManager(): MCPServerManager {
  if (!globalManager) {
    globalManager = new MCPServerManager()
  }
  return globalManager
}

/**
 * 重置全局 MCPServerManager（仅供测试使用）。
 */
export function resetMcpServerManager(): void {
  globalManager = null
}
