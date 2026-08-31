// M3: video store 状态管理测试
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVideoStore } from './video'
import type { VideoSequence, VideoTask } from '@shared/types'

const BASE_TASK: VideoTask = {
  id: 't1',
  provider: 'seedance',
  providerTaskId: 'pt-1',
  prompt: 'a cat',
  model: 'doubao-seedance',
  duration: 5,
  resolution: '720P',
  aspect: '16:9',
  status: 'running',
  progress: 30,
  errorCode: null,
  errorMessage: null,
  downloadUrl: null,
  outputPath: null,
  sequenceId: null,
  shotIndex: null,
  favorite: false,
  tags: [],
  deletedAt: null,
  createdAt: 1000,
  updatedAt: 1000,
}

function task(overrides: Partial<VideoTask>): VideoTask {
  return { ...BASE_TASK, ...overrides }
}

function sequence(overrides: Partial<VideoSequence>): VideoSequence {
  return {
    id: 'seq-1',
    title: 'My story',
    provider: 'seedance',
    status: 'running',
    totalCount: 2,
    succeededCount: 1,
    failedCount: 0,
    cancelledCount: 0,
    deletedAt: null,
    createdAt: 2000,
    updatedAt: 2000,
    ...overrides,
  }
}

/** 构造 window.electron.video mock */
function mockElectronVideo(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base = {
    generate: vi.fn(),
    status: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    cancel: vi.fn(),
    retry: vi.fn(),
    cancelSequence: vi.fn(),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    deleteSequence: vi.fn().mockResolvedValue(undefined),
    retryTasks: vi.fn(),
    cancelSequences: vi.fn(),
    deleteTasks: vi.fn(),
    deleteSequences: vi.fn(),
    parseCsv: vi.fn(),
    batchGenerate: vi.fn(),
    stats: vi.fn(),
    exportStats: vi.fn(),
    queue: vi.fn(),
    queuePause: vi.fn(),
    queueResume: vi.fn(),
    queueConcurrency: vi.fn(),
    getConfig: vi.fn(),
    testConfig: vi.fn(),
    listSequences: vi.fn().mockResolvedValue([]),
    getSequenceDetail: vi.fn().mockResolvedValue(null),
    setFavorite: vi.fn().mockResolvedValue(null),
    setTags: vi.fn().mockResolvedValue(null),
    trash: vi.fn().mockResolvedValue({ tasks: [], sequences: [] }),
    restore: vi.fn().mockResolvedValue(null),
    purge: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue({ tasks: 0, sequences: 0 }),
    exportAssets: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  }
  const api = { ...base, ...(overrides ?? {}) }
  ;(window as unknown as Record<string, unknown>)['electron'] = { video: api }
  return api
}

