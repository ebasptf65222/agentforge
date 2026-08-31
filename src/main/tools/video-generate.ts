// AgentForge: video_generate 内置工具
// 允许 AI 在对话中提交一个 AI 视频生成任务（当前接入 Seedance 引擎）。
// 中风险工具：调用外部付费大模型 API，需要已配置视频 API Key。
import type { ToolDefinition, ToolExecutionResult, VideoImageRef, VideoAspect, VideoResolution, VideoShot } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getVideoEngine, loadVideoConfig } from '../services/video-engine'
import type { BuiltinTool } from './types'

/** video_generate 工具定义与执行函数 */
export const videoGenerateTool: BuiltinTool = {
  definition: {
    name: 'video_generate',
    description:
      'Generate an AI video by submitting a video generation task. ' +
      'Use the `prompt` field for a single video, or `shots` (2 or more) for a ' +
      'multi-shot sequence where each shot is generated as its own video. ' +
      'Returned immediately with a task ID (or sequence ID); tasks run asynchronously ' +
      'and results are delivered when ready. Requires a configured video API key in settings.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the video content to generate, including subject, action, scene, style, lighting and camera movement. Required unless `shots` is provided.',
        },
        shots: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'This shot\'s prompt: subject, action, scene, style, lighting, camera.',
              },
              duration: {
                type: 'number',
                description: 'This shot\'s duration in seconds (4-15, optional).',
              },
              images: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional local image paths for this shot (≤2). 1 = first frame, 2 = first + last frame.',
              },
            },
            required: ['prompt'],
          },
          description: 'Multi-shot: 2+ shots. Each shot becomes its own video task grouped under one sequence. When provided, `prompt` is ignored.',
        },
        continuity: {
          type: 'boolean',
          description:
            'Continuity mode for a `shots` sequence: each shot is generated strictly in order and ' +
            'starts from the previous shot\'s auto-captured last frame, producing a coherent narrative. ' +
            'Requires shots to be text-to-video only (no `images`) and provider image-to-video support. ' +
            'Ignored when `shots` is not provided.',
        },
        model: {
          type: 'string',
          description: 'Video model name (optional, uses configured default if not specified)',
        },
        duration: {
          type: 'number',
          description: 'Video duration in seconds (4-15, default 5, single-shot only)',
        },
        resolution: {
          type: 'string',
          enum: ['480P', '720P', '1080P'],
          description: 'Video resolution (default 720P)',
        },
        aspect: {
          type: 'string',
          enum: ['16:9', '9:16', '4:3', '3:4', '1:1'],
          description: 'Video aspect ratio (default 16:9)',
        },
        images: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Local image file paths (absolute) for image-to-video (single-shot). ' +
            '1 image = first frame; 2 images = first + last frame (max 2). ' +
            'Only supported when the default provider is Seedance.',
        },
        styleRef: {
          type: 'string',
          description:
            'M16: Local image file path (absolute) used as a style reference (风格参考图). ' +
            'Anchors the visual style without fixing the first frame. Combine with `images` if needed. ' +
            'Only supported when the default provider is Seedance.',
        },
      },
      required: [],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const resolution = args['resolution'] as VideoResolution | undefined
    if (resolution !== undefined && !['480P', '720P', '1080P'].includes(resolution)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'resolution must be one of "480P", "720P", "1080P".',
      )
    }

    const aspect = args['aspect'] as VideoAspect | undefined
    if (aspect !== undefined && !['16:9', '9:16', '4:3', '3:4', '1:1'].includes(aspect)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'aspect must be one of "16:9", "9:16", "4:3", "3:4", "1:1".',
      )
    }

    const model = typeof args['model'] === 'string' && args['model'] ? args['model'] : undefined
    const continuity = args['continuity'] === true

    // 多镜头序列路径
    if (Array.isArray(args['shots']) && args['shots'].length > 0) {
      return this.executeSequence(args, { resolution, aspect, model, continuity })
    }

    // 单镜头路径
    const prompt = args['prompt']
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'prompt must be a non-empty string when shots is not provided.',
      )
    }

    // 先校验配置是否完整，避免提交后才失败
    loadVideoConfig()

    const duration =
      typeof args['duration'] === 'number' && Number.isFinite(args['duration'])
        ? args['duration']
        : undefined

    // 图生视频/首尾帧：最多 2 张，1 张=首帧，2 张=首尾帧
    const imageRefs = resolveImageRefs(args['images'])
    // M16：可选风格参考图（独立角色 style，拼入参考图列表参与内联上传）
    const styleRef = resolveStyleRef(args['styleRef'])
    const combinedRefs = mergeImageRefs(imageRefs, styleRef)

    const task = await getVideoEngine().generate({
      prompt,
      model,
      duration,
      resolution,
      aspect,
      imageRefs: combinedRefs,
    })

    const imageCount = combinedRefs?.length ?? 0
    const hasStyle = Boolean(styleRef)
    const frameCount = hasStyle ? (combinedRefs?.length ?? 1) - 1 : imageCount
    const inputLine =
      imageCount > 0
        ? `输入图片: ${frameCount} 张${hasStyle ? ' + 1 张风格参考图' : ''}（${frameCount === 0 ? '仅风格参考' : frameCount === 1 ? '首帧' : '首帧 + 尾帧'}）`
        : `生成方式: 文生视频`
    const summary = [
      `视频生成任务已提交！`,
      ``,
      `任务 ID: ${task.id}`,
      `提示词: ${task.prompt}`,
      inputLine,
      `分辨率: ${task.resolution}`,
      `画面比例: ${task.aspect}`,
      `时长: ${task.duration} 秒`,
      `状态: ${task.status}`,
      ``,
      `任务将在后台异步执行，生成完成后会自动通知。`,
    ].join('\n')

    return {
      isError: false,
      content: summary,
      metadata: {
        taskId: task.id,
        provider: task.provider,
        model: task.model,
        resolution: task.resolution,
        aspect: task.aspect,
        duration: task.duration,
        status: task.status,
        imageCount: combinedRefs?.length ?? 0,
        hasStyleRef: Boolean(styleRef),
      },
    }
  },

  /** 多镜头序列：解析 shots 并提交序列生成 */
  async executeSequence(
    args: Record<string, unknown>,
    common: {
      resolution?: VideoResolution
      aspect?: VideoAspect
      model?: string
      continuity?: boolean
    },
  ): Promise<ToolExecutionResult> {
    loadVideoConfig()
    const shots = resolveShots(args['shots'])
    if (shots.length < 2) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'shots 多镜头模式至少需要 2 个镜头。',
      )
    }
    const { sequence } = await getVideoEngine().generateSequence({
      shots,
      model: common.model,
      resolution: common.resolution,
      aspect: common.aspect,
      continuity: common.continuity,
    })

    const isContinuity = sequence.continuity
    const lines = [
      `多镜头视频序列已提交！`,
      ``,
      `序列 ID: ${sequence.id}`,
      `镜头: ${sequence.totalCount} 个`,
      `模式: ${isContinuity ? '连续性衔接（尾帧自动衔接）' : '并行跑批'}`,
      ``,
    ]
    shots.forEach((shot, index) => {
      const imgRefCount = shot.imageRefs?.length ?? 0
      lines.push(
        ` 镜头 ${index + 1}: ${shot.prompt}` +
          (imgRefCount > 0 ? `（含参考图 ${imgRefCount} 张）` : ``),
      )
    })
    lines.push(
      ``,
      isContinuity
        ? `镜头将按顺序生成：每个镜头以上一镜头尾帧为首帧，完成后自动通知。`
        : `每个镜头将在后台异步生成，完成后会自动通知。`,
    )

    return {
      isError: false,
      content: lines.join('\n'),
      metadata: {
        sequenceId: sequence.id,
        provider: sequence.provider,
        shotCount: sequence.totalCount,
        resolution: common.resolution ?? '720P',
        aspect: common.aspect ?? '16:9',
        status: sequence.status,
        continuity: sequence.continuity,
      },
    }
  },
}

