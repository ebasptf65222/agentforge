// AgentForge 视频生成域 IPC Handlers
// 通道命名: video:generate / video:status / video:list / video:cancel
// 渲染进程通过预加载暴露的 API 调用，实际逻辑委托给视频任务引擎。

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
import { getVideoEngine, loadVideoConfig } from '../services/video-engine'
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
          ]) as VideoProvider),
    ),
  )
}