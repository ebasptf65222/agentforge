// AgentForge P1-09b: System IPC Handler 单元测试
// 测试 handleGetVersion / handleOpenExternal
// Mock electron app/shell，验证参数校验与调用行为

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { AppError } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const { mockAppGetVersion, mockShellOpenExternal } = vi.hoisted(() => ({
  mockAppGetVersion: vi.fn(() => '0.1.0'),
  mockShellOpenExternal: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getVersion: () => mockAppGetVersion(),
  },
  shell: {
    openExternal: (...args: unknown[]) => mockShellOpenExternal(...args),
  },
}))

// 固定 process.versions 与 process.platform（vitest 运行时这些值存在但不确定）
const originalVersions = process.versions
const originalPlatform = process.platform

// ─── Import after mocks ─────────────────────────────────────────

const { handleGetVersion, handleOpenExternal } = await import('./system')

// ─── Helpers ────────────────────────────────────────────────────

async function expectAppErrorAsync(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

// 用于修改 process.versions 的工具函数
function setProcessVersions(overrides: Record<string, string>): void {
  Object.defineProperty(process, 'versions', {
    value: { ...originalVersions, ...overrides },
    configurable: true,
  })
}

// ─── Tests ──────────────────────────────────────────────────────

describe('System IPC Handlers (P1-09b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 还原 mock 默认行为
    mockAppGetVersion.mockReturnValue('0.1.0')
    mockShellOpenExternal.mockResolvedValue(undefined)
    // 还原 process 全局
    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      configurable: true,
    })
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
  })

  afterAll(() => {
    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      configurable: true,
    })
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
  })

  // ─── handleGetVersion ────────────────────────────────────────

  describe('handleGetVersion', () => {
    it('should return app version from app.getVersion()', () => {
      mockAppGetVersion.mockReturnValue('1.2.3')

      const result = handleGetVersion()

      expect(result.appVersion).toBe('1.2.3')
    })

    it('should return electron version from process.versions.electron', () => {
      setProcessVersions({ electron: '99.0.0' })

      const result = handleGetVersion()

      expect(result.electronVersion).toBe('99.0.0')
    })

    it('should return node version from process.versions.node', () => {
      setProcessVersions({ node: '20.0.0' })

      const result = handleGetVersion()

      expect(result.nodeVersion).toBe('20.0.0')
    })

    it('should return platform from process.platform', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      })

      const result = handleGetVersion()

      expect(result.platform).toBe('darwin')
    })

    it('should return all four fields in the result object', () => {
      const result = handleGetVersion()

      expect(result).toHaveProperty('appVersion')
      expect(result).toHaveProperty('electronVersion')
      expect(result).toHaveProperty('nodeVersion')
      expect(result).toHaveProperty('platform')
      expect(Object.keys(result).sort()).toEqual(
        ['appVersion', 'electronVersion', 'nodeVersion', 'platform'].sort(),
      )
    })

    it('should return string types for all fields', () => {
      setProcessVersions({ electron: '99.0.0', node: '20.0.0' })

      const result = handleGetVersion()

      expect(typeof result.appVersion).toBe('string')
      expect(typeof result.electronVersion).toBe('string')
      expect(typeof result.nodeVersion).toBe('string')
      expect(typeof result.platform).toBe('string')
    })
  })

  // ─── handleOpenExternal: validation ─────────────────────────

  describe('handleOpenExternal validation', () => {
    it('should throw VALIDATION_ERROR when params is null', async () => {
      await expectAppErrorAsync(handleOpenExternal(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when params is not an object', async () => {
      await expectAppErrorAsync(handleOpenExternal('string'), 'VALIDATION_ERROR')
    })

    it('should throw INVALID_URL when url is missing', async () => {
      await expectAppErrorAsync(handleOpenExternal({}), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url is empty string', async () => {
      await expectAppErrorAsync(handleOpenExternal({ url: '' }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url is whitespace only', async () => {
      await expectAppErrorAsync(handleOpenExternal({ url: '   ' }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url is not a string', async () => {
      await expectAppErrorAsync(handleOpenExternal({ url: 123 }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url is not a valid URL', async () => {
      await expectAppErrorAsync(handleOpenExternal({ url: 'not-a-url' }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url uses file:// protocol', async () => {
      await expectAppErrorAsync(handleOpenExternal({ url: 'file:///etc/passwd' }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url uses javascript: protocol', async () => {
      await expectAppErrorAsync(handleOpenExternal({ url: 'javascript:alert(1)' }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url uses data: protocol', async () => {
      await expectAppErrorAsync(
        handleOpenExternal({ url: 'data:text/html,<script>alert(1)</script>' }),
        'INVALID_URL',
      )
    })

    it('should throw INVALID_URL when url uses ftp: protocol', async () => {
      await expectAppErrorAsync(
        handleOpenExternal({ url: 'ftp://example.com/file' }),
        'INVALID_URL',
      )
    })
  })

  // ─── handleOpenExternal: success ────────────────────────────

  describe('handleOpenExternal success', () => {
    it('should call shell.openExternal with http URL', async () => {
      mockShellOpenExternal.mockResolvedValue(undefined)

      await handleOpenExternal({ url: 'http://example.com' })

      expect(mockShellOpenExternal).toHaveBeenCalledTimes(1)
      expect(mockShellOpenExternal).toHaveBeenCalledWith('http://example.com')
    })

    it('should accept https URLs', async () => {
      mockShellOpenExternal.mockResolvedValue(undefined)

      await handleOpenExternal({ url: 'https://github.com/user/repo' })

      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/user/repo')
    })

    it('should accept URLs with trailing path and query', async () => {
      mockShellOpenExternal.mockResolvedValue(undefined)

      await handleOpenExternal({
        url: 'https://example.com/path?query=1&other=2#anchor',
      })

      expect(mockShellOpenExternal).toHaveBeenCalledWith(
        'https://example.com/path?query=1&other=2#anchor',
      )
    })

    it('should accept URLs with ports', async () => {
      mockShellOpenExternal.mockResolvedValue(undefined)

      await handleOpenExternal({ url: 'http://localhost:3000' })

      expect(mockShellOpenExternal).toHaveBeenCalledWith('http://localhost:3000')
    })

    it('should trim whitespace around url before passing', async () => {
      mockShellOpenExternal.mockResolvedValue(undefined)

      await handleOpenExternal({ url: '  https://example.com  ' })

      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('should resolve to undefined on success', async () => {
      mockShellOpenExternal.mockResolvedValue(undefined)

      const result = await handleOpenExternal({ url: 'https://example.com' })

      expect(result).toBeUndefined()
    })

    it('should accept http URLs with uppercase protocol', async () => {
      // URL 解析器会将协议转为小写
      mockShellOpenExternal.mockResolvedValue(undefined)

      await handleOpenExternal({ url: 'HTTPS://example.com' })

      expect(mockShellOpenExternal).toHaveBeenCalledTimes(1)
    })
  })

  // ─── handleOpenExternal: error propagation ──────────────────

  describe('handleOpenExternal error propagation', () => {
    it('should propagate errors from shell.openExternal', async () => {
      const error = new Error('Failed to open')
      mockShellOpenExternal.mockRejectedValue(error)

      await expect(handleOpenExternal({ url: 'https://example.com' })).rejects.toThrow(
        'Failed to open',
      )
    })

    it('should not call shell.openExternal when url is invalid', async () => {
      try {
        await handleOpenExternal({ url: 'javascript:alert(1)' })
      } catch {
        // 预期抛出
      }

      expect(mockShellOpenExternal).not.toHaveBeenCalled()
    })
  })
})
