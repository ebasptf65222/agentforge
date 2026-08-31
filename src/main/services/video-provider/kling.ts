// AgentForge Kling（可灵）视频生成适配器 - TokenHub OpenAI 风格 Bearer 端点
//
// 对接腾讯云 TokenHub 提供的 Kling 模型（与 Seedance/ARK 同为 Bearer API Key 鉴权，
// 复用 apiKey + baseUrl + model 配置模型）：
//   POST {baseUrl}/v1/wand/kling/text-to-video    提交文生视频任务
//   GET  {baseUrl}/v1/wand/kling/tasks/{task_id}  查询任务状态与结果
// 鉴权使用 Authorization: Bearer {API_KEY}，与 ARK 一致的传输层。
//
// M4 目标：作为第二引擎接入，厂商在设置页可切换。

import type {
  SubmitResult,
  StatusResult,
  SubmitSpec,
  VideoProviderAdapter,
  VideoProviderConfig,
} from './types'
import { fetchTransport, type HttpRequestFn } from './transport'
import { AppError, ErrorCodes } from '../../utils/error'
import type { VideoAspect, VideoProvider, VideoResolution } from '@shared/types'

/** 腾讯云 TokenHub Kling 默认基础地址 */
export const DEFAULT_KLING_BASE_URL = 'https://tokenhub.tencentmaas.com'

/** Kling 默认模型（成熟稳定版，可在设置中覆盖） */
export const DEFAULT_KLING_MODEL = 'kling-video-v2.6'

/** TokenHub 统一任务查询的子路径前缀 */
const KLING_SUBMIT_PATH = '/v1/wand/kling/text-to-video'
const KLING_TASKS_PREFIX = '/v1/wand/kling/tasks/'

/** Kling 适配器 */
export class KlingAdapter implements VideoProviderAdapter {
  readonly provider: VideoProvider = 'kling'

  private readonly request: HttpRequestFn

  constructor(request: HttpRequestFn = fetchTransport) {
    this.request = request
  }

  /**
   * 提交一次文生视频任务。
   */
  async submit(spec: SubmitSpec, config: VideoProviderConfig): Promise<SubmitResult> {
    const url = `${trimSlash(config.baseUrl)}${KLING_SUBMIT_PATH}`
    const body = {
      model: config.model,
      prompt: spec.prompt,
      settings: {
        resolution: normalizeResolution(spec.resolution),
        aspect_ratio: normalizeAspect(spec.aspect),
        duration: spec.duration,
      },
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
        'Kling submit response missing task id',
        { data: res.data },
      )
    }
    return { providerTaskId: id }
  }

  /**
   * 查询任务状态并映射为统一状态机。
   */
  async status(providerTaskId: string, config: VideoProviderConfig): Promise<StatusResult> {
    const url = `${trimSlash(config.baseUrl)}${KLING_TASKS_PREFIX}${encodeURIComponent(providerTaskId)}`
    const res = await this.requestJson(() =>
      this.request({ url, method: 'GET', headers: this.buildHeaders(config) }),
    )

    const data = ensureObject(res.data)
    const rawStatus: string | undefined = data['task_status'] as string | undefined
    const { status, progress } = mapKlingStatus(rawStatus)
    const downloadUrl = extractVideoUrl(data)

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
    throw new AppError(ErrorCodes.VIDEO_API_ERROR, 'Kling response is not an object')
  }
  return value as Record<string, unknown>
}

/**
 * 将 Kling 分辨率规格映射为 TokenHub 接受的小写档位。
 * Kling 支持 720p / 1080p / 4k；480P 项目档位就近映射为 720p。
 */
function normalizeResolution(resolution: VideoResolution): string {
  return resolution === '1080P' ? '1080p' : '720p'
}

/**
 * 将统一画幅映射为 Kling 支持的取值（16:9 / 9:16 / 1:1）。
 * 不支持的 4:3 / 3:4 就近回退到默认 16:9，避免接口报错。
 */
function normalizeAspect(aspect: VideoAspect): string {
  return aspect === '9:16' || aspect === '1:1' ? aspect : '16:9'
}

/**
 * 将 TokenHub Kling 任务状态映射为统一状态机。
 * TokenHub 状态：submitted / processing / succeed（查询接口偶见 succeeded）/ failed。
 */
function mapKlingStatus(
  raw: string | undefined,
): { status: StatusResult['status']; progress: number } {
  switch (raw) {
    case 'succeed':
    case 'succeeded':
    case 'SUCCESS':
      return { status: 'succeeded', progress: 100 }
    case 'failed':
    case 'FAILED':
      return { status: 'failed', progress: 100 }
    case 'processing':
    case 'RUNNING':
    case 'PENDING':
      return { status: 'running', progress: 45 }
    case 'submitted':
    default:
      return { status: 'queued', progress: 5 }
  }
}

/** 从 Kling 查询响应里提取视频地址（task_result.videos[0].url） */
function extractVideoUrl(data: Record<string, unknown>): string | null {
  const taskResult = data['task_result']
  if (!taskResult || typeof taskResult !== 'object') return null
  const videos = (taskResult as Record<string, unknown>)['videos']
  if (!Array.isArray(videos) || videos.length === 0) return null
  const first = videos[0] as Record<string, unknown> | undefined
  if (first && typeof first['url'] === 'string' && first['url'] !== '') {
    return first['url']
  }
  return null
}

/**
 * 将 HTTP 状态码/错误映射为 AppError。
 */
function toAppError(status: number | undefined, message: string): AppError {
  if (status === 429) {
    return new AppError(ErrorCodes.VIDEO_RATE_LIMIT, `Kling API rate limited: ${message}`)
  }
  if (status !== undefined && status >= 400) {
    return new AppError(ErrorCodes.VIDEO_API_ERROR, `Kling API error (${status}): ${message}`)
  }
  return new AppError(ErrorCodes.VIDEO_API_ERROR, `Kling network error: ${message}`)
}