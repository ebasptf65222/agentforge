// AgentForge 视频成片后处理服务（M18）
//
// 职责：
// - subtitle   ：把 SRT 字幕烧录进成品画面，生成新成品任务
// - watermark  ：叠加水印图片，生成新成品任务
// - concat     ：按顺序拼接多个成品，生成新成品任务
// - rename     ：重命名任务成品文件（更新落盘路径）
// - archive    ：把成品移动到 archive 目录并打归档标记
//
// 每次执行记录到 video_postprocess_runs 表；产物视频存放于 workspace/videos/postprocess。

import { rename as fsRename, mkdir } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import type {
  VideoTask,
  VideoPostprocessResult,
  VideoPostprocessType,
  VideoArchiveParams,
  VideoConcatParams,
  VideoRenameParams,
  VideoSubtitleParams,
  VideoWatermarkParams,
} from '@shared/types'
import {
  getVideoTaskById,
  createVideoTask,
  updateVideoTask,
} from '../db/repos/video-task'
import {
  createVideoPostprocessRun,
  finishVideoPostprocessRun,
} from '../db/repos/video-postprocess'
import { getWorkspaceService } from './workspace-service'
import { burnSubtitle, overlayWatermark, concatVideos } from '../utils/ffmpeg'
import { AppError, ErrorCodes } from '../utils/error'

/** 后处理产物子目录（workspace/videos/postprocess） */
const POSTPROCESS_DIR = join('videos', 'postprocess')

/** 校验任务存在、为成功成品且已落盘；返回相对输出路径 */
function requireSucceededTask(id: string): VideoTask | null {
  const task = getVideoTaskById(id)
  if (!task) {
    throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video task not found: ${id}`)
  }
  if (task.status !== 'succeeded' || !task.outputPath) {
    throw new AppError(
      ErrorCodes.VIDEO_POSTPROCESS_ERROR,
      `Task ${id} has no finished video (status=${task.status}).`,
    )
  }
  return task
}

/** 解析产物相对路径（带随机后缀避免冲突） */
function resolveOutRel(suffix: string, ext: string): string {
  const stamp = Date.now()
  const rand = Math.floor(Math.random() * 1000)
  return join(POSTPROCESS_DIR, `${suffix}-${stamp}-${rand}${ext}`)
}

/** 生成一个“已成功成品”的派生任务记录（用于字幕/水印/拼接产物入库展示） */
function createDerivedSuccessTask(sourceId: string, outRel: string): string {
  const source = getVideoTaskById(sourceId)
  if (!source) throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video task not found: ${sourceId}`)
  const task = createVideoTask({
    provider: source.provider,
    prompt: `[后处理] ${source.prompt}`,
    model: source.model,
    duration: source.duration,
    resolution: source.resolution,
    aspect: source.aspect,
    imageRefs: source.imageRefs,
  })
  updateVideoTask(task.id, {
    status: 'succeeded',
    progress: 100,
    outputPath: outRel,
    providerTaskId: null,
  })
  return task.id
}

async function runAndRecord(
  type: VideoPostprocessType,
  sourceTaskIds: string[],
  exec: () => Promise<{ outputPath?: string | null; outputTaskId?: string | null }>,
): Promise<VideoPostprocessResult> {
  const run = createVideoPostprocessRun({ type, taskIds: sourceTaskIds })
  try {
    const result = await exec()
    const finished = finishVideoPostprocessRun(
      run.id,
      'ok',
      '完成',
      result.outputPath ?? null,
      result.outputTaskId ?? null,
    )
    return { ok: true, message: '完成', run: finished ?? run }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const finished = finishVideoPostprocessRun(run.id, 'error', message)
    return { ok: false, message, run: finished ?? run }
  }
}

/** M18：烧录字幕 */
export async function postprocessSubtitle(
  params: VideoSubtitleParams,
): Promise<VideoPostprocessResult> {
  const src = requireSucceededTask(params.taskId)
  const content = params.content?.trim()
  if (!content) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Subtitle content must not be empty.')
  }
  return runAndRecord('subtitle', [params.taskId], async () => {
    const outRel = resolveOutRel('subtitle', '.mp4')
    const workspaceRoot = getWorkspaceService().getPath()
    await burnSubtitle(
      join(workspaceRoot, src.outputPath as string),
      join(workspaceRoot, outRel),
      content,
    )
    const outputTaskId = createDerivedSuccessTask(params.taskId, outRel)
    return { outputPath: outRel, outputTaskId }
  })
}

