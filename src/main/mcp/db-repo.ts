// AgentForge MCP Server 配置数据访问层（Repository）
// 实现 P2-07/P2-08: mcp_servers 表 CRUD
// 与 Spec v0.2 §5.5 MCPServerConfig 一致

import type Database from 'better-sqlite3'
import type { MCPServerConfig, TransportType } from '@shared/types'
import { getDatabase } from '../db/index'
import { AppError, ErrorCodes } from '../utils/error'
import { generateId } from '../utils/id'

/**
 * SQLite 行类型（数据库存储格式）。
 */
interface McpServerRow {
  id: string
  name: string
  transport: string
  command: string | null
  args: string | null // JSON array
  env: string | null // JSON object
  url: string | null
  headers: string | null // JSON object
  enabled: number // 0 or 1
  created_at: number
  updated_at: number
}

/** 创建 MCP Server 配置参数 */
export interface CreateMcpServerParams {
  name: string
  transport: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

/** 更新 MCP Server 配置参数（所有字段可选） */
export interface UpdateMcpServerParams {
  name?: string
  transport?: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

/**
 * 将数据库行转换为 MCPServerConfig 实体。
 */
function rowToMcpServer(row: McpServerRow): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as TransportType,
    command: row.command ?? undefined,
    args: row.args ? (JSON.parse(row.args) as string[]) : undefined,
    env: row.env ? (JSON.parse(row.env) as Record<string, string>) : undefined,
    url: row.url ?? undefined,
    headers: row.headers ? (JSON.parse(row.headers) as Record<string, string>) : undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建 MCP Server 配置。
 * - 默认 enabled 为 true
 * - 自动生成 id、createdAt、updatedAt
 *
 * @param params - 创建参数
 * @returns 新建的 MCPServerConfig
 */
export function createMcpServer(params: CreateMcpServerParams): MCPServerConfig {
  const db: Database.Database = getDatabase()

  const now = Date.now()
  const id = generateId()
  const enabled = (params.enabled ?? true) ? 1 : 0

  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args, env, url, headers, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name,
    params.transport,
    params.command ?? null,
    params.args ? JSON.stringify(params.args) : null,
    params.env ? JSON.stringify(params.env) : null,
    params.url ?? null,
    params.headers ? JSON.stringify(params.headers) : null,
    enabled,
    now,
    now,
  )

  return getMcpServerById(id)
}

/**
 * 根据 ID 查询单个 MCP Server 配置。
 *
 * @param id - Server ID
 * @returns MCPServerConfig
 * @throws {AppError} MCP_SERVER_NOT_FOUND - 配置不存在
 */
export function getMcpServerById(id: string): MCPServerConfig {
  const db: Database.Database = getDatabase()
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
    | McpServerRow
    | undefined

  if (row === undefined) {
    throw new AppError(
      ErrorCodes.MCP_CONNECT_FAILED,
      `MCP Server with id "${id}" not found.`,
      { id },
    )
  }

  return rowToMcpServer(row)
}

/**
 * 查询所有 MCP Server 配置，按 created_at 升序排列。
 *
 * @returns MCPServerConfig 数组
 */
export function listMcpServers(): MCPServerConfig[] {
  const db: Database.Database = getDatabase()
  const rows = db
    .prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC')
    .all() as McpServerRow[]

  return rows.map(rowToMcpServer)
}

/**
 * 更新 MCP Server 配置。
 * 仅更新提供的字段，未提供的字段保持不变。
 *
 * @param id - Server ID
 * @param updates - 更新字段
 * @returns 更新后的 MCPServerConfig
 * @throws {AppError} MCP_SERVER_NOT_FOUND - 配置不存在
 */
export function updateMcpServer(id: string, updates: UpdateMcpServerParams): MCPServerConfig {
  const db: Database.Database = getDatabase()

  // 验证存在
  const existing = db.prepare('SELECT 1 FROM mcp_servers WHERE id = ?').get(id) as
    | { '1': number }
    | undefined

  if (existing === undefined) {
    throw new AppError(
      ErrorCodes.MCP_CONNECT_FAILED,
      `MCP Server with id "${id}" not found.`,
      { id },
    )
  }

  const now = Date.now()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.transport !== undefined) {
    fields.push('transport = ?')
    values.push(updates.transport)
  }
  if (updates.command !== undefined) {
    fields.push('command = ?')
    values.push(updates.command)
  }
  if (updates.args !== undefined) {
    fields.push('args = ?')
    values.push(updates.args ? JSON.stringify(updates.args) : null)
  }
  if (updates.env !== undefined) {
    fields.push('env = ?')
    values.push(updates.env ? JSON.stringify(updates.env) : null)
  }
  if (updates.url !== undefined) {
    fields.push('url = ?')
    values.push(updates.url)
  }
  if (updates.headers !== undefined) {
    fields.push('headers = ?')
    values.push(updates.headers ? JSON.stringify(updates.headers) : null)
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(updates.enabled ? 1 : 0)
  }

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)

  db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getMcpServerById(id)
}

/**
 * 删除 MCP Server 配置。
 *
 * @param id - Server ID
 * @throws {AppError} MCP_SERVER_NOT_FOUND - 配置不存在
 */
export function deleteMcpServer(id: string): void {
  const db: Database.Database = getDatabase()

  const existing = db.prepare('SELECT 1 FROM mcp_servers WHERE id = ?').get(id) as
    | { '1': number }
    | undefined

  if (existing === undefined) {
    throw new AppError(
      ErrorCodes.MCP_CONNECT_FAILED,
      `MCP Server with id "${id}" not found.`,
      { id },
    )
  }

  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}
