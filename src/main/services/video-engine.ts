// AgentForge 视频任务引擎（M1）
//
// 职责：统一管理视频生成任务的生命周期（提交 → 轮询 → 下载落盘）：
// 1. generate(): 校验参数 → 持久化任务 → 通过厂商适配器提交 → 进入轮询
// 2. 单轮询器：一个 setInterval 轮询所有在途任务，直到到达终态
// 3. 成功后下载 download_url 到 workspace/videos 并更新本地路径
// 4. 通过 notify 回调向渲染进程推送 progress / completed / failed 事件
//
// 厂商差异由 provider 适配器封装；配置由 configProvider 注入（默认从 settings 读取）。

import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CreateVideoTaskParams,
  VideoAsyncEvent,
  VideoProvider,
  VideoTask,
  VideoTaskStatus,
} from '@shared/types'
import {
  createVideoTask,
  getVideoTaskById,
  listVideoTasks,
  updateVideoTask,
} from '../db/repos/video-task'
import { getSettings } from '../db/repos/app-settings'
import { decryptApiKey } from '../utils/encryption'
import { getWorkspaceService } from './workspace-service'
import { createVideoProviderAdapter } from './video-provider'
import { DEFAULT_KLING_BASE_URL, DEFAULT_KLING_MODEL } from './video-provider/kling'
import type { VideoProviderAdapter, VideoProviderConfig } from './video-provider/types'
import { AppError, ErrorCodes } from '../utils/error'

/** 默认轮询间隔（毫秒） */
const DEFAULT_POLL_INTERVAL_MS = 15_000
/** 连续状态查询失败阈值，超过后任务判失败 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3

/** 读取视频运行时配置（含 API Key 解密的处理函数） */
export type VideoConfigProvider = (provider?: VideoProvider) => VideoProviderConfig
/** 进度/结果事件推送函数 */
export type VideoEventEmitter = (event: VideoAsyncEvent) => void
/** 下载函数（可注入以便测试） */
export type VideoDownloadFn = (url: string, outputAbsolutePath: string) => Promise<void>

interface EngineState {
  /** 在途任务（未到达终态） */
  active: Map<string, VideoTask>
  timer: NodeJS.Timeout | null
  initialized: false
}

const state: EngineState = {
  active: new Map(),
  timer: null,
  initialized: false,
}

/**
 * 默认事件推送：向主窗口发送 video:event。
 */
const defaultNotify: VideoEventEmitter = (event) => {
  try {
    // 动态导入避免循环依赖
    void import('../utils/electron-helpers').then(({ getMainWindowWebContents }) => {
      const wc = getMainWindowWebContents()
      if (wc) {
        wc.send('video:event', event)
      }
    })
  } catch {
    // 忽略推送失败
  }
}

/**
 * 从应用设置读取并构建指定厂商的视频运行时配置。
 * 视频 API Key 在 settings 中为 safeStorage 加密存储，此处解密。
 *
 * @param provider - 目标厂商；缺省时使用设置中的默认厂商（videoProvider）。
 */
