// AgentForge MCP 域 IPC Handlers
// 实现 P2-07/P2-08: MCP Server 管理
// 通道命名: mcp:add, mcp:remove, mcp:list, mcp:get-status, mcp:toggle-enable

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { MCPServerConfig, MCPServerStatus, TransportType } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { assertNonEmptyString } from '../utils/assertions'
import { getMcpServerManager, type ServerListEntry } from '../mcp/manager'
import type { CreateMcpServerParams, UpdateMcpServerParams } from '../mcp/db-repo'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

const VALID_TRANSPORT_TYPES: readonly TransportType[] = ['stdio', 'http']

function assertTransportType(value: unknown): asserts value is TransportType {
  if (typeof value !== 'string' || !VALID_TRANSPORT_TYPES.includes(value as TransportType)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid transport: ${String(value)}. Must be one of: ${VALID_TRANSPORT_TYPES.join(', ')}.`,
      { transport: value },
    )
  }
}

function assertOptionalStringArray(
  value: unknown,
  field: string,
): asserts value is string[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value) || !value.every((v: unknown) => typeof v === 'string')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be an array of strings.`,
      { field, value },
    )
  }
}

function assertOptionalRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, string> | undefined {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `Field "${field}" must be an object.`, {
      field,
      value,
    })
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `Field "${field}.${k}" must be a string.`, {
        field: `${field}.${k}`,
        value: v,
      })
    }
  }
}

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * mcp:add - 添加 MCP Server。
 * 自动连接并发现工具。
 *
 * @param params - { name, transport, command?, args?, env?, url?, headers?, enabled? }
 * @returns 新建的 MCPServerConfig
 */
export async function handleAddMcp(params: unknown): Promise<MCPServerConfig> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Add MCP server params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['name'], 'name')
  assertTransportType(p['transport'])
  assertOptionalString(p['command'], 'command')
  assertOptionalStringArray(p['args'], 'args')
  assertOptionalRecord(p['env'], 'env')
  assertOptionalString(p['url'], 'url')
  assertOptionalRecord(p['headers'], 'headers')

  const createParams: CreateMcpServerParams = {
    name: p['name'] as string,
    transport: p['transport'] as TransportType,
    command: p['command'] as string | undefined,
    args: p['args'] as string[] | undefined,
    env: p['env'] as Record<string, string> | undefined,
    url: p['url'] as string | undefined,
    headers: p['headers'] as Record<string, string> | undefined,
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
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Remove MCP server params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  const manager = getMcpServerManager()
  await manager.removeServer(p['id'] as string)
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
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Update MCP server params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')
  assertOptionalString(p['name'], 'name')
  if (p['transport'] !== undefined) assertTransportType(p['transport'])
  assertOptionalString(p['command'], 'command')
  assertOptionalStringArray(p['args'], 'args')
  assertOptionalRecord(p['env'], 'env')
  assertOptionalString(p['url'], 'url')
  assertOptionalRecord(p['headers'], 'headers')

  const id = p['id'] as string
  const updates: UpdateMcpServerParams = {}
  if (p['name'] !== undefined) updates.name = p['name'] as string
  if (p['transport'] !== undefined) updates.transport = p['transport'] as TransportType
  if (p['command'] !== undefined) updates.command = p['command'] as string
  if (p['args'] !== undefined) updates.args = p['args'] as string[]
  if (p['env'] !== undefined) updates.env = p['env'] as Record<string, string>
  if (p['url'] !== undefined) updates.url = p['url'] as string
  if (p['headers'] !== undefined) updates.headers = p['headers'] as Record<string, string>
  if (p['enabled'] !== undefined) updates.enabled = Boolean(p['enabled'])

  const manager = getMcpServerManager()
  return manager.updateServerConfig(id, updates)
}

/**
 * mcp:list - 列出所有 MCP Server。
 *
 * @returns ServerListEntry 数组
 */
export function handleListMcp(): ServerListEntry[] {
  const manager = getMcpServerManager()
  return manager.listServers()
}

/**
 * mcp:get-status - 获取指定 Server 的状态。
 *
 * @param params - { id }
 * @returns MCPServerStatus
 */
export function handleGetMcpStatus(params: unknown): MCPServerStatus {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get MCP status params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  const manager = getMcpServerManager()
  return manager.getServerStatus(p['id'] as string)
}

/**
 * mcp:toggle-enable - 切换 Server 的启用状态。
 *
 * @param params - { id }
 * @returns 新的启用状态
 * @throws {AppError} MCP_CONNECT_FAILED - Server 不存在
 */
export async function handleToggleEnable(params: unknown): Promise<boolean> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Toggle enable params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  const manager = getMcpServerManager()
  return manager.toggleEnable(p['id'] as string)
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
