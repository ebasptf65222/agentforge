// 验证 MCP getStatus 返回格式修复
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖
const mockGetServerStatus = vi.fn()
const mockListMcpServers = vi.fn()
const mockToolRegistryList = vi.fn()

vi.mock('../mcp/manager', () => ({
  getMcpServerManager: () => ({
    getServerStatus: mockGetServerStatus,
  }),
}))

vi.mock('../mcp/db-repo', () => ({
  listMcpServers: mockListMcpServers,
}))

vi.mock('../tools/registry', () => ({
  getToolRegistry: () => ({
    list: mockToolRegistryList,
  }),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

const { handleGetMcpStatus } = await import('./mcp')

describe('handleGetMcpStatus 返回格式修复', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerStatus.mockReturnValue('connected')
    mockListMcpServers.mockReturnValue([
      { id: 'test-id', name: 'TestServer', transport: 'stdio' },
    ])
    mockToolRegistryList.mockReturnValue([
      {
        definition: { name: 'tool1', description: 'desc1' },
        source: 'mcp',
        mcpServerId: 'test-id',
      },
      {
        definition: { name: 'tool2', description: 'desc2' },
        source: 'builtin',
        mcpServerId: undefined,
      },
    ])
  })

  it('应返回包含 config, status, tools 的对象', () => {
    const result = handleGetMcpStatus({ id: 'test-id' })

    expect(result).toHaveProperty('config')
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('tools')
  })

  it('status 应为字符串', () => {
    const result = handleGetMcpStatus({ id: 'test-id' })
    expect(typeof result.status).toBe('string')
    expect(result.status).toBe('connected')
  })

  it('config 应为服务器配置对象', () => {
    const result = handleGetMcpStatus({ id: 'test-id' })
    expect(result.config).not.toBeNull()
    expect(result.config?.name).toBe('TestServer')
  })

  it('tools 应只包含该服务器的 MCP 工具', () => {
    const result = handleGetMcpStatus({ id: 'test-id' })
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]).toEqual({ name: 'tool1', description: 'desc1' })
  })

  it('不存在的服务器应返回 null config 和 disconnected status', () => {
    mockGetServerStatus.mockReturnValue('disconnected')
    mockListMcpServers.mockReturnValue([])

    const result = handleGetMcpStatus({ id: 'nonexistent' })
    expect(result.config).toBeNull()
    expect(result.status).toBe('disconnected')
    expect(result.tools).toEqual([])
  })

  it('参数为空时应抛出 VALIDATION_ERROR', () => {
    expect(() => handleGetMcpStatus(null)).toThrow('must be a non-null object')
  })

  it('id 为空时应抛出 VALIDATION_ERROR', () => {
    expect(() => handleGetMcpStatus({})).toThrow()
  })
})
