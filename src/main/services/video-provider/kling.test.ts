// Kling（TokenHub）适配器单元测试
// 通过注入 mock transport 验证提交/状态映射/归一化/错误处理，不发起真实网络请求。

import { describe, it, expect, vi } from 'vitest'
import { KlingAdapter, DEFAULT_KLING_BASE_URL } from './kling'
import type { HttpRequestFn, HttpResponse } from './transport'
import { AppError } from '../../utils/error'
import type { VideoProviderConfig } from './types'

const TEST_CONFIG: VideoProviderConfig = {
  apiKey: 'th-key',
  baseUrl: DEFAULT_KLING_BASE_URL,
  model: 'kling-video-v2.6',
}

function makeRequestMock(handler: (input: Parameters<HttpRequestFn>[0]) => HttpResponse): HttpRequestFn {
  const fn = vi.fn(handler)
  return fn as unknown as HttpRequestFn
}

describe('KlingAdapter', () => {
  it('should submit a text-to-video task and return task id', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      if (input.method === 'POST') {
        return { status: 200, data: { id: 'kling_task_1', status: 'submitted' } }
      }
      return { status: 200, data: {} }
    })

    const adapter = new KlingAdapter(request)
    const result = await adapter.submit(
      { prompt: 'A cat walking', duration: 5, resolution: '720P', aspect: '16:9' },
      TEST_CONFIG,
    )
    expect(result.providerTaskId).toBe('kling_task_1')

    const call = requests[0]
    expect(call.url).toBe(`${DEFAULT_KLING_BASE_URL}/v1/wand/kling/text-to-video`)
    expect(call.headers.Authorization).toBe('Bearer th-key')
    expect(call.body).toMatchObject({
      model: 'kling-video-v2.6',
      prompt: 'A cat walking',
      settings: { resolution: '720p', aspect_ratio: '16:9', duration: 5 },
    })
  })

  it('should normalize resolution and aspect for Kling limits', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return { status: 200, data: { id: 't1', status: 'submitted' } }
    })

    const adapter = new KlingAdapter(request)
    // 1080P → 1080p；4:3 不在 Kling 支持集内 → 回退 16:9
    await adapter.submit(
      { prompt: 'x', duration: 10, resolution: '1080P', aspect: '4:3' },
      TEST_CONFIG,
    )
    expect(requests[0].body).toMatchObject({
      settings: { resolution: '1080p', aspect_ratio: '16:9', duration: 10 },
    })
  })

  it('should map submitted/processing states with estimated progress', async () => {
    const request = makeRequestMock((input) => {
      const isSubmitted = String(input.url).endsWith('/task_queued')
      return {
        status: 200,
        data: {
          task_id: isSubmitted ? 'task_queued' : 'task_run',
          task_status: isSubmitted ? 'submitted' : 'processing',
        },
      }
    })

    const adapter = new KlingAdapter(request)
    const queued = await adapter.status('task_queued', TEST_CONFIG)
    expect(queued.status).toBe('queued')
    expect(queued.progress).toBe(5)

    const running = await adapter.status('task_run', TEST_CONFIG)
    expect(running.status).toBe('running')
    expect(running.progress).toBe(45)
  })

  it('should parse video url from task_result on succeed/succeeded', async () => {
    const request = makeRequestMock((input) => {
      const useSucceed = String(input.url).endsWith('/task_succeed')
      return {
        status: 200,
        data: {
          task_id: useSucceed ? 'task_succeed' : 'task_ok',
          task_status: useSucceed ? 'succeed' : 'succeeded',
          task_result: {
            videos: [{ id: 'v1', url: 'https://cdn.klingai.com/video.mp4' }],
          },
        },
      }
    })

    const adapter = new KlingAdapter(request)
    const a = await adapter.status('task_succeed', TEST_CONFIG)
    expect(a.status).toBe('succeeded')
    expect(a.progress).toBe(100)
    expect(a.downloadUrl).toBe('https://cdn.klingai.com/video.mp4')

    const b = await adapter.status('task_ok', TEST_CONFIG)
    expect(b.status).toBe('succeeded')
    expect(b.downloadUrl).toBe('https://cdn.klingai.com/video.mp4')
  })

  it('should map failed state and missing videos to null url', async () => {
    const request = makeRequestMock(() => ({
      status: 200,
      data: { task_id: 'task_fail', task_status: 'failed', task_result: { videos: [] } },
    }))

    const adapter = new KlingAdapter(request)
    const failed = await adapter.status('task_fail', TEST_CONFIG)
    expect(failed.status).toBe('failed')
    expect(failed.progress).toBe(100)
    expect(failed.downloadUrl).toBeNull()
  })

  it('should throw VIDEO_RATE_LIMIT on 429', async () => {
    const request = makeRequestMock(() => {
      const err = new Error('Rate limit hit') as Error & { status?: number }
      err.status = 429
      throw err
    })

    const adapter = new KlingAdapter(request)
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

    const adapter = new KlingAdapter(request)
    const caught = await adapter
      .status('task_x', TEST_CONFIG)
      .then(() => null)
      .catch((e) => e)
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).code).toBe('VIDEO_API_ERROR')
  })

  it('should reject unknown submit response without id', async () => {
    const request = makeRequestMock(() => ({ status: 200, data: { status: 'submitted' } }))
    const adapter = new KlingAdapter(request)
    await expect(
      adapter.submit({ prompt: 'x', duration: 5, resolution: '720P', aspect: '16:9' }, TEST_CONFIG),
    ).rejects.toMatchObject({ code: 'VIDEO_API_ERROR' })
  })
})