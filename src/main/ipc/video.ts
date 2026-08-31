// AgentForge 视频生成域 IPC Handlers
// 通道命名: video:generate / video:status / video:list / video:cancel
// 渲染进程通过预加载暴露的 API 调用，实际逻辑委托给视频任务引擎。

import { readFile, writeFile } from 'node:fs/promises'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import type {
  CreateVideoTaskParams,
  VideoAspect,
  VideoConfigView,
  VideoExportAssetsResult,
  VideoProvider,
  VideoResolution,
  VideoSequence,
  VideoSequenceDetail,
  VideoStatsExportResult,
  VideoStatsOverview,
  VideoQueueSnapshot,
  VideoTask,
  VideoTrashPurgeResult,
  VideoTrashSnapshot,
  VideoRoutingConfig,
  VideoRoutingLogEntry,
  VideoSchedule,
  VideoScheduleRun,
  CreateVideoScheduleParams,
  UpdateVideoScheduleParams,
  VideoTemplate,
  CreateVideoTemplateParams,
  UpdateVideoTemplateParams,
  VideoPostprocessResult,
  VideoBillingOverview,
} from '@shared/types'
import {
  getVideoEngine,
  loadVideoConfig,
  type VideoBatchResult,
} from '../services/video-engine'
import { normalizeRoutingConfig } from '../services/video-router'
import { updateSettings } from '../db/repos/app-settings'
import { parseCsvRows, type CsvParseResult } from '../services/csv-batch'
import { aggregateVideoStats, buildStatsCsv } from '../services/video-stats'
import { aggregateVideoBilling } from '../services/video-billing'
import {
  getVideoScheduleService,
} from '../services/video-schedule-service'
import { getVideoTemplateService } from '../services/video-template'
import {
  postprocessSubtitle,
  postprocessWatermark,
  postprocessConcat,
  postprocessRename,
  postprocessArchive,
} from '../services/video-postprocess'
import { listVideoPostprocessRuns } from '../db/repos/video-postprocess'
import { AppError, ErrorCodes } from '../utils/error'
import { getVideoSequenceById, listVideoSequences } from '../db/repos/video-sequence'
import { listVideoTasksBySequence, updateVideoTask } from '../db/repos/video-task'
import { DEFAULT_ARK_BASE_URL } from '../services/video-provider/seedance'
import { DEFAULT_KLING_BASE_URL, DEFAULT_KLING_MODEL } from '../services/video-provider/kling'
import {
  createValidatedHandler,
  validateEnum,
  validateNonEmptyString,
  validateOptionalBoolean,
  validateOptionalEnum,
  validateOptionalNumber,
  validateOptionalString,
  validateOptionalStringArray,
  validateStringArray,
} from '../utils/ipc-validator'

// ─── 处理函数（委托给引擎） ───────────────────────────────────

/**
 * 提交一个视频生成任务。
 */
export async function handleVideoGenerate(params: CreateVideoTaskParams): Promise<VideoTask> {
  return getVideoEngine().generate(params)
}

/**
 * 查询任务状态。
 */
export async function handleVideoStatus(id: string): Promise<VideoTask | null> {
  return getVideoEngine().get(id)
}

/**
 * 获取视频任务列表。
 */
export async function handleVideoList(limit?: number): Promise<VideoTask[]> {
  return getVideoEngine().list(limit)
}

/**
 * 取消在途任务（本地标记 + 停止轮询）。
 */
export async function handleVideoCancel(id: string): Promise<VideoTask | null> {
  return getVideoEngine().cancel(id)
}

/**
 * 重试一个已失败/已取消的任务（M9）。
 */
export async function handleVideoRetry(id: string): Promise<VideoTask> {
  return getVideoEngine().retry(id)
}

/**
 * 取消一个多镜头序列的全部在途子任务（M9）。
 */
export async function handleVideoCancelSequence(id: string): Promise<VideoSequence> {
  return getVideoEngine().cancelSequence(id)
}

/**
 * 移入回收站：软删一条视频任务记录（M14，文件保留至彻底删除）。
 */
export async function handleVideoDeleteTask(id: string): Promise<void> {
  await getVideoEngine().deleteTask(id)
}

/**
 * 移入回收站：软删一个多镜头序列及其全部子任务（M14，文件保留至彻底删除）。
 */
export async function handleVideoDeleteSequence(id: string): Promise<void> {
  await getVideoEngine().deleteSequence(id)
}

/**
 * 批量重试一批已失败/已取消的任务（M10）。
 */