/** M18：叠加水印 */
export async function postprocessWatermark(
  params: VideoWatermarkParams,
): Promise<VideoPostprocessResult> {
  const src = requireSucceededTask(params.taskId)
  if (!params.imagePath) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Watermark image path must not be empty.')
  }
  return runAndRecord('watermark', [params.taskId], async () => {
    const outRel = resolveOutRel('watermarked', '.mp4')
    const workspaceRoot = getWorkspaceService().getPath()
    await overlayWatermark(
      join(workspaceRoot, src.outputPath as string),
      params.imagePath,
      join(workspaceRoot, outRel),
      params.position ?? 'bottom-right',
    )
    const outputTaskId = createDerivedSuccessTask(params.taskId, outRel)
    return { outputPath: outRel, outputTaskId }
  })
}

/** M18：拼接 */
export async function postprocessConcat(
  params: VideoConcatParams,
): Promise<VideoPostprocessResult> {
  if (!params.taskIds || params.taskIds.length < 2) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Concatenation requires at least 2 tasks.',
    )
  }
  const sources = params.taskIds.map(requireSucceededTask)
  return runAndRecord('concat', params.taskIds, async () => {
    const outRel = resolveOutRel('concat', '.mp4')
    const workspaceRoot = getWorkspaceService().getPath()
    await concatVideos(
      sources.map((s) => join(workspaceRoot, s.outputPath as string)),
      join(workspaceRoot, outRel),
    )
    const outputTaskId = createDerivedSuccessTask(sources[0].id, outRel)
    return { outputPath: outRel, outputTaskId }
  })
}

/** M18：重命名任务成品文件（不产新任务，直接更新落盘路径） */
export async function postprocessRename(
  params: VideoRenameParams,
): Promise<VideoPostprocessResult> {
  const src = requireSucceededTask(params.taskId)
  const newName = params.newName?.trim()
  if (!newName) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'New name must not be empty.')
  }
  const run = createVideoPostprocessRun({ type: 'rename', taskIds: [params.taskId] })
  try {
    const workspaceRoot = getWorkspaceService().getPath()
    const oldAbs = join(workspaceRoot, src.outputPath as string)
    const ext = extname(oldAbs) || '.mp4'
    const base = newName.toLowerCase().endsWith(ext.toLowerCase())
      ? newName.slice(0, newName.length - ext.length)
      : newName
    const newRel = join(dirname(src.outputPath as string), `${base}${ext}`)
    const newAbs = join(workspaceRoot, newRel)
    await mkdir(dirname(newAbs), { recursive: true })
    await fsRename(oldAbs, newAbs)
    updateVideoTask(params.taskId, { outputPath: newRel })
    const finished = finishVideoPostprocessRun(run.id, 'ok', '完成', newRel)
    return { ok: true, message: '完成', run: finished ?? run }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const finished = finishVideoPostprocessRun(run.id, 'error', message)
    return { ok: false, message, run: finished ?? run }
  }
}

/** M18：归档成品（移动到 archive 目录并打标记） */
export async function postprocessArchive(
  params: VideoArchiveParams,
): Promise<VideoPostprocessResult> {
  const taskIds = params.taskIds ?? []
  if (taskIds.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No tasks selected for archiving.')
  }
  const run = createVideoPostprocessRun({ type: 'archive', taskIds })
  try {
    const workspaceRoot = getWorkspaceService().getPath()
    const now = Date.now()
    let moved = 0
    for (const id of taskIds) {
      const src = requireSucceededTask(id)
      if (src.archived) continue
      const oldAbs = join(workspaceRoot, src.outputPath as string)
      const relDir = join('archive', 'videos', String(now))
      const newRel = join(relDir, (src.outputPath as string).split(/[\\/]/).pop() || `${id}.mp4`)
      const newAbs = join(workspaceRoot, newRel)
      await mkdir(dirname(newAbs), { recursive: true })
      await fsRename(oldAbs, newAbs)
      updateVideoTask(id, { outputPath: newRel, archived: true })
      moved += 1
    }
    const finished = finishVideoPostprocessRun(run.id, 'ok', `已归档 ${moved} 个任务`)
    return { ok: true, message: `已归档 ${moved} 个任务`, run: finished ?? run }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const finished = finishVideoPostprocessRun(run.id, 'error', message)
    return { ok: false, message, run: finished ?? run }
  }
}