// OpenAI Videos 兼容适配器单元测试
// 通过注入 mock transport 验证提交/状态映射/Agnes 差异处理，不发起真实网络请求。

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import { OpenAIVideoAdapter, DEFAULT_OPENAI_VIDEO_BASE_URL } from './openai'
import { CustomAdapter, normalizeCustomProtocol } from './custom'
import type { HttpRequestFn, HttpResponse } from './transport'
import type { VideoProviderConfig } from './types'

const TEST_CONFIG: VideoProviderConfig = {
  apiKey: 'test-key',
  baseUrl: DEFAULT_OPENAI_VIDEO_BASE_URL,
  model: 'agnes-video-2.5-flash',
  protocol: 'openai',
}

function makeRequestMock(handler: (input: Parameters<HttpRequestFn>[0]) => HttpResponse): HttpRequestFn {
  const fn = vi.fn(handler)
  return fn as unknown as HttpRequestFn
}

describe('OpenAIVideoAdapter', () => {
  it('should submit a text-mode task and prefer video_id from response', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return { status: 200, data: { id: 'task_1', task_id: 'task_1', video_id: 'video_1', status: 'queued' } }
    })

    const adapter = new OpenAIVideoAdapter(request)
    const result = await adapter.submit(
      { prompt: 'A cat walking', duration: 5, resolution: '720P', aspect: '16:9' },
      TEST_CONFIG,
    )

    expect(result.providerTaskId).toBe('video_1')
    const call = requests[0]
    expect(call.url).toBe(`${DEFAULT_OPENAI_VIDEO_BASE_URL}/videos`)
    expect(call.method).toBe('POST')
    expect(call.headers.Authorization).toBe('Bearer test-key')
    expect(call.body).toMatchObject({
      model: 'agnes-video-2.5-flash',
      prompt: 'A cat walking',
      mode: 'text',
      seconds: '5',
      size: '720P',
      aspect_ratio: '16:9',
    })
  })

  it('should submit keyframe mode with first/last frame data uris', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return { status: 200, data: { video_id: 'video_kf', status: 'queued' } }
    })

    const first = join(tmpdir(), `openai-test-first-${Date.now()}.png`)
    const last = join(tmpdir(), `openai-test-last-${Date.now()}.png`)
    writeFileSync(first, Buffer.from('89504e470d0a1a0a', 'hex'))
    writeFileSync(last, Buffer.from('89504e470d0a1a0a', 'hex'))

    const adapter = new OpenAIVideoAdapter(request)
    await adapter.submit(
      {
        prompt: 'Transition between frames',
        duration: 8,
        resolution: '1080P',
        aspect: '9:16',
        imageRefs: [
          { path: first, role: 'first_frame' },
          { path: last, role: 'last_frame' },
        ],
      },
      TEST_CONFIG,
    )

    const body = requests[0].body as Record<string, unknown>
    expect(body['mode']).toBe('keyframe')
    expect(body['seconds']).toBe('8')
    // Flash 模型仅支持 720P：即使任务选择 1080P 也固定下发 720P
    expect(body['size']).toBe('720P')
    expect(body['aspect_ratio']).toBe('9:16')
    expect(String(body['first_frame'])).toMatch(/^data:image\/png;base64,/)
    expect(String(body['last_frame'])).toMatch(/^data:image\/png;base64,/)
  })

  it('should map 1080P to 2K for non-flash Agnes models', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return { status: 200, data: { video_id: 'video_25', status: 'queued' } }
    })

    const adapter = new OpenAIVideoAdapter(request)
    await adapter.submit(
      { prompt: 'A cat walking', duration: 15, resolution: '1080P', aspect: '16:9' },
      { ...TEST_CONFIG, model: 'agnes-video-2.5' },
    )

    const body = requests[0].body as Record<string, unknown>
    expect(body['size']).toBe('2K')
    // seconds 钳制到 "4"–"12" 合法区间
    expect(body['seconds']).toBe('12')
  })

  it('should poll via Agnes /agnesapi and map completed with metadata.url', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return {
        status: 200,
        data: {
          video_id: 'video_1',
          status: 'completed',
          progress: 100,
          metadata: { url: 'https://cdn.example.com/video.mp4' },
        },
      }
    })

    const adapter = new OpenAIVideoAdapter(request)
    const result = await adapter.status('video_1', TEST_CONFIG)

    expect(result).toEqual({
      status: 'succeeded',
      progress: 100,
      downloadUrl: 'https://cdn.example.com/video.mp4',
    })
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url).toBe('https://api.agnes-ai.cn/agnesapi?video_id=video_1&model_name=agnes-video-2.5-flash')
  })

  it('should fall back to standard GET /videos/{id} when /agnesapi returns 404', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      if (input.url.includes('/agnesapi')) {
        const err = new Error('HTTP 404 Not Found') as Error & { status?: number }
        err.status = 404
        throw err
      }
      return { status: 200, data: { status: 'in_progress', progress: 60 } }
    })

    const adapter = new OpenAIVideoAdapter(request)
    const result = await adapter.status('video_1', TEST_CONFIG)

    expect(result).toEqual({ status: 'running', progress: 60, downloadUrl: null })
    expect(requests).toHaveLength(2)
    expect(requests[1].url).toBe(`${DEFAULT_OPENAI_VIDEO_BASE_URL}/videos/video_1`)
  })

  it('should map failed status with error message', async () => {
    const request = makeRequestMock(() => ({
      status: 200,
      data: { status: 'failed', progress: 100, error: { message: 'content policy' } },
    }))

    const adapter = new OpenAIVideoAdapter(request)
    const result = await adapter.status('video_1', TEST_CONFIG)

    expect(result.status).toBe('failed')
    expect(result.progress).toBe(100)
    expect(result.downloadUrl).toBeNull()
    expect(result.errorMessage).toBe('content policy')
  })
})