export async function handleVideoRetryTasks(ids: string[]): Promise<VideoBatchResult<VideoTask>> {
  return getVideoEngine().retryTasks(ids)
}

/**
 * 批量取消多个进行中的多镜头序列（M10）。
 */
export async function handleVideoCancelSequences(
  ids: string[],
): Promise<VideoBatchResult<VideoSequence>> {
  return getVideoEngine().cancelSequences(ids)
}

/**
 * 批量删除一批视频任务记录及其落盘文件（M10）。
 */
export async function handleVideoDeleteTasks(ids: string[]): Promise<VideoBatchResult<string>> {
  return getVideoEngine().deleteTasks(ids)
}

/**
 * 批量删除多个多镜头序列及其子任务与落盘文件（M10）。
 */
export async function handleVideoDeleteSequences(
  ids: string[],
): Promise<VideoBatchResult<string>> {
  return getVideoEngine().deleteSequences(ids)
}

// ─── M14：视频资产管理（收藏/标签/回收站/导出） ────────────────

/**
 * M14：设置任务收藏标记。
 */
export async function handleVideoSetFavorite(
  id: string,
  favorite: boolean,
): Promise<VideoTask | null> {
  return updateVideoTask(id, { favorite })
}

/**
 * M14：整体覆盖任务标签。
 */
export async function handleVideoSetTags(id: string, tags: string[]): Promise<VideoTask | null> {
  return updateVideoTask(id, { tags })
}

/**
 * M14：获取回收站快照（已软删任务 + 序列）。
 */
export async function handleVideoTrash(): Promise<VideoTrashSnapshot> {
  return getVideoEngine().listTrash()
}

/**
 * M14：从回收站恢复任务/序列。
 */
export async function handleVideoRestore(
  type: 'task' | 'sequence',
  id: string,
): Promise<VideoTask | VideoSequence> {
  const engine = getVideoEngine()
  return type === 'task' ? engine.restoreTask(id) : engine.restoreSequence(id)
}

/**
 * M14：彻底删除回收站中的任务/序列（硬删记录并删除落盘文件）。
 */
export async function handleVideoPurge(type: 'task' | 'sequence', id: string): Promise<void> {
  const engine = getVideoEngine()
  if (type === 'task') await engine.purgeTask(id)
  else await engine.purgeSequence(id)
}

/**
 * M14：清空回收站。
 */
export async function handleVideoEmptyTrash(): Promise<VideoTrashPurgeResult> {
  return getVideoEngine().emptyTrash()
}

/**
 * M14：批量导出成品视频。
 * 弹出系统目录选择对话框，用户取消返回 { canceled: true }；
 * 否则将任务/序列展开后的成品 mp4 复制到所选目录。
 */
export async function handleVideoExportAssets(
  taskIds: string[],
  sequenceIds: string[],
): Promise<VideoExportAssetsResult> {
  const parentWindow = getMainWindow()
  const options = {
    title: '选择导出目录',
    properties: ['openDirectory', 'createDirectory'] as Array<
      'openDirectory' | 'createDirectory'
    >,
  }
  const picked = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0) {
    return { canceled: true }
  }
  return getVideoEngine().exportAssets({
    taskIds,
    sequenceIds,
    targetDir: picked.filePaths[0],
  })
}

/**
 * M11：解析本地 CSV 文件为可生成的任务行预览。
 * 读取文件内容并复用 csv-batch 解析器校验。
 */
export async function handleVideoParseCsv(filePath: string): Promise<CsvParseResult> {
  const content = await readFile(filePath, 'utf8')
  return parseCsvRows(content)
}

/**
 * M11：批量生成一组单视频任务（CSV 造片）。
 */
export async function handleVideoBatchGenerate(
  rows: CreateVideoTaskParams[],
  concurrency?: number,
): Promise<VideoBatchResult<VideoTask>> {
  return getVideoEngine().generateRows(rows, concurrency)
}

/** M12：统计时间范围天数边界 */
const STATS_MIN_DAYS = 1
const STATS_MAX_DAYS = 365
/** M12：统计时间范围缺省天数 */
const STATS_DEFAULT_DAYS = 30

/** 规整统计时间范围天数（缺省 30，钳制 1–365） */
function normalizeStatsDays(days?: number): number {
  if (days === undefined || days === null || !Number.isFinite(days)) return STATS_DEFAULT_DAYS
  return Math.max(STATS_MIN_DAYS, Math.min(Math.round(days), STATS_MAX_DAYS))
}

