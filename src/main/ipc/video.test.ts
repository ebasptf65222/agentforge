// M10/M11: 批量操作与 CSV 批量造片 IPC 通道注册与参数校验测试
// 通过 mock 引擎与 electron.ipcMain 捕获注册的 handler，验证：
//  - 批量通道正确注册并委托到引擎
//  - ids / rows 数组通过获取、空数组/非法输入被校验拦截
//  - M11 parse-csv 读取文件后委托解析器；batch-generate 校验行后委托引擎

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock setup（hoisted，供 vi.mock factory 引用） ────────────
const { capturedHandlers, mockEngine, mockParseCsvRows, mockReadFile } = vi.hoisted(() => {
  const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  const mockEngine = {
    retryTasks: vi.fn(),
    cancelSequences: vi.fn(),
    deleteTasks: vi.fn(),
    deleteSequences: vi.fn(),
    generateRows: vi.fn(),
  }
  const mockParseCsvRows = vi.fn()
  const mockReadFile = vi.fn()
  return { capturedHandlers, mockEngine, mockParseCsvRows, mockReadFile }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      capturedHandlers[channel] = fn
    },
    removeHandler: () => undefined,
  },
}))
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))
vi.mock('../services/csv-batch', () => ({
  parseCsvRows: (...args: unknown[]) => mockParseCsvRows(...args),
}))
vi.mock('../services/video-engine', () => ({
  getVideoEngine: () => mockEngine,
  loadVideoConfig: () => undefined,
}))
vi.mock('../db/repos/video-sequence', () => ({
  getVideoSequenceById: () => null,
  listVideoSequences: () => [],
}))
vi.mock('../db/repos/video-task', () => ({
  listVideoTasksBySequence: () => [],
}))
vi.mock('../services/video-provider/seedance', () => ({ DEFAULT_ARK_BASE_URL: 'https://x' }))
vi.mock('../services/video-provider/kling', () => ({
  DEFAULT_KLING_BASE_URL: 'https://x',
  DEFAULT_KLING_MODEL: 'kling',
}))

const { registerVideoHandlers } = await import('./video')
const { ErrorCodes } = await import('../utils/error')

function handler(channel: string): (e: unknown, p: unknown) => unknown {
  return capturedHandlers[channel] as (e: unknown, p: unknown) => unknown
}

describe('video batch IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the four batch channels', () => {
    registerVideoHandlers()
    for (const ch of [
      'video:batch-retry',
      'video:cancel-sequences',
      'video:delete-tasks',
      'video:delete-sequences',
    ]) {
      expect(capturedHandlers[ch]).toBeDefined()
    }
  })

  it('dispatches batch-retry with validated ids array', async () => {
    mockEngine.retryTasks.mockResolvedValue({ succeeded: [], failed: [] })
    registerVideoHandlers()
    await handler('video:batch-retry')(null, { ids: ['t1', 't2'] })
    expect(mockEngine.retryTasks).toHaveBeenCalledWith(['t1', 't2'])
  })

  it('dispatches delete-tasks / cancel-sequences / delete-sequences', async () => {
    mockEngine.deleteTasks.mockResolvedValue({ succeeded: [], failed: [] })
    mockEngine.cancelSequences.mockResolvedValue({ succeeded: [], failed: [] })
    mockEngine.deleteSequences.mockResolvedValue({ succeeded: [], failed: [] })
    registerVideoHandlers()

    await handler('video:delete-tasks')(null, { ids: ['a'] })
    await handler('video:cancel-sequences')(null, { ids: ['s1'] })
    await handler('video:delete-sequences')(null, { ids: ['s1', 's2'] })

    expect(mockEngine.deleteTasks).toHaveBeenCalledWith(['a'])
    expect(mockEngine.cancelSequences).toHaveBeenCalledWith(['s1'])
    expect(mockEngine.deleteSequences).toHaveBeenCalledWith(['s1', 's2'])
  })

  it('rejects empty or non-string ids array', () => {
    registerVideoHandlers()
    const raw = handler('video:batch-retry')
    const expectValidationError = (fn: () => unknown): void => {
      try {
        fn()
        throw new Error('expected a validation error to be thrown')
      } catch (error) {
        expect((error as { code?: string; name?: string }).code).toBe(
          ErrorCodes.VALIDATION_ERROR,
        )
      }
    }

    expectValidationError(() => raw(null, { ids: [] }))
    expectValidationError(() => raw(null, { ids: 't1' }))
    expectValidationError(() => raw(null, { ids: [1, 2] }))
    expectValidationError(() => raw(null, {}))
  })

  it('registers the two M11 CSV channels', () => {
    registerVideoHandlers()
    expect(capturedHandlers['video:parse-csv']).toBeDefined()
    expect(capturedHandlers['video:batch-generate']).toBeDefined()
  })

  it('parse-csv reads the file and delegates to the parser (M11)', async () => {
    const parsed = { rows: [{ prompt: 'a cat' }], skipped: [], headerMissingPrompt: false }
    mockReadFile.mockResolvedValue('prompt\na cat')
    mockParseCsvRows.mockReturnValue(parsed)
    registerVideoHandlers()

    const result = await handler('video:parse-csv')(null, { filePath: '/tmp/batch.csv' })

    expect(mockReadFile).toHaveBeenCalledWith('/tmp/batch.csv', 'utf8')
    expect(mockParseCsvRows).toHaveBeenCalledWith('prompt\na cat')
    expect(result).toBe(parsed)
  })

  it('dispatches batch-generate with validated rows (M11)', async () => {
    mockEngine.generateRows.mockResolvedValue({ succeeded: [], failed: [] })
    registerVideoHandlers()

    const rows = [
      { prompt: 'a cat' },
      { prompt: 'a dog', duration: 6, resolution: '1080P', aspect: '9:16' },
    ]
    await handler('video:batch-generate')(null, { rows, concurrency: 3 })

    expect(mockEngine.generateRows).toHaveBeenCalledWith(rows, 3)
  })

  it('rejects invalid batch-generate rows (M11)', () => {
    registerVideoHandlers()
    const raw = handler('video:batch-generate')
    const expectValidationError = (fn: () => unknown): void => {
      try {
        fn()
        throw new Error('expected a validation error to be thrown')
      } catch (error) {
        expect((error as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    }

    expectValidationError(() => raw(null, { rows: [] }))
    expectValidationError(() => raw(null, {}))
    expectValidationError(() => raw(null, { rows: 'not-array' }))
    expectValidationError(() => raw(null, { rows: [null] }))
    expectValidationError(() => raw(null, { rows: [{ prompt: '  ' }] }))
    expectValidationError(() => raw(null, { rows: [{ prompt: 'ok', resolution: '4K' }] }))
    expectValidationError(() => raw(null, { rows: [{ prompt: 'ok', duration: -1 }] }))
  })
})