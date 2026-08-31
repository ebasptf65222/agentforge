// AgentForge 分镜模板库服务（M19）
//
// 职责：模板 CRUD + “一键复用”——根据单镜头/序列模板直接派发到视频引擎生成。
// 模板仅保存结构化的镜头描述、分辨率/比例、模型等参数，不耦合具体任务运行状态。

import type {
  CreateVideoSequenceParams,
  CreateVideoTaskParams,
  CreateVideoTemplateParams,
  UpdateVideoTemplateParams,
  VideoTask,
  VideoTemplate,
} from '@shared/types'
import {
  createVideoTemplate as repoCreate,
  updateVideoTemplate as repoUpdate,
  deleteVideoTemplate as repoDelete,
  getVideoTemplateById,
  listVideoTemplates,
} from '../db/repos/video-template'
import { getVideoEngine } from './video-engine'
import { AppError, ErrorCodes } from '../utils/error'

export function createTemplate(params: CreateVideoTemplateParams): VideoTemplate {
  const name = params.name?.trim()
  if (!name) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video template name must not be empty.')
  }
  const shots = params.shots ?? []
  if (shots.length === 0 || shots.some((s) => !s?.prompt?.trim())) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Video template must contain at least one shot with a non-empty prompt.',
    )
  }
  const type = params.type ?? 'shot'
  if (type === 'sequence' && shots.length < 2) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Sequence template requires at least 2 shots.',
    )
  }
  return repoCreate({ ...params, name, type, shots })
}

export function updateTemplate(
  id: string,
  params: UpdateVideoTemplateParams,
): VideoTemplate {
  if (!getVideoTemplateById(id)) {
    throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video template not found: ${id}`)
  }
  if (params.name !== undefined && !params.name.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Video template name must not be empty.')
  }
  const updated = repoUpdate(id, params)
  if (!updated) throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video template not found: ${id}`)
  return updated
}

export function deleteTemplate(id: string): void {
  repoDelete(id)
}

export function getTemplate(id: string): VideoTemplate | null {
  return getVideoTemplateById(id)
}

export function listTemplates(limit?: number): VideoTemplate[] {
  return listVideoTemplates(limit)
}

/**
 * 一键复用：按模板生成视频。
 * - shot 类型：单任务（可带图生视频参考图，模板原样使用）
 * - sequence 类型：多镜头序列（可连续性衔接）
 */
export async function generateFromTemplate(
  templateId: string,
  providerOverride?: CreateVideoTaskParams['providerOverride'],
): Promise<VideoTask[] | { sequence: unknown; tasks: VideoTask[] }> {
  const template = getVideoTemplateById(templateId)
  if (!template) {
    throw new AppError(ErrorCodes.VIDEO_TASK_NOT_FOUND, `Video template not found: ${templateId}`)
  }
  const resolution = template.resolution
  const aspect = template.aspect
  const model = template.model ?? undefined

  if (template.type === 'sequence') {
    const params: CreateVideoSequenceParams = {
      title: template.name,
      model,
      resolution,
      aspect,
      shots: template.shots,
      continuity: template.continuity,
      providerOverride,
    }
    return await getVideoEngine().generateSequence(params)
  }

  const shot = template.shots[0]
  const params: CreateVideoTaskParams = {
    prompt: shot.prompt,
    model,
    duration: shot.duration,
    resolution,
    aspect,
    imageRefs: shot.imageRefs,
    providerOverride,
  }
  return [await getVideoEngine().generate(params)]
}

// ─── 单例 ──────────────────────────────────────────────────────

let instance: typeof api | null = null

const api = {
  create: createTemplate,
  update: updateTemplate,
  delete: deleteTemplate,
  get: getTemplate,
  list: listTemplates,
  generateFromTemplate,
}

export function getVideoTemplateService(): typeof api {
  if (instance === null) {
    instance = api
  }
  return instance
}