/**
 * M12：聚合生成历史统计（按时间/厂商/模型/状态）。
 */
export async function handleVideoStats(days?: number): Promise<VideoStatsOverview> {
  const since = Date.now() - normalizeStatsDays(days) * 24 * 60 * 60 * 1000
  return aggregateVideoStats(since)
}

/** 获取主窗口（导出保存对话框的 parent），无窗口时返回 undefined */
function getMainWindow(): BrowserWindow | undefined {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return undefined
  const win = windows[0]
  return win.isDestroyed() ? undefined : win
}

/**
 * M12：聚合统计并导出 CSV 报表。
 * 弹出系统保存对话框（默认文件名 video-stats-YYYYMMDD.csv），
 * 用户取消返回 { canceled: true }；否则写入 UTF-8 BOM 的 CSV 并返回落盘路径。
 */
export async function handleVideoExportStats(days?: number): Promise<VideoStatsExportResult> {
  const overview = await handleVideoStats(days)
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`
  const parentWindow = getMainWindow()
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, {
        title: '导出生成统计 CSV',
        defaultPath: `video-stats-${stamp}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })
    : await dialog.showSaveDialog({
        title: '导出生成统计 CSV',
        defaultPath: `video-stats-${stamp}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })
  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }
  // UTF-8 BOM：保证 Excel 直接打开时正确识别编码
  await writeFile(result.filePath, `\uFEFF${buildStatsCsv(overview)}`, 'utf8')
  return { canceled: false, path: result.filePath }
}

/**
 * M11：校验批量生成的任务行数组。
 * 每行必须是对象且含非空字符串 prompt，其余可选字段按类型守卫过滤后透传。
 */
function validateVideoTaskParamsArray(value: unknown): CreateVideoTaskParams[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "rows" must be a non-empty array of task params.',
    )
  }
  return value.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Field "rows[${index}]" must be an object.`,
      )
    }
    const obj = row as Record<string, unknown>
    if (typeof obj['prompt'] !== 'string' || (obj['prompt'] as string).trim() === '') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Field "rows[${index}].prompt" must be a non-empty string.`,
      )
    }
    const params: CreateVideoTaskParams = { prompt: (obj['prompt'] as string).trim() }
    const duration = validateOptionalNumber(obj['duration'], `rows[${index}].duration`, 1)
    const resolution = validateOptionalEnum<VideoResolution>(
      obj['resolution'],
      `rows[${index}].resolution`,
      ['480P', '720P', '1080P'],
    )
    const aspect = validateOptionalEnum<VideoAspect>(
      obj['aspect'],
      `rows[${index}].aspect`,
      ['16:9', '9:16', '4:3', '3:4', '1:1'],
    )
    if (duration !== undefined) params.duration = duration
    if (resolution !== undefined) params.resolution = resolution
    if (aspect !== undefined) params.aspect = aspect
    return params
  })
}

/**
 * 读取当前视频生成配置（不含 API Key，仅用于前端回显）。
 * 返回默认厂商与各厂商各自的 BaseUrl/模型/是否已配置 Key。
 */
export async function handleVideoConfig(): Promise<VideoConfigView> {
  const { getSettings } = await import('../db/repos/app-settings')
  const settings = getSettings()
  return {
    defaultProvider: (settings.videoProvider ?? 'seedance') as VideoProvider,
    providers: {
      seedance: {
        baseUrl: settings.videoBaseUrl ?? DEFAULT_ARK_BASE_URL,
        model: settings.videoModel ?? 'doubao-seedance',
        configured: Boolean(settings.videoApiKey),
      },
      kling: {
        baseUrl: settings.videoKlingBaseUrl ?? DEFAULT_KLING_BASE_URL,
        model: settings.videoKlingModel ?? DEFAULT_KLING_MODEL,
        configured: Boolean(settings.videoKlingApiKey),
      },
      custom: {
        baseUrl: settings.videoCustomBaseUrl ?? '',
        model: settings.videoCustomModel ?? '',
        configured: Boolean(settings.videoCustomApiKey),
        protocol: settings.videoCustomProtocol === 'kling' ? 'kling' : 'ark',
      },
    },
    maxDuration: settings.videoMaxDuration ?? 10,
  }
}

/**
 * 测试链接：校验指定厂商配置是否完整（不发起下载）。
 * 缺省 provider 时按默认厂商。
 */
export async function handleVideoTestConfig(provider?: VideoProvider): Promise<{
  ok: boolean
  provider: VideoProvider
  baseUrl: string
  model: string
}> {
  const config = loadVideoConfig(provider)
  return { ok: true, provider: config.provider, baseUrl: config.baseUrl, model: config.model }
}

/**
 * M13：获取生成队列快照（排队任务、并发上限、暂停状态）。
 */
export async function handleVideoQueue(): Promise<VideoQueueSnapshot> {
  return getVideoEngine().getQueueSnapshot()
}

/**
 * M13：暂停队列出队（已提交厂商的任务继续轮询）。
 */
export function handleVideoQueuePause(): VideoQueueSnapshot {
  return getVideoEngine().pauseQueue()
}

/**
 * M13：恢复队列出队。
 */
export function handleVideoQueueResume(): VideoQueueSnapshot {
  return getVideoEngine().resumeQueue()
}

/**
 * M13：设置队列并发上限（1–10）。
 */
export function handleVideoQueueConcurrency(limit: number): VideoQueueSnapshot {
  return getVideoEngine().setQueueConcurrency(limit)
}

// ─── M15：跨厂商智能路由 ───────────────────────────────────────

/**
 * M15：读取当前路由配置（含默认回退）。
 */
export function handleVideoGetRoutingConfig(): VideoRoutingConfig {
  return getVideoEngine().getRoutingConfig()
}

/**
 * M15：更新路由配置（规整后持久化 + 同步引擎内存路由）。
 */
export function handleVideoSetRoutingConfig(config: unknown): VideoRoutingConfig {
  const normalized = normalizeRoutingConfig(config)
  updateSettings({ videoRoutingConfig: normalized })
  getVideoEngine().setRoutingConfig(normalized)
  return getVideoEngine().getRoutingConfig()
}

/**
 * M15：获取路由决策日志（最近 N 条，缺省 50）。
 */
export function handleVideoGetRoutingLogs(limit?: number): VideoRoutingLogEntry[] {
  return getVideoEngine().getRoutingLogs(limit)
}

/**
 * M15：清空路由决策日志。
 */
export function handleVideoClearRoutingLogs(): boolean {
  getVideoEngine().clearRoutingLogs()
  return true
}

// ─── M17：定时/脚本化批量 ──────────────────────────────────────

export function handleVideoScheduleList(limit?: number): VideoSchedule[] {
  return getVideoScheduleService().list(limit ?? 200)
}

export function handleVideoScheduleCreate(params: CreateVideoScheduleParams): VideoSchedule {
  return getVideoScheduleService().create(params)
}

export function handleVideoScheduleUpdate(
  id: string,
  params: UpdateVideoScheduleParams,
): VideoSchedule {
  return getVideoScheduleService().update(id, params)
}

export function handleVideoScheduleToggle(id: string, enabled: boolean): VideoSchedule {
  return getVideoScheduleService().toggle(id, enabled)
}

export function handleVideoScheduleDelete(id: string): void {
  getVideoScheduleService().delete(id)
}

export function handleVideoScheduleRunNow(id: string): Promise<VideoScheduleRun | null> {
  return getVideoScheduleService().runNow(id)
}

export function handleVideoScheduleHistory(id: string, limit?: number): VideoScheduleRun[] {
  return getVideoScheduleService().history(id, limit ?? 50)
}

// ─── M18：成片后处理 ────────────────────────────────────────────

export function handleVideoPostprocessRuns(limit?: number): VideoPostprocessRun[] {
  return listVideoPostprocessRuns(limit ?? 50)
}

export function handleVideoPostprocessSubtitle(
  taskId: string,
  content: string,
  outputName?: string,
): Promise<VideoPostprocessResult> {
  return postprocessSubtitle({ taskId, content, outputName })
}

export function handleVideoPostprocessWatermark(
  taskId: string,
  imagePath: string,
  position: VideoPostprocessWatermarkPosition,
  outputName?: string,
): Promise<VideoPostprocessResult> {
  return postprocessWatermark({ taskId, imagePath, position, outputName })
}

export function handleVideoPostprocessConcat(
  taskIds: string[],
  outputName?: string,
): Promise<VideoPostprocessResult> {
  return postprocessConcat({ taskIds, outputName })
}

export function handleVideoPostprocessRename(
  taskId: string,
  newName: string,
): Promise<VideoPostprocessResult> {
  return postprocessRename({ taskId, newName })
}

export function handleVideoPostprocessArchive(
  taskIds: string[],
): Promise<VideoPostprocessResult> {
  return postprocessArchive({ taskIds })
}

type VideoPostprocessWatermarkPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

// ─── M19：分镜模板库 ────────────────────────────────────────────

export function handleVideoTemplateList(limit?: number): VideoTemplate[] {
  return getVideoTemplateService().list(limit ?? 200)
}

export function handleVideoTemplateCreate(params: CreateVideoTemplateParams): VideoTemplate {
  return getVideoTemplateService().create(params)
}

export function handleVideoTemplateUpdate(
  id: string,
  params: UpdateVideoTemplateParams,
): VideoTemplate {
  return getVideoTemplateService().update(id, params)
}

export function handleVideoTemplateDelete(id: string): void {
  getVideoTemplateService().delete(id)
}

export function handleVideoTemplateGet(id: string): VideoTemplate | null {
  return getVideoTemplateService().get(id)
}

export function handleVideoTemplateGenerate(
  id: string,
  providerOverride?: VideoProvider,
): Promise<VideoTask[] | { sequence: unknown; tasks: VideoTask[] }> {
  return getVideoTemplateService().generateFromTemplate(id, providerOverride)
}

// ─── M20：成本与用量计费 ────────────────────────────────────────

export function handleVideoBilling(days?: number): VideoBillingOverview {
  const range = normalizeStatsDays(days)
  return aggregateVideoBilling(Date.now() - range * 24 * 60 * 60 * 1000)
}

/**
 * 获取多镜头序列列表。
 */
export async function handleVideoListSequences(limit?: number): Promise<VideoSequence[]> {
  return listVideoSequences(limit)
}

/**
 * 获取多镜头序列详情（含镜头子任务）。
 */
export async function handleVideoSequenceDetail(
  id: string,
): Promise<VideoSequenceDetail | null> {
  const sequence = getVideoSequenceById(id)
  if (!sequence) return null
  return { sequence, tasks: listVideoTasksBySequence(id) }
}

// ─── IPC 通道注册 ─────────────────────────────────────────────

/**
 * 注册视频生成域的所有 IPC handlers。
 * 幂等：重复调用会先移除已注册的 handler 再重新注册。
 */
export function registerVideoHandlers(): void {
  ipcMain.removeHandler('video:generate')
  ipcMain.handle(
    'video:generate',
    createValidatedHandler(
      (p) => ({
        prompt: validateNonEmptyString(p['prompt'], 'prompt'),
        model: validateOptionalString(p['model'], 'model'),
        duration: validateOptionalNumber(p['duration'], 'duration'),
        resolution: validateOptionalEnum<VideoResolution>(p['resolution'], 'resolution', [
          '480P',
          '720P',
          '1080P',
        ]),
        aspect: validateOptionalEnum<VideoAspect>(p['aspect'], 'aspect', [
          '16:9',
          '9:16',
          '4:3',
          '3:4',
          '1:1',
        ]),
      }),
      (params) => handleVideoGenerate(params as CreateVideoTaskParams),
    ),
  )

  ipcMain.removeHandler('video:status')
  ipcMain.handle(
    'video:status',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoStatus(id),
    ),
  )

  ipcMain.removeHandler('video:list')
  ipcMain.handle(
    'video:list',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit') : undefined
      return handleVideoList(limit)
    },
  )

  ipcMain.removeHandler('video:cancel')
  ipcMain.handle(
    'video:cancel',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoCancel(id),
    ),
  )

  ipcMain.removeHandler('video:retry')
  ipcMain.handle(
    'video:retry',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoRetry(id),
    ),
  )

  ipcMain.removeHandler('video:cancel-sequence')
  ipcMain.handle(
    'video:cancel-sequence',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoCancelSequence(id),
    ),
  )

  ipcMain.removeHandler('video:delete-task')
  ipcMain.handle(
    'video:delete-task',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoDeleteTask(id),
    ),
  )

  ipcMain.removeHandler('video:delete-sequence')
  ipcMain.handle(
    'video:delete-sequence',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoDeleteSequence(id),
    ),
  )

  const batchIdsHandler: (fn: (ids: string[]) => unknown) => ReturnType<
    typeof createValidatedHandler<unknown>
  > = (fn) =>
    createValidatedHandler((p) => ({ ids: validateStringArray(p['ids'], 'ids') }), ({ ids }) =>
      fn(ids),
    )

  ipcMain.removeHandler('video:batch-retry')
  ipcMain.handle('video:batch-retry', batchIdsHandler((ids) => handleVideoRetryTasks(ids)))

  ipcMain.removeHandler('video:cancel-sequences')
  ipcMain.handle('video:cancel-sequences', batchIdsHandler((ids) => handleVideoCancelSequences(ids)))

  ipcMain.removeHandler('video:delete-tasks')
  ipcMain.handle('video:delete-tasks', batchIdsHandler((ids) => handleVideoDeleteTasks(ids)))

  ipcMain.removeHandler('video:delete-sequences')
  ipcMain.handle('video:delete-sequences', batchIdsHandler((ids) => handleVideoDeleteSequences(ids)))

  // M11：CSV 批量造片
  ipcMain.removeHandler('video:parse-csv')
  ipcMain.handle(
    'video:parse-csv',
    createValidatedHandler(
      (p) => ({ filePath: validateNonEmptyString(p['filePath'], 'filePath') }),
      ({ filePath }) => handleVideoParseCsv(filePath),
    ),
  )

  ipcMain.removeHandler('video:batch-generate')
  ipcMain.handle(
    'video:batch-generate',
    createValidatedHandler(
      (p) => ({
        rows: validateVideoTaskParamsArray(p['rows']),
        concurrency: validateOptionalNumber(p['concurrency'], 'concurrency', 1, 10),
      }),
      ({ rows, concurrency }) => handleVideoBatchGenerate(rows, concurrency),
    ),
  )

  ipcMain.removeHandler('video:get-config')
  ipcMain.handle('video:get-config', () => handleVideoConfig())

  // M12：生成历史统计与 CSV 导出
  ipcMain.removeHandler('video:stats')
  ipcMain.handle(
    'video:stats',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const days = obj ? validateOptionalNumber(obj['days'], 'days', 1, 365) : undefined
      return handleVideoStats(days)
    },
  )

  ipcMain.removeHandler('video:export-stats')
  ipcMain.handle(
    'video:export-stats',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const days = obj ? validateOptionalNumber(obj['days'], 'days', 1, 365) : undefined
      return handleVideoExportStats(days)
    },
  )

  ipcMain.removeHandler('video:list-sequences')
  ipcMain.handle(
    'video:list-sequences',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit') : undefined
      return handleVideoListSequences(limit)
    },
  )

  ipcMain.removeHandler('video:sequence-detail')
  ipcMain.handle(
    'video:sequence-detail',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoSequenceDetail(id),
    ),
  )

  // M13：生成队列
  ipcMain.removeHandler('video:queue')
  ipcMain.handle('video:queue', () => handleVideoQueue())

  ipcMain.removeHandler('video:queue-pause')
  ipcMain.handle('video:queue-pause', () => handleVideoQueuePause())

  ipcMain.removeHandler('video:queue-resume')
  ipcMain.handle('video:queue-resume', () => handleVideoQueueResume())

  ipcMain.removeHandler('video:queue-concurrency')
  ipcMain.handle(
    'video:queue-concurrency',
    createValidatedHandler(
      (p) => ({ limit: validateOptionalNumber(p['limit'], 'limit', 1, 10) }),
      ({ limit }) => handleVideoQueueConcurrency(limit as number),
    ),
  )

  // M14：视频资产管理（收藏 / 标签 / 回收站 / 资产导出）
  ipcMain.removeHandler('video:set-favorite')
  ipcMain.handle(
    'video:set-favorite',
    createValidatedHandler(
      (p) => ({
        id: validateNonEmptyString(p['id'], 'id'),
        favorite: validateOptionalBoolean(p['favorite'], 'favorite') ?? false,
      }),
      ({ id, favorite }) => handleVideoSetFavorite(id, favorite),
    ),
  )

  ipcMain.removeHandler('video:set-tags')
  ipcMain.handle(
    'video:set-tags',
    createValidatedHandler(
      (p) => ({
        id: validateNonEmptyString(p['id'], 'id'),
        tags: validateStringArray(p['tags'], 'tags'),
      }),
      ({ id, tags }) => handleVideoSetTags(id, tags),
    ),
  )

  ipcMain.removeHandler('video:trash')
  ipcMain.handle('video:trash', () => handleVideoTrash())

  ipcMain.removeHandler('video:restore')
  ipcMain.handle(
    'video:restore',
    createValidatedHandler(
      (p) => ({
        type: validateEnum<'task' | 'sequence'>(p['type'], 'type', ['task', 'sequence']),
        id: validateNonEmptyString(p['id'], 'id'),
      }),
      ({ type, id }) => handleVideoRestore(type, id),
    ),
  )

  ipcMain.removeHandler('video:purge')
  ipcMain.handle(
    'video:purge',
    createValidatedHandler(
      (p) => ({
        type: validateEnum<'task' | 'sequence'>(p['type'], 'type', ['task', 'sequence']),
        id: validateNonEmptyString(p['id'], 'id'),
      }),
      ({ type, id }) => handleVideoPurge(type, id),
    ),
  )

  ipcMain.removeHandler('video:empty-trash')
  ipcMain.handle('video:empty-trash', () => handleVideoEmptyTrash())

  ipcMain.removeHandler('video:export-assets')
  ipcMain.handle(
    'video:export-assets',
    createValidatedHandler(
      (p) => ({
        taskIds: validateOptionalStringArray(p['taskIds'], 'taskIds') ?? [],
        sequenceIds: validateOptionalStringArray(p['sequenceIds'], 'sequenceIds') ?? [],
      }),
      ({ taskIds, sequenceIds }) => handleVideoExportAssets(taskIds, sequenceIds),
    ),
  )

  ipcMain.removeHandler('video:test-config')
  ipcMain.handle('video:test-config', (_event, provider) =>
    handleVideoTestConfig(
      provider === undefined
        ? undefined
        : (validateOptionalEnum<VideoProvider>(provider['provider'], 'provider', [
            'seedance',
            'kling',
            'custom',
          ]) as VideoProvider),
    ),
  )

  // M15：跨厂商智能路由
  ipcMain.removeHandler('video:get-routing-config')
  ipcMain.handle('video:get-routing-config', () => handleVideoGetRoutingConfig())

  ipcMain.removeHandler('video:set-routing-config')
  ipcMain.handle('video:set-routing-config', (event, config) =>
    handleVideoSetRoutingConfig(config),
  )

  ipcMain.removeHandler('video:get-routing-logs')
  ipcMain.handle(
    'video:get-routing-logs',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit', 1, 100) : undefined
      return handleVideoGetRoutingLogs(limit)
    },
  )

  ipcMain.removeHandler('video:clear-routing-logs')
  ipcMain.handle('video:clear-routing-logs', () => handleVideoClearRoutingLogs())

  // ─── M17：视频批量调度 ──────────────────────────────────────
  ipcMain.removeHandler('video:schedule-list')
  ipcMain.handle(
    'video:schedule-list',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit', 1, 500) : undefined
      return handleVideoScheduleList(limit)
    },
  )

  ipcMain.removeHandler('video:schedule-create')
  ipcMain.handle('video:schedule-create', (event, params) =>
    handleVideoScheduleCreate(params as CreateVideoScheduleParams),
  )

  ipcMain.removeHandler('video:schedule-update')
  ipcMain.handle(
    'video:schedule-update',
    (event, payload) => {
      const obj = (payload ?? {}) as Record<string, unknown>
      const id = validateNonEmptyString(obj['id'], 'id')
      const params = obj['params'] as UpdateVideoScheduleParams | undefined
      return handleVideoScheduleUpdate(id, params ?? {})
    },
  )

  ipcMain.removeHandler('video:schedule-toggle')
  ipcMain.handle(
    'video:schedule-toggle',
    createValidatedHandler(
      (p) => ({
        id: validateNonEmptyString(p['id'], 'id'),
        enabled: validateOptionalBoolean(p['enabled'], 'enabled') ?? true,
      }),
      ({ id, enabled }) => handleVideoScheduleToggle(id, enabled),
    ),
  )

  ipcMain.removeHandler('video:schedule-delete')
  ipcMain.handle(
    'video:schedule-delete',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoScheduleDelete(id),
    ),
  )

  ipcMain.removeHandler('video:schedule-run-now')
  ipcMain.handle(
    'video:schedule-run-now',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoScheduleRunNow(id),
    ),
  )

  ipcMain.removeHandler('video:schedule-history')
  ipcMain.handle(
    'video:schedule-history',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const id = obj ? validateNonEmptyString(obj['id'], 'id') : ''
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit', 1, 200) : undefined
      return handleVideoScheduleHistory(id, limit)
    },
  )

  // ─── M18：成片后处理 ────────────────────────────────────────
  ipcMain.removeHandler('video:postprocess-runs')
  ipcMain.handle(
    'video:postprocess-runs',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit', 1, 200) : undefined
      return handleVideoPostprocessRuns(limit)
    },
  )

  ipcMain.removeHandler('video:postprocess-subtitle')
  ipcMain.handle(
    'video:postprocess-subtitle',
    createValidatedHandler(
      (p) => ({
        taskId: validateNonEmptyString(p['taskId'], 'taskId'),
        content: validateNonEmptyString(p['content'], 'content'),
        outputName: validateOptionalString(p['outputName'], 'outputName'),
      }),
      ({ taskId, content, outputName }) =>
        handleVideoPostprocessSubtitle(taskId, content, outputName),
    ),
  )

  ipcMain.removeHandler('video:postprocess-watermark')
  ipcMain.handle(
    'video:postprocess-watermark',
    createValidatedHandler(
      (p) => ({
        taskId: validateNonEmptyString(p['taskId'], 'taskId'),
        imagePath: validateNonEmptyString(p['imagePath'], 'imagePath'),
        position: validateOptionalEnum(
          p['position'],
          'position',
          ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'],
        ) as VideoPostprocessWatermarkPosition | undefined,
        outputName: validateOptionalString(p['outputName'], 'outputName'),
      }),
      ({ taskId, imagePath, position, outputName }) =>
        handleVideoPostprocessWatermark(
          taskId,
          imagePath,
          position ?? 'bottom-right',
          outputName,
        ),
    ),
  )

  ipcMain.removeHandler('video:postprocess-concat')
  ipcMain.handle(
    'video:postprocess-concat',
    createValidatedHandler(
      (p) => ({
        taskIds: validateOptionalStringArray(p['taskIds'], 'taskIds') ?? [],
        outputName: validateOptionalString(p['outputName'], 'outputName'),
      }),
      ({ taskIds, outputName }) => handleVideoPostprocessConcat(taskIds, outputName),
    ),
  )

  ipcMain.removeHandler('video:postprocess-rename')
  ipcMain.handle(
    'video:postprocess-rename',
    createValidatedHandler(
      (p) => ({
        taskId: validateNonEmptyString(p['taskId'], 'taskId'),
        newName: validateNonEmptyString(p['newName'], 'newName'),
      }),
      ({ taskId, newName }) => handleVideoPostprocessRename(taskId, newName),
    ),
  )

  ipcMain.removeHandler('video:postprocess-archive')
  ipcMain.handle(
    'video:postprocess-archive',
    createValidatedHandler(
      (p) => ({ taskIds: validateOptionalStringArray(p['taskIds'], 'taskIds') ?? [] }),
      ({ taskIds }) => handleVideoPostprocessArchive(taskIds),
    ),
  )

  // ─── M19：分镜模板库 ────────────────────────────────────────
  ipcMain.removeHandler('video:template-list')
  ipcMain.handle(
    'video:template-list',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const limit = obj ? validateOptionalNumber(obj['limit'], 'limit', 1, 500) : undefined
      return handleVideoTemplateList(limit)
    },
  )

  ipcMain.removeHandler('video:template-create')
  ipcMain.handle('video:template-create', (event, params) =>
    handleVideoTemplateCreate(params as CreateVideoTemplateParams),
  )

  ipcMain.removeHandler('video:template-update')
  ipcMain.handle(
    'video:template-update',
    (event, payload) => {
      const obj = (payload ?? {}) as Record<string, unknown>
      const id = validateNonEmptyString(obj['id'], 'id')
      const params = obj['params'] as UpdateVideoTemplateParams | undefined
      return handleVideoTemplateUpdate(id, params ?? {})
    },
  )

  ipcMain.removeHandler('video:template-delete')
  ipcMain.handle(
    'video:template-delete',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoTemplateDelete(id),
    ),
  )

  ipcMain.removeHandler('video:template-get')
  ipcMain.handle(
    'video:template-get',
    createValidatedHandler(p => ({ id: validateNonEmptyString(p['id'], 'id') }), ({ id }) =>
      handleVideoTemplateGet(id),
    ),
  )

  ipcMain.removeHandler('video:template-generate')
  ipcMain.handle(
    'video:template-generate',
    createValidatedHandler(
      (p) => ({
        id: validateNonEmptyString(p['id'], 'id'),
        providerOverride: validateOptionalEnum<VideoProvider>(p['providerOverride'], 'providerOverride', [
          'seedance',
          'kling',
          'custom',
        ]),
      }),
      ({ id, providerOverride }) => handleVideoTemplateGenerate(id, providerOverride),
    ),
  )

  // ─── M20：成本与用量计费 ────────────────────────────────────
  ipcMain.removeHandler('video:billing')
  ipcMain.handle(
    'video:billing',
    (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const days = obj ? validateOptionalNumber(obj['days'], 'days', 1, 365) : undefined
      return handleVideoBilling(days)
    },
  )
}