/**
 * 将工具入参 `images`（本地图片路径数组）解析为图生视频引用。
 * 1 张 → 首帧；2 张 → 首尾帧；超过 2 张或格式非法时抛校验错误。
 */
function resolveImageRefs(raw: unknown): VideoImageRef[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'images must be an array of file paths.')
  }
  const paths: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'images must be an array of non-empty file paths.')
    }
    paths.push(item.trim())
  }
  if (paths.length === 0) return undefined
  if (paths.length > 2) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      '图生视频最多支持 2 张图片（首帧 + 尾帧）。',
    )
  }
  if (paths.length === 1) {
    return [{ path: paths[0], role: 'first_frame' }]
  }
  return [
    { path: paths[0], role: 'first_frame' },
    { path: paths[1], role: 'last_frame' },
  ]
}

/**
 * M16：解析可选的风格参考图（style_ref / styleRef 参数）。
 * 返回单一 style 角色参考图，或 undefined。
 */
function resolveStyleRef(raw: unknown): VideoImageRef | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'styleRef must be a non-empty file path.')
  }
  return { path: raw.trim(), role: 'style' }
}

/**
 * M16：合并首尾帧参考图与风格参考图。
 * 保证风格参考图放在末尾，且总数量不超过上限（2 帧 + 1 风格 / 仅 1 风格）。
 */
function mergeImageRefs(
  frames?: VideoImageRef[],
  style?: VideoImageRef,
): VideoImageRef[] | undefined {
  if (!frames && !style) return undefined
  const merged: VideoImageRef[] = [...(frames ?? [])]
  if (style) merged.push(style)
  return merged
}

/**
 * 将工具入参 `shots`（多镜头数组）解析为内部 VideoShot 列表。
 * 校验：必须是数组、每个镜头含非空 prompt、每镜头图片 ≤2 张。
 */
function resolveShots(raw: unknown): VideoShot[] {
  if (!Array.isArray(raw)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'shots must be an array of shot objects.')
  }
  const shots: VideoShot[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Each shot must be an object with a prompt.')
    }
    const shot = item as Record<string, unknown>
    const prompt = shot['prompt']
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Each shot must have a non-empty prompt.',
      )
    }
    const duration =
      typeof shot['duration'] === 'number' && Number.isFinite(shot['duration'])
        ? (shot['duration'] as number)
        : undefined
    shots.push({
      prompt: prompt.trim(),
      duration,
      imageRefs: resolveImageRefs(shot['images']),
    })
  }
  return shots
}