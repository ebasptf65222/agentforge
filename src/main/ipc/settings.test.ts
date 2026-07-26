// AgentForge P1-09b: Settings IPC Handler 单元测试
// 测试 handleGetSettings / handleUpdateSettings
// Mock app-settings repo，验证 handler 参数校验与调用行为

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppSettings } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── Mock setup ─────────────────────────────────────────────────

const { mockGetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
}))

vi.mock('../db/repos/app-settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

// ─── Import after mocks ─────────────────────────────────────────

const { handleGetSettings, handleUpdateSettings } = await import('./settings')

// ─── Helpers ────────────────────────────────────────────────────

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: 'dark',
    defaultApprovalMode: 'auto-edit',
    maxExecutionSteps: 20,
    defaultModelId: null,
    shortcuts: {
      newConversation: 'CmdOrCtrl+N',
      sendMessage: 'Enter',
      stopGeneration: 'CmdOrCtrl+.',
      toggleSidebar: 'CmdOrCtrl+B',
    },
    approvalTimeoutMs: 300000,
    voice: {
      tts: {
        enabled: false,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'tts-1',
        voice: 'alloy',
        speed: 1.0,
        format: 'mp3',
        autoPlay: false,
      },
      stt: {
        enabled: false,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'whisper-1',
        language: '',
        temperature: 0.0,
      },
      mode: {
        vadSilenceThreshold: 1.5,
        autoAwait: true,
      },
    },
    workspace: {
      path: null,
      recentPaths: [],
      autoRestore: true,
      excludePatterns: ['node_modules', '.git', 'dist', '.DS_Store'],
    },
    updatedAt: Date.now(),
    ...overrides,
  }
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn()
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Settings IPC Handlers (P1-09b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── handleGetSettings ───────────────────────────────────────

  describe('handleGetSettings', () => {
    it('should return AppSettings from getSettings() directly', () => {
      const settings = makeSettings({ theme: 'light' })
      mockGetSettings.mockReturnValue(settings)

      const result = handleGetSettings()

      expect(result).toBe(settings)
      expect(mockGetSettings).toHaveBeenCalledTimes(1)
    })

    it('should propagate SETTINGS_NOT_FOUND from repo', () => {
      mockGetSettings.mockImplementation(() => {
        throw new AppError(ErrorCodes.SETTINGS_NOT_FOUND, 'Not found', { id: 1 })
      })
      expectAppError(() => handleGetSettings(), 'SETTINGS_NOT_FOUND')
    })
  })

  // ─── handleUpdateSettings: validation ───────────────────────

  describe('handleUpdateSettings validation', () => {
    it('should throw VALIDATION_ERROR when params is null', () => {
      expectAppError(() => handleUpdateSettings(null), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when params is not an object', () => {
      expectAppError(() => handleUpdateSettings('string'), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when theme is invalid', () => {
      expectAppError(() => handleUpdateSettings({ theme: 'invalid-theme' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when defaultApprovalMode is invalid', () => {
      expectAppError(
        () => handleUpdateSettings({ defaultApprovalMode: 'invalid-mode' }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when maxExecutionSteps is not a number', () => {
      expectAppError(() => handleUpdateSettings({ maxExecutionSteps: '20' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when approvalTimeoutMs is not a number', () => {
      expectAppError(() => handleUpdateSettings({ approvalTimeoutMs: '100' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when defaultModelId is empty string', () => {
      expectAppError(() => handleUpdateSettings({ defaultModelId: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when defaultModelId is a number', () => {
      expectAppError(() => handleUpdateSettings({ defaultModelId: 123 }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when shortcuts is not an object', () => {
      expectAppError(() => handleUpdateSettings({ shortcuts: 'bad' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when shortcuts is null', () => {
      expectAppError(() => handleUpdateSettings({ shortcuts: null }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when shortcuts has unknown key', () => {
      expectAppError(
        () =>
          handleUpdateSettings({
            shortcuts: { unknownKey: 'value' },
          }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when shortcut value is not a string', () => {
      expectAppError(
        () =>
          handleUpdateSettings({
            shortcuts: { newConversation: 123 },
          }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when windowBounds is not an object', () => {
      expectAppError(() => handleUpdateSettings({ windowBounds: 'bad' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when windowBounds is missing required key', () => {
      expectAppError(
        () => handleUpdateSettings({ windowBounds: { x: 0, y: 0, width: 100, height: 100 } }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when windowBounds.x is not a number', () => {
      expectAppError(
        () =>
          handleUpdateSettings({
            windowBounds: { x: '0', y: 0, width: 100, height: 100, isMaximized: false },
          }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when windowBounds.isMaximized is not boolean', () => {
      expectAppError(
        () =>
          handleUpdateSettings({
            windowBounds: { x: 0, y: 0, width: 100, height: 100, isMaximized: 'yes' },
          }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when updatedAt is provided', () => {
      expectAppError(() => handleUpdateSettings({ updatedAt: 123 }), 'VALIDATION_ERROR')
    })

    // ─── workspace validation ─────────────────────────────────

    it('should throw VALIDATION_ERROR when workspace is not an object', () => {
      expectAppError(() => handleUpdateSettings({ workspace: 'bad' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when workspace is null', () => {
      expectAppError(() => handleUpdateSettings({ workspace: null }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when workspace has unknown key', () => {
      expectAppError(
        () => handleUpdateSettings({ workspace: { unknownKey: 'value' } }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when workspace.path is not string or null', () => {
      expectAppError(
        () => handleUpdateSettings({ workspace: { path: 123 } }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when workspace.autoRestore is not boolean', () => {
      expectAppError(
        () => handleUpdateSettings({ workspace: { autoRestore: 'yes' } }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when workspace.excludePatterns is not string array', () => {
      expectAppError(
        () => handleUpdateSettings({ workspace: { excludePatterns: 'bad' } }),
        'VALIDATION_ERROR',
      )
    })

    it('should throw VALIDATION_ERROR when workspace.recentPaths contains non-string', () => {
      expectAppError(
        () => handleUpdateSettings({ workspace: { recentPaths: ['ok', 123] } }),
        'VALIDATION_ERROR',
      )
    })

    // ─── voice validation ─────────────────────────────────────

    it('should throw VALIDATION_ERROR when voice is not an object', () => {
      expectAppError(() => handleUpdateSettings({ voice: 'bad' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when voice has unknown key', () => {
      expectAppError(
        () => handleUpdateSettings({ voice: { unknownKey: 'value' } }),
        'VALIDATION_ERROR',
      )
    })
  })

  // ─── handleUpdateSettings: success ──────────────────────────

  describe('handleUpdateSettings successful calls', () => {
    it('should call updateSettings with empty object when no fields provided', () => {
      handleUpdateSettings({})

      expect(mockUpdateSettings).toHaveBeenCalledWith({})
    })

    it('should accept theme dark/light/system', () => {
      for (const theme of ['dark', 'light', 'system'] as const) {
        mockUpdateSettings.mockClear()
        handleUpdateSettings({ theme })
        expect(mockUpdateSettings).toHaveBeenCalledWith({ theme })
      }
    })

    it('should accept defaultApprovalMode suggest/auto-edit/full-auto', () => {
      for (const mode of ['suggest', 'auto-edit', 'full-auto'] as const) {
        mockUpdateSettings.mockClear()
        handleUpdateSettings({ defaultApprovalMode: mode })
        expect(mockUpdateSettings).toHaveBeenCalledWith({ defaultApprovalMode: mode })
      }
    })

    it('should accept maxExecutionSteps as number', () => {
      handleUpdateSettings({ maxExecutionSteps: 50 })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ maxExecutionSteps: 50 })
    })

    it('should accept approvalTimeoutMs as number', () => {
      handleUpdateSettings({ approvalTimeoutMs: 1000 })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ approvalTimeoutMs: 1000 })
    })

    it('should accept defaultModelId as string', () => {
      handleUpdateSettings({ defaultModelId: 'model-1' })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ defaultModelId: 'model-1' })
    })

    it('should accept defaultModelId as null', () => {
      handleUpdateSettings({ defaultModelId: null })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ defaultModelId: null })
    })

    it('should accept shortcuts object with valid keys', () => {
      const shortcuts = {
        newConversation: 'CmdOrCtrl+Shift+N',
        sendMessage: 'CmdOrCtrl+Enter',
      }
      handleUpdateSettings({ shortcuts })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ shortcuts })
    })

    it('should accept windowBounds object', () => {
      const windowBounds = { x: 0, y: 0, width: 800, height: 600, isMaximized: false }
      handleUpdateSettings({ windowBounds })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ windowBounds })
    })

    it('should accept windowBounds as null', () => {
      handleUpdateSettings({ windowBounds: null })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ windowBounds: null })
    })

    it('should accept voice partial config', () => {
      const voice = { tts: { enabled: true } }
      handleUpdateSettings({ voice })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ voice })
    })

    it('should accept workspace partial config with path', () => {
      const workspace = { path: '/home/user/workspace' }
      handleUpdateSettings({ workspace })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ workspace })
    })

    it('should accept workspace config with null path', () => {
      const workspace = { path: null }
      handleUpdateSettings({ workspace })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ workspace })
    })

    it('should accept workspace config with excludePatterns', () => {
      const workspace = { excludePatterns: ['node_modules', 'build'] }
      handleUpdateSettings({ workspace })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ workspace })
    })

    it('should accept workspace config with autoRestore', () => {
      const workspace = { autoRestore: false }
      handleUpdateSettings({ workspace })
      expect(mockUpdateSettings).toHaveBeenCalledWith({ workspace })
    })

    it('should accept multiple fields including workspace and voice in one call', () => {
      handleUpdateSettings({
        theme: 'light',
        maxExecutionSteps: 30,
        voice: { stt: { enabled: true } },
        workspace: { path: '/test/workspace' },
      })

      expect(mockUpdateSettings).toHaveBeenCalledWith({
        theme: 'light',
        maxExecutionSteps: 30,
        voice: { stt: { enabled: true } },
        workspace: { path: '/test/workspace' },
      })
    })

    it('should accept multiple fields in one call', () => {
      handleUpdateSettings({
        theme: 'light',
        maxExecutionSteps: 30,
        shortcuts: { stopGeneration: 'Escape' },
      })

      expect(mockUpdateSettings).toHaveBeenCalledWith({
        theme: 'light',
        maxExecutionSteps: 30,
        shortcuts: { stopGeneration: 'Escape' },
      })
    })

    it('should return undefined on success', () => {
      mockUpdateSettings.mockReturnValue(undefined)
      expect(handleUpdateSettings({ theme: 'light' })).toBeUndefined()
    })

    it('should propagate SETTINGS_NOT_FOUND from repo', () => {
      mockUpdateSettings.mockImplementation(() => {
        throw new AppError(ErrorCodes.SETTINGS_NOT_FOUND, 'Not found', { id: 1 })
      })
      expectAppError(() => handleUpdateSettings({ theme: 'light' }), 'SETTINGS_NOT_FOUND')
    })
  })
})
