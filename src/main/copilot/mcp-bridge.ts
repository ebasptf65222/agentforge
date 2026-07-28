// MCP Server configuration bridge
// Converts AgentForge's MCPServerConfig (from DB) to Copilot SDK's mcpServers format
// Step 4: MCP migration to SDK native mcpServers

import type { MCPServerConfig as ForgeMcpServerConfig } from '@shared/types'
import { listMcpServers } from '../mcp/db-repo'

/**
 * SDK MCP server config types (subset of @github/copilot-sdk types).
 * Defined locally to avoid importing from internal SDK dist paths.
 */
interface SdkMCPStdioServerConfig {
  type?: 'local' | 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  workingDirectory?: string
  tools?: string[]
  timeout?: number
}

interface SdkMCPHTTPServerConfig {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
  tools?: string[]
  timeout?: number
}

type SdkMCPServerConfig = SdkMCPStdioServerConfig | SdkMCPHTTPServerConfig

/**
 * Convert a single AgentForge MCPServerConfig to SDK format.
 *
 * Mapping:
 * - stdio transport → SDK local/stdio config (command, args, env)
 * - http transport  → SDK http config (url, headers)
 *
 * Only enabled servers are included.
 *
 * @param config - AgentForge's MCPServerConfig from DB
 * @returns SDK-compatible MCPServerConfig, or null if config is incomplete
 */
function convertToSdkConfig(
  config: ForgeMcpServerConfig,
): SdkMCPServerConfig | null {
  if (config.transport === 'stdio') {
    if (!config.command) {
      console.warn(
        `[MCP Bridge] Skipping server "${config.name}": missing command for stdio transport`,
      )
      return null
    }
    const sdkConfig: SdkMCPStdioServerConfig = {
      type: 'local',
      command: config.command,
    }
    if (config.args && config.args.length > 0) {
      sdkConfig.args = config.args
    }
    if (config.env && Object.keys(config.env).length > 0) {
      sdkConfig.env = config.env
    }
    return sdkConfig
  }

  if (config.transport === 'http') {
    if (!config.url) {
      console.warn(
        `[MCP Bridge] Skipping server "${config.name}": missing URL for http transport`,
      )
      return null
    }
    const sdkConfig: SdkMCPHTTPServerConfig = {
      type: 'http',
      url: config.url,
    }
    if (config.headers && Object.keys(config.headers).length > 0) {
      sdkConfig.headers = config.headers
    }
    return sdkConfig
  }

  console.warn(
    `[MCP Bridge] Skipping server "${config.name}": unsupported transport "${config.transport}"`,
  )
  return null
}

/**
 * Build SDK mcpServers config from all enabled MCP servers in the database.
 *
 * Returns a Record<string, MCPServerConfig> keyed by server name,
 * suitable for passing to CopilotClient.createSession({ mcpServers }).
 *
 * Only includes servers that are:
 * 1. Enabled (config.enabled === true)
 * 2. Have complete configuration (command for stdio, url for http)
 *
 * @returns Record mapping server names to SDK MCPServerConfig
 */
export function buildMcpServersConfig(): Record<string, SdkMCPServerConfig> {
  const allServers = listMcpServers()
  const mcpServers: Record<string, SdkMCPServerConfig> = {}

  for (const server of allServers) {
    if (!server.enabled) {
      continue
    }

    const sdkConfig = convertToSdkConfig(server)
    if (sdkConfig) {
      // Use server name as key, falling back to id if name collides
      const key = server.name || server.id
      if (mcpServers[key]) {
        // Name collision: append id to disambiguate
        mcpServers[`${key}-${server.id.slice(0, 8)}`] = sdkConfig
      } else {
        mcpServers[key] = sdkConfig
      }
    }
  }

  return mcpServers
}