describe('CustomAdapter protocol delegation', () => {
  it('should delegate to OpenAI adapter when protocol is openai', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return { status: 200, data: { video_id: 'video_1', status: 'queued' } }
    })

    const adapter = new CustomAdapter(request)
    const result = await adapter.submit(
      { prompt: 'A cat walking', duration: 5, resolution: '720P', aspect: '16:9' },
      TEST_CONFIG,
    )

    expect(result.providerTaskId).toBe('video_1')
    expect(requests[0].url).toBe(`${DEFAULT_OPENAI_VIDEO_BASE_URL}/videos`)
  })

  it('should keep ark as the default protocol', async () => {
    const requests: Array<Parameters<HttpRequestFn>[0]> = []
    const request = makeRequestMock((input) => {
      requests.push(input)
      return { status: 200, data: { id: 'task_1', status: 'queued' } }
    })

    const adapter = new CustomAdapter(request)
    await adapter.submit(
      { prompt: 'A cat walking', duration: 5, resolution: '720P', aspect: '16:9' },
      { apiKey: 'k', baseUrl: DEFAULT_OPENAI_VIDEO_BASE_URL, model: 'm' },
    )

    // 缺省协议走 ARK 的内容生成任务端点
    expect(requests[0].url).toBe(`${DEFAULT_OPENAI_VIDEO_BASE_URL}/contents/generations/tasks`)
  })
})

describe('normalizeCustomProtocol', () => {
  it('should accept openai and fall back to ark for unknown values', () => {
    expect(normalizeCustomProtocol('openai')).toBe('openai')
    expect(normalizeCustomProtocol('kling')).toBe('kling')
    expect(normalizeCustomProtocol('ark')).toBe('ark')
    expect(normalizeCustomProtocol('bogus')).toBe('ark')
    expect(normalizeCustomProtocol(null)).toBe('ark')
    expect(normalizeCustomProtocol(undefined)).toBe('ark')
  })
})
