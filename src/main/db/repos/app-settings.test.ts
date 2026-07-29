// AgentForge P1-09b: app-settings repository 单元测试
// 测试 getSettings() 和 updateSettings() 的实际数据库行为
// 使用真实 better-sqlite3 + 临时数据库

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

// ─── 静态读取 schema ─────────────────────────────────────────────
const __dirname_test = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(__dirname_test, '../schema.sql'), 'utf-8')

// ─── 测试用 DB 实例（在 beforeEach 中初始化）──────────────────────
let tempDir: string
let testDb: DatabaseType

// Mock electron（db/index.ts 依赖 electron）
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
}))

// Mock db/index.ts 的 getDatabase，使其返回我们的测试 DB
vi.mock('../index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getSchemaVersion: vi.fn(() => 1),
}))

// 在 mock 设置完成后导入被测模块
const { getSettings, updateSettings } = await import('./app-settings')

// ─── 测试用 WindowBounds（与 AppSettings.windowBounds 一致）─────
interface TestWindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

describe('app-settings repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-settings-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)
    // schema.sql 使用 CREATE TABLE IF NOT EXISTS，对于新建库不会包含
    // 后续迁移添加的列。手动补齐以模拟 runConditionalMigrations 的效果。
    const cols = testDb.pragma('table_info(app_settings)') as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'copilot_reasoning_effort')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_reasoning_effort TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_wire_api')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_wire_api TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_skill_directories')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_skill_directories TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_enable_config_discovery')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_enable_config_discovery INTEGER DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'copilot_context_tier')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_context_tier TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_reasoning_summary')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_reasoning_summary TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_excluded_tools')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_excluded_tools TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_enable_host_git_operations')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_enable_host_git_operations INTEGER DEFAULT 1')
    }
    if (!cols.some((c) => c.name === 'copilot_tool_search_defer_threshold')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_tool_search_defer_threshold INTEGER')
    }
    if (!cols.some((c) => c.name === 'copilot_default_agent_excluded_tools')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_default_agent_excluded_tools TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_plugin_directories')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_plugin_directories TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_instruction_directories')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_instruction_directories TEXT')
    }
    if (!cols.some((c) => c.name === 'copilot_enable_memory')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_enable_memory INTEGER DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'copilot_skip_custom_instructions')) {
      testDb.exec('ALTER TABLE app_settings ADD COLUMN copilot_skip_custom_instructions INTEGER DEFAULT 0')
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── getSettings ─────────────────────────────────────────────

  describe('getSettings', () => {
    it('should return default settings when no updates have been made', () => {
      const settings = getSettings()

      expect(settings.theme).toBe('dark')
      expect(settings.defaultApprovalMode).toBe('auto-edit')
      expect(settings.maxExecutionSteps).toBe(20)
      expect(settings.defaultModelId).toBeNull()
      expect(settings.approvalTimeoutMs).toBe(300000)
      expect(settings.windowBounds).toBeUndefined()
      expect(settings.updatedAt).toBeGreaterThan(0)
    })

    it('should return shortcuts with default values', () => {
      const settings = getSettings()

      expect(settings.shortcuts).toEqual({
        newConversation: 'CmdOrCtrl+N',
        sendMessage: 'Enter',
        stopGeneration: 'CmdOrCtrl+.',
        toggleSidebar: 'CmdOrCtrl+B',
      })
    })

    it('should parse shortcuts from JSON stored in DB', () => {
      // 直接修改数据库
      testDb.prepare('UPDATE app_settings SET shortcuts = ? WHERE id = 1').run(
        JSON.stringify({
          newConversation: 'CmdOrCtrl+Shift+N',
          sendMessage: 'CmdOrCtrl+Enter',
          stopGeneration: 'Escape',
          toggleSidebar: 'CmdOrCtrl+B',
        }),
      )

      const settings = getSettings()
      expect(settings.shortcuts.newConversation).toBe('CmdOrCtrl+Shift+N')
      expect(settings.shortcuts.sendMessage).toBe('CmdOrCtrl+Enter')
      expect(settings.shortcuts.stopGeneration).toBe('Escape')
    })

    it('should merge shortcuts with defaults when DB has partial JSON', () => {
      testDb
        .prepare('UPDATE app_settings SET shortcuts = ? WHERE id = 1')
        .run(JSON.stringify({ newConversation: 'CmdOrCtrl+Shift+N' }))

      const settings = getSettings()
      expect(settings.shortcuts.newConversation).toBe('CmdOrCtrl+Shift+N')
      // 其它字段使用默认值
      expect(settings.shortcuts.sendMessage).toBe('Enter')
      expect(settings.shortcuts.stopGeneration).toBe('CmdOrCtrl+.')
      expect(settings.shortcuts.toggleSidebar).toBe('CmdOrCtrl+B')
    })

    it('should fall back to default shortcuts when JSON is invalid', () => {
      testDb.prepare('UPDATE app_settings SET shortcuts = ? WHERE id = 1').run('{invalid json}')

      const settings = getSettings()
      expect(settings.shortcuts).toEqual({
        newConversation: 'CmdOrCtrl+N',
        sendMessage: 'Enter',
        stopGeneration: 'CmdOrCtrl+.',
        toggleSidebar: 'CmdOrCtrl+B',
      })
    })

    it('should parse windowBounds from JSON when present', () => {
      const bounds: TestWindowBounds = {
        x: 100,
        y: 200,
        width: 1024,
        height: 768,
        isMaximized: false,
      }
      testDb
        .prepare('UPDATE app_settings SET window_bounds = ? WHERE id = 1')
        .run(JSON.stringify(bounds))

      const settings = getSettings()
      expect(settings.windowBounds).toEqual(bounds)
    })

    it('should return windowBounds as undefined when window_bounds is NULL', () => {
      const settings = getSettings()
      expect(settings.windowBounds).toBeUndefined()
    })

    it('should return windowBounds as undefined when JSON is invalid', () => {
      testDb.prepare('UPDATE app_settings SET window_bounds = ? WHERE id = 1').run('{invalid json}')

      const settings = getSettings()
      expect(settings.windowBounds).toBeUndefined()
    })

    it('should return defaultModelId as null by default', () => {
      const settings = getSettings()
      expect(settings.defaultModelId).toBeNull()
    })

    it('should throw SETTINGS_NOT_FOUND when id=1 row does not exist', () => {
      testDb.prepare('DELETE FROM app_settings WHERE id = 1').run()

      expect(() => getSettings()).toThrow(/SETTINGS_NOT_FOUND|not found/)
    })
  })

  // ─── updateSettings ──────────────────────────────────────────

  describe('updateSettings', () => {
    it('should update theme field', () => {
      updateSettings({ theme: 'light' })
      expect(getSettings().theme).toBe('light')
    })

    it('should update theme to system', () => {
      updateSettings({ theme: 'system' })
      expect(getSettings().theme).toBe('system')
    })

    it('should update defaultApprovalMode', () => {
      updateSettings({ defaultApprovalMode: 'suggest' })
      expect(getSettings().defaultApprovalMode).toBe('suggest')
    })

    it('should update maxExecutionSteps', () => {
      updateSettings({ maxExecutionSteps: 50 })
      expect(getSettings().maxExecutionSteps).toBe(50)
    })

    it('should update approvalTimeoutMs', () => {
      updateSettings({ approvalTimeoutMs:600000 })
      expect(getSettings().approvalTimeoutMs).toBe(600000)
    })

    it('should update defaultModelId to a string', () => {
      updateSettings({ defaultModelId: 'model-uuid-123' })
      expect(getSettings().defaultModelId).toBe('model-uuid-123')
    })

    it('should update defaultModelId to null', () => {
      // 先设置一个值
      updateSettings({ defaultModelId: 'model-uuid-123' })
      expect(getSettings().defaultModelId).toBe('model-uuid-123')

      // 再清空
      updateSettings({ defaultModelId: null })
      expect(getSettings().defaultModelId).toBeNull()
    })

    it('should not change defaultModelId when undefined', () => {
      updateSettings({ defaultModelId: 'model-uuid-123' })
      updateSettings({ theme: 'light' }) // defaultModelId 不传
      expect(getSettings().defaultModelId).toBe('model-uuid-123')
    })

    it('should merge shortcuts with existing values', () => {
      // 初始默认值
      expect(getSettings().shortcuts.newConversation).toBe('CmdOrCtrl+N')

      updateSettings({ shortcuts: { newConversation: 'CmdOrCtrl+Shift+N' } })

      const settings = getSettings()
      expect(settings.shortcuts.newConversation).toBe('CmdOrCtrl+Shift+N')
      // 其它字段保持默认
      expect(settings.shortcuts.sendMessage).toBe('Enter')
      expect(settings.shortcuts.stopGeneration).toBe('CmdOrCtrl+.')
      expect(settings.shortcuts.toggleSidebar).toBe('CmdOrCtrl+B')
    })

    it('should merge multiple shortcut keys', () => {
      updateSettings({
        shortcuts: {
          newConversation: 'CmdOrCtrl+Shift+N',
          stopGeneration: 'Escape',
        },
      })

      const settings = getSettings()
      expect(settings.shortcuts.newConversation).toBe('CmdOrCtrl+Shift+N')
      expect(settings.shortcuts.stopGeneration).toBe('Escape')
      expect(settings.shortcuts.sendMessage).toBe('Enter') // default
      expect(settings.shortcuts.toggleSidebar).toBe('CmdOrCtrl+B') // default
    })

    it('should preserve previously updated shortcuts on subsequent updates', () => {
      updateSettings({ shortcuts: { newConversation: 'CmdOrCtrl+Shift+N' } })
      updateSettings({ shortcuts: { stopGeneration: 'Escape' } })

      const settings = getSettings()
      expect(settings.shortcuts.newConversation).toBe('CmdOrCtrl+Shift+N')
      expect(settings.shortcuts.stopGeneration).toBe('Escape')
    })

    it('should store shortcuts as JSON in DB', () => {
      updateSettings({ shortcuts: { newConversation: 'CmdOrCtrl+Shift+N' } })

      const row = testDb.prepare('SELECT shortcuts FROM app_settings WHERE id = 1').get() as {
        shortcuts: string
      }
      const parsed = JSON.parse(row.shortcuts) as Record<string, string>
      expect(parsed.newConversation).toBe('CmdOrCtrl+Shift+N')
    })

    it('should update windowBounds to an object', () => {
      const bounds: TestWindowBounds = {
        x: 10,
        y: 20,
        width: 800,
        height: 600,
        isMaximized: false,
      }
      updateSettings({ windowBounds: bounds })

      expect(getSettings().windowBounds).toEqual(bounds)
    })

    it('should update windowBounds to null (clear)', () => {
      const bounds: TestWindowBounds = {
        x: 10,
        y: 20,
        width: 800,
        height: 600,
        isMaximized: false,
      }
      updateSettings({ windowBounds: bounds })
      expect(getSettings().windowBounds).toBeDefined()

      updateSettings({ windowBounds: null })
      expect(getSettings().windowBounds).toBeUndefined()
    })

    it('should store windowBounds as JSON in DB', () => {
      const bounds: TestWindowBounds = {
        x: 100,
        y: 200,
        width: 1024,
        height: 768,
        isMaximized: true,
      }
      updateSettings({ windowBounds: bounds })

      const row = testDb.prepare('SELECT window_bounds FROM app_settings WHERE id = 1').get() as {
        window_bounds: string
      }
      expect(JSON.parse(row.window_bounds)).toEqual(bounds)
    })

    it('should not change windowBounds when undefined', () => {
      const bounds: TestWindowBounds = {
        x: 10,
        y: 20,
        width: 800,
        height: 600,
        isMaximized: false,
      }
      updateSettings({ windowBounds: bounds })
      updateSettings({ theme: 'light' }) // windowBounds 不传

      expect(getSettings().windowBounds).toEqual(bounds)
    })

    it('should update updated_at timestamp', () => {
      const before = getSettings().updatedAt
      // 确保时间戳不同
      // SQLite 的 INTEGER 列精度为毫秒，但若同一毫秒内会相等，所以用 mock 时间
      const realDateNow = Date.now
      const mockNow = before + 5000
      Date.now = vi.fn(() => mockNow)

      updateSettings({ theme: 'light' })

      Date.now = realDateNow

      const after = getSettings().updatedAt
      expect(after).toBe(mockNow)
    })

    it('should update multiple fields in one call', () => {
      const bounds: TestWindowBounds = {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        isMaximized: true,
      }
      updateSettings({
        theme: 'light',
        defaultApprovalMode: 'full-auto',
        maxExecutionSteps: 100,
        approvalTimeoutMs: 10000,
        defaultModelId: 'model-x',
        shortcuts: { sendMessage: 'CmdOrCtrl+Enter' },
        workspace: { path: '/test/workspace' },
        windowBounds: bounds,
      })

      const settings = getSettings()
      expect(settings.theme).toBe('light')
      expect(settings.defaultApprovalMode).toBe('full-auto')
      expect(settings.maxExecutionSteps).toBe(100)
      expect(settings.approvalTimeoutMs).toBe(10000)
      expect(settings.defaultModelId).toBe('model-x')
      expect(settings.shortcuts.sendMessage).toBe('CmdOrCtrl+Enter')
      expect(settings.workspace.path).toBe('/test/workspace')
      expect(settings.windowBounds).toEqual(bounds)
    })

    it('should be a no-op when params is an empty object (only updated_at changes)', () => {
      const before = getSettings()
      const realDateNow = Date.now
      Date.now = vi.fn(() => before.updatedAt + 1000)

      updateSettings({})

      Date.now = realDateNow

      const after = getSettings()
      // 业务字段不变
      expect(after.theme).toBe(before.theme)
      expect(after.defaultApprovalMode).toBe(before.defaultApprovalMode)
      expect(after.maxExecutionSteps).toBe(before.maxExecutionSteps)
      // updated_at 应该更新
      expect(after.updatedAt).toBe(before.updatedAt + 1000)
    })

    it('should throw SETTINGS_NOT_FOUND when id=1 row does not exist', () => {
      testDb.prepare('DELETE FROM app_settings WHERE id = 1').run()

      expect(() => updateSettings({ theme: 'light' })).toThrow(/SETTINGS_NOT_FOUND|not found/)
    })
  })

  // ─── workspace 配置 ──────────────────────────────────────────

  describe('workspace config', () => {
    it('should return default workspace config when no updates have been made', () => {
      const settings = getSettings()

      expect(settings.workspace).toEqual({
        path: null,
        recentPaths: [],
        autoRestore: true,
        excludePatterns: ['node_modules', '.git', 'dist', '.DS_Store'],
      })
    })

    it('should update workspace.path', () => {
      updateSettings({ workspace: { path: '/home/user/workspace' } })

      const settings = getSettings()
      expect(settings.workspace.path).toBe('/home/user/workspace')
    })

    it('should auto-add path to recentPaths when path changes', () => {
      updateSettings({ workspace: { path: '/home/user/ws1' } })

      const settings = getSettings()
      expect(settings.workspace.recentPaths).toContain('/home/user/ws1')
    })

    it('should deduplicate recentPaths when same path is set again', () => {
      updateSettings({ workspace: { path: '/home/user/ws1' } })
      updateSettings({ workspace: { path: '/home/user/ws2' } })
      updateSettings({ workspace: { path: '/home/user/ws1' } })

      const settings = getSettings()
      const paths = settings.workspace.recentPaths
      // ws1 should appear only once (at the front)
      const ws1Count = paths.filter((p) => p === '/home/user/ws1').length
      expect(ws1Count).toBe(1)
      expect(paths[0]).toBe('/home/user/ws1')
    })

    it('should truncate recentPaths to 10 entries', () => {
      // Add 12 different paths
      for (let i = 0; i < 12; i++) {
        updateSettings({ workspace: { path: `/home/user/ws${i}` } })
      }

      const settings = getSettings()
      expect(settings.workspace.recentPaths.length).toBe(10)
      // Most recent should be at the front
      expect(settings.workspace.recentPaths[0]).toBe('/home/user/ws11')
    })

    it('should not add null path to recentPaths', () => {
      updateSettings({ workspace: { path: '/home/user/ws1' } })
      updateSettings({ workspace: { path: null } })

      const settings = getSettings()
      expect(settings.workspace.path).toBeNull()
      // recentPaths should still contain the previous path
      expect(settings.workspace.recentPaths).toContain('/home/user/ws1')
    })

    it('should update autoRestore independently', () => {
      updateSettings({ workspace: { autoRestore: false } })

      const settings = getSettings()
      expect(settings.workspace.autoRestore).toBe(false)
      // Other fields should remain default
      expect(settings.workspace.path).toBeNull()
    })

    it('should update excludePatterns independently', () => {
      const customPatterns = ['node_modules', '.git', 'build', 'target']
      updateSettings({ workspace: { excludePatterns: customPatterns } })

      const settings = getSettings()
      expect(settings.workspace.excludePatterns).toEqual(customPatterns)
    })

    it('should preserve existing workspace config when updating other settings', () => {
      updateSettings({ workspace: { path: '/home/user/ws1', autoRestore: false } })
      updateSettings({ theme: 'light' })

      const settings = getSettings()
      expect(settings.workspace.path).toBe('/home/user/ws1')
      expect(settings.workspace.autoRestore).toBe(false)
    })

    it('should store workspace as JSON in DB', () => {
      updateSettings({ workspace: { path: '/test/path' } })

      const row = testDb.prepare('SELECT workspace FROM app_settings WHERE id = 1').get() as {
        workspace: string
      }
      const parsed = JSON.parse(row.workspace) as { path: string }
      expect(parsed.path).toBe('/test/path')
    })

    it('should fall back to default workspace config when JSON is invalid', () => {
      testDb.prepare('UPDATE app_settings SET workspace = ? WHERE id = 1').run('{invalid json}')

      const settings = getSettings()
      expect(settings.workspace).toEqual({
        path: null,
        recentPaths: [],
        autoRestore: true,
        excludePatterns: ['node_modules', '.git', 'dist', '.DS_Store'],
      })
    })
  })

  // ─── copilotReasoningEffort 配置 (CE-05) ──────────────────────

  describe('copilotReasoningEffort config', () => {
    it('should return undefined by default when column is NULL', () => {
      const settings = getSettings()
      expect(settings.copilotReasoningEffort).toBeUndefined()
    })

    it('should update copilotReasoningEffort to "high"', () => {
      updateSettings({ copilotReasoningEffort: 'high' })

      const settings = getSettings()
      expect(settings.copilotReasoningEffort).toBe('high')
    })

    it('should update copilotReasoningEffort to "xhigh"', () => {
      updateSettings({ copilotReasoningEffort: 'xhigh' })

      const settings = getSettings()
      expect(settings.copilotReasoningEffort).toBe('xhigh')
    })

    it('should clear copilotReasoningEffort by setting to null', () => {
      updateSettings({ copilotReasoningEffort: 'high' })
      updateSettings({ copilotReasoningEffort: null })

      const settings = getSettings()
      expect(settings.copilotReasoningEffort).toBeUndefined()
    })

    it('should persist copilotReasoningEffort as raw TEXT in DB', () => {
      updateSettings({ copilotReasoningEffort: 'medium' })

      const row = testDb
        .prepare('SELECT copilot_reasoning_effort FROM app_settings WHERE id = 1')
        .get() as { copilot_reasoning_effort: string | null }
      expect(row.copilot_reasoning_effort).toBe('medium')
    })

    it('should store NULL when copilotReasoningEffort is set to null', () => {
      updateSettings({ copilotReasoningEffort: 'low' })
      updateSettings({ copilotReasoningEffort: null })

      const row = testDb
        .prepare('SELECT copilot_reasoning_effort FROM app_settings WHERE id = 1')
        .get() as { copilot_reasoning_effort: string | null }
      expect(row.copilot_reasoning_effort).toBeNull()
    })

    it('should preserve copilotReasoningEffort when updating other settings', () => {
      updateSettings({ copilotReasoningEffort: 'high' })
      updateSettings({ theme: 'light' })

      const settings = getSettings()
      expect(settings.copilotReasoningEffort).toBe('high')
      expect(settings.theme).toBe('light')
    })
  })
})
