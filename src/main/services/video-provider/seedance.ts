// AgentForge Seedance 视频生成适配器（火山方舟 ARK / 即梦 Seedance 同源）
//
// 实现火山方舟「内容生成任务」(Content Generation Task) API：
//   POST {baseUrl}/api/v3/contents/generations/tasks   提交生成任务
//   GET  {baseUrl}/api/v3/contents/generations/tasks/{id}  查询任务状态
// 支持文生视频 / 图生视频-首帧 / 图生视频-首尾帧，鉴权使用 Authorization: Bearer {ARK_API_KEY}。
// 参考图本地文件会 base64 内联为 data URI（无需额外上传接口）。
//
// M5 目标：接入图生视频与首尾帧，参考图以 role=first_frame/last_frame 传入 content。

import { readFile } from 'node:fs/promises'
import type { SubmitResult, StatusResult, SubmitSpec, VideoProviderAdapter, VideoProviderConfig } from './types'
import { fetchTransport, type HttpRequestFn } from './transport'
import { AppError, ErrorCodes } from '../../utils/error'
import type { VideoImageRef, VideoProvider, VideoResolution } from '@shared/types'

/** 火山方舟 ARK API 默认基础地址 */
export const DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** Seedance 默认模型（可在设置中覆盖为自定义 endpoint） */
export const DEFAULT_SEEDANCE_MODEL = 'doubao-seedance'

/** 单张参考图大小上限（避免 base64 后请求体超限，单位 MB） */
const MAX_IMAGE_MB = 24

/** Seedance 适配器 */
export class SeedanceAdapter implements VideoProviderAdapter {
  readonly provider: VideoProvider = 'seedance'

  private readonly request: HttpRequestFn

  constructor(request: HttpRequestFn = fetchTransport) {
    this.request = request
  }

  /**
   * 提交一次视频生成任务（文生视频 / 图生视频-首帧 / 图生视频-首尾帧）。
   */
  async submit(spec: SubmitSpec, config: VideoProviderConfig): Promise<SubmitResult> {
    const url = `${trimSlash(config.baseUrl)}/contents/generations/tasks`
    const content: Array<Record<string, unknown>> = []

    // 参考图（图生视频）：1 张=首帧；多张需含 last_frame 角色
    if (spec.imageRefs && spec.imageRefs.length > 0) {
      for (const ref of spec.imageRefs) {
        content.push({
          type: 'image_url',
          image_url: { url: await readImageDataUri(ref) },
          role: ref.role,
        })
      }
    }

    // 文生提示词（图生视频场景 prompt 可选，这里始终携带用户描述）
    content.push({ type: 'text', text: spec.prompt })

    const body = {
      model: config.model,
      content,
      resolution: normalizeResolution(spec.resolution),
      ratio: spec.aspect,
      duration: spec.duration,
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

/**
 * 将统一分辨率档位映射为 ARK 接受的 `resolution` 取值。
 * ARK 接受 480p / 720p / 1080p / 4k。
 */
function normalizeResolution(resolution: VideoResolution): string {
  return {
    '480P': '480p',
    '720P': '720p',
    '1080P': '1080p',
  }[resolution]
}

/** 图片扩展名 → MIME */
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
}

/**
 * 读取本地参考图并编码为 ARK 接受的 base64 data URI。
 * 格式：data:image/<ext>;base64,<base64>。找不到文件或超限时抛 AppError。
 */
async function readImageDataUri(ref: VideoImageRef): Promise<string> {
  let buffer: Buffer
  try {
    buffer = await readFile(ref.path)
  } catch (error) {
    throw new AppError(
      ErrorCodes.VIDEO_INVALID_CONFIG,
      `Cannot read image reference file: ${ref.path} (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const sizeMb = buffer.length / (1024 * 1024)
  if (sizeMb > MAX_IMAGE_MB) {
    throw new AppError(
      ErrorCodes.VIDEO_INVALID_CONFIG,
      `Image reference too large (${sizeMb.toFixed(1)} MB > ${MAX_IMAGE_MB} MB): ${ref.path}`,
    )
  }
  const ext = ref.path.split('.').pop()?.toLowerCase() ?? ''
  const mime = IMAGE_MIME[ext]
  if (!mime) {
    throw new AppError(
      ErrorCodes.VIDEO_INVALID_CONFIG,
      `Unsupported image format for video input: ${ext || '(no extension)'} (ref: ${ref.path})`,
    )
  }
  return `data:${mime};base64,${buffer.toString('base64')}`
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