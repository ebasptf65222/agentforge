// AgentForge MCP 域 IPC Handlers
// 实现 P2-07/P2-08: MCP Server 管理
// 通道命名: mcp:add, mcp:remove, mcp:list, mcp:get-status, mcp:toggle-enable

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { MCPServerConfig, MCPServerStatus, TransportType } from '@shared/types'
import { getMcpServerManager } from '../mcp/manager'
import type { CreateMcpServerParams, UpdateMcpServerParams } from '../mcp/db-repo'
import { listMcpServers } from '../mcp/db-repo'
import { getToolRegistry } from '../tools/registry'
import { getSettings } from '../db/repos/app-settings'
import {
  ensureParamsObject,
  validateEnum,
  validateNonEmptyString,
  validateOptionalRecord,
  validateOptionalString,
  validateOptionalStringArray,
} from '../utils/ipc-validator'

// ─── 常量 ─────────────────────────────────────────────────────────

const VALID_TRANSPORT_TYPES: readonly TransportType[] = ['stdio', 'http']

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * mcp:add - 添加 MCP Server。
 * 自动连接并发现工具。
 *
 * @param params - { name, transport, command?, args?, env?, url?, headers?, enabled? }
 * @returns 新建的 MCPServerConfig
 */
export async function handleAddMcp(params: unknown): Promise<MCPServerConfig> {
  const p = ensureParamsObject(params, 'mcp:add')
  const name = validateNonEmptyString(p['name'], 'name')
  const transport = validateEnum(p['transport'], 'transport', VALID_TRANSPORT_TYPES)
  const command = validateOptionalString(p['command'], 'command')
  const args = validateOptionalStringArray(p['args'], 'args')
  const env = validateOptionalRecord(p['env'], 'env')
  const url = validateOptionalString(p['url'], 'url')
  const headers = validateOptionalRecord(p['headers'], 'headers')

  const createParams: CreateMcpServerParams = {
    name,
    transport,
    command,
    args,
    env,
    url,
    headers,
    enabled: p['enabled'] === undefined ? undefined : Boolean(p['enabled']),
  }

  const manager = getMcpServerManager()
  return manager.addServer(createParams)
}

/**
 * mcp:remove - 移除 MCP Server。
 * 断开连接并删除配置。
 *
 * @param params - { id }
 * @throws {AppError} MCP_CONNECT_FAILED - Server 不存在
 */
export async function handleRemoveMcp(params: unknown): Promise<void> {
  const p = ensureParamsObject(params, 'mcp:remove')
  const id = validateNonEmptyString(p['id'], 'id')

  const manager = getMcpServerManager()
  await manager.removeServer(id)
}

/**
 * mcp:update - 更新 MCP Server 配置（原子操作）。
 * 断开旧连接、更新 DB、按需重连。
 *
 * @param params - { id, ...UpdateMcpServerParams }
 * @returns 更新后的 MCPServerConfig
 * @throws {AppError} MCP_CONNECT_FAILED - Server 不存在
 */
export async function handleUpdateMcp(params: unknown): Promise<MCPServerConfig> {
  const p = ensureParamsObject(params, 'mcp:update')
  const id = validateNonEmptyString(p['id'], 'id')
  const name = validateOptionalString(p['name'], 'name')
  const transport =
    p['transport'] === undefined
      ? undefined
      : validateEnum(p['transport'], 'transport', VALID_TRANSPORT_TYPES)
  const command = validateOptionalString(p['command'], 'command')
  const args = validateOptionalStringArray(p['args'], 'args')
  const env = validateOptionalRecord(p['env'], 'env')
  const url = validateOptionalString(p['url'], 'url')
  const headers = validateOptionalRecord(p['headers'], 'headers')

  const updates: UpdateMcpServerParams = {}
  if (name !== undefined) updates.name = name
  if (transport !== undefined) updates.transport = transport
  if (command !== undefined) updates.command = command
  if (args !== undefined) updates.args = args
  if (env !== undefined) updates.env = env
  if (url !== undefined) updates.url = url
  if (headers !== undefined) updates.headers = headers
  if (p['enabled'] !== undefined) updates.enabled = Boolean(p['enabled'])

  const manager = getMcpServerManager()
  return manager.updateServerConfig(id, updates)
}

/**
 * mcp:list - 列出所有 MCP Server。
 *
 * @returns MCPServerConfig 数组
 */
export function handleListMcp(): MCPServerConfig[] {
  const manager = getMcpServerManager()
  return manager.listServers().map((s) => s.config)
}

/**
 * mcp:get-status - 获取指定 Server 的状态信息。
 *
 * @param params - { id }
 * @returns { config, status, tools } - 服务器配置、状态和工具列表
 */
export function handleGetMcpStatus(params: unknown): {
  config: MCPServerConfig | null
  status: MCPServerStatus
  tools: unknown[]
} {
  const p = ensureParamsObject(params, 'mcp:get-status')
  const id = validateNonEmptyString(p['id'], 'id')

  const manager = getMcpServerManager()

  // 获取服务器状态
  let status = manager.getServerStatus(id)

  // 获取服务器配置（从数据库）
  let config: MCPServerConfig | null = null
  try {
    const servers = listMcpServers()
    config = servers.find((s) => s.id === id) ?? null
  } catch {
    // Ignore errors
  }

  // SDK 模式下，MCP 连接由 Copilot SDK 管理（通过 buildMcpServersConfig 从 DB 读取）。
  // Manager 不参与连接，状态始终为 disconnected。对已启用且配置完整的服务器，
  // 返回 connected 以反映 SDK 管理的真实状态。
  if (status === 'disconnected' && config?.enabled) {
    try {
      const engineType = getSettings().engineType ?? 'builtin'
      if (engineType === 'copilot-sdk') {
        const hasValidConfig =
          (config.transport === 'stdio' && !!config.command) ||
          (config.transport === 'http' && !!config.url)
        if (hasValidConfig) {
          status = 'connected'
        }
      }
    } catch {
      // Settings 读取失败，保持原状态
    }
  }

  // 获取已注册的工具列表
  const tools = getToolRegistry()
    .list()
    .filter((t) => t.source === 'mcp' && t.mcpServerId === id)
    .map((t) => ({ name: t.definition.name, description: t.definition.description }))

  return { config, status, tools }
}

/**
 * mcp:toggle-enable - 切换 Server 的启用状态。
 *
 * @param params - { id }
 * @returns 新的启用状态
 * @throws {AppError} MCP_CONNECT_FAILED - Server 不存在
 */
export async function handleToggleEnable(params: unknown): Promise<boolean> {
  const p = ensureParamsObject(params, 'mcp:toggle-enable')
  const id = validateNonEmptyString(p['id'], 'id')

  const manager = getMcpServerManager()
  return manager.toggleEnable(id)
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'mcp:add',
    handler: (_event, params: unknown) => handleAddMcp(params),
  },
  {
    channel: 'mcp:remove',
    handler: (_event, params: unknown) => handleRemoveMcp(params),
  },
  {
    channel: 'mcp:update',
    handler: (_event, params: unknown) => handleUpdateMcp(params),
  },
  { channel: 'mcp:list', handler: () => handleListMcp() },
  {
    channel: 'mcp:get-status',
    handler: (_event, params: unknown) => handleGetMcpStatus(params),
  },
  {
    channel: 'mcp:toggle-enable',
    handler: (_event, params: unknown) => handleToggleEnable(params),
  },
]

/**
 * 注册 MCP 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerMcpHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
