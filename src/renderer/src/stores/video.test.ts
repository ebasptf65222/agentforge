// M3: video store 状态管理测试
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVideoStore } from './video'
import type { VideoTask } from '@shared/types'

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
  createdAt: 1000,
  updatedAt: 1000,
}

function task(overrides: Partial<VideoTask>): VideoTask {
  return { ...BASE_TASK, ...overrides }
}

/** 构造 window.electron.video mock */
function mockElectronVideo(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base = {
    generate: vi.fn(),
    status: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    cancel: vi.fn(),
    getConfig: vi.fn(),
    testConfig: vi.fn(),
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
})