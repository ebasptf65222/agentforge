// AgentForge OpenAI Videos 兼容视频生成适配器
//
// 对接 OpenAI Videos 风格的异步视频 API（典型服务：Agnes Video 2.5 / 2.5 Flash）：
//   POST {baseUrl}/videos          提交生成任务（baseUrl 需包含 /v1）
//   GET  {baseUrl}/videos/{id}     查询任务状态（OpenAI 标准方式）
// Agnes 扩展差异（以官方文档为准）：
//   - 推荐轮询 GET {origin}/agnesapi?video_id=<VIDEO_ID>&model_name=<model>（origin 为去掉 /v1 的根地址），
//     优先使用，404 时回退 OpenAI 标准查询。
//   - 请求体扩展 mode（text/keyframe/reference）、first_frame/last_frame、aspect_ratio。
//   - size 使用档位字符串（"720P"/"960P"/"2K"），不接受像素尺寸；Flash 版仅支持 "720P"。
//   - seconds 为字符串 "4"–"12"；响应中 video_id 用于查询，metadata.url 为下载地址。
// 鉴权使用 Authorization: Bearer {API_KEY}，与 ARK 一致的传输层。

import type {
  SubmitResult,
  StatusResult,
  SubmitSpec,
  VideoProviderAdapter,
  VideoProviderConfig,
} from './types'
import { fetchTransport, type HttpRequestFn } from './transport'
import { AppError, ErrorCodes } from '../../utils/error'
import { readImageDataUri } from './seedance'
import type { VideoProvider, VideoResolution } from '@shared/types'

/** Agnes AI 中国站默认基础地址（OpenAI Videos 兼容入口） */
export const DEFAULT_OPENAI_VIDEO_BASE_URL = 'https://api.agnes-ai.cn/v1'

/** OpenAI Videos 适配器 */
export class OpenAIVideoAdapter implements VideoProviderAdapter {
  readonly provider: VideoProvider = 'custom'

  private readonly request: HttpRequestFn

  constructor(request: HttpRequestFn = fetchTransport) {
    this.request = request
  }

