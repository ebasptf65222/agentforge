// AgentForge P2-08: MCPServerManager 单元测试
// Mock MCPClient + db-repo + ToolRegistry，验证管理器行为

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MCPServerConfig, ToolDefinition } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup（使用 vi.hoisted 确保在模块加载前可用） ──────────

const {
  mockCreateMcpServer,
  mockListMcpServers,
  mockUpdateMcpServer,
  mockDeleteMcpServer,
  mockTransportConnect,
  mockTransportClose,
  mockClientInitialize,
  mockClientListTools,
  mockClientCallTool,
  mockClientClose,
  mockRegisterMcp,
  mockUnregisterMcpServer,
} = vi.hoisted(() => {
  return {
    mockCreateMcpServer: vi.fn(),
    mockListMcpServers: vi.fn(),
    mockUpdateMcpServer: vi.fn(),
    mockDeleteMcpServer: vi.fn(),
    mockTransportConnect: vi.fn(),
    mockTransportClose: vi.fn(),
    mockClientInitialize: vi.fn(),
    mockClientListTools: vi.fn(),
    mockClientCallTool: vi.fn(),
    mockClientClose: vi.fn(),
    mockRegisterMcp: vi.fn(),
    mockUnregisterMcpServer: vi.fn(),
  }
})

// Mock db-repo
vi.mock('./db-repo', () => ({
  createMcpServer: (...args: unknown[]) => mockCreateMcpServer(...args),
  listMcpServers: (...args: unknown[]) => mockListMcpServers(...args),
  updateMcpServer: (...args: unknown[]) => mockUpdateMcpServer(...args),
  deleteMcpServer: (...args: unknown[]) => mockDeleteMcpServer(...args),
}))

// Mock transport - 使用 class 而非 vi.fn().mockImplementation()，避免 clearAllMocks 清除实现
vi.mock('./transport', () => ({
  StdioTransport: class MockStdioTransport {
    connect(...args: unknown[]): Promise<void> {
      return mockTransportConnect(...args)
    }
    send(): Promise<void> {
      return Promise.resolve()
    }
    onMessage(): void {}
    onClose(): void {}
    onError(): void {}
    close(...args: unknown[]): Promise<void> {
      return mockTransportClose(...args)
    }
  },
}))

// Mock client - 使用 class 而非 vi.fn().mockImplementation()，避免 clearAllMocks 清除实现
vi.mock('./client', () => ({
  MCPClient: class MockMCPClient {
    initialize(...args: unknown[]): Promise<void> {
      return mockClientInitialize(...args)
    }
    listTools(...args: unknown[]): Promise<ToolDefinition[]> {
      return mockClientListTools(...args)
    }
    callTool(...args: unknown[]): Promise<ToolExecutionResult> {
      return mockClientCallTool(...args)
    }
    close(...args: unknown[]): Promise<void> {
      return mockClientClose(...args)
    }
    getServerCapabilities(): null {
      return null
    }
    getServerInfo(): null {
      return null
    }
  },
}))

// Mock ToolRegistry
vi.mock('../tools/registry', () => ({
  getToolRegistry: () => ({
    registerMcp: (...args: unknown[]) => mockRegisterMcp(...args),
    unregisterMcpServer: (...args: unknown[]) => mockUnregisterMcpServer(...args),
    registerBuiltin: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    listDefinitions: vi.fn(() => []),
    list: vi.fn(() => []),
    size: vi.fn(() => 0),
    clear: vi.fn(),
  }),
}))

// Mock app-settings：使用 Work 引擎（manager 仅在 work 引擎下自建连接并注册工具；
// code 引擎下连接由 SDK 管理，本测试聚焦连接管理逻辑）
vi.mock('../db/repos/app-settings', () => ({
  getSettings: vi.fn(() => ({ engineType: 'work' })),
}))

// 在 mock 设置完成后导入被测模块
const { getMcpServerManager, resetMcpServerManager } = await import('./manager')

// ─── 辅助函数 ─────────────────────────────────────────────────────

function makeConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    id: 'srv-1',
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: {},
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object' },
    riskLevel: 'high',
    source: 'mcp',
  }
}

// ─── 测试 ─────────────────────────────────────────────────────────

describe('MCPServerManager', () => {
  let manager: MCPServerManager

  beforeEach(() => {
    vi.clearAllMocks()

    // 默认 mock 行为
    mockTransportConnect.mockResolvedValue(undefined)
    mockTransportClose.mockResolvedValue(undefined)
    mockClientInitialize.mockResolvedValue(undefined)
    mockClientClose.mockResolvedValue(undefined)
    mockClientListTools.mockResolvedValue([])
    mockClientCallTool.mockResolvedValue({ isError: false, content: '' })

    // 重置单例
    resetMcpServerManager()
    manager = getMcpServerManager()
  })

  afterEach(() => {
    resetMcpServerManager()
  })

  // ─── addServer ────────────────────────────────────────────────

  describe('addServer', () => {
    it('should persist config to db and add to internal map', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)

      const result = await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      })

      expect(mockCreateMcpServer).toHaveBeenCalledWith({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      })
      expect(result).toEqual(config)
      expect(manager.listServers()).toHaveLength(1)
    })

    it('should auto-connect when enabled is true', async () => {
      const config = makeConfig({ enabled: true })
      mockCreateMcpServer.mockReturnValue(config)
      mockClientListTools.mockResolvedValue([makeTool('tool1')])

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      expect(mockTransportConnect).toHaveBeenCalledTimes(1)
      expect(mockClientInitialize).toHaveBeenCalledTimes(1)
      expect(mockClientListTools).toHaveBeenCalledTimes(1)
    })

    it('should NOT auto-connect when enabled is false', async () => {
      const config = makeConfig({ enabled: false })
      mockCreateMcpServer.mockReturnValue(config)

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
        enabled: false,
      })

      expect(mockTransportConnect).not.toHaveBeenCalled()
      expect(mockClientInitialize).not.toHaveBeenCalled()
    })

    it('should register discovered tools to ToolRegistry', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)
      const tools = [makeTool('tool1'), makeTool('tool2')]
      mockClientListTools.mockResolvedValue(tools)

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      expect(mockRegisterMcp).toHaveBeenCalledTimes(2)
      // 第一个工具
      expect(mockRegisterMcp.mock.calls[0][0]).toBe('srv-1')
      expect(mockRegisterMcp.mock.calls[0][1]).toEqual(tools[0])
      // 第二个工具
      expect(mockRegisterMcp.mock.calls[1][0]).toBe('srv-1')
      expect(mockRegisterMcp.mock.calls[1][1]).toEqual(tools[1])
    })

    it('should not throw when connect fails (should still add server)', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)
      mockTransportConnect.mockRejectedValue(
        new AppError(ErrorCodes.MCP_SPAWN_FAILED, 'Spawn failed'),
      )

      // addServer 不应抛出（连接失败不阻止添加）
      const result = await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'bad-command',
        args: [],
      })

      expect(result).toEqual(config)
      expect(manager.listServers()).toHaveLength(1)
      // 状态应为 error
      expect(manager.getServerStatus('srv-1')).toBe('error')
    })

    it('should set status to connected after successful connect', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)
      mockClientListTools.mockResolvedValue([makeTool('tool1')])

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      expect(manager.getServerStatus('srv-1')).toBe('connected')
    })
  })

  // ─── removeServer ─────────────────────────────────────────────

  describe('removeServer', () => {
    it('should disconnect, unregister tools, and delete from db', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)
      mockClientListTools.mockResolvedValue([makeTool('tool1')])

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      await manager.removeServer('srv-1')

      expect(mockClientClose).toHaveBeenCalledTimes(1)
      expect(mockUnregisterMcpServer).toHaveBeenCalledWith('srv-1')
      expect(mockDeleteMcpServer).toHaveBeenCalledWith('srv-1')
      expect(manager.listServers()).toHaveLength(0)
    })

    it('should throw MCP_CONNECT_FAILED when server not found', async () => {
      await expect(manager.removeServer('nonexistent')).rejects.toThrow()
      try {
        await manager.removeServer('nonexistent')
        expect.fail('Expected error')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.MCP_CONNECT_FAILED)
      }
    })

    it('should remove server from internal map', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      expect(manager.listServers()).toHaveLength(1)

      await manager.removeServer('srv-1')

      expect(manager.listServers()).toHaveLength(0)
    })
  })

  // ─── listServers ──────────────────────────────────────────────

  describe('listServers', () => {
    it('should return empty array when no servers', () => {
      expect(manager.listServers()).toEqual([])
    })

    it('should return server entries with config, status, and toolCount', async () => {
      const config1 = makeConfig({ id: 'srv-1', name: 'server-1' })
      const config2 = makeConfig({ id: 'srv-2', name: 'server-2' })
      mockCreateMcpServer.mockReturnValueOnce(config1).mockReturnValueOnce(config2)
      mockClientListTools
        .mockResolvedValueOnce([makeTool('a'), makeTool('b')])
        .mockResolvedValueOnce([makeTool('c')])

      await manager.addServer({ name: 'server-1', transport: 'stdio', command: 'node', args: [] })
      await manager.addServer({ name: 'server-2', transport: 'stdio', command: 'node', args: [] })

      const list = manager.listServers()
      expect(list).toHaveLength(2)
      expect(list[0].config.name).toBe('server-1')
      expect(list[0].toolCount).toBe(2)
      expect(list[1].config.name).toBe('server-2')
      expect(list[1].toolCount).toBe(1)
    })

    it('should return toolCount 0 for disconnected servers', async () => {
      const config = makeConfig({ enabled: false })
      mockCreateMcpServer.mockReturnValue(config)

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
        enabled: false,
      })

      const list = manager.listServers()
      expect(list[0].toolCount).toBe(0)
      expect(list[0].status).toBe('disconnected')
    })
  })

  // ─── getServerStatus ──────────────────────────────────────────

  describe('getServerStatus', () => {
    it('should return disconnected for unknown server', () => {
      expect(manager.getServerStatus('unknown')).toBe('disconnected')
    })

    it('should return connected status after successful connect', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)
      mockClientListTools.mockResolvedValue([makeTool('tool1')])

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      expect(manager.getServerStatus('srv-1')).toBe('connected')
    })

    it('should return error status when connect fails', async () => {
      const config = makeConfig()
      mockCreateMcpServer.mockReturnValue(config)
      mockTransportConnect.mockRejectedValue(new Error('connect failed'))

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      expect(manager.getServerStatus('srv-1')).toBe('error')
    })
  })

  // ─── toggleEnable ─────────────────────────────────────────────

  describe('toggleEnable', () => {
    it('should disable an enabled server and disconnect', async () => {
      const config = makeConfig({ enabled: true })
      mockCreateMcpServer.mockReturnValue(config)
      mockClientListTools.mockResolvedValue([makeTool('tool1')])
      mockUpdateMcpServer.mockReturnValue(makeConfig({ enabled: false }))

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      const newEnabled = await manager.toggleEnable('srv-1')

      expect(newEnabled).toBe(false)
      expect(mockUpdateMcpServer).toHaveBeenCalledWith('srv-1', { enabled: false })
      expect(mockClientClose).toHaveBeenCalled()
    })

    it('should enable a disabled server and connect', async () => {
      const config = makeConfig({ enabled: false })
      mockCreateMcpServer.mockReturnValue(config)
      mockUpdateMcpServer.mockReturnValue(makeConfig({ enabled: true }))
      mockClientListTools.mockResolvedValue([])

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
        enabled: false,
      })

      expect(manager.getServerStatus('srv-1')).toBe('disconnected')

      const newEnabled = await manager.toggleEnable('srv-1')

      expect(newEnabled).toBe(true)
      expect(mockUpdateMcpServer).toHaveBeenCalledWith('srv-1', { enabled: true })
      expect(mockTransportConnect).toHaveBeenCalled()
      expect(mockClientInitialize).toHaveBeenCalled()
    })

    it('should throw MCP_CONNECT_FAILED when server not found', async () => {
      try {
        await manager.toggleEnable('nonexistent')
        expect.fail('Expected error')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe(ErrorCodes.MCP_CONNECT_FAILED)
      }
    })
  })

  // ─── getAggregatedTools ───────────────────────────────────────

  describe('getAggregatedTools', () => {
    it('should return empty array when no servers connected', () => {
      expect(manager.getAggregatedTools()).toEqual([])
    })

    it('should return tools from all connected servers', async () => {
      const config1 = makeConfig({ id: 'srv-1' })
      const config2 = makeConfig({ id: 'srv-2' })
      mockCreateMcpServer.mockReturnValueOnce(config1).mockReturnValueOnce(config2)
      const tools1 = [makeTool('tool1'), makeTool('tool2')]
      const tools2 = [makeTool('tool3')]
      mockClientListTools.mockResolvedValueOnce(tools1).mockResolvedValueOnce(tools2)

      await manager.addServer({ name: 's1', transport: 'stdio', command: 'node', args: [] })
      await manager.addServer({ name: 's2', transport: 'stdio', command: 'node', args: [] })

      const aggregated = manager.getAggregatedTools()
      expect(aggregated).toHaveLength(3)
      expect(aggregated.map((t) => t.name).sort()).toEqual(['tool1', 'tool2', 'tool3'])
    })

    it('should NOT include tools from disconnected servers', async () => {
      const config1 = makeConfig({ id: 'srv-1', enabled: true })
      const config2 = makeConfig({ id: 'srv-2', enabled: false })
      mockCreateMcpServer.mockReturnValueOnce(config1).mockReturnValueOnce(config2)
      mockClientListTools.mockResolvedValueOnce([makeTool('tool1')])

      await manager.addServer({ name: 's1', transport: 'stdio', command: 'node', args: [] })
      await manager.addServer({
        name: 's2',
        transport: 'stdio',
        command: 'node',
        args: [],
        enabled: false,
      })

      const aggregated = manager.getAggregatedTools()
      expect(aggregated).toHaveLength(1)
      expect(aggregated[0].name).toBe('tool1')
    })
  })

  // ─── connectAll ───────────────────────────────────────────────

  describe('connectAll', () => {
    it('should connect all enabled servers', async () => {
      const config1 = makeConfig({ id: 'srv-1', enabled: true })
      const config2 = makeConfig({ id: 'srv-2', enabled: true })
      mockCreateMcpServer.mockReturnValueOnce(config1).mockReturnValueOnce(config2)
      mockClientListTools.mockResolvedValue([])

      await manager.addServer({ name: 's1', transport: 'stdio', command: 'node', args: [] })
      await manager.addServer({ name: 's2', transport: 'stdio', command: 'node', args: [] })

      // 先断开（模拟重启场景）
      mockClientClose.mockClear()
      mockTransportConnect.mockClear()
      mockClientInitialize.mockClear()

      // connectAll 不会重连已连接的 server
      await manager.connectAll()

      // 已连接的 server 不应被重连
      expect(mockTransportConnect).not.toHaveBeenCalled()
    })

    it('should not connect disabled servers', async () => {
      const config = makeConfig({ enabled: false })
      mockCreateMcpServer.mockReturnValue(config)

      await manager.addServer({
        name: 's1',
        transport: 'stdio',
        command: 'node',
        args: [],
        enabled: false,
      })

      mockTransportConnect.mockClear()
      await manager.connectAll()

      expect(mockTransportConnect).not.toHaveBeenCalled()
    })
  })

  // ─── loadFromDatabase ─────────────────────────────────────────

  describe('loadFromDatabase', () => {
    it('should load configs from db into internal map', () => {
      const configs = [
        makeConfig({ id: 'srv-1', name: 'server-1' }),
        makeConfig({ id: 'srv-2', name: 'server-2' }),
      ]
      mockListMcpServers.mockReturnValue(configs)

      manager.loadFromDatabase()

      const list = manager.listServers()
      expect(list).toHaveLength(2)
      expect(list[0].config.name).toBe('server-1')
      expect(list[0].status).toBe('disconnected')
      expect(list[1].config.name).toBe('server-2')
      expect(list[1].status).toBe('disconnected')
    })

    it('should not duplicate servers already in map', async () => {
      const config = makeConfig({ id: 'srv-1' })
      mockCreateMcpServer.mockReturnValue(config)
      mockClientListTools.mockResolvedValue([])

      await manager.addServer({
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [],
      })

      // loadFromDatabase 不应重复添加
      mockListMcpServers.mockReturnValue([config])
      manager.loadFromDatabase()

      expect(manager.listServers()).toHaveLength(1)
    })
  })

  // ─── initialize ───────────────────────────────────────────────

  describe('initialize', () => {
    it('should load configs and connect enabled servers', async () => {
      const config = makeConfig({ id: 'srv-1', enabled: true })
      mockListMcpServers.mockReturnValue([config])
      mockClientListTools.mockResolvedValue([makeTool('tool1')])

      await manager.initialize()

      expect(mockListMcpServers).toHaveBeenCalled()
      expect(mockTransportConnect).toHaveBeenCalledTimes(1)
      expect(mockClientInitialize).toHaveBeenCalledTimes(1)
      expect(manager.getServerStatus('srv-1')).toBe('connected')
    })

    it('should not connect disabled servers on initialize', async () => {
      const config = makeConfig({ id: 'srv-1', enabled: false })
      mockListMcpServers.mockReturnValue([config])

      await manager.initialize()

      expect(mockTransportConnect).not.toHaveBeenCalled()
      expect(manager.getServerStatus('srv-1')).toBe('disconnected')
    })
  })

  // ─── closeAll ─────────────────────────────────────────────────

  describe('closeAll', () => {
    it('should disconnect all servers', async () => {
      const config1 = makeConfig({ id: 'srv-1' })
      const config2 = makeConfig({ id: 'srv-2' })
      mockCreateMcpServer.mockReturnValueOnce(config1).mockReturnValueOnce(config2)
      mockClientListTools.mockResolvedValue([])

      await manager.addServer({ name: 's1', transport: 'stdio', command: 'node', args: [] })
      await manager.addServer({ name: 's2', transport: 'stdio', command: 'node', args: [] })

      mockClientClose.mockClear()
      await manager.closeAll()

      expect(mockClientClose).toHaveBeenCalledTimes(2)
      expect(manager.getServerStatus('srv-1')).toBe('disconnected')
      expect(manager.getServerStatus('srv-2')).toBe('disconnected')
    })

    it('should handle closeAll with no servers', async () => {
      await expect(manager.closeAll()).resolves.toBeUndefined()
    })
  })

  // ─── 单例管理 ─────────────────────────────────────────────────

  describe('singleton', () => {
    it('getMcpServerManager should return same instance', () => {
      const m1 = getMcpServerManager()
      const m2 = getMcpServerManager()
      expect(m1).toBe(m2)
    })

    it('resetMcpServerManager should create new instance', () => {
      const m1 = getMcpServerManager()
      resetMcpServerManager()
      const m2 = getMcpServerManager()
      expect(m1).not.toBe(m2)
    })
  })

  // ─── 传输类型校验 ─────────────────────────────────────────────

  describe('transport validation', () => {
    it('should fail to connect non-stdio transport', async () => {
      const config = makeConfig({ transport: 'http', url: 'http://localhost:3000' })
      mockCreateMcpServer.mockReturnValue(config)

      await manager.addServer({
        name: 'http-server',
        transport: 'http',
        url: 'http://localhost:3000',
      })

      // http transport 尚不支持，状态应为 error
      expect(manager.getServerStatus('srv-1')).toBe('error')
    })

    it('should fail when stdio command is missing', async () => {
      const config = makeConfig({ command: undefined })
      mockCreateMcpServer.mockReturnValue(config)

      await manager.addServer({
        name: 'no-command',
        transport: 'stdio',
      })

      expect(manager.getServerStatus('srv-1')).toBe('error')
    })
  })
})