export function loadVideoConfig(provider?: VideoProvider): VideoProviderConfig {
  const settings = getSettings()
  const active: VideoProvider = provider ?? settings.videoProvider ?? 'seedance'

  let apiKeyEnc: string | undefined
  let baseUrl: string
  let model: string
  let providerLabel: string
  if (active === 'kling') {
    apiKeyEnc = settings.videoKlingApiKey
    baseUrl = settings.videoKlingBaseUrl?.trim() || DEFAULT_KLING_BASE_URL
    model = settings.videoKlingModel?.trim() || DEFAULT_KLING_MODEL
    providerLabel = 'Kling'
  } else {
    apiKeyEnc = settings.videoApiKey
    baseUrl = settings.videoBaseUrl?.trim() || 'https://ark.cn-beijing.volces.com/api/v3'
    model = settings.videoModel?.trim() || 'doubao-seedance'
    providerLabel = 'Seedance'
  }

  if (!apiKeyEnc) {
    throw new AppError(
      ErrorCodes.VIDEO_INVALID_CONFIG,
      `Video generation is not configured. Set a ${providerLabel} API key in Settings.`,
    )
  }
  let apiKey: string
  try {
    apiKey = decryptApiKey(apiKeyEnc)
  } catch (error) {
    throw new AppError(
      ErrorCodes.VIDEO_INVALID_CONFIG,
      `Failed to decrypt video API key: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return { provider: active, apiKey, baseUrl, model }
}

/**
 * 视频任务引擎单例。
 */
export class VideoEngine {
  private readonly adapters = new Map<VideoProvider, VideoProviderAdapter>()
  private readonly adapterFactory: (provider: VideoProvider) => VideoProviderAdapter
  private readonly configProvider: VideoConfigProvider
  private readonly notify: VideoEventEmitter
  private readonly download: VideoDownloadFn
  private readonly maxDuration: number
  private readonly maxPollFailures: number
  private pollFailures: Map<string, number>
  private pollIntervalMs: number

  constructor(options?: {
    adapterFactory?: (provider: VideoProvider) => VideoProviderAdapter
    configProvider?: VideoConfigProvider
    notify?: VideoEventEmitter
    download?: VideoDownloadFn
    pollIntervalMs?: number
    maxDuration?: number
  }) {
    this.adapterFactory =
      options?.adapterFactory ?? ((provider) => createVideoProviderAdapter(provider))
    this.configProvider = options?.configProvider ?? (() => this.loadRuntimeConfig())
    this.notify = options?.notify ?? defaultNotify
    this.download = options?.download ?? defaultDownload
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.maxDuration = options?.maxDuration ?? 10
    this.maxPollFailures = options?.maxPollFailures ?? MAX_CONSECUTIVE_POLL_FAILURES
    this.pollFailures = new Map()
  }

  private loadRuntimeConfig(provider?: VideoProvider): VideoProviderConfig {
    return loadVideoConfig(provider)
  }

  private getAdapter(provider: VideoProvider): VideoProviderAdapter {
    let adapter = this.adapters.get(provider)
    if (!adapter) {
      adapter = this.adapterFactory(provider)
      this.adapters.set(provider, adapter)
    }
    return adapter
  }

  /**
   * 提交并跟踪一个视频生成任务。
   */
  async generate(params: CreateVideoTaskParams): Promise<VideoTask> {
    const duration = Math.max(1, Math.min(Math.round(params.duration ?? 5), this.maxDuration))
    const resolution = params.resolution ?? '720P'
    const aspect = params.aspect ?? '16:9'
    const prompt = params.prompt.trim()
    if (!prompt) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video prompt must not be empty')
    }

    const config = this.configProvider()
    const adapter = this.getAdapter(config.provider)

    // 1. 持久化任务（submitted）
    let task = createVideoTask({
      provider: config.provider,
      prompt,
      model: config.model,
      duration,
      resolution,
      aspect,
    })

    // 2. 提交到厂商
    const { providerTaskId } = await adapter.submit(
      { prompt, duration, resolution, aspect },
      config,
    )
    task = updateVideoTask(task.id, {
      providerTaskId,
      status: 'submitted',
      progress: 5,
    }) ?? task

    // 3. 进入轮询队列
    state.active.set(task.id, task)
    this.ensureTimer()

    this.notify({ type: 'progress', taskId: task.id, progress: task.progress, status: task.status })

    return task
  }

  /**
   * 获取单个任务。
   */
  get(id: string): VideoTask | null {
    return getVideoTaskById(id)
  }

  /**
   * 获取任务列表（倒序）。
   */
  list(limit?: number): VideoTask[] {
    return listVideoTasks(limit)
  }

  /**
   * 取消本地在途任务（停止轮询并置为 cancelled）。
   * 注意：厂商侧任务仍可能继续生成，M4 补取消 API。
   */
  cancel(id: string): VideoTask | null {
    const task = getVideoTaskById(id)
    if (!task) {
      throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video task not found: ${id}`)
    }
    if (!isTerminal(task.status)) {
      const updated =
        updateVideoTask(id, { status: 'cancelled', progress: task.progress }) ?? task
      state.active.delete(id)
      this.pollFailures.delete(id)
      this.ensureTimer()
      return updated
    }
    return task
  }

  /** 关闭引擎（释放定时器） */
  shutdown(): void {
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
    state.active.clear()
  }

  // ─── 轮询 ─────────────────────────────────────────────────────

  private ensureTimer(): void {
    if (state.timer) return
    state.timer = setInterval(() => this.pollTick().catch((e) => console.error('[Video] poll error', e)), this.pollIntervalMs)
    state.timer.unref?.()
  }

  private async pollTick(): Promise<void> {
    if (state.active.size === 0) {
      this.stopTimerIfIdle()
      return
    }
    const ids = Array.from(state.active.keys())
    for (const id of ids) {
      const task = state.active.get(id)
      if (!task || !task.providerTaskId) continue
      await this.pollOnce(id, task)
    }
    this.stopTimerIfIdle()
  }

  private async pollOnce(id: string, task: VideoTask): Promise<void> {
    const providerTaskId = task.providerTaskId as string
    const config = this.configProvider(task.provider)
    try {
      const result = await this.getAdapter(task.provider).status(providerTaskId, config)
      this.pollFailures.delete(id)

      if (result.status === 'succeeded') {
        await this.handleSucceeded(id, task, result.downloadUrl)
      } else if (result.status === 'failed') {
        await this.handleTerminal(id, task, 'failed', result.errorCode ?? null, result.errorMessage ?? null)
      } else if (result.status === 'cancelled') {
        await this.handleTerminal(id, task, 'cancelled', null, null)
      } else {
        const updated =
          updateVideoTask(id, {
            status: result.status as VideoTaskStatus,
            progress: Math.max(task.progress, result.progress),
          }) ?? task
        state.active.set(id, updated)
        this.notify({
          type: 'progress',
          taskId: id,
          progress: updated.progress,
          status: updated.status,
        })
      }
    } catch (error) {
      const failures = (this.pollFailures.get(id) ?? 0) + 1
      this.pollFailures.set(id, failures)
      if (failures >= this.maxPollFailures) {
        await this.handleTerminal(
          id,
          task,
          'failed',
          ErrorCodes.VIDEO_API_ERROR,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  private async handleSucceeded(id: string, task: VideoTask, downloadUrl: string | null): Promise<void> {
    let outputPath: string | null = null
    try {
      if (downloadUrl) {
        const { relPath, absPath } = this.resolveOutputPaths(id, task.provider)
        await this.download(downloadUrl, absPath)
        outputPath = relPath
      }
    } catch (error) {
      // 下载失败也视为整体失败
      await this.handleTerminal(
        id,
        task,
        'failed',
        ErrorCodes.VIDEO_DOWNLOAD_ERROR,
        error instanceof Error ? error.message : String(error),
      )
      return
    }

    updateVideoTask(id, {
      status: 'succeeded',
      progress: 100,
      downloadUrl,
      outputPath,
    })
    state.active.delete(id)
    this.pollFailures.delete(id)
    this.notify({ type: 'completed', taskId: id, outputPath: outputPath ?? '' })
    this.stopTimerIfIdle()
  }

  private async handleTerminal(
    id: string,
    task: VideoTask,
    status: 'failed' | 'cancelled',
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    updateVideoTask(id, { status, progress: task.progress, errorCode, errorMessage })
    state.active.delete(id)
    this.pollFailures.delete(id)
    if (status === 'failed') {
      this.notify({
        type: 'failed',
        taskId: id,
        message: errorMessage ?? errorCode ?? 'Video generation failed',
      })
    }
    this.stopTimerIfIdle()
  }

  /** 计算视频落盘的相对/绝对路径（workspace/videos/{provider}-{taskId}.mp4） */
  private resolveOutputPaths(
    taskId: string,
    provider: VideoProvider,
  ): { relPath: string; absPath: string } {
    const workspaceRoot = getWorkspaceService().getPath()
    const relPath = join('videos', `${provider}-${taskId}.mp4`)
    return { relPath, absPath: join(workspaceRoot, relPath) }
  }

  private stopTimerIfIdle(): void {
    if (state.active.size === 0 && state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
  }
}

/** 默认下载实现 */
async function defaultDownload(url: string, outputAbsolutePath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new AppError(ErrorCodes.VIDEO_DOWNLOAD_ERROR, `Download failed: HTTP ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  await mkdir(join(outputAbsolutePath, '..'), { recursive: true })
  await writeFile(outputAbsolutePath, buffer)
}

function isTerminal(status: VideoTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

// ─── 单例 ──────────────────────────────────────────────────────

let instance: VideoEngine | null = null

/**
 * 获取视频任务引擎单例。
 */
export function getVideoEngine(): VideoEngine {
  if (!instance) {
    instance = new VideoEngine()
  }
  return instance
}

/**
 * 重置引擎单例（仅供测试使用）。
 */
export function resetVideoEngine(): void {
  if (instance) {
    instance.shutdown()
  }
  instance = null
}