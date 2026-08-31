// M10/M11/M12/M14: 批量操作、CSV 批量造片、统计导出与资产管理 IPC 通道注册与参数校验测试
// 通过 mock 引擎与 electron.ipcMain 捕获注册的 handler，验证：
//  - 批量通道正确注册并委托到引擎
//  - ids / rows 数组通过获取、空数组/非法输入被校验拦截
//  - M11 parse-csv 读取文件后委托解析器；batch-generate 校验行后委托引擎
//  - M12 stats / export-stats 委托统计服务，导出经保存对话框写文件
//  - M14 收藏/标签/回收站/资产导出通道注册、校验与委托

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock setup（hoisted，供 vi.mock factory 引用） ────────────
const {
  capturedHandlers,
  mockEngine,
  mockParseCsvRows,
  mockReadFile,
  mockWriteFile,
  mockShowSaveDialog,
  mockShowOpenDialog,
  mockAggregateVideoStats,
  mockBuildStatsCsv,
  mockUpdateVideoTask,
  mockUpdateSettings,
} = vi.hoisted(() => {
  const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  const mockEngine = {
    retryTasks: vi.fn(),
    cancelSequences: vi.fn(),
    deleteTasks: vi.fn(),
    deleteSequences: vi.fn(),
    generateRows: vi.fn(),
    getQueueSnapshot: vi.fn(),
    pauseQueue: vi.fn(),
    resumeQueue: vi.fn(),
    setQueueConcurrency: vi.fn(),
    listTrash: vi.fn(),
    restoreTask: vi.fn(),
    restoreSequence: vi.fn(),
    purgeTask: vi.fn(),
    purgeSequence: vi.fn(),
    emptyTrash: vi.fn(),
    exportAssets: vi.fn(),
    getRoutingConfig: vi.fn(),
    setRoutingConfig: vi.fn(),
    getRoutingLogs: vi.fn(),
    clearRoutingLogs: vi.fn(),
  }
  const mockParseCsvRows = vi.fn()
  const mockReadFile = vi.fn()
  const mockWriteFile = vi.fn()
  const mockShowSaveDialog = vi.fn()
  const mockShowOpenDialog = vi.fn()
  const mockAggregateVideoStats = vi.fn()
  const mockBuildStatsCsv = vi.fn()
  const mockUpdateVideoTask = vi.fn()
  const mockUpdateSettings = vi.fn()
  return {
    capturedHandlers,
    mockEngine,
    mockParseCsvRows,
    mockReadFile,
    mockWriteFile,
    mockShowSaveDialog,
    mockShowOpenDialog,
    mockAggregateVideoStats,
    mockBuildStatsCsv,
    mockUpdateVideoTask,
    mockUpdateSettings,
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      capturedHandlers[channel] = fn
    },
    removeHandler: () => undefined,
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
  },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}))
