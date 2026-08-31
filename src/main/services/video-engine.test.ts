// 视频任务引擎单元测试
// 注入 mock adapter / configProvider / download，验证生成 → 轮询 → 成功/失败/取消 的完整生命周期。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
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
    expect(result?.outputPath).toMatch(/^videos\/seedance-[\w-]+\.mp4$/)
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

  it('should delete a task and its record (M9)', async () => {
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
    expect(engine.get(t.id)).toBeNull()
    engine.shutdown()
  })

  it('should delete a sequence and its child tasks (M9)', async () => {
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

    expect(engine.get(tasks[0].id)).toBeNull()
    expect(engine.get(tasks[1].id)).toBeNull()
    expect(getVideoSequenceById(sequence.id)).toBeNull()
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
    expect(engine.get(a.id)).toBeNull()
    expect(engine.get(b.id)).toBeNull()
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
    expect(getVideoSequenceById(s1.sequence.id)).toBeNull()
    expect(getVideoSequenceById(s2.sequence.id)).toBeNull()
    expect(engine.get(s1.tasks[0].id)).toBeNull()
    expect(engine.get(s2.tasks[1].id)).toBeNull()
    engine.shutdown()
  })
})