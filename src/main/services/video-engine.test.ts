// 视频任务引擎单元测试
// 注入 mock adapter / configProvider / download，验证生成 → 轮询 → 成功/失败/取消 的完整生命周期。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase } from '../db/index'
import { updateSettings, getSettings } from '../db/repos/app-settings'
import { getVideoEngine, resetVideoEngine, VideoEngine } from './video-engine'
import type { VideoProviderAdapter, VideoProviderConfig } from './video-provider/types'
import { getVideoSequenceById } from '../db/repos/video-sequence'
import { extractLastFrame } from '../utils/ffmpeg'

// M8：以 fake 实现替换 ffmpeg 尾帧抽取，聚焦连续性编排逻辑而非真实截帧
vi.mock('../utils/ffmpeg', () => ({
  extractLastFrame: vi.fn(async (_src: string, _dir: string, index: number) =>
    join('/tmp/fake-frames', `chain-${index}-${Date.now()}.jpg`),
  ),
}))

const mockedExtractLastFrame = vi.mocked(extractLastFrame)

const TEST_CONFIG: VideoProviderConfig = {
  provider: 'seedance',
  apiKey: 'test-key',
  baseUrl: 'https://ark.test/api/v3',
  model: 'doubao-seedance',
}

function makeAdapter(statusSequence: Array<{ status: string; progress?: number; downloadUrl?: string | null }>): VideoProviderAdapter {
  let call = 0
  return {
    provider: 'seedance',
    submit: async () => ({ providerTaskId: 'prov-1' }),
    status: async () => {
      const item = statusSequence[Math.min(call++, statusSequence.length - 1)]
      return {
        status: item.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled',
        progress: item.progress ?? 0,
        downloadUrl: item.downloadUrl ?? null,
      }
    },
  }
}

/** 轮询等待直到满足条件或超时 */
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('timed out waiting for condition')
}

