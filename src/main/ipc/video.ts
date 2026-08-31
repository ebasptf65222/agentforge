// AgentForge 视频生成域 IPC Handlers
// 通道命名: video:generate / video:status / video:list / video:cancel
// 渲染进程通过预加载暴露的 API 调用，实际逻辑委托给视频任务引擎。

import { readFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type {
  CreateVideoTaskParams,
  VideoAspect,
  VideoConfigView,
  VideoProvider,
  VideoResolution,
  VideoSequence,
  VideoSequenceDetail,
  VideoTask,
} from '@shared/types'
import {
  getVideoEngine,
  loadVideoConfig,
  type VideoBatchResult,
} from '../services/video-engine'
import { parseCsvRows, type CsvParseResult } from '../services/csv-batch'
import { AppError, ErrorCodes } from '../utils/error'
import { getVideoSequenceById, listVideoSequences } from '../db/repos/video-sequence'
import { listVideoTasksBySequence } from '../db/repos/video-task'
import { DEFAULT_ARK_BASE_URL } from '../services/video-provider/seedance'
import { DEFAULT_KLING_BASE_URL, DEFAULT_KLING_MODEL } from '../services/video-provider/kling'
import {
  createValidatedHandler,
  validateNonEmptyString,
  validateOptionalEnum,
  validateOptionalNumber,
  validateOptionalString,
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
 * 删除一条视频任务记录及其落盘文件（M9）。
 */
export async function handleVideoDeleteTask(id: string): Promise<void> {
  await getVideoEngine().deleteTask(id)
}

/**
 * 删除一个多镜头序列及其全部子任务与落盘文件（M9）。
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
}