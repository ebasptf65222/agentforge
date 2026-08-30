// AgentForge Seedance 视频生成适配器（火山方舟 ARK / 即梦 Seedance 同源）
//
// 实现火山方舟「内容生成任务」(Content Generation Task) API：
//   POST {baseUrl}/api/v3/contents/generations/tasks   提交生成任务
//   GET  {baseUrl}/api/v3/contents/generations/tasks/{id}  查询任务状态
// 支持 text2video 视频生成，鉴权使用 Authorization: Bearer {ARK_API_KEY}。
//
// M1 目标：打通提交 → 轮询 → 拿到 download_url 的最小闭环。

import type { SubmitResult, StatusResult, SubmitSpec, VideoProviderAdapter, VideoProviderConfig } from './types'
import { fetchTransport, type HttpRequestFn } from './transport'
import { AppError, ErrorCodes } from '../../utils/error'
import type { VideoProvider } from '@shared/types'

/** 火山方舟 ARK API 默认基础地址 */
export const DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** Seedance 默认模型（可在设置中覆盖为自定义 endpoint） */
export const DEFAULT_SEEDANCE_MODEL = 'doubao-seedance'

/** Ark 内容生成任务的默认帧率 */
const DEFAULT_FPS = 30

/** Seedance 适配器 */
export class SeedanceAdapter implements VideoProviderAdapter {
  readonly provider: VideoProvider = 'seedance'

  private readonly request: HttpRequestFn

  constructor(request: HttpRequestFn = fetchTransport) {
    this.request = request
  }

  /**
   * 提交一次 text2video 生成任务。
   */
  async submit(spec: SubmitSpec, config: VideoProviderConfig): Promise<SubmitResult> {
    const url = `${trimSlash(config.baseUrl)}/contents/generations/tasks`
    const body = {
      model: config.model,
      content: [
        {
          type: 'video',
          video: {
            prompt: spec.prompt,
            duration: spec.duration,
            resolution: spec.resolution,
            fps: DEFAULT_FPS,
            aspect_ratio: spec.aspect,
          },
        },
      ],
      response_format: { type: 'object' },
    }

    const res = await this.requestJson(() =>
      this.request({
        url,
        method: 'POST',
        headers: this.buildHeaders(config),
        body,
      }),
    )

    const data = ensureObject(res.data)
    const id = data['id']
    if (typeof id !== 'string' || id.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_API_ERROR,
        'Seedance submit response missing task id',
        { data: res.data },
      )
    }

    return { providerTaskId: id }
  }

  /**
   * 查询任务状态并映射为统一状态机。
   */
  async status(providerTaskId: string, config: VideoProviderConfig): Promise<StatusResult> {
    const url = `${trimSlash(config.baseUrl)}/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`
    const res = await this.requestJson(() =>
      this.request({ url, method: 'GET', headers: this.buildHeaders(config) }),
    )

    const data = ensureObject(res.data)
    const rawStatus: string | undefined = data['status'] as string | undefined
    const { status, progress } = mapArkStatus(rawStatus)
    const downloadUrl = extractDownloadUrl(data)

    return { status, progress, downloadUrl }
  }

  private buildHeaders(config: VideoProviderConfig): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }
  }

  /** 统一错误映射：把底层 HTTP/网络错误包装为 AppError */
  private async requestJson(doRequest: () => Promise<unknown>): Promise<{ data: unknown }> {
    try {
      const res = await doRequest()
      const data = (res as { data: unknown }).data
      return { data }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const status = (error as { status?: number }).status
      throw toAppError(status, err.message)
    }
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────────

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new AppError(ErrorCodes.VIDEO_API_ERROR, 'Seedance response is not an object')
  }
  return value as Record<string, unknown>
}

/**
 * 将 Ark 任务状态映射为统一状态机。
 * Ark 状态：queued / running / succeeded / failed / cancelled / suspended。
 */
function mapArkStatus(raw: string | undefined): { status: StatusResult['status']; progress: number } {
  switch (raw) {
    case 'succeeded':
      return { status: 'succeeded', progress: 100 }
    case 'failed':
      return { status: 'failed', progress: 100 }
    case 'cancelled':
      return { status: 'cancelled', progress: 100 }
    case 'running':
      return { status: 'running', progress: 45 }
    case 'suspended':
      // Ark 排队暂停，视作运行中
      return { status: 'running', progress: 20 }
    case 'queued':
    default:
      return { status: 'queued', progress: 5 }
  }
}

/** 从 Ark 任务响应内容里提取 download_url（file 类型资源） */
function extractDownloadUrl(data: Record<string, unknown>): string | null {
  const content = data['content']
  if (!Array.isArray(content)) return null
  for (const item of content) {
    const obj = item as Record<string, unknown>
    if (obj['type'] === 'file' && obj['file'] && typeof obj['file'] === 'object') {
      const file = obj['file'] as Record<string, unknown>
      if (typeof file['download_url'] === 'string' && file['download_url'] !== '') {
        return file['download_url']
      }
    }
  }
  return null
}

/**
 * 将 HTTP 状态码/错误映射为 AppError。
 */
function toAppError(status: number | undefined, message: string): AppError {
  if (status === 429) {
    return new AppError(ErrorCodes.VIDEO_RATE_LIMIT, `Seedance API rate limited: ${message}`)
  }
  if (status !== undefined && status >= 400) {
    return new AppError(ErrorCodes.VIDEO_API_ERROR, `Seedance API error (${status}): ${message}`)
  }
  return new AppError(ErrorCodes.VIDEO_API_ERROR, `Seedance network error: ${message}`)
}