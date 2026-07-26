// AgentForge P1-09b: File IPC Handler 单元测试
// 测试 handleSelectDir / handleSelectFile
// Mock electron dialog，验证参数传递与返回值

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const { mockShowOpenDialog, mockBrowserWindowGetAllWindows } = vi.hoisted(() => ({
  mockShowOpenDialog: vi.fn(),
  mockBrowserWindowGetAllWindows: vi.fn(() => []),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
  },
  BrowserWindow: {
    getAllWindows: () => mockBrowserWindowGetAllWindows(),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const { handleSelectDir, handleSelectFile } = await import('./file')

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

// ─── Tests ──────────────────────────────────────────────────────

describe('File IPC Handlers (P1-09b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBrowserWindowGetAllWindows.mockReturnValue([])
  })

  // ─── handleSelectDir ────────────────────────────────────────

  describe('handleSelectDir', () => {
    it('should call dialog.showOpenDialog with openDirectory property', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/home/user/Documents'],
      })

      const result = await handleSelectDir({})

      expect(result).toBe('/home/user/Documents')
      expect(mockShowOpenDialog).toHaveBeenCalledTimes(1)
      const opts = mockShowOpenDialog.mock.calls[0][0] as { properties: string[] }
      expect(opts.properties).toEqual(['openDirectory'])
    })

    it('should pass title and defaultPath when provided', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectDir({ title: '选择目录', defaultPath: '/home' })

      const opts = mockShowOpenDialog.mock.calls[0][0] as {
        properties: string[]
        title: string
        defaultPath: string
      }
      expect(opts.title).toBe('选择目录')
      expect(opts.defaultPath).toBe('/home')
    })

    it('should not set title/defaultPath when not provided', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectDir({})

      const opts = mockShowOpenDialog.mock.calls[0][0] as {
        properties: string[]
        title?: string
        defaultPath?: string
      }
      expect(opts.title).toBeUndefined()
      expect(opts.defaultPath).toBeUndefined()
    })

    it('should accept undefined params (uses default {})', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectDir(undefined)

      expect(mockShowOpenDialog).toHaveBeenCalledTimes(1)
    })

    it('should return null when user cancels (canceled=true)', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      })

      const result = await handleSelectDir({})

      expect(result).toBeNull()
    })

    it('should return null when filePaths is empty', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [],
      })

      const result = await handleSelectDir({})

      expect(result).toBeNull()
    })

    it('should throw VALIDATION_ERROR when params is not an object', async () => {
      await expectAppErrorAsync(handleSelectDir('string'), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when params is null', async () => {
      await expectAppErrorAsync(handleSelectDir(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when title is empty string', async () => {
      await expectAppErrorAsync(handleSelectDir({ title: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when title is whitespace', async () => {
      await expectAppErrorAsync(handleSelectDir({ title: '   ' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when defaultPath is empty string', async () => {
      await expectAppErrorAsync(handleSelectDir({ defaultPath: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when title is not a string', async () => {
      await expectAppErrorAsync(handleSelectDir({ title: 123 }), 'VALIDATION_ERROR')
    })

    it('should use parent window when BrowserWindow exists', async () => {
      const fakeWindow = { isDestroyed: () => false }
      mockBrowserWindowGetAllWindows.mockReturnValue([fakeWindow])
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectDir({})

      // 第一个参数应为 parentWindow
      expect(mockShowOpenDialog.mock.calls[0][0]).toBe(fakeWindow)
      expect(mockShowOpenDialog.mock.calls[0][1]).toBeDefined()
    })

    it('should fall back to no-parent when window is destroyed', async () => {
      const fakeWindow = { isDestroyed: () => true }
      mockBrowserWindowGetAllWindows.mockReturnValue([fakeWindow])
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectDir({})

      // 无 parent：第一个参数是 options 对象
      expect(mockShowOpenDialog.mock.calls[0].length).toBe(1)
    })
  })

  // ─── handleSelectFile ───────────────────────────────────────

  describe('handleSelectFile', () => {
    it('should call dialog.showOpenDialog with openFile property', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/home/user/file.txt'],
      })

      const result = await handleSelectFile({})

      expect(result).toBe('/home/user/file.txt')
      const opts = mockShowOpenDialog.mock.calls[0][0] as { properties: string[] }
      expect(opts.properties).toEqual(['openFile'])
    })

    it('should pass title, defaultPath, and filters when provided', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path/file.md'],
      })

      const filters = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      await handleSelectFile({
        title: '选择文件',
        defaultPath: '/home',
        filters,
      })

      const opts = mockShowOpenDialog.mock.calls[0][0] as {
        properties: string[]
        title: string
        defaultPath: string
        filters: typeof filters
      }
      expect(opts.title).toBe('选择文件')
      expect(opts.defaultPath).toBe('/home')
      expect(opts.filters).toEqual(filters)
    })

    it('should not set filters when not provided', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectFile({})

      const opts = mockShowOpenDialog.mock.calls[0][0] as {
        properties: string[]
        filters?: unknown
      }
      expect(opts.filters).toBeUndefined()
    })

    it('should return null when user cancels', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      })

      const result = await handleSelectFile({})

      expect(result).toBeNull()
    })

    it('should return null when filePaths is empty', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [],
      })

      const result = await handleSelectFile({})

      expect(result).toBeNull()
    })

    it('should throw VALIDATION_ERROR when params is not an object', async () => {
      await expectAppErrorAsync(handleSelectFile('string'), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when params is null', async () => {
      await expectAppErrorAsync(handleSelectFile(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when title is empty', async () => {
      await expectAppErrorAsync(handleSelectFile({ title: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when defaultPath is empty', async () => {
      await expectAppErrorAsync(handleSelectFile({ defaultPath: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when filters is not an array', async () => {
      await expectAppErrorAsync(handleSelectFile({ filters: 'bad' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when filter is missing name', async () => {
      await expectAppErrorAsync(
        handleSelectFile({ filters: [{ extensions: ['md'] }] }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when filter is missing extensions', async () => {
      await expectAppErrorAsync(
        handleSelectFile({ filters: [{ name: 'Markdown' }] }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when filter.extensions is not array of strings', async () => {
      await expectAppErrorAsync(
        handleSelectFile({ filters: [{ name: 'Bad', extensions: [123] }] }),
        'VALIDATION_ERROR',
      )
    })

    it('should accept undefined params (uses default {})', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/path'],
      })

      await handleSelectFile(undefined)

      expect(mockShowOpenDialog).toHaveBeenCalledTimes(1)
    })
  })
})