vi.mock('../services/csv-batch', () => ({
  parseCsvRows: (...args: unknown[]) => mockParseCsvRows(...args),
}))
vi.mock('../services/video-stats', () => ({
  aggregateVideoStats: (...args: unknown[]) => mockAggregateVideoStats(...args),
  buildStatsCsv: (...args: unknown[]) => mockBuildStatsCsv(...args),
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
  updateVideoTask: (...args: unknown[]) => mockUpdateVideoTask(...args),
}))
vi.mock('../db/repos/app-settings', () => ({
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  getSettings: () => ({ videoRoutingConfig: undefined, videoProvider: 'seedance' }),
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

  // ─── M12: 统计与导出 ────────────────────────────────────────

  it('registers the two M12 stats channels', () => {
    registerVideoHandlers()
    expect(capturedHandlers['video:stats']).toBeDefined()
    expect(capturedHandlers['video:export-stats']).toBeDefined()
  })

  it('stats delegates with days and defaults when omitted (M12)', async () => {
    mockAggregateVideoStats.mockReturnValue({ total: 0 })
    registerVideoHandlers()

    await handler('video:stats')(null, { days: 7 })
    const calledWith = mockAggregateVideoStats.mock.calls[0]?.[0] as number
    // since = now - 7 天（允许秒级误差）
    expect(Math.abs(Date.now() - calledWith - 7 * 24 * 3600 * 1000)).toBeLessThan(5000)

    await handler('video:stats')(null, undefined)
    const second = mockAggregateVideoStats.mock.calls[1]?.[0] as number
    expect(Math.abs(Date.now() - second - 30 * 24 * 3600 * 1000)).toBeLessThan(5000)
  })

  it('export-stats writes BOM CSV to the chosen path (M12)', async () => {
    const overview = { total: 1 }
    mockAggregateVideoStats.mockReturnValue(overview)
    mockBuildStatsCsv.mockReturnValue('section,key\nsummary,ALL')
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: 'D:/out/report.csv' })
    mockWriteFile.mockResolvedValue(undefined)
    registerVideoHandlers()

    const result = (await handler('video:export-stats')(null, { days: 30 })) as {
      canceled: boolean
      path?: string
    }

    expect(result.canceled).toBe(false)
    expect(result.path).toBe('D:/out/report.csv')
    expect(mockWriteFile).toHaveBeenCalledWith(
      'D:/out/report.csv',
      expect.stringContaining('\uFEFFsection,key'),
      'utf8',
    )
  })

  it('export-stats returns canceled without writing when dialog canceled (M12)', async () => {
    mockAggregateVideoStats.mockReturnValue({ total: 0 })
    mockShowSaveDialog.mockResolvedValue({ canceled: true })
    registerVideoHandlers()

    const result = (await handler('video:export-stats')(null, undefined)) as { canceled: boolean }

    expect(result.canceled).toBe(true)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects out-of-range days for stats channels (M12)', () => {
    registerVideoHandlers()
    const rawStats = handler('video:stats')
    const rawExport = handler('video:export-stats')
    const expectValidationError = (fn: () => unknown): void => {
      try {
        fn()
        throw new Error('expected a validation error to be thrown')
      } catch (error) {
        expect((error as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    }

    expectValidationError(() => rawStats(null, { days: 0 }))
    expectValidationError(() => rawStats(null, { days: 366 }))
    expectValidationError(() => rawExport(null, { days: 'x' }))
  })

  // ─── M13: 生成队列 ──────────────────────────────────────────

  it('registers the four M13 queue channels and delegates to the engine', async () => {
    const snapshot = { paused: false, maxConcurrent: 2, activeCount: 1, items: [] }
    mockEngine.getQueueSnapshot.mockReturnValue(snapshot)
    mockEngine.pauseQueue.mockReturnValue({ ...snapshot, paused: true })
    mockEngine.resumeQueue.mockReturnValue(snapshot)
    mockEngine.setQueueConcurrency.mockReturnValue({ ...snapshot, maxConcurrent: 5 })
    registerVideoHandlers()

    for (const ch of [
      'video:queue',
      'video:queue-pause',
      'video:queue-resume',
      'video:queue-concurrency',
    ]) {
      expect(capturedHandlers[ch]).toBeDefined()
    }

    expect(await handler('video:queue')(null, undefined)).toBe(snapshot)
    expect(await handler('video:queue-pause')(null, undefined)).toMatchObject({ paused: true })
    expect(await handler('video:queue-resume')(null, undefined)).toBe(snapshot)
    await handler('video:queue-concurrency')(null, { limit: 5 })
    expect(mockEngine.setQueueConcurrency).toHaveBeenCalledWith(5)
  })

  it('rejects invalid concurrency limits for queue-concurrency (M13)', () => {
    registerVideoHandlers()
    const raw = handler('video:queue-concurrency')
    const expectValidationError = (fn: () => unknown): void => {
      try {
        fn()
        throw new Error('expected a validation error to be thrown')
      } catch (error) {
        expect((error as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    }

    expectValidationError(() => raw(null, { limit: 0 }))
    expectValidationError(() => raw(null, { limit: 11 }))
    expectValidationError(() => raw(null, { limit: 'x' }))
  })

  // ─── M15: 跨厂商智能路由 ─────────────────────────────────────

  it('registers the four M15 routing channels and delegates to the engine', async () => {
    const cfg = { strategy: 'cost-optimized', providers: [] }
    mockEngine.getRoutingConfig.mockReturnValue(cfg)
    mockEngine.getRoutingLogs.mockReturnValue([])
    registerVideoHandlers()

    for (const ch of [
      'video:get-routing-config',
      'video:set-routing-config',
      'video:get-routing-logs',
      'video:clear-routing-logs',
    ]) {
      expect(capturedHandlers[ch]).toBeDefined()
    }

    expect(await handler('video:get-routing-config')(null, undefined)).toBe(cfg)
    await handler('video:set-routing-config')(null, { strategy: 'cost-optimized', providers: [] })
    expect(mockEngine.setRoutingConfig).toHaveBeenCalled()
    expect(mockUpdateSettings).toHaveBeenCalled()
    await handler('video:get-routing-logs')(null, { limit: 10 })
    expect(mockEngine.getRoutingLogs).toHaveBeenCalled()
    mockEngine.clearRoutingLogs.mockReturnValue(undefined)
    expect(await handler('video:clear-routing-logs')(null, undefined)).toBe(true)
    expect(mockEngine.clearRoutingLogs).toHaveBeenCalled()
  })

  // ─── M14: 资产管理（收藏/标签/回收站/导出） ─────────────────

  it('registers the seven M14 asset management channels', () => {
    registerVideoHandlers()
    for (const ch of [
      'video:set-favorite',
      'video:set-tags',
      'video:trash',
      'video:restore',
      'video:purge',
      'video:empty-trash',
      'video:export-assets',
    ]) {
      expect(capturedHandlers[ch]).toBeDefined()
    }
  })

  it('dispatches set-favorite and set-tags to the repo (M14)', async () => {
    mockUpdateVideoTask.mockResolvedValue({ id: 't1' })
    registerVideoHandlers()

    await handler('video:set-favorite')(null, { id: 't1', favorite: true })
    expect(mockUpdateVideoTask).toHaveBeenLastCalledWith('t1', { favorite: true })

    // favorite 缺省按 false 处理
    await handler('video:set-favorite')(null, { id: 't1' })
    expect(mockUpdateVideoTask).toHaveBeenLastCalledWith('t1', { favorite: false })

    await handler('video:set-tags')(null, { id: 't1', tags: ['a', 'b'] })
    expect(mockUpdateVideoTask).toHaveBeenLastCalledWith('t1', { tags: ['a', 'b'] })
  })

  it('rejects invalid set-favorite / set-tags payloads (M14)', () => {
    registerVideoHandlers()
    const favoriteHandler = handler('video:set-favorite')
    const tagsHandler = handler('video:set-tags')
    const expectValidationError = (fn: () => unknown): void => {
      try {
        fn()
        throw new Error('expected a validation error to be thrown')
      } catch (error) {
        expect((error as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    }

    expectValidationError(() => favoriteHandler(null, { id: 't1', favorite: 'yes' }))
    expectValidationError(() => favoriteHandler(null, {}))
    expectValidationError(() => tagsHandler(null, { id: 't1', tags: [] }))
    expectValidationError(() => tagsHandler(null, { id: 't1', tags: ['ok', 1] }))
  })

  it('dispatches trash / restore / purge / empty-trash by type (M14)', async () => {
    const snapshot = { tasks: [], sequences: [] }
    mockEngine.listTrash.mockReturnValue(snapshot)
    mockEngine.restoreTask.mockResolvedValue({ id: 't1' })
    mockEngine.restoreSequence.mockResolvedValue({ id: 's1' })
    mockEngine.purgeTask.mockResolvedValue(undefined)
    mockEngine.purgeSequence.mockResolvedValue(undefined)
    mockEngine.emptyTrash.mockResolvedValue({ tasks: 1, sequences: 2 })
    registerVideoHandlers()

    expect(await handler('video:trash')(null, undefined)).toBe(snapshot)

    await handler('video:restore')(null, { type: 'task', id: 't1' })
    expect(mockEngine.restoreTask).toHaveBeenCalledWith('t1')
    await handler('video:restore')(null, { type: 'sequence', id: 's1' })
    expect(mockEngine.restoreSequence).toHaveBeenCalledWith('s1')

    await handler('video:purge')(null, { type: 'task', id: 't2' })
    expect(mockEngine.purgeTask).toHaveBeenCalledWith('t2')
    await handler('video:purge')(null, { type: 'sequence', id: 's2' })
    expect(mockEngine.purgeSequence).toHaveBeenCalledWith('s2')

    expect(await handler('video:empty-trash')(null, undefined)).toMatchObject({
      tasks: 1,
      sequences: 2,
    })
  })

  it('rejects invalid restore / purge type values (M14)', () => {
    registerVideoHandlers()
    const restoreHandler = handler('video:restore')
    const purgeHandler = handler('video:purge')
    const expectValidationError = (fn: () => unknown): void => {
      try {
        fn()
        throw new Error('expected a validation error to be thrown')
      } catch (error) {
        expect((error as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR)
      }
    }

    expectValidationError(() => restoreHandler(null, { type: 'shot', id: 'x' }))
    expectValidationError(() => restoreHandler(null, { type: 'task' }))
    expectValidationError(() => purgeHandler(null, { type: '', id: 'x' }))
  })

  it('export-assets delegates to the engine with the picked directory (M14)', async () => {
    const exportResult = { canceled: false, targetDir: 'D:/out', exported: 2, skipped: [] }
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/out'] })
    mockEngine.exportAssets.mockResolvedValue(exportResult)
    registerVideoHandlers()

    const result = (await handler('video:export-assets')(null, {
      taskIds: ['t1'],
      sequenceIds: ['s1'],
    })) as { canceled: boolean; exported?: number }

    expect(result.canceled).toBe(false)
    expect(result.exported).toBe(2)
    expect(mockEngine.exportAssets).toHaveBeenCalledWith({
      taskIds: ['t1'],
      sequenceIds: ['s1'],
      targetDir: 'D:/out',
    })
  })

  it('export-assets returns canceled without engine call when dialog canceled (M14)', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    registerVideoHandlers()

    const result = (await handler('video:export-assets')(null, {
      taskIds: ['t1'],
      sequenceIds: [],
    })) as { canceled: boolean }

    expect(result.canceled).toBe(true)
    expect(mockEngine.exportAssets).not.toHaveBeenCalled()
  })
})