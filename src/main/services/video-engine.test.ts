// 视频任务引擎单元测试
// 注入 mock adapter / configProvider / download，验证生成 → 轮询 → 成功/失败/取消 的完整生命周期。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase } from '../db/index'
import { updateSettings, getSettings } from '../db/repos/app-settings'
import { getVideoEngine, resetVideoEngine, VideoEngine } from './video-engine'
import type { VideoProviderAdapter, VideoProviderConfig } from './video-provider/types'

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
})