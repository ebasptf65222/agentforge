// AgentForge 视频任务引擎（M1）
//
// 职责：统一管理视频生成任务的生命周期（提交 → 轮询 → 下载落盘）：
// 1. generate(): 校验参数 → 持久化任务 → 通过厂商适配器提交 → 进入轮询
// 2. 单轮询器：一个 setInterval 轮询所有在途任务，直到到达终态
// 3. 成功后下载 download_url 到 workspace/videos 并更新本地路径
// 4. 通过 notify 回调向渲染进程推送 progress / completed / failed 事件
//
// 厂商差异由 provider 适配器封装；配置由 configProvider 注入（默认从 settings 读取）。

import { unlink, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CreateVideoSequenceParams,
  CreateVideoTaskParams,
  VideoAsyncEvent,
  VideoImageRef,
  VideoProvider,
  VideoSequence,
  VideoShot,
  VideoTask,
  VideoTaskStatus,
} from '@shared/types'
import {
  createQueuedVideoTask,
  createVideoTask,
  deleteVideoTask,
  getVideoTaskById,
  listVideoTasks,
  listVideoTasksBySequence,
  updateVideoTask,
} from '../db/repos/video-task'
import {
  createVideoSequence,
  deleteVideoSequence,
  getVideoSequenceById,
  reconcileVideoSequence,
} from '../db/repos/video-sequence'
import { getSettings } from '../db/repos/app-settings'
import { decryptApiKey } from '../utils/encryption'
import { getWorkspaceService } from './workspace-service'
import { createVideoProviderAdapter } from './video-provider'
import { DEFAULT_KLING_BASE_URL, DEFAULT_KLING_MODEL } from './video-provider/kling'
import type { VideoProviderAdapter, VideoProviderConfig } from './video-provider/types'
import { extractLastFrame } from '../utils/ffmpeg'
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

