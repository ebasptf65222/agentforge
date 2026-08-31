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
  VideoQueueItem,
  VideoQueueSnapshot,
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
  listQueuedVideoTasks,
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
import { normalizeCustomProtocol } from './video-provider/custom'
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

/** M13：队列并发上限的取值范围与缺省值 */
export const QUEUE_CONCURRENCY_MIN = 1
export const QUEUE_CONCURRENCY_MAX = 10
export const QUEUE_CONCURRENCY_DEFAULT = 2

/** M13：队列中的一项（任务 id + 提交时需透传的参考图） */
interface QueueEntry {
  taskId: string
  imageRefs?: VideoImageRef[]
}

interface EngineState {
  /** 在途任务（未到达终态） */
  active: Map<string, VideoTask>
  timer: NodeJS.Timeout | null
  initialized: false
  /** M13：待提交队列（FIFO），任务以 queued 状态落库后在此排队 */
  queue: QueueEntry[]
  /** M13：是否暂停出队 */
  paused: boolean
  /** M13：同时在途任务上限 */
  maxConcurrent: number
  /** M13：是否已执行过重启恢复（遗留 queued 任务回队） */
  recovered: boolean
}

const state: EngineState = {
  active: new Map(),
  timer: null,
  initialized: false,
  queue: [],
  paused: false,
  maxConcurrent: QUEUE_CONCURRENCY_DEFAULT,
  recovered: false,
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
  let protocol: 'ark' | 'kling' | 'openai' | undefined
  if (active === 'kling') {
    apiKeyEnc = settings.videoKlingApiKey
    baseUrl = settings.videoKlingBaseUrl?.trim() || DEFAULT_KLING_BASE_URL
    model = settings.videoKlingModel?.trim() || DEFAULT_KLING_MODEL
    providerLabel = 'Kling'
  } else if (active === 'custom') {
    apiKeyEnc = settings.videoCustomApiKey
    baseUrl = settings.videoCustomBaseUrl?.trim() || ''
    model = settings.videoCustomModel?.trim() || ''
    protocol = normalizeCustomProtocol(settings.videoCustomProtocol)
    providerLabel = '自定义厂商'
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
  if (active === 'custom' && (!baseUrl || !model)) {
    throw new AppError(
      ErrorCodes.VIDEO_INVALID_CONFIG,
      'Custom video provider requires both Base URL and model in Settings.',
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
  return { provider: active, apiKey, baseUrl, model, protocol }
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
  /** M13：出队循环进行中标记（runPump 同步维护） */
  private pumping = false
  /** M13：进行中的 pump Promise（重入时共享，保证 await pump 能等到本轮出队完成） */
  private pumpPromise: Promise<void> | null = null

  constructor(options?: {
    adapterFactory?: (provider: VideoProvider) => VideoProviderAdapter
    configProvider?: VideoConfigProvider
    notify?: VideoEventEmitter
    download?: VideoDownloadFn
    pollIntervalMs?: number
    maxDuration?: number
    maxConcurrent?: number
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
    if (options?.maxConcurrent !== undefined) {
      state.maxConcurrent = clampConcurrency(options.maxConcurrent)
    }
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
   * M13 队列化：任务先以 queued 入队，由 pump 按并发上限出队提交；
   * 返回时若未暂停且并发槽位充足则已提交（submitted）。
   */
  async generate(params: CreateVideoTaskParams): Promise<VideoTask> {
    const prompt = params.prompt.trim()
    if (!prompt) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video prompt must not be empty')
    }

    const task = this.enqueueSingle(params, {}, undefined)
    this.ensureTimer()
    await this.pump()
    return getVideoTaskById(task.id) ?? task
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

    // M6：并行跑批（M13 队列化：镜头任务入队，由队列按并发上限提交）
    const tasks: VideoTask[] = []
    for (let index = 0; index < shots.length; index++) {
      const shot = shots[index]
      const task = this.enqueueSingle(
        {
          prompt: shot.prompt,
          model: params.model,
          duration: shot.duration,
          resolution: params.resolution,
          aspect: params.aspect,
          imageRefs: shot.imageRefs,
        },
        { sequenceId: sequence.id, shotIndex: index },
        config.provider,
      )
      tasks.push(task)
    }

    this.ensureTimer()
    await this.pump()
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

  /**
   * 将单任务参数落库为 queued 并加入提交队列（M13 队列化）。
   * model 由当前厂商配置解析后随任务持久化，实际提交由 pump 完成。
   */
  private enqueueSingle(
    params: CreateVideoTaskParams,
    meta: { sequenceId?: string | null; shotIndex?: number | null },
    provider?: VideoProvider,
    imageRefs?: VideoImageRef[],
  ): VideoTask {
    const config = this.configProvider(provider)
    const duration = Math.max(1, Math.min(Math.round(params.duration ?? 5), this.maxDuration))
    const resolution = params.resolution ?? '720P'
    const aspect = params.aspect ?? '16:9'
    const prompt = params.prompt.trim()

    // 持久化任务（queued），进入 FIFO 提交队列
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
    state.queue.push({
      taskId: task.id,
      imageRefs: params.imageRefs ?? imageRefs,
    })
    return task
  }

  /**
   * M13：按并发上限从队列出队提交任务。
   * 暂停中直接返回；已在出队时共享同一 Promise（保证 await 能等到本轮出队完成）。
   * 提交失败的任务标记为 failed，不阻断其余任务。
   */
  private pump(): Promise<void> {
    if (state.paused) return Promise.resolve()
    if (this.pumping && this.pumpPromise) return this.pumpPromise
    this.pumping = true
    this.pumpPromise = this.runPump()
      .catch(() => undefined)
      .finally(() => {
        this.pumpPromise = null
      })
    return this.pumpPromise
  }

  private async runPump(): Promise<void> {
    try {
      while (!state.paused && state.queue.length > 0 && state.active.size < state.maxConcurrent) {
        const entry = state.queue.shift()
        if (!entry) break
        const task = getVideoTaskById(entry.taskId)
        // 队列中的任务可能已被删除或取消，跳过失效项
        if (!task || task.status !== 'queued') continue
        try {
          const config = this.configProvider(task.provider as VideoProvider)
          await this.submitPersisted(task, config, entry.imageRefs)
        } catch (error) {
          await this.handleTerminal(
            task.id,
            task,
            'failed',
            ErrorCodes.VIDEO_API_ERROR,
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    } finally {
      // 同步结束标记：循环退出后立刻允许下一次 pump 启动，
      // 避免 pumpPromise 尚未清理时新的出队请求被旧 Promise 吞掉
      this.pumping = false
    }
  }

  // ─── M13：队列控制 ────────────────────────────────────────────

  /** 重启恢复：把 DB 中遗留的普通 queued 任务（非衔接镜头）回队并尝试推进 */
  private ensureQueueRecovered(): void {
    if (state.recovered) return
    state.recovered = true
    try {
      for (const task of listQueuedVideoTasks()) {
        const exists = state.queue.some((entry) => entry.taskId === task.id)
        if (!exists && !state.active.has(task.id)) {
          state.queue.push({ taskId: task.id })
        }
      }
    } catch {
      // DB 不可用时忽略恢复，队列照常接收新任务
    }
    if (state.queue.length > 0 && !state.paused) {
      // 微任务中再启动出队：保证本次快照能先返回排队明细
      queueMicrotask(() => {
        if (!state.paused) void this.pump()
      })
    }
  }

  /** 暂停出队：排队任务保持 queued，已提交厂商的任务继续轮询 */
  pauseQueue(): VideoQueueSnapshot {
    this.ensureQueueRecovered()
    state.paused = true
    return this.getQueueSnapshot()
  }

  /** 恢复出队并立即尝试推进 */
  resumeQueue(): VideoQueueSnapshot {
    this.ensureQueueRecovered()
    state.paused = false
    void this.pump()
    return this.getQueueSnapshot()
  }

  /** 调节并发上限（1–10），只影响后续出队，不中断在途任务 */
  setQueueConcurrency(limit: number): VideoQueueSnapshot {
    state.maxConcurrent = clampConcurrency(limit)
    void this.pump()
    return this.getQueueSnapshot()
  }

  /** 获取队列快照（排队任务按出队顺序带位置） */
  getQueueSnapshot(): VideoQueueSnapshot {
    this.ensureQueueRecovered()
    const items: VideoQueueItem[] = []
    let position = 0
    for (const entry of state.queue) {
      const task = getVideoTaskById(entry.taskId)
      if (!task || task.status !== 'queued') continue
      position += 1
      items.push({ task, position })
    }
    return {
      paused: state.paused,
      maxConcurrent: state.maxConcurrent,
      activeCount: state.active.size,
      items,
    }
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
      state.queue = state.queue.filter((entry) => entry.taskId !== id)
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
    // M13 队列化：重试任务入队，由队列按并发上限提交
    state.queue.push({ taskId: newTask.id })
    this.ensureTimer()
    await this.pump()
    return getVideoTaskById(newTask.id) ?? newTask
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
   * M13 队列化：全部行入队后由队列按并发上限提交；可临时提升本批并发。
   * 提交即失败（厂商拒绝）的行计入 failed，其余（含仍在排队的行）计入 succeeded。
   *
   * @param rows - 已由 parseCsvRows 校验通过的任务参数
   * @param concurrency - 本批出队并发上限（临时生效，缺省沿用队列当前上限）
   * @returns 成功入队任务列表与失败行明细（失败项 id 为原 prompt，用于 UI 定位）
   */
  async generateRows(
    rows: CreateVideoTaskParams[],
    concurrency?: number,
  ): Promise<VideoBatchResult<VideoTask>> {
    const results: VideoBatchResult<VideoTask> = { succeeded: [], failed: [] }
    if (rows.length === 0) return results

    // 早期校验默认厂商配置（缺 Key 等无效配置直接抛给调用方）
    const config = this.configProvider()
    const enqueued: VideoTask[] = []
    for (const params of rows) {
      try {
        const prompt = params.prompt.trim()
        if (!prompt) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video prompt must not be empty')
        }
        enqueued.push(this.enqueueSingle(params, {}, config.provider))
      } catch (error) {
        results.failed.push({
          id: params.prompt,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.ensureTimer()

    // 本批临时提升并发上限，出队完成后恢复
    const prevLimit = state.maxConcurrent
    if (concurrency !== undefined) {
      state.maxConcurrent = clampConcurrency(concurrency)
    }
    try {
      await this.pump()
    } finally {
      state.maxConcurrent = prevLimit
    }

    // 重新分类：提交即失败 → failed；仍在排队/已提交 → succeeded
    for (const task of enqueued) {
      const fresh = getVideoTaskById(task.id)
      if (!fresh) continue
      if (fresh.status === 'failed' && !fresh.providerTaskId) {
        results.failed.push({
          id: fresh.prompt,
          message: fresh.errorMessage ?? 'Video generation failed',
        })
      } else {
        results.succeeded.push(fresh)
      }
    }
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
    state.queue = state.queue.filter((entry) => entry.taskId !== id)
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

  /** 关闭引擎（释放定时器与队列状态） */
  shutdown(): void {
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
    state.active.clear()
    state.queue = []
    state.paused = false
    state.recovered = false
    this.pumping = false
    this.pumpPromise = null
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
    // M13：终态释放并发槽位，继续推进队列
    void this.pump()
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
    // M13：终态释放并发槽位，继续推进队列
    void this.pump()
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

/** M13：并发上限钳制（1–10） */
function clampConcurrency(limit: number): number {
  const value = Math.round(limit)
  if (!Number.isFinite(value)) return QUEUE_CONCURRENCY_DEFAULT
  return Math.max(QUEUE_CONCURRENCY_MIN, Math.min(value, QUEUE_CONCURRENCY_MAX))
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