// AgentForge 视频生成域 IPC Handlers
// 通道命名: video:generate / video:status / video:list / video:cancel
// 渲染进程通过预加载暴露的 API 调用，实际逻辑委托给视频任务引擎。

import { ipcMain } from 'electron'
import type {
  CreateVideoTaskParams,
  VideoAspect,
  VideoResolution,
  VideoTask,
} from '@shared/types'
import { getVideoEngine, loadVideoConfig } from '../services/video-engine'
import {
  createValidatedHandler,
  validateNonEmptyString,
  validateOptionalEnum,
  validateOptionalNumber,
  validateOptionalString,
} from '../utils/ipc-validator'

/** 视频生成配置回显（不含 API Key） */
export interface VideoConfigView {
  provider: 'seedance'
  baseUrl: string
  model: string
  maxDuration: number
  configured: boolean
}

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
 */
export async function handleVideoConfig(): Promise<VideoConfigView> {
  const { getSettings } = await import('../db/repos/app-settings')
  const settings = getSettings()
  return {
    provider: (settings.videoProvider ?? 'seedance') as 'seedance',
    baseUrl: settings.videoBaseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3',
    model: settings.videoModel ?? 'doubao-seedance',
    maxDuration: settings.videoMaxDuration ?? 10,
    configured: Boolean(settings.videoApiKey),
  }
}

/**
 * 测试链接：校验配置是否完整并尝试读取模型（不发起下载）。
 */
export async function handleVideoTestConfig(): Promise<{
  ok: boolean
  provider: 'seedance'
  baseUrl: string
  model: string
}> {
  const config = loadVideoConfig()
  return { ok: true, provider: 'seedance', baseUrl: config.baseUrl, model: config.model }
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

  ipcMain.removeHandler('video:test-config')
  ipcMain.handle('video:test-config', () => handleVideoTestConfig())
}