  /**
   * 提交一次视频生成任务（文生视频 / 首尾帧控制）。
   * AgentForge 的参考图角色只有 first_frame/last_frame，因此映射为 keyframe 模式。
   */
  async submit(spec: SubmitSpec, config: VideoProviderConfig): Promise<SubmitResult> {
    const url = `${trimSlash(config.baseUrl)}/videos`
    const refs = spec.imageRefs ?? []

    const body: Record<string, unknown> = {
      model: config.model,
      prompt: spec.prompt,
      mode: refs.length > 0 ? 'keyframe' : 'text',
      seconds: normalizeSeconds(spec.duration),
      size: normalizeResolution(spec.resolution, config.model),
      aspect_ratio: spec.aspect,
    }
    for (const ref of refs) {
      body[ref.role] = await readImageDataUri(ref)
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
    // Agnes：video_id 用于查询；标准 OpenAI 只回 id
    const id = data['video_id'] ?? data['id']
    if (typeof id !== 'string' || id.length === 0) {
      throw new AppError(
        ErrorCodes.VIDEO_API_ERROR,
        'OpenAI Videos submit response missing video id',
        { data: res.data },
      )
    }
    return { providerTaskId: id }
  }

  /**
   * 查询任务状态并映射为统一状态机。
   * 优先走 Agnes 推荐的 /agnesapi?video_id=&model_name= 查询；404 时回退 OpenAI 标准 GET /videos/{id}。
   */
  async status(providerTaskId: string, config: VideoProviderConfig): Promise<StatusResult> {
    const headers = this.buildHeaders(config)
    const agnesUrl = buildAgnesPollUrl(providerTaskId, config)

    let data: Record<string, unknown>
    try {
      const res = await this.request({ url: agnesUrl, method: 'GET', headers })
      data = ensureObject(res.data)
    } catch (error) {
      // 非 Agnes 网关（标准 OpenAI Videos 兼容服务）没有 /agnesapi 端点，回退标准查询
      const status = (error as { status?: number }).status
      if (status !== 404) {
        const err = error instanceof Error ? error : new Error(String(error))
        throw toAppError(status, err.message)
      }
      const url = `${trimSlash(config.baseUrl)}/videos/${encodeURIComponent(providerTaskId)}`
      const res = await this.requestJson(() => this.request({ url, method: 'GET', headers }))
      data = ensureObject(res.data)
    }

    return mapStatus(data)
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
    throw new AppError(ErrorCodes.VIDEO_API_ERROR, 'OpenAI Videos response is not an object')
  }
  return value as Record<string, unknown>
}

/**
 * 将统一分辨率档位映射为 Agnes 的 size 档位。
 * Agnes Video 2.5 接受 "720P" / "960P" / "2K"，1080P 就近映射为 2K；
 * Flash 版（如 agnes-video-2.5-flash）仅支持 "720P"，其他值会被 HTTP 400
 * （"size must be 720P"）拒绝，因此 Flash 模型一律固定 720P（输出画幅由 aspect_ratio 决定）。
 */
function normalizeResolution(resolution: VideoResolution, model: string): string {
  if (isFlashModel(model)) return '720P'
  return resolution === '1080P' ? '2K' : '720P'
}

/** Flash 版 Agnes 视频模型仅支持 720P 档位 */
function isFlashModel(model: string): boolean {
  return /flash/i.test(model)
}

/**
 * Agnes 的 seconds 为字符串且仅接受 "4"–"12"，超出范围会被 HTTP 400 拒绝，
 * 此处钳制到合法区间（应用内时长上限 UI 允许到 15 秒）。
 */
function normalizeSeconds(duration: number): string {
  return String(Math.min(12, Math.max(4, Math.round(duration))))
}

/** 构造 Agnes 推荐轮询地址：{origin}/agnesapi?video_id=&model_name=（origin 为去掉 /v1 的根地址） */
function buildAgnesPollUrl(providerTaskId: string, config: VideoProviderConfig): string {
  const origin = trimSlash(config.baseUrl).replace(/\/v1$/i, '')
  const params = new URLSearchParams({ video_id: providerTaskId, model_name: config.model })
  return `${origin}/agnesapi?${params.toString()}`
}

/**
 * 将任务响应映射为统一状态机。
 * OpenAI Videos 状态：queued / in_progress / completed / failed。
 */
function mapStatus(data: Record<string, unknown>): StatusResult {
  const raw = data['status']
  const rawProgress = typeof data['progress'] === 'number' ? data['progress'] : undefined

  if (raw === 'completed') {
    return { status: 'succeeded', progress: 100, downloadUrl: extractDownloadUrl(data) }
  }
  if (raw === 'failed') {
    const error = data['error']
    const message =
      error && typeof error === 'object' ? String((error as Record<string, unknown>)['message'] ?? '') : undefined
    return { status: 'failed', progress: 100, downloadUrl: null, errorMessage: message || undefined }
  }
  if (raw === 'in_progress') {
    return { status: 'running', progress: rawProgress ?? 45, downloadUrl: null }
  }
  // queued 及未知状态
  return { status: 'queued', progress: rawProgress ?? 5, downloadUrl: null }
}

/** 从完成响应里提取视频地址（metadata.url） */
function extractDownloadUrl(data: Record<string, unknown>): string | null {
  const metadata = data['metadata']
  if (!metadata || typeof metadata !== 'object') return null
  const url = (metadata as Record<string, unknown>)['url']
  return typeof url === 'string' && url !== '' ? url : null
}

/**
 * 将 HTTP 状态码/错误映射为 AppError。
 */
function toAppError(status: number | undefined, message: string): AppError {
  if (status === 429) {
    return new AppError(ErrorCodes.VIDEO_RATE_LIMIT, `OpenAI Videos API rate limited: ${message}`)
  }
  if (status !== undefined && status >= 400) {
    return new AppError(ErrorCodes.VIDEO_API_ERROR, `OpenAI Videos API error (${status}): ${message}`)
  }
  return new AppError(ErrorCodes.VIDEO_API_ERROR, `OpenAI Videos network error: ${message}`)
}