describe('video store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generate 提交任务并 upsert 到状态', async () => {
    const api = mockElectronVideo({ generate: vi.fn().mockResolvedValue(task({ id: 't1' })) })
    const store = useVideoStore()

    const result = await store.generate({ prompt: 'a cat' })

    expect(api.generate).toHaveBeenCalledWith({ prompt: 'a cat' })
    expect(result.id).toBe('t1')
    expect(store.getTask('t1')?.status).toBe('running')
    expect(store.list).toHaveLength(1)
  })

  it('generate 出错时向上抛出', async () => {
    mockElectronVideo({
      generate: vi.fn().mockRejectedValue(new Error('no api key')),
    })
    const store = useVideoStore()
    await expect(store.generate({ prompt: 'x' })).rejects.toThrow('no api key')
  })

  it('cancel 更新本地状态为已取消', async () => {
    const api = mockElectronVideo({
      generate: vi.fn(),
      list: vi.fn().mockResolvedValue([BASE_TASK]),
      cancel: vi.fn().mockResolvedValue(task({ id: 't1', status: 'cancelled' })),
    })
    const store = useVideoStore()
    await store.refresh()

    const result = await store.cancel('t1')

    expect(result?.status).toBe('cancelled')
    expect(store.getTask('t1')?.status).toBe('cancelled')
    expect(api.cancel).toHaveBeenCalledWith('t1')
  })

  it('retry 提交新任务并 upsert（M9）', async () => {
    const api = mockElectronVideo({
      retry: vi.fn().mockResolvedValue(task({ id: 't2' })),
    })
    const store = useVideoStore()

    const result = await store.retry('t1')

    expect(api.retry).toHaveBeenCalledWith('t1')
    expect(result.id).toBe('t2')
    expect(store.getTask('t2')?.id).toBe('t2')
  })

  it('cancelSequence 更新序列为取消（M9）', async () => {
    const api = mockElectronVideo({
      cancelSequence: vi.fn().mockResolvedValue(sequence({ id: 'seq-1', status: 'cancelled' })),
    })
    const store = useVideoStore()

    const seq = await store.cancelSequence('seq-1')

    expect(seq.status).toBe('cancelled')
    expect(store.getSequence('seq-1')?.status).toBe('cancelled')
    expect(api.cancelSequence).toHaveBeenCalledWith('seq-1')
  })

  it('deleteTask 从本地状态移除（M9）', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([task({ id: 't1', status: 'succeeded', progress: 100 })]),
      deleteTask: vi.fn().mockResolvedValue(undefined),
    })
    const store = useVideoStore()
    await store.refresh()
    expect(store.getTask('t1')).toBeTruthy()

    await store.deleteTask('t1')

    expect(store.getTask('t1')).toBeNull()
    expect(api.deleteTask).toHaveBeenCalledWith('t1')
  })

  it('deleteSequence 移除序列及其子任务（M9）', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([
        task({ id: 't1', status: 'succeeded', progress: 100, sequenceId: 'seq-1' }),
      ]),
      listSequences: vi.fn().mockResolvedValue([sequence({ id: 'seq-1', status: 'succeeded', totalCount: 1, succeededCount: 1 })]),
      deleteSequence: vi.fn().mockResolvedValue(undefined),
    })
    const store = useVideoStore()
    await store.refresh()
    await store.refreshSequences()
    expect(store.getSequence('seq-1')).toBeTruthy()

    await store.deleteSequence('seq-1')

    expect(store.getSequence('seq-1')).toBeNull()
    expect(store.getTask('t1')).toBeNull()
    expect(api.deleteSequence).toHaveBeenCalledWith('seq-1')
  })

  it('refresh 拉取列表并合并任务', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([task({ id: 't1', status: 'succeeded', progress: 100 })])
    })
    const store = useVideoStore()

    await store.refresh(20)

    expect(api.list).toHaveBeenCalledWith(20)
    expect(store.getTask('t1')?.status).toBe('succeeded')
    expect(store.loading).toBe(false)
  })

  it('init 订阅 onEvent 并刷新列表', () => {
    const onEvent = vi.fn().mockReturnValue(() => {})
    mockElectronVideo({
      list: vi.fn().mockResolvedValue([]),
      onEvent,
    })
    const store = useVideoStore()

    store.init()

    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('init 幂等：重复调用只订阅一次', () => {
    const onEvent = vi.fn().mockReturnValue(() => {})
    mockElectronVideo({ list: vi.fn().mockResolvedValue([]), onEvent })
    const store = useVideoStore()

    store.init()
    store.init()

    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('onEvent progress 更新任务进度与状态', async () => {
    const handlers: Array<(e: unknown) => void> = []
    mockElectronVideo({
      list: vi.fn().mockResolvedValue([task({ id: 't1' })]),
      onEvent: vi.fn((cb: (e: unknown) => void) => {
        handlers.push(cb)
        return () => {}
      }),
    })
    const store = useVideoStore()
    store.init()
    await store.refresh()

    handlers[0]({ type: 'progress', taskId: 't1', progress: 60, status: 'running' })

    expect(store.getTask('t1')?.progress).toBe(60)
  })

  it('onEvent completed 置 succeeded 并落盘 outputPath', async () => {
    const handlers: Array<(e: unknown) => void> = []
    mockElectronVideo({
      list: vi.fn().mockResolvedValue([task({ id: 't1' })]),
      onEvent: vi.fn((cb: (e: unknown) => void) => {
        handlers.push(cb)
        return () => {}
      }),
    })
    const store = useVideoStore()
    store.init()
    await store.refresh()

    handlers[0]({
      type: 'completed',
      taskId: 't1',
      outputPath: 'videos/seedance-t1.mp4',
    })

    expect(store.getTask('t1')?.status).toBe('succeeded')
    expect(store.getTask('t1')?.progress).toBe(100)
    expect(store.getTask('t1')?.outputPath).toBe('videos/seedance-t1.mp4')
  })

  it('onEvent failed 记录错误信息', async () => {
    const handlers: Array<(e: unknown) => void> = []
    mockElectronVideo({
      list: vi.fn().mockResolvedValue([task({ id: 't1' })]),
      onEvent: vi.fn((cb: (e: unknown) => void) => {
        handlers.push(cb)
        return () => {}
      }),
    })
    const store = useVideoStore()
    store.init()
    await store.refresh()

    handlers[0]({ type: 'failed', taskId: 't1', message: 'timeout' })

    expect(store.getTask('t1')?.status).toBe('failed')
    expect(store.getTask('t1')?.errorMessage).toBe('timeout')
  })

  it('list 按创建时间倒序，activeCount 仅统计进行中任务', async () => {
    mockElectronVideo({
      list: vi.fn().mockResolvedValue([
        task({ id: 'a', createdAt: 1000, status: 'running' }),
        task({ id: 'b', createdAt: 2000, status: 'succeeded', progress: 100 }),
        task({ id: 'c', createdAt: 1500, status: 'failed' }),
      ]),
    })
    const store = useVideoStore()

    await store.refresh()

    expect(store.list.map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(store.activeCount).toBe(1)
  })

  it('refreshSequences 填充序列列表并按创建时间倒序', async () => {
    mockElectronVideo({
      listSequences: vi.fn().mockResolvedValue([
        sequence({ id: 'seq-a', createdAt: 1000 }),
        sequence({ id: 'seq-b', createdAt: 2000 }),
      ]),
    })
    const store = useVideoStore()

    await store.refreshSequences()

    expect(store.sequenceList.map((s) => s.id)).toEqual(['seq-b', 'seq-a'])
    expect(store.getSequence('seq-a')?.totalCount).toBe(2)
  })

  it('getSequenceDetail 拉取详情并写入缓存，重复调用不二次请求', async () => {
    const detailSpy = vi.fn().mockResolvedValue({
      sequence: sequence({ id: 'seq-a' }),
      tasks: [task({ id: 'shot-0', sequenceId: 'seq-a', shotIndex: 0 })],
    })
    const api = mockElectronVideo({ getSequenceDetail: detailSpy })
    const store = useVideoStore()

    const first = await store.getSequenceDetail('seq-a')
    const second = await store.getSequenceDetail('seq-a')

    expect(first?.tasks).toHaveLength(1)
    expect(second).toEqual(first)
    expect(detailSpy).toHaveBeenCalledTimes(1)
    expect(api.getSequenceDetail).toHaveBeenCalledWith('seq-a')
    expect(store.getSequence('seq-a')?.status).toBe('running')
  })

  // ─── M10: 选择模型 ─────────────────────────────────────────

  it('toggle 选中/取消任务与序列', () => {
    mockElectronVideo({})
    const store = useVideoStore()

    store.toggleSelectTask('t1')
    expect(store.isTaskSelected('t1')).toBe(true)
    store.toggleSelectTask('t1')
    expect(store.isTaskSelected('t1')).toBe(false)
    expect(store.selectedTaskCount).toBe(0)

    store.toggleSelectSequence('seq-1')
    expect(store.isSequenceSelected('seq-1')).toBe(true)
    expect(store.selectedCount).toBe(1)
    store.clearSelection()
    expect(store.selectedCount).toBe(0)
  })

  it('selectAllTasks / selectAllSequences 去重并覆盖', () => {
    mockElectronVideo({})
    const store = useVideoStore()

    store.selectAllTasks(['a', 'b', 'a'])
    store.selectAllSequences(['s1'])

    expect(store.selectedTaskIds).toEqual(['a', 'b'])
    expect(store.selectedSequenceIds).toEqual(['s1'])
  })

  // ─── M10: 批量动作 ─────────────────────────────────────────

  it('batchRetry upsert 新任务并清除对应选择（M10）', async () => {
    const api = mockElectronVideo({
      retryTasks: vi.fn().mockResolvedValue({
        succeeded: [task({ id: 'n2', status: 'running' })],
        failed: [],
      }),
    })
    const store = useVideoStore()
    store.toggleSelectTask('t1')

    await store.batchRetry(['t1'])

    expect(api.retryTasks).toHaveBeenCalledWith(['t1'])
    expect(store.getTask('n2')?.id).toBe('n2')
    expect(store.isTaskSelected('t1')).toBe(false)
  })

  it('batchDeleteTasks 移除本地任务并清除选择（M10）', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([
        task({ id: 'a', status: 'succeeded', progress: 100 }),
        task({ id: 'b', status: 'succeeded', progress: 100 }),
      ]),
      deleteTasks: vi.fn().mockResolvedValue({ succeeded: ['a', 'b'], failed: [] }),
    })
    const store = useVideoStore()
    await store.refresh()

    await store.batchDeleteTasks(['a', 'b'])

    expect(api.deleteTasks).toHaveBeenCalledWith(['a', 'b'])
    expect(store.getTask('a')).toBeNull()
    expect(store.getTask('b')).toBeNull()
  })

  it('batchDeleteSequences 移除序列及其子任务（M10）', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([
        task({ id: 'c1', status: 'succeeded', progress: 100, sequenceId: 'seq-a' }),
        task({ id: 'c2', status: 'succeeded', progress: 100, sequenceId: 'seq-a' }),
      ]),
      listSequences: vi.fn().mockResolvedValue([
        sequence({ id: 'seq-a', status: 'succeeded', totalCount: 2, succeededCount: 2 }),
      ]),
      deleteSequences: vi.fn().mockResolvedValue({ succeeded: ['seq-a'], failed: [] }),
    })
    const store = useVideoStore()
    await store.refresh()
    await store.refreshSequences()

    await store.batchDeleteSequences(['seq-a'])

    expect(api.deleteSequences).toHaveBeenCalledWith(['seq-a'])
    expect(store.getSequence('seq-a')).toBeNull()
    expect(store.getTask('c1')).toBeNull()
    expect(store.getTask('c2')).toBeNull()
  })

  it('batchCancelSequences upsert 序列为取消（M10）', async () => {
    const api = mockElectronVideo({
      cancelSequences: vi.fn().mockResolvedValue({
        succeeded: [sequence({ id: 'seq-1', status: 'cancelled' })],
        failed: [],
      }),
    })
    const store = useVideoStore()
    store.toggleSelectSequence('seq-1')

    await store.batchCancelSequences(['seq-1'])

    expect(api.cancelSequences).toHaveBeenCalledWith(['seq-1'])
    expect(store.getSequence('seq-1')?.status).toBe('cancelled')
    expect(store.isSequenceSelected('seq-1')).toBe(false)
  })

  // ─── M11: CSV 批量造片 ──────────────────────────────────────

  it('parseCsv 返回解析预览（M11）', async () => {
    const api = mockElectronVideo({
      parseCsv: vi.fn().mockResolvedValue({
        rows: [{ prompt: 'a cat' }, { prompt: 'a dog', duration: 6 }],
        skipped: [{ line: 4, reason: 'prompt is empty' }],
        headerMissingPrompt: false,
      }),
    })
    const store = useVideoStore()

    const result = await store.parseCsv('/tmp/batch.csv')

    expect(api.parseCsv).toHaveBeenCalledWith('/tmp/batch.csv')
    expect(result.rows).toHaveLength(2)
    expect(result.skipped[0]?.line).toBe(4)
    expect(result.headerMissingPrompt).toBe(false)
  })

  it('parseCsv 出错时向上抛出（M11）', async () => {
    mockElectronVideo({
      parseCsv: vi.fn().mockRejectedValue(new Error('file not found')),
    })
    const store = useVideoStore()
    await expect(store.parseCsv('/tmp/missing.csv')).rejects.toThrow('file not found')
  })

  it('batchGenerate upsert 成功任务（M11）', async () => {
    const api = mockElectronVideo({
      batchGenerate: vi.fn().mockResolvedValue({
        succeeded: [task({ id: 't1', prompt: 'a cat' }), task({ id: 't2', prompt: 'a dog' })],
        failed: [],
      }),
    })
    const store = useVideoStore()

    await store.batchGenerate([{ prompt: 'a cat' }, { prompt: 'a dog' }])

    expect(api.batchGenerate).toHaveBeenCalledWith(
      [{ prompt: 'a cat' }, { prompt: 'a dog' }],
      undefined,
    )
    expect(store.getTask('t1')?.id).toBe('t1')
    expect(store.getTask('t2')?.id).toBe('t2')
  })

  it('batchGenerate 部分失败时仍 upsert 成功项（M11）', async () => {
    mockElectronVideo({
      batchGenerate: vi.fn().mockResolvedValue({
        succeeded: [task({ id: 't1' })],
        failed: [{ id: 'a dog', message: 'provider rejected' }],
      }),
    })
    const store = useVideoStore()

    await store.batchGenerate([{ prompt: 'a cat' }, { prompt: 'a dog' }])

    expect(store.getTask('t1')?.id).toBe('t1')
  })

  it('batchGenerate 空行时直接返回不调用（M11）', async () => {
    const api = mockElectronVideo({ batchGenerate: vi.fn() })
    const store = useVideoStore()

    await store.batchGenerate([])

    expect(api.batchGenerate).not.toHaveBeenCalled()
  })

  // ─── M12: 生成历史统计 ──────────────────────────────────────

  it('fetchStats 拉取统计并缓存（M12）', async () => {
    const overview = {
      since: 1000,
      total: 3,
      succeeded: 2,
      failed: 1,
      cancelled: 0,
      active: 0,
      successRate: 66.67,
      failureRate: 33.33,
      avgElapsedSeconds: 20,
      videoSeconds: 15,
      byDay: [],
      byProvider: [],
      byModel: [],
    }
    const api = mockElectronVideo({ stats: vi.fn().mockResolvedValue(overview) })
    const store = useVideoStore()

    const result = await store.fetchStats(7)

    expect(api.stats).toHaveBeenCalledWith(7)
    expect(result.total).toBe(3)
    expect(store.stats?.succeeded).toBe(2)
    expect(store.statsDays).toBe(7)
    expect(store.statsLoading).toBe(false)
  })

  it('fetchStats 缺省沿用当前范围（M12）', async () => {
    const api = mockElectronVideo({ stats: vi.fn().mockResolvedValue(null) })
    const store = useVideoStore()

    await store.fetchStats()

    expect(api.stats).toHaveBeenCalledWith(30)
  })

  it('exportStatsCsv 成功返回 true，取消返回 false（M12）', async () => {
    const api = mockElectronVideo({
      exportStats: vi.fn().mockResolvedValue({ canceled: false, path: 'D:/r.csv' }),
    })
    const store = useVideoStore()
    expect(await store.exportStatsCsv()).toBe(true)
    expect(api.exportStats).toHaveBeenCalledWith(30)

    ;(api.exportStats as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true })
    expect(await store.exportStatsCsv()).toBe(false)
  })

  it('exportStatsCsv 出错向上抛出（M12）', async () => {
    mockElectronVideo({
      exportStats: vi.fn().mockRejectedValue(new Error('write failed')),
    })
    const store = useVideoStore()
    await expect(store.exportStatsCsv()).rejects.toThrow('write failed')
  })

  // ─── M13: 生成队列 ──────────────────────────────────────────

  it('refreshQueue 拉取并缓存队列快照（M13）', async () => {
    const snapshot = { paused: false, maxConcurrent: 2, activeCount: 1, items: [] }
    mockElectronVideo({ queue: vi.fn().mockResolvedValue(snapshot) })
    const store = useVideoStore()

    await store.refreshQueue()

    expect(store.queue?.paused).toBe(false)
    expect(store.queue?.activeCount).toBe(1)
  })

  it('pauseQueue / resumeQueue 同步快照（M13）', async () => {
    const api = mockElectronVideo({
      queuePause: vi.fn().mockResolvedValue({ paused: true, maxConcurrent: 2, activeCount: 0, items: [] }),
      queueResume: vi.fn().mockResolvedValue({ paused: false, maxConcurrent: 2, activeCount: 0, items: [] }),
    })
    const store = useVideoStore()

    await store.pauseQueue()
    expect(store.queue?.paused).toBe(true)

    await store.resumeQueue()
    expect(store.queue?.paused).toBe(false)
    expect(api.queuePause).toHaveBeenCalledTimes(1)
    expect(api.queueResume).toHaveBeenCalledTimes(1)
  })

  it('setQueueConcurrency 传递上限并同步快照（M13）', async () => {
    const api = mockElectronVideo({
      queueConcurrency: vi.fn().mockResolvedValue({ paused: false, maxConcurrent: 5, activeCount: 0, items: [] }),
    })
    const store = useVideoStore()

    await store.setQueueConcurrency(5)

    expect(api.queueConcurrency).toHaveBeenCalledWith(5)
    expect(store.queue?.maxConcurrent).toBe(5)
  })

  // ─── M14: 资产管理 ─────────────────────────────────────────

  it('setFavorite 调用 IPC 并 upsert 任务（M14）', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([BASE_TASK]),
      setFavorite: vi.fn().mockResolvedValue(task({ id: 't1', favorite: true })),
    })
    const store = useVideoStore()
    await store.refresh()

    await store.setFavorite('t1', true)

    expect(api.setFavorite).toHaveBeenCalledWith('t1', true)
    expect(store.getTask('t1')?.favorite).toBe(true)
  })

  it('setTags 调用 IPC 并 upsert 任务（M14）', async () => {
    const api = mockElectronVideo({
      list: vi.fn().mockResolvedValue([BASE_TASK]),
      setTags: vi.fn().mockResolvedValue(task({ id: 't1', tags: ['风景', '猫'] })),
    })
    const store = useVideoStore()
    await store.refresh()

    await store.setTags('t1', ['风景', '猫'])

    expect(api.setTags).toHaveBeenCalledWith('t1', ['风景', '猫'])
    expect(store.getTask('t1')?.tags).toEqual(['风景', '猫'])
  })

  it('fetchTrash 填充回收站列表（M14）', async () => {
    mockElectronVideo({
      trash: vi.fn().mockResolvedValue({
        tasks: [task({ id: 't9', deletedAt: 12345 })],
        sequences: [sequence({ id: 'seq-9', deletedAt: 12345 })],
      }),
    })
    const store = useVideoStore()

    await store.fetchTrash()

    expect(store.trashTasks.map((t) => t.id)).toEqual(['t9'])
    expect(store.trashSequences.map((s) => s.id)).toEqual(['seq-9'])
    expect(store.trashLoading).toBe(false)
  })

  it('restore 从回收站移除并刷新主列表（M14）', async () => {
    mockElectronVideo({
      list: vi.fn().mockResolvedValue([task({ id: 't9', status: 'cancelled' })]),
      trash: vi.fn().mockResolvedValue({
        tasks: [task({ id: 't9', deletedAt: 12345 })],
        sequences: [],
      }),
      restore: vi.fn().mockResolvedValue(null),
    })
    const store = useVideoStore()
    await store.fetchTrash()
    expect(store.trashTasks).toHaveLength(1)

    await store.restore('task', 't9')

    expect(store.trashTasks).toHaveLength(0)
    expect(store.getTask('t9')).toBeTruthy()
  })

  it('purge 从回收站移除（M14）', async () => {
    mockElectronVideo({
      trash: vi.fn().mockResolvedValue({
        tasks: [task({ id: 't9', deletedAt: 12345 })],
        sequences: [],
      }),
      purge: vi.fn().mockResolvedValue(undefined),
    })
    const store = useVideoStore()
    await store.fetchTrash()

    await store.purge('task', 't9')

    expect(store.trashTasks).toHaveLength(0)
  })

  it('emptyTrash 清空回收站列表并返回统计（M14）', async () => {
    mockElectronVideo({
      trash: vi.fn().mockResolvedValue({
        tasks: [task({ id: 't9', deletedAt: 12345 })],
        sequences: [sequence({ id: 'seq-9', deletedAt: 12345 })],
      }),
      emptyTrash: vi.fn().mockResolvedValue({ tasks: 1, sequences: 1 }),
    })
    const store = useVideoStore()
    await store.fetchTrash()

    const result = await store.emptyTrash()

    expect(result).toMatchObject({ tasks: 1, sequences: 1 })
    expect(store.trashTasks).toHaveLength(0)
    expect(store.trashSequences).toHaveLength(0)
  })

  it('exportAssets 成功返回 true 并清除选择，取消返回 false（M14）', async () => {
    const api = mockElectronVideo({
      exportAssets: vi.fn().mockResolvedValue({
        canceled: false,
        targetDir: 'D:/out',
        exported: 2,
        skipped: [],
      }),
    })
    const store = useVideoStore()
    store.toggleSelectTask('t1')
    store.toggleSelectSequence('seq-1')

    const ok = await store.exportAssets(['t1'], ['seq-1'])

    expect(api.exportAssets).toHaveBeenCalledWith(['t1'], ['seq-1'])
    expect(ok).toBe(true)
    expect(store.isTaskSelected('t1')).toBe(false)
    expect(store.isSequenceSelected('seq-1')).toBe(false)

    ;(api.exportAssets as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true })
    expect(await store.exportAssets(['t1'], [])).toBe(false)
  })
})