/** M10：批量操作结果（succeeded 成功项 / failed 失败明细） */
export interface VideoBatchResult<T = string> {
  succeeded: T[]
  failed: Array<{ id: string; message: string }>
}

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
   * 提交并跟踪一个视频生成任务（单镜头，M5 图生视频/首尾帧走此处）。
   */
  async generate(params: CreateVideoTaskParams): Promise<VideoTask> {
    const prompt = params.prompt.trim()
    if (!prompt) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video prompt must not be empty')
    }

    const config = this.configProvider()
    const task = await this.submitSingle(params, config, {})
    this.ensureTimer()
    return task
  }

  /**
   * 提交并跟踪一个多镜头序列（M6 并行跑批 / M8 连续性衔接）。
   * 连续性衔接（continuity=true）：镜头 i 生成后自动截取其尾帧作为镜头 i+1 的首帧，
   * 并按顺序逐个推进以形成连贯叙事。
   *
   * @returns 父序列记录与子任务列表
   */
  async generateSequence(params: CreateVideoSequenceParams): Promise<{
    sequence: VideoSequence
    tasks: VideoTask[]
  }> {
    const shots = params.shots
    if (!shots || shots.length < 2) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Video sequence requires at least 2 shots.',
      )
    }
    for (const shot of shots) {
      if (!shot.prompt.trim()) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          'Every shot in a video sequence must have a non-empty prompt.',
        )
      }
    }

    const config = this.configProvider()
    const title =
      params.title?.trim() || `${shots[0].prompt.trim().slice(0, 30)}…`
    const continuity = Boolean(params.continuity)

    // M8：连续性镜头的首帧由上一镜头尾帧衔接提供，故要求纯文生。
    if (continuity) {
      for (const shot of shots) {
        if (shot.imageRefs && shot.imageRefs.length > 0) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            'Continuity sequence shots must be text-to-video only; their first frame is auto-chained from the previous shot.',
          )
        }
      }
    }

    const sequence = createVideoSequence({
      title,
      provider: config.provider,
      totalCount: shots.length,
      continuity,
    })

    if (continuity) {
      return await this.runContinuitySequence(sequence, shots, params, config)
    }

    // M6：并行跑批（所有镜头一次性提交，统一轮询）
    const tasks: VideoTask[] = []
    for (let index = 0; index < shots.length; index++) {
      const shot = shots[index]
      const task = await this.submitSingle(
        {
          prompt: shot.prompt,
          model: params.model,
          duration: shot.duration,
          resolution: params.resolution,
          aspect: params.aspect,
          imageRefs: shot.imageRefs,
        },
        config,
        { sequenceId: sequence.id, shotIndex: index },
      )
      tasks.push(task)
    }

    this.ensureTimer()
    return { sequence, tasks }
  }

  /**
   * M8：连续性衔接序列的编排入口。
   * 所有镜头先以 queued 落库占位（shotIndex>0 记为 isChained），
   * 仅提交首镜头（纯文生）；此后每个镜头达成时由 advanceContinuity
   * 截取其尾帧并推进到下一个 queued 镜头。
   */
  private async runContinuitySequence(
    sequence: VideoSequence,
    shots: VideoShot[],
    params: CreateVideoSequenceParams,
    config: VideoProviderConfig,
  ): Promise<{ sequence: VideoSequence; tasks: VideoTask[] }> {
    const resolution = params.resolution ?? '720P'
    const aspect = params.aspect ?? '16:9'
    const tasks = shots.map((shot, index) =>
      createQueuedVideoTask({
        provider: config.provider,
        prompt: shot.prompt,
        model: config.model,
        duration: Math.max(1, Math.min(Math.round(shot.duration ?? 5), this.maxDuration)),
        resolution,
        aspect,
        sequenceId: sequence.id,
        shotIndex: index,
        isChained: index > 0,
      }),
    )
    // 提交首个（锚点）镜头：纯文生，首帧由厂商从 0 生成。
    // 先入队再启动轮询，避免空队列触发 stopTimerIfIdle 提前停表。
    const anchor = await this.submitPersisted(tasks[0], config)
    tasks[0] = anchor
    this.ensureTimer()
    return { sequence, tasks }
  }

  /** 提交单个视频任务并加入轮询队列（generate / generateSequence 共用） */
  private async submitSingle(
    params: CreateVideoTaskParams,
    config: VideoProviderConfig,
    meta: { sequenceId?: string | null; shotIndex?: number | null },
  ): Promise<VideoTask> {
    const duration = Math.max(1, Math.min(Math.round(params.duration ?? 5), this.maxDuration))
    const resolution = params.resolution ?? '720P'
    const aspect = params.aspect ?? '16:9'
    const prompt = params.prompt.trim()

    // 持久化任务（submitted）
    const task = createVideoTask({
      provider: config.provider,
      prompt,
      model: config.model,
      duration,
      resolution,
      aspect,
      sequenceId: meta.sequenceId ?? null,
      shotIndex: meta.shotIndex ?? null,
    })

    // 提交到厂商并进入轮询队列
    return this.submitPersisted(task, config, params.imageRefs)
  }

  /**
   * 将已持久化的任务提交到厂商，并加入在途轮询队列（generate / submitSingle / M8 连续性推进共用）。
   * 若成功，任务状态由 queued/submitted 更新为 submitted，进度置为 5。
   */
  private async submitPersisted(
    task: VideoTask,
    config: VideoProviderConfig,
    imageRefs?: VideoImageRef[],
  ): Promise<VideoTask> {
    const adapter = this.getAdapter(config.provider)
    const { providerTaskId } = await adapter.submit(
      {
        prompt: task.prompt,
        duration: task.duration,
        resolution: task.resolution,
        aspect: task.aspect,
        imageRefs,
      },
      config,
    )
    const updated =
      updateVideoTask(task.id, {
        providerTaskId,
        status: 'submitted',
        progress: 5,
      }) ?? task

    // 进入轮询队列
    state.active.set(task.id, updated)
    this.notify({
      type: 'progress',
      taskId: task.id,
      progress: updated.progress,
      status: updated.status,
    })

    return updated
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
      this.reconcileParentSequence(id)
      this.ensureTimer()
      return updated
    }
    return task
  }

  /**
   * 重试一个已失败/已取消的视频任务（M9 视频资源管理）。
   * 以任务内持久化的 prompt/参数重新提交为全新任务（纯文生重跑；
   * 图生视频的参考图未持久化，故重试回退为文生）。
   *
   * @returns 新建并已提交的任务记录
   */
  async retry(id: string): Promise<VideoTask> {
    const task = getVideoTaskById(id)
    if (!task) {
      throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video task not found: ${id}`)
    }
    if (!RETRYABLE_STATUSES.includes(task.status)) {
      throw new AppError(
        ErrorCodes.VIDEO_TASK_NOT_RETRYABLE,
        `Cannot retry a task in status "${task.status}". Only failed or cancelled tasks can be retried.`,
      )
    }
    const config = this.configProvider(task.provider as VideoProvider)
    const newTask = createVideoTask({
      provider: task.provider as VideoProvider,
      prompt: task.prompt,
      model: config.model,
      duration: task.duration,
      resolution: task.resolution,
      aspect: task.aspect,
    })
    const submitted = await this.submitPersisted(newTask, config)
    this.ensureTimer()
    return submitted
  }

  /**
   * 批量重试一批已失败/已取消的任务（M10）。
   * 受限并发逐个重新提交，避免集中触发厂商限流。
   *
   * @returns 成功新建的任务列表与失败项明细
   */
  async retryTasks(ids: string[]): Promise<VideoBatchResult<VideoTask>> {
    const results: VideoBatchResult<VideoTask> = { succeeded: [], failed: [] }
    await runWithConcurrency(
      Array.from(new Set(ids)),
      BATCH_RETRY_CONCURRENCY,
      async (id) => {
        try {
          results.succeeded.push(await this.retry(id))
        } catch (error) {
          results.failed.push({
            id,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    this.ensureTimer()
    return results
  }

  /**
   * 批量生成一组单视频任务（M11：CSV 造片）。
   * 复用受限并发逐个提交，个别行失败不阻断其余行。
   *
   * @param rows - 已由 parseCsvRows 校验通过的任务参数
   * @param concurrency - 并发上限，缺省用批量重试同款并发（避免集中触发厂商限流）
   * @returns 成功任务列表与失败行明细（失败项 id 为原 prompt，用于 UI 定位）
   */
  async generateRows(
    rows: CreateVideoTaskParams[],
    concurrency?: number,
  ): Promise<VideoBatchResult<VideoTask>> {
    const results: VideoBatchResult<VideoTask> = { succeeded: [], failed: [] }
    if (rows.length === 0) return results

    const config = this.configProvider()
    const limit = Math.max(1, concurrency ?? BATCH_RETRY_CONCURRENCY)
    await runWithConcurrency(rows, limit, async (params) => {
      try {
        const prompt = params.prompt.trim()
        if (!prompt) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video prompt must not be empty')
        }
        results.succeeded.push(await this.submitSingle(params, config, {}))
      } catch (error) {
        results.failed.push({
          id: params.prompt,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
    this.ensureTimer()
    return results
  }

  /** 批量取消多个进行中的多镜头序列（M10）。 */
  cancelSequences(ids: string[]): VideoBatchResult<VideoSequence> {
    const results: VideoBatchResult<VideoSequence> = { succeeded: [], failed: [] }
    for (const id of Array.from(new Set(ids))) {
      try {
        results.succeeded.push(this.cancelSequence(id))
      } catch (error) {
        results.failed.push({
          id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }

  /** 批量删除一批视频任务记录及其落盘文件（M10）。 */
  async deleteTasks(ids: string[]): Promise<VideoBatchResult<string>> {
    const results: VideoBatchResult<string> = { succeeded: [], failed: [] }
    for (const id of Array.from(new Set(ids))) {
      try {
        await this.deleteTask(id)
        results.succeeded.push(id)
      } catch (error) {
        results.failed.push({
          id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }

  /** 批量删除多个多镜头序列及其子任务与落盘文件（M10）。 */
  async deleteSequences(ids: string[]): Promise<VideoBatchResult<string>> {
    const results: VideoBatchResult<string> = { succeeded: [], failed: [] }
    for (const id of Array.from(new Set(ids))) {
      try {
        await this.deleteSequence(id)
        results.succeeded.push(id)
      } catch (error) {
        results.failed.push({
          id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }

  /** 取消一个多镜头序列的全部在途子任务（M9），并返回重算后的序列 */
  cancelSequence(sequenceId: string): VideoSequence {
    const seq = getVideoSequenceById(sequenceId)
    if (!seq) {
      throw new AppError(ErrorCodes.VIDEO_SEQUENCE_NOT_FOUND, `Video sequence not found: ${sequenceId}`)
    }
    for (const child of listVideoTasksBySequence(sequenceId)) {
      if (!isTerminal(child.status)) {
        updateVideoTask(child.id, { status: 'cancelled', progress: child.progress })
        state.active.delete(child.id)
        this.pollFailures.delete(child.id)
      }
    }
    reconcileVideoSequence(sequenceId)
    const reconciled = getVideoSequenceById(sequenceId)
    return reconciled ?? seq
  }

  /** 删除一条视频任务记录及其落盘文件（M9） */
  async deleteTask(id: string): Promise<void> {
    const task = getVideoTaskById(id)
    if (!task) {
      throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video task not found: ${id}`)
    }
    if (!isTerminal(task.status)) {
      this.cancel(id)
    }
    state.active.delete(id)
    this.pollFailures.delete(id)
    deleteVideoTask(id)
    await this.removeOutputFile(task)
    if (task.sequenceId) {
      reconcileVideoSequence(task.sequenceId)
    }
  }

  /** 删除一个多镜头序列及其全部子任务与落盘文件（M9） */
  async deleteSequence(sequenceId: string): Promise<void> {
    const seq = getVideoSequenceById(sequenceId)
    if (!seq) {
      throw new AppError(ErrorCodes.VIDEO_SEQUENCE_NOT_FOUND, `Video sequence not found: ${sequenceId}`)
    }
    const children = listVideoTasksBySequence(sequenceId)
    for (const child of children) {
      if (!isTerminal(child.status)) {
        state.active.delete(child.id)
        this.pollFailures.delete(child.id)
      }
    }
    for (const child of children) {
      await this.removeOutputFile(child)
      deleteVideoTask(child.id)
    }
    deleteVideoSequence(sequenceId)
  }

  /** 删除任务落盘视频文件（不存在视为已清理；删除失败不阻断记录删除） */
  private async removeOutputFile(task: VideoTask): Promise<void> {
    if (!task.outputPath) return
    const abs = join(getWorkspaceService().getPath(), task.outputPath)
    try {
      await unlink(abs)
    } catch {
      // 忽略：ENOENT 视为已清理，其余删除失败也不阻断
    }
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
    this.reconcileParentSequence(id)
    // M8：若处于连续性衔接序列且存在下一个排队镜头，则截取尾帧并推进
    await this.advanceContinuity(id)
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
    // M8：连续性序列中途失败 → 取消其后续仍未提交的排队镜头
    this.cancelRemainingContinuity(task)
    this.reconcileParentSequence(id)
    this.stopTimerIfIdle()
  }

  /** 若该任务是多镜头序列的子任务，则重算父序列状态 */
  private reconcileParentSequence(taskId: string): void {
    const task = getVideoTaskById(taskId)
    if (task?.sequenceId) {
      reconcileVideoSequence(task.sequenceId)
    }
  }

  /**
   * M8：当连续性序列中的镜头成功后，推进到下一个排队镜头。
   * 抽取当前镜头视频的尾帧作为下一镜头首帧，再将其提交到厂商。
   */
  private async advanceContinuity(id: string): Promise<void> {
    const task = getVideoTaskById(id)
    if (!task?.sequenceId || task.status !== 'succeeded') return
    const seq = getVideoSequenceById(task.sequenceId)
    if (!seq?.continuity) return

    const nextIndex = (task.shotIndex ?? 0) + 1
    if (nextIndex >= seq.totalCount) return
    const next = listVideoTasksBySequence(seq.id).find(
      (t) => t.shotIndex === nextIndex && t.status === 'queued',
    )
    if (!next) return

    const workspaceRoot = getWorkspaceService().getPath()
    const config = this.configProvider(seq.provider)
    try {
      if (!task.outputPath) {
        throw new AppError(
          ErrorCodes.VIDEO_FRAME_EXTRACT_ERROR,
          'Previous shot has no output to chain from.',
        )
      }
      const frameDir = join(workspaceRoot, 'videos', 'chain', seq.id)
      const framePath = await extractLastFrame(
        join(workspaceRoot, task.outputPath),
        frameDir,
        nextIndex,
      )
      await this.submitPersisted(next, config, [{ path: framePath, role: 'first_frame' }])
    } catch (error) {
      await this.handleTerminal(
        next.id,
        next,
        'failed',
        ErrorCodes.VIDEO_FRAME_EXTRACT_ERROR,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * M8：连续性序列在某个镜头失败/被取消时，把其下标之后仍未提交的排队镜头一并标记为 cancelled，
   * 避免序列停留在永久的 queued 状态。
   */
  private cancelRemainingContinuity(task: VideoTask): void {
    if (!task.sequenceId || task.status === 'succeeded') return
    const seq = getVideoSequenceById(task.sequenceId)
    if (!seq?.continuity) return
    const failedIndex = task.shotIndex ?? 0
    for (const sib of listVideoTasksBySequence(seq.id)) {
      if ((sib.shotIndex ?? 0) > failedIndex && sib.status === 'queued') {
        updateVideoTask(sib.id, { status: 'cancelled', progress: sib.progress })
      }
    }
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

/** M9：可重试的任务状态 */
const RETRYABLE_STATUSES: VideoTaskStatus[] = ['failed', 'cancelled']

/** M10：批量重试的并发上限（避免集中提交触发厂商限流） */
const BATCH_RETRY_CONCURRENCY = 2

/**
 * 受限并发执行异步任务（M10）：最多同时运行 limit 个 worker，
 * 逐项消费，任一失败不影响其他项执行。
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
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