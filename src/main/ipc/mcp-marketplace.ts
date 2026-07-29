// P3-02: MCP 市场域 IPC Handlers
// 提供预置目录浏览和一键安装功能

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { TransportType, MCPServerConfig } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { assertNonEmptyString } from '../utils/assertions'
import { getMcpServerManager } from '../mcp/manager'
import {
  getCatalog,
  getCatalogEntry,
  searchCatalog,
  type McpCatalogEntry,
  type McpCategory,
} from '../mcp/catalog'
import type { CreateMcpServerParams } from '../mcp/db-repo'
import { listMcpServers } from '../mcp/db-repo'

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * mcp:catalog:list - 获取市场目录（全量或按分类）。
 *
 * @param params - { category?: McpCategory, query?: string }
 * @returns McpCatalogEntry[]
 */
export function handleListCatalog(params: unknown): McpCatalogEntry[] {
  if (params !== null && typeof params === 'object') {
    const p = params as Record<string, unknown>

    // 搜索模式
    if (typeof p['query'] === 'string' && p['query'].trim()) {
      return searchCatalog(p['query'])
    }

    // 分类过滤
    if (typeof p['category'] === 'string' && p['category']) {
      const category = p['category'] as McpCategory
      return getCatalog().filter((e) => e.category === category)
    }
  }

  return getCatalog()
}

/**
 * mcp:catalog:get - 获取单个目录条目详情。
 *
 * @param params - { id }
 * @returns McpCatalogEntry
 * @throws {AppError} VALIDATION_ERROR - ID 为空
 * @throws {AppError} MCP_NOT_IN_CATALOG - 目录中不存在
 */
export function handleGetCatalogEntry(params: unknown): McpCatalogEntry {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get catalog entry params must be an object.')
  }
  const p = params as Record<string, unknown>
  assertNonEmptyString(p['id'], 'id')

  const entry = getCatalogEntry(p['id'] as string)
  if (!entry) {
    throw new AppError(
      ErrorCodes.MCP_NOT_IN_CATALOG,
      `Catalog entry "${p['id']}" not found.`,
      { id: p['id'] },
    )
  }
  return entry
}

/**
 * mcp:catalog:install - 一键安装预置 MCP Server。
 * 根据目录条目创建 MCP Server 配置并自动连接。
 *
 * @param params - { id, env?: Record<string, string> }
 * @returns 新创建的 MCPServerConfig（不含 id 等持久化字段）
 * @throws {AppError} MCP_ALREADY_INSTALLED - 已安装同名 server
 * @throws {AppError} MCP_NOT_IN_CATALOG - 目录中不存在
 * @throws {AppError} VALIDATION_ERROR - 必填环境变量缺失
 */
export async function handleInstallFromCatalog(params: unknown): Promise<{
  config: MCPServerConfig
  entry: McpCatalogEntry
}> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Install params must be an object.')
  }
  const p = params as Record<string, unknown>
  assertNonEmptyString(p['id'], 'id')

  const entry = getCatalogEntry(p['id'] as string)
  if (!entry) {
    throw new AppError(
      ErrorCodes.MCP_NOT_IN_CATALOG,
      `Catalog entry "${p['id']}" not found.`,
      { id: p['id'] },
    )
  }

  // 检查是否已安装（按 name 去重）
  const existingServers = listMcpServers()
  const alreadyInstalled = existingServers.find((s) => s.name === entry.name)
  if (alreadyInstalled) {
    throw new AppError(
      ErrorCodes.MCP_ALREADY_INSTALLED,
      `Server "${entry.name}" is already installed.`,
      { existingId: alreadyInstalled.id },
    )
  }

  // 校验必填环境变量
  const userEnv = (p['env'] as Record<string, string> | undefined) ?? {}
  if (entry.envKeys) {
    for (const envKey of entry.envKeys) {
      if (envKey.required && !userEnv[envKey.key]?.trim()) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          `Missing required environment variable: ${envKey.key} (${envKey.label})`,
          { envKey: envKey.key },
        )
      }
    }
  }

  // 构建 CreateMcpServerParams
  const createParams: CreateMcpServerParams = {
    name: entry.name,
    transport: entry.transport as TransportType,
    enabled: true,
  }

  if (entry.transport === 'stdio') {
    createParams.command = entry.command
    if (entry.args && entry.args.length > 0) {
      createParams.args = [...entry.args]
    }
  } else if (entry.transport === 'http' && entry.url) {
    createParams.url = entry.url
  }

  // 合并环境变量（只保留用户提供的非空值）
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(userEnv)) {
    if (v.trim()) {
      env[k] = v.trim()
    }
  }
  if (Object.keys(env).length > 0) {
    createParams.env = env
  }

  const manager = getMcpServerManager()
  const config = await manager.addServer(createParams)

  return { config, entry }
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'mcp:catalog:list',
    handler: (_event, params: unknown) => handleListCatalog(params),
  },
  {
    channel: 'mcp:catalog:get',
    handler: (_event, params: unknown) => handleGetCatalogEntry(params),
  },
  {
    channel: 'mcp:catalog:install',
    handler: (_event, params: unknown) => handleInstallFromCatalog(params),
  },
]

/**
 * 注册 MCP 市场域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerMcpMarketplaceHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
