// Seedance 适配器单元测试
// 通过注入 mock transport 验证提交/状态映射/错误处理，不发起真实网络请求。

import { describe, it, expect, vi } from 'vitest'
import { SeedanceAdapter, DEFAULT_ARK_BASE_URL } from './seedance'
import type { HttpRequestFn, HttpResponse } from './transport'
import { AppError } from '../../utils/error'
import type { VideoProviderConfig } from './types'

const TEST_CONFIG: VideoProviderConfig = {
  apiKey: 'test-key',
  baseUrl: DEFAULT_ARK_BASE_URL,
  model: 'doubao-seedance',
}

function makeRequestMock(handler: (input: Parameters<HttpRequestFn>[0]) => HttpResponse): HttpRequestFn {
  const fn = vi.fn(handler)
  return fn as unknown as HttpRequestFn
}

describe('SeedanceAdapter', () => {
  it('should submit a video task and return providerTaskId', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      if (input.method === 'POST') {
        return { status: 200, data: { id: 'task_123', status: 'queued' } }
      }
      return { status: 200, data: {} }
    })

    const adapter = new SeedanceAdapter(request)
    const result = await adapter.submit(
      { prompt: 'A cat walking', duration: 5, resolution: '720P', aspect: '16:9' },
      TEST_CONFIG,
    )
    expect(result.providerTaskId).toBe('task_123')

    // 校验请求体含 prompt / duration / model / 鉴权头
    const call = requests[0]
    expect(call.url).toBe(`${DEFAULT_ARK_BASE_URL}/contents/generations/tasks`)
    expect(call.headers.Authorization).toBe('Bearer test-key')
    expect(call.body).toMatchObject({
      model: 'doubao-seedance',
      content: [
        {
          type: 'video',
          video: {
            prompt: 'A cat walking',
            duration: 5,
            resolution: '720P',
            aspect_ratio: '16:9',
          },
        },
      ],
    })
  })

  it('should map queued/running state with estimated progress', async () => {
    const request = makeRequestMock((input) => {
      const isQueued = String(input.url).endsWith('/task_999')
      const status = isQueued ? 'queued' : 'running'
      return { status: 200, data: { id: 'task_999', status } }
    })

    const adapter = new SeedanceAdapter(request)

    const queued = await adapter.status('task_999', TEST_CONFIG)
    expect(queued.status).toBe('queued')
    expect(queued.progress).toBe(5)

    const running = await adapter.status('task_1000', TEST_CONFIG)
    expect(running.status).toBe('running')
    expect(running.progress).toBe(45)
  })

  it('should parse download_url from succeeded content', async () => {
    const request = makeRequestMock(() => ({
      status: 200,
      data: {
        id: 'task_ok',
        status: 'succeeded',
        content: [
          { type: 'file', file: { download_url: 'https://bucket/video.mp4?expire=1' } },
        ],
      },
    }))

    const adapter = new SeedanceAdapter(request)
    const result = await adapter.status('task_ok', TEST_CONFIG)
    expect(result.status).toBe('succeeded')
    expect(result.progress).toBe(100)
    expect(result.downloadUrl).toBe('https://bucket/video.mp4?expire=1')
  })

  it('should map failed and cancelled states', async () => {
    const request = makeRequestMock((input) => {
      const taskId = String(input.url).split('/').pop()
      if (taskId === 'task_fail') {
        return { status: 200, data: { id: 'task_fail', status: 'failed' } }
      }
      return { status: 200, data: { id: 'task_cancel', status: 'cancelled' } }
    })

    const adapter = new SeedanceAdapter(request)
    expect((await adapter.status('task_fail', TEST_CONFIG)).status).toBe('failed')
    expect((await adapter.status('task_cancel', TEST_CONFIG)).status).toBe('cancelled')
  })

  it('should throw VIDEO_RATE_LIMIT on 429', async () => {
    const request = makeRequestMock(() => {
      const err = new Error('Rate limit hit') as Error & { status?: number }
      err.status = 429
      throw err
    })

    const adapter = new SeedanceAdapter(request)
    await expect(adapter.submit({ prompt: 'x', duration: 5, resolution: '720P', aspect: '16:9' }, TEST_CONFIG)).rejects.toMatchObject({
      code: 'VIDEO_RATE_LIMIT',
    })
  })

  it('should throw VIDEO_API_ERROR on other HTTP errors', async () => {
    const request = makeRequestMock(() => {
      const err = new Error('Unauthorized') as Error & { status?: number }
      err.status = 401
      throw err
    })

    const adapter = new SeedanceAdapter(request)
    const caught = await adapter
      .status('task_x', TEST_CONFIG)
      .then(() => null)
      .catch((e) => e)
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).code).toBe('VIDEO_API_ERROR')
  })
})