describe('VideoEngine', () => {
  let tempDir: string
  let dbPath: string
  let workspacePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-video-test-'))
    dbPath = join(tempDir, 'test.db')
    workspacePath = join(tempDir, 'ws')
    mkdirSync(workspacePath, { recursive: true })
    closeDatabase()
    resetVideoEngine()
    initDatabase(dbPath)
    mockedExtractLastFrame.mockClear()
    // 设置工作区路径，满足成功落盘时 getPath 的校验
    updateSettings({ workspace: { path: workspacePath } })
  })

  afterEach(() => {
    resetVideoEngine()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create a submitted task with providerTaskId', async () => {
    resetVideoEngine()
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })
    const task = await engine.generate({ prompt: 'a cat', duration: 5 })
    expect(task.status).toBe('submitted')
    expect(task.providerTaskId).toBe('prov-1')
    expect(task.prompt).toBe('a cat')
    expect(getSettings().workspace.path).toBe(workspacePath)
    engine.shutdown()
  })

  it('should transition to succeeded and record outputPath', async () => {
    const events: string[] = []
    const engine = new VideoEngine({
      adapterFactory: () =>
        makeAdapter([{ status: 'running', progress: 40 }, { status: 'succeeded', progress: 100, downloadUrl: 'https://x/v.mp4' }]),
      configProvider: () => TEST_CONFIG,
      notify: (e) => events.push(e.type),
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const task = await engine.generate({ prompt: 'a cat', duration: 5 })
    await waitFor(() => engine.get(task.id)?.status === 'succeeded')

    const result = engine.get(task.id)
    expect(result?.status).toBe('succeeded')
    expect(result?.progress).toBe(100)
    expect(result?.outputPath?.replace(/\\/g, '/')).toMatch(/^videos\/seedance-[\w-]+\.mp4$/)
    expect(events).toContain('completed')
    engine.shutdown()
  })

  it('should mark task as failed when provider returns failed status', async () => {
    const events: string[] = []
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'failed', progress: 100 }]),
      configProvider: () => TEST_CONFIG,
      notify: (e) => events.push(e.type),
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const task = await engine.generate({ prompt: 'a cat' })
    await waitFor(() => engine.get(task.id)?.status === 'failed')

    expect(events).toContain('failed')
    engine.shutdown()
  })

  it('should allow cancelling an in-flight task', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }, { status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000, // 长间隔，保持 in-flight
    })

    const task = await engine.generate({ prompt: 'a cat' })
    const cancelled = engine.cancel(task.id)
    expect(cancelled?.status).toBe('cancelled')
    // 即时状态一致
    expect(engine.get(task.id)?.status).toBe('cancelled')
    engine.shutdown()
  })

  it('should reject an empty prompt', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })
    await expect(engine.generate({ prompt: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    engine.shutdown()
  })

  it('should mark failed after consecutive status poll errors', async () => {
    const events: string[] = []
    let call = 0
    const failingAdapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-1' }),
      status: async () => {
        call++
        throw new Error('network down')
      },
    }
    const engine = new VideoEngine({
      adapterFactory: () => failingAdapter,
      configProvider: () => TEST_CONFIG,
      notify: (e) => events.push(e.type),
      download: async () => undefined,
      pollIntervalMs: 5,
      maxPollFailures: 2,
    })

    const task = await engine.generate({ prompt: 'a cat' })
    await waitFor(() => engine.get(task.id)?.status === 'failed')
    expect(call).toBeGreaterThanOrEqual(2)
    expect(events).toContain('failed')
    engine.shutdown()
  })

  it('should expose the singleton and allow listing', async () => {
    const engine = getVideoEngine()
    expect(engine).toBe(getVideoEngine())
    await expect(engine.list()).toBeDefined()
  })

  it('should route adapter and persist provider by config provider (M4)', async () => {
    const requestedProviders: string[] = []
    const adapter: VideoProviderAdapter = {
      provider: 'kling',
      submit: async () => ({ providerTaskId: 'kt-1' }),
      status: async () => ({ status: 'queued' as const, progress: 5, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: (provider) => {
        requestedProviders.push(provider)
        return adapter
      },
      configProvider: () => ({ ...TEST_CONFIG, provider: 'kling' }),
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 1000,
    })

    const task = await engine.generate({ prompt: 'a cat' })
    expect(requestedProviders).toContain('kling')
    expect(task.provider).toBe('kling')
    // 永久化到库中的 provider 也应为 kling
    expect(engine.get(task.id)?.provider).toBe('kling')
    engine.shutdown()
  })

  it('should honor providerOverride and skip routing (M15)', async () => {
    const requestedProviders: string[] = []
    const adapter: VideoProviderAdapter = {
      provider: 'kling',
      submit: async () => ({ providerTaskId: 'kt-ovr' }),
      status: async () => ({ status: 'queued' as const, progress: 5, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: (provider) => {
        requestedProviders.push(provider)
        return adapter
      },
      configProvider: () => ({ ...TEST_CONFIG, provider: 'kling' }),
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 1000,
    })

    const task = await engine.generate({ prompt: 'a cat', providerOverride: 'kling' })
    expect(requestedProviders).toContain('kling')
    expect(task.provider).toBe('kling')
    // 手动覆盖时无路由摘要
    expect(task.routing).toBeUndefined()
    engine.shutdown()
  })

  it('should attach routing summary when routing selects provider (M15)', async () => {
    const requestedProviders: string[] = []
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'rt-1' }),
      status: async () => ({ status: 'queued' as const, progress: 5, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: (provider) => {
        requestedProviders.push(provider)
        return adapter
      },
      configProvider: () => ({ ...TEST_CONFIG, provider: 'seedance' }),
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 1000,
    })

    const task = await engine.generate({ prompt: 'a cat', duration: 5 })
    expect(task.routing).toBeDefined()
    expect(task.routing?.strategy).toBe('fixed')
    expect(task.routing?.selectedProvider).toBe('seedance')
    expect(task.routing?.reason).toBeTruthy()
    engine.shutdown()
  })

  it('should expose routing config and logs via engine (M15)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 1000,
    })
    const cfg = engine.getRoutingConfig()
    expect(cfg).toBeDefined()
    expect(engine.getRoutingLogs()).toBeInstanceOf(Array)
    engine.clearRoutingLogs()
    expect(engine.getRoutingLogs()).toHaveLength(0)
    engine.shutdown()
  })

  it('should forward imageRefs to the adapter submit (M5)', async () => {
    let seenSpec: { imageRefs?: unknown[] } | null = null
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async (spec) => {
        seenSpec = spec as { imageRefs?: unknown[] }
        return { providerTaskId: 'prov-img' }
      },
      status: async () => ({ status: 'queued' as const, progress: 5, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      pollIntervalMs: 1000,
    })

    await engine.generate({
      prompt: 'animate a frame',
      imageRefs: [
        { path: '/tmp/a.png', role: 'first_frame' },
        { path: '/tmp/b.png', role: 'last_frame' },
      ],
    })
    expect(seenSpec?.imageRefs).toEqual([
      { path: '/tmp/a.png', role: 'first_frame' },
      { path: '/tmp/b.png', role: 'last_frame' },
    ])
    engine.shutdown()
  })

  it('should create a sequence with child tasks carrying sequenceId/shotIndex (M6)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
    })

    const { sequence, tasks } = await engine.generateSequence({
      shots: [{ prompt: 'shot one' }, { prompt: 'shot two' }],
    })
    expect(sequence.totalCount).toBe(2)
    expect(sequence.status).toBe('submitted')
    expect(tasks).toHaveLength(2)
    expect(tasks[0].sequenceId).toBe(sequence.id)
    expect(tasks[0].shotIndex).toBe(0)
    expect(tasks[1].shotIndex).toBe(1)
    engine.shutdown()
  })

  it('should reject a sequence with fewer than 2 shots (M6)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      pollIntervalMs: 60_000,
    })
    await expect(
      engine.generateSequence({ shots: [{ prompt: 'only one' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    engine.shutdown()
  })

  it('should persist imageRefs on generate and carry them into retry (M16)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-ref' }),
      status: async () => ({ status: 'failed' as const, progress: 100, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const refs = [
      { path: '/tmp/a.png', role: 'first_frame' as const },
      { path: '/tmp/b.png', role: 'style' as const },
    ]
    const task = await engine.generate({ prompt: 'styled', imageRefs: refs })
    expect(task.imageRefs).toEqual(refs)
    // 任务持久化读回完整参考图
    expect(engine.get(task.id)?.imageRefs).toEqual(refs)

    await waitFor(() => engine.get(task.id)?.status === 'failed')
    const retried = await engine.retry(task.id)
    // M16：带图重试，不退化为纯文生
    expect(retried.imageRefs).toEqual(refs)
    expect(engine.get(retried.id)?.imageRefs).toEqual(refs)
    engine.shutdown()
  })

  it('should retry a failed task as a new submitted task (M9)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-retry' }),
      status: async () => ({ status: 'failed' as const, progress: 100, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const original = await engine.generate({ prompt: 'retry me' })
    await waitFor(() => engine.get(original.id)?.status === 'failed')
    const retried = await engine.retry(original.id)

    expect(retried.id).not.toBe(original.id)
    expect(retried.prompt).toBe('retry me')
    expect(retried.status).toBe('submitted')
    expect(retried.providerTaskId).toBe('prov-retry')
    // 原任务保留失败记录
    expect(engine.get(original.id)?.status).toBe('failed')
    engine.shutdown()
  })

  it('should reject retrying a succeeded task (M9)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'p' }),
      status: async () => ({ status: 'succeeded' as const, progress: 100, downloadUrl: 'https://x/v.mp4' }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const original = await engine.generate({ prompt: 'x' })
    await waitFor(() => engine.get(original.id)?.status === 'succeeded')
    await expect(engine.retry(original.id)).rejects.toMatchObject({
      code: 'VIDEO_TASK_NOT_RETRYABLE',
    })
    engine.shutdown()
  })

  it('should cancel in-flight children of a sequence (M9)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'p' }),
      status: async () => ({ status: 'submitted' as const }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
    })

    const { sequence, tasks } = await engine.generateSequence({
      shots: [{ prompt: 'a' }, { prompt: 'b' }],
    })
    const updated = engine.cancelSequence(sequence.id)

    expect(updated.status).toBe('cancelled')
    expect(engine.get(tasks[0].id)?.status).toBe('cancelled')
    expect(engine.get(tasks[1].id)?.status).toBe('cancelled')
    engine.shutdown()
  })

  it('should move a task to the recycle bin keeping its record (M9/M14)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'p' }),
      status: async () => ({ status: 'succeeded' as const, progress: 100, downloadUrl: 'https://x/v.mp4' }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const t = await engine.generate({ prompt: 'x' })
    await waitFor(() => engine.get(t.id)?.status === 'succeeded')
    await engine.deleteTask(t.id)
    // M14：软删——记录保留但带删除时间戳，主列表不再出现
    expect(engine.get(t.id)?.deletedAt).not.toBeNull()
    expect(engine.list().map((task) => task.id)).not.toContain(t.id)
    expect(engine.listTrash().tasks.map((task) => task.id)).toContain(t.id)
    engine.shutdown()
  })

  it('should move a sequence and its child tasks to the recycle bin (M9/M14)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'p' }),
      status: async () => ({ status: 'succeeded' as const, progress: 100, downloadUrl: 'https://x/v.mp4' }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const { sequence, tasks } = await engine.generateSequence({
      shots: [{ prompt: 'a' }, { prompt: 'b' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'succeeded')
    await engine.deleteSequence(sequence.id)

    // M14：软删——序列与子任务记录均保留，带删除时间戳
    expect(getVideoSequenceById(sequence.id)?.deletedAt).not.toBeNull()
    expect(engine.get(tasks[0].id)?.deletedAt).not.toBeNull()
    expect(engine.get(tasks[1].id)?.deletedAt).not.toBeNull()
    expect(engine.listTrash().sequences.map((s) => s.id)).toContain(sequence.id)
    engine.shutdown()
  })

  it('should reconcile sequence to succeeded when all shots succeed (M6)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () =>
        makeAdapter([{ status: 'succeeded', progress: 100, downloadUrl: 'https://x/v.mp4' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const { sequence, tasks } = await engine.generateSequence({
      shots: [{ prompt: 'shot one' }, { prompt: 'shot two' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'succeeded')

    const seq = getVideoSequenceById(sequence.id)
    expect(seq?.succeededCount).toBe(2)
    expect(seq?.failedCount).toBe(0)
    expect(engine.get(tasks[0].id)?.status).toBe('succeeded')
    expect(engine.get(tasks[1].id)?.status).toBe('succeeded')
    engine.shutdown()
  })

  it('should reconcile sequence to failed when any shot fails (M6)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-fail' }),
      status: async () => ({ status: 'failed' as const, progress: 100, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      pollIntervalMs: 5,
    })

    const { sequence } = await engine.generateSequence({
      shots: [{ prompt: 'a' }, { prompt: 'b' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'failed')

    const seq = getVideoSequenceById(sequence.id)
    expect(seq?.failedCount).toBe(2)
    engine.shutdown()
  })

  it('should create a continuity sequence with queued chained shots (M8)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'submitted' as const }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000, // 长间隔，保持提交初始状态，避免推进
    })

    const { sequence, tasks } = await engine.generateSequence({
      continuity: true,
      shots: [{ prompt: 'one' }, { prompt: 'two' }, { prompt: 'three' }],
    })

    expect(sequence.continuity).toBe(true)
    expect(sequence.totalCount).toBe(3)
    expect(tasks).toHaveLength(3)
    // 锚点镜头为纯文生（非衔接），其余镜头标记为链式衔接
    expect(tasks.map((t) => t.isChained)).toEqual([false, true, true])
    // 仅锚点已提交，其余镜头以 queued 占位
    expect(tasks.map((t) => t.status)).toEqual(['submitted', 'queued', 'queued'])
    engine.shutdown()
  })

  it('should advance a continuity chain in order with extracted frames (M8)', async () => {
    const submitImageRefs: Array<Array<{ path: string; role: string }>> = []
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async (spec) => {
        submitImageRefs.push((spec.imageRefs ?? []) as Array<{ path: string; role: string }>)
        return { providerTaskId: `prov-${submitImageRefs.length}` }
      },
      status: async () => ({ status: 'succeeded' as const, progress: 100, downloadUrl: 'https://x/v.mp4' }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const { sequence } = await engine.generateSequence({
      continuity: true,
      shots: [{ prompt: 'a' }, { prompt: 'b' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'succeeded')

    // 两次提交：锚点（无参考图） + 第二个镜头（携带上一镜头尾帧作为首帧）
    expect(submitImageRefs).toHaveLength(2)
    expect(submitImageRefs[0]).toHaveLength(0)
    expect(submitImageRefs[1][0]).toMatchObject({ role: 'first_frame' })
    expect(mockedExtractLastFrame).toHaveBeenCalledTimes(1)
    engine.shutdown()
  })

  it('should cancel remaining queued shots when a continuity shot fails (M8)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-f' }),
      status: async () => ({ status: 'failed' as const, progress: 100, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const { tasks } = await engine.generateSequence({
      continuity: true,
      shots: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }],
    })
    await waitFor(() => engine.get(tasks[0].id)?.status === 'failed')
    // 第 0 个镜头失败后，后续排队镜头被一并取消，且不会触发尾帧抽取
    await waitFor(() => engine.get(tasks[1].id)?.status === 'cancelled')
    expect(engine.get(tasks[2].id)?.status).toBe('cancelled')
    expect(mockedExtractLastFrame).not.toHaveBeenCalled()
    engine.shutdown()
  })

  it('should reject continuity shots that carry imageRefs (M8)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'submitted' as const }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
    })

    await expect(
      engine.generateSequence({
        continuity: true,
        shots: [
          { prompt: 'a', imageRefs: [{ path: '/tmp/x.png', role: 'first_frame' }] },
          { prompt: 'b' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    engine.shutdown()
  })

  it('should batch retry failed tasks as new tasks with dedupe (M10)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-batch' }),
      status: async () => ({ status: 'failed' as const, progress: 100, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const a = await engine.generate({ prompt: 'batch-a' })
    const b = await engine.generate({ prompt: 'batch-b' })
    await waitFor(() => engine.get(a.id)?.status === 'failed')
    await waitFor(() => engine.get(b.id)?.status === 'failed')

    const result = await engine.retryTasks([a.id, b.id, a.id])
    expect(result.succeeded).toHaveLength(2)
    expect(new Set(result.succeeded.map((t) => t.id)).size).toBe(2)
    expect(result.failed).toHaveLength(0)
    result.succeeded.forEach((t) => expect(t.status).toBe('submitted'))
    // 原任务仍保留失败状态
    expect(engine.get(a.id)?.status).toBe('failed')
    engine.shutdown()
  })

  it('should report partial failures in retryTasks (M10)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'prov-p' }),
      status: async () => ({ status: 'failed' as const, progress: 100, downloadUrl: null }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const target = await engine.generate({ prompt: 'recover' })
    await waitFor(() => engine.get(target.id)?.status === 'failed')

    const result = await engine.retryTasks([target.id, 'missing-id'])
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0]?.prompt).toBe('recover')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.id).toBe('missing-id')
    engine.shutdown()
  })

  it('should generate rows in batch as submitted tasks (M11)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000, // 保持 in-flight
    })

    const result = await engine.generateRows([
      { prompt: 'cat one' },
      { prompt: 'dog two', duration: 6 },
    ])
    expect(result.succeeded).toHaveLength(2)
    expect(result.failed).toHaveLength(0)
    const prompts = result.succeeded.map((t) => t.prompt)
    expect(prompts).toEqual(expect.arrayContaining(['cat one', 'dog two']))
    result.succeeded.forEach((t) => {
      expect(t.status).toBe('submitted')
      expect(engine.get(t.id)?.status).toBe('submitted')
    })
    engine.shutdown()
  })

  it('should report per-row failures in generateRows without blocking others (M11)', async () => {
    let call = 0
    const flakyAdapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => {
        call++
        if (call === 1) throw new Error('provider rejected row 1')
        return { providerTaskId: 'prov-ok' }
      },
      status: async () => ({ status: 'submitted' as const }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => flakyAdapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
    })

    const result = await engine.generateRows([{ prompt: 'bad row' }, { prompt: 'good row' }])
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0]?.prompt).toBe('good row')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.id).toBe('bad row')
    engine.shutdown()
  })

  it('should no-op when generateRows receives no rows (M11)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      pollIntervalMs: 60_000,
    })
    const result = await engine.generateRows([])
    expect(result.succeeded).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
    engine.shutdown()
  })

  it('should cancel multiple sequences in batch (M10)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'submitted' as const }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000, // 保持 in-flight
    })

    const s1 = await engine.generateSequence({ shots: [{ prompt: 'a' }, { prompt: 'b' }] })
    const s2 = await engine.generateSequence({ shots: [{ prompt: 'c' }, { prompt: 'd' }] })

    const result = engine.cancelSequences([s1.sequence.id, s2.sequence.id])
    expect(result.succeeded).toHaveLength(2)
    result.succeeded.forEach((seq) => expect(seq.status).toBe('cancelled'))
    expect(result.failed).toHaveLength(0)
    engine.shutdown()
  })

  it('should delete multiple tasks in batch (M10)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'p' }),
      status: async () => ({ status: 'succeeded' as const, progress: 100, downloadUrl: 'https://x/v.mp4' }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const a = await engine.generate({ prompt: 'a' })
    const b = await engine.generate({ prompt: 'b' })
    await waitFor(() => engine.get(a.id)?.status === 'succeeded')
    await waitFor(() => engine.get(b.id)?.status === 'succeeded')

    const result = await engine.deleteTasks([a.id, b.id])
    expect(result.succeeded).toEqual(expect.arrayContaining([a.id, b.id]))
    // M14：软删——记录保留，主列表不再出现
    expect(engine.get(a.id)?.deletedAt).not.toBeNull()
    expect(engine.get(b.id)?.deletedAt).not.toBeNull()
    expect(engine.list().map((task) => task.id)).not.toContain(a.id)
    engine.shutdown()
  })

  it('should delete multiple sequences with their children in batch (M10)', async () => {
    const adapter: VideoProviderAdapter = {
      provider: 'seedance',
      submit: async () => ({ providerTaskId: 'p' }),
      status: async () => ({ status: 'succeeded' as const, progress: 100, downloadUrl: 'https://x/v.mp4' }),
    }
    const engine = new VideoEngine({
      adapterFactory: () => adapter,
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 5,
    })

    const s1 = await engine.generateSequence({ shots: [{ prompt: 'a' }, { prompt: 'b' }] })
    const s2 = await engine.generateSequence({ shots: [{ prompt: 'c' }, { prompt: 'd' }] })
    await waitFor(() => getVideoSequenceById(s1.sequence.id)?.status === 'succeeded')
    await waitFor(() => getVideoSequenceById(s2.sequence.id)?.status === 'succeeded')

    const result = await engine.deleteSequences([s1.sequence.id, s2.sequence.id])
    expect(result.succeeded).toHaveLength(2)
    // M14：软删——序列与子任务记录保留，带删除时间戳
    expect(getVideoSequenceById(s1.sequence.id)?.deletedAt).not.toBeNull()
    expect(getVideoSequenceById(s2.sequence.id)?.deletedAt).not.toBeNull()
    expect(engine.get(s1.tasks[0].id)?.deletedAt).not.toBeNull()
    expect(engine.get(s2.tasks[1].id)?.deletedAt).not.toBeNull()
    engine.shutdown()
  })

  // ─── M13: 生成队列 ──────────────────────────────────────────

  it('should throttle submissions by queue concurrency (M13)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
      maxConcurrent: 1,
    })

    const first = await engine.generate({ prompt: 'one' })
    expect(first.status).toBe('submitted')

    const second = await engine.generate({ prompt: 'two' })
    expect(second.status).toBe('queued')

    const snapshot = engine.getQueueSnapshot()
    expect(snapshot.activeCount).toBe(1)
    expect(snapshot.maxConcurrent).toBe(1)
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]?.task.id).toBe(second.id)
    expect(snapshot.items[0]?.position).toBe(1)

    // 提升并发上限后自动出队
    engine.setQueueConcurrency(3)
    await waitFor(() => engine.get(second.id)?.status === 'submitted')
    expect(engine.getQueueSnapshot().items).toHaveLength(0)
    engine.shutdown()
  })

  it('should pause and resume the queue (M13)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
      maxConcurrent: 2,
    })

    const first = await engine.generate({ prompt: 'first' })
    expect(first.status).toBe('submitted')

    const snapshot = engine.pauseQueue()
    expect(snapshot.paused).toBe(true)

    const second = await engine.generate({ prompt: 'second' })
    expect(second.status).toBe('queued')
    // 暂停期间保持排队
    expect(engine.get(second.id)?.status).toBe('queued')

    engine.resumeQueue()
    await waitFor(() => engine.get(second.id)?.status === 'submitted')
    expect(engine.getQueueSnapshot().paused).toBe(false)
    engine.shutdown()
  })

  it('should remove a queued task from the queue when cancelled (M13)', async () => {
    const engine = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
      maxConcurrent: 1,
    })

    await engine.generate({ prompt: 'in-flight' })
    const queued = await engine.generate({ prompt: 'queued one' })
    expect(engine.getQueueSnapshot().items).toHaveLength(1)

    engine.cancel(queued.id)
    expect(engine.get(queued.id)?.status).toBe('cancelled')
    expect(engine.getQueueSnapshot().items).toHaveLength(0)
    engine.shutdown()
  })

  it('should recover queued tasks from db in a fresh engine (M13)', async () => {
    const first = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
      maxConcurrent: 1,
    })
    first.pauseQueue()
    const stuck = await first.generate({ prompt: 'stuck task' })
    expect(stuck.status).toBe('queued')
    first.shutdown()

    // 新引擎实例（模拟重启）：遗留 queued 任务自动回队并提交
    const second = new VideoEngine({
      adapterFactory: () => makeAdapter([{ status: 'running' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async () => undefined,
      pollIntervalMs: 60_000,
      maxConcurrent: 1,
    })
    const snapshot = second.getQueueSnapshot()
    expect(snapshot.items.map((item) => item.task.id)).toContain(stuck.id)
    await waitFor(() => second.get(stuck.id)?.status === 'submitted')
    second.shutdown()
  })

  // ─── M14: 回收站与资产管理 ──────────────────────────────────

  /** 构建真实落盘下载（导出测试需要磁盘上的成品文件） */
  function makeDownloadingEngine(pollIntervalMs = 5): VideoEngine {
    return new VideoEngine({
      adapterFactory: () =>
        makeAdapter([{ status: 'succeeded', progress: 100, downloadUrl: 'https://x/v.mp4' }]),
      configProvider: () => TEST_CONFIG,
      notify: () => undefined,
      download: async (_url, absPath) => {
        await mkdir(join(absPath, '..'), { recursive: true })
        await writeFile(absPath, 'mp4-bytes')
      },
      pollIntervalMs,
    })
  }

  it('should soft-delete a task keeping its file, then restore it (M14)', async () => {
    const engine = makeDownloadingEngine()
    const t = await engine.generate({ prompt: 'keep me' })
    await waitFor(() => engine.get(t.id)?.status === 'succeeded')
    const outputPath = engine.get(t.id)?.outputPath as string
    const absPath = join(workspacePath, outputPath)
    expect(existsSync(absPath)).toBe(true)

    await engine.deleteTask(t.id)
    // 软删：记录保留 + 文件保留 + 主列表隐藏 + 回收站可见
    expect(engine.get(t.id)?.deletedAt).not.toBeNull()
    expect(existsSync(absPath)).toBe(true)
    expect(engine.list().map((task) => task.id)).not.toContain(t.id)
    expect(engine.listTrash().tasks.map((task) => task.id)).toContain(t.id)

    engine.restoreTask(t.id)
    expect(engine.get(t.id)?.deletedAt).toBeNull()
    expect(engine.list().map((task) => task.id)).toContain(t.id)
    expect(existsSync(absPath)).toBe(true)
    engine.shutdown()
  })

  it('should purge a trashed task removing record and file (M14)', async () => {
    const engine = makeDownloadingEngine()
    const t = await engine.generate({ prompt: 'purge me' })
    await waitFor(() => engine.get(t.id)?.status === 'succeeded')
    const absPath = join(workspacePath, engine.get(t.id)?.outputPath as string)

    await engine.deleteTask(t.id)
    await engine.purgeTask(t.id)
    expect(engine.get(t.id)).toBeNull()
    expect(existsSync(absPath)).toBe(false)
    expect(engine.listTrash().tasks).toHaveLength(0)
    engine.shutdown()
  })

  it('should empty the trash purging every trashed task and sequence (M14)', async () => {
    const engine = makeDownloadingEngine()
    const a = await engine.generate({ prompt: 'trash-a' })
    await waitFor(() => engine.get(a.id)?.status === 'succeeded')
    const { sequence } = await engine.generateSequence({
      shots: [{ prompt: 'seq-a' }, { prompt: 'seq-b' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'succeeded')

    await engine.deleteTask(a.id)
    await engine.deleteSequence(sequence.id)
    expect(engine.listTrash().tasks).toHaveLength(3) // 1 独立任务 + 2 子镜头
    expect(engine.listTrash().sequences).toHaveLength(1)

    const result = await engine.emptyTrash()
    expect(result.tasks).toBe(3)
    expect(result.sequences).toBe(1)
    expect(engine.listTrash().tasks).toHaveLength(0)
    expect(engine.listTrash().sequences).toHaveLength(0)
    expect(engine.get(a.id)).toBeNull()
    expect(getVideoSequenceById(sequence.id)).toBeNull()
    engine.shutdown()
  })

  it('should restore a sequence together with its children (M14)', async () => {
    const engine = makeDownloadingEngine()
    const { sequence, tasks } = await engine.generateSequence({
      shots: [{ prompt: 'a' }, { prompt: 'b' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'succeeded')

    await engine.deleteSequence(sequence.id)
    expect(engine.get(tasks[0].id)?.deletedAt).not.toBeNull()

    engine.restoreSequence(sequence.id)
    expect(getVideoSequenceById(sequence.id)?.deletedAt).toBeNull()
    expect(engine.get(tasks[0].id)?.deletedAt).toBeNull()
    expect(engine.get(tasks[1].id)?.deletedAt).toBeNull()
    engine.shutdown()
  })

  it('should export succeeded assets with conflict rename (M14)', async () => {
    const engine = makeDownloadingEngine()
    const t = await engine.generate({ prompt: 'export me' })
    await waitFor(() => engine.get(t.id)?.status === 'succeeded')
    const task = engine.get(t.id)
    const baseName = (task?.outputPath as string).split(/[\\/]/).pop() as string

    const targetDir = join(tempDir, 'export-out')
    mkdirSync(targetDir, { recursive: true })
    // 预置同名文件，验证冲突自动追加 -2 序号
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(targetDir, baseName), 'existing')

    const result = await engine.exportAssets({ taskIds: [t.id], sequenceIds: [], targetDir })
    expect(result.canceled).toBe(false)
    if (!result.canceled) {
      expect(result.exported).toBe(1)
      expect(result.skipped).toHaveLength(0)
    }
    const files = readdirSync(targetDir).sort()
    expect(files).toContain(baseName)
    expect(files).toContain(baseName.replace('.mp4', '-2.mp4'))
    expect(readFileSync(join(targetDir, baseName.replace('.mp4', '-2.mp4')), 'utf8')).toBe('mp4-bytes')
    engine.shutdown()
  })

  it('should expand sequences and skip missing tasks when exporting (M14)', async () => {
    const engine = makeDownloadingEngine()
    const { sequence } = await engine.generateSequence({
      shots: [{ prompt: 'a' }, { prompt: 'b' }],
    })
    await waitFor(() => getVideoSequenceById(sequence.id)?.status === 'succeeded')

    const targetDir = join(tempDir, 'export-seq')
    const result = await engine.exportAssets({
      taskIds: ['missing-id'],
      sequenceIds: [sequence.id],
      targetDir,
    })
    expect(result.canceled).toBe(false)
    if (!result.canceled) {
      // 序列展开为 2 个成功子镜头；missing-id 计入 skipped
      expect(result.exported).toBe(2)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.id).toBe('missing-id')
    }
    expect(readdirSync(targetDir)).toHaveLength(2)
    engine.shutdown()
  })

  it('should reject exporting with an empty target directory (M14)', async () => {
    const engine = makeDownloadingEngine()
    await expect(
      engine.exportAssets({ taskIds: [], sequenceIds: [], targetDir: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    engine.shutdown()
  })
})