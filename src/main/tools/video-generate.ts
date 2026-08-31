// AgentForge: video_generate 内置工具
// 允许 AI 在对话中提交一个 AI 视频生成任务（当前接入 Seedance 引擎）。
// 中风险工具：调用外部付费大模型 API，需要已配置视频 API Key。
import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import type { VideoAspect, VideoResolution } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getVideoEngine, loadVideoConfig } from '../services/video-engine'
import type { BuiltinTool } from './types'

/** video_generate 工具定义与执行函数 */
export const videoGenerateTool: BuiltinTool = {
  definition: {
    name: 'video_generate',
    description:
      'Generate an AI video by submitting a video generation task. ' +
      'Returns immediately with a task ID; the task runs asynchronously and the result ' +
      'is delivered when ready. Use this tool when the user asks to create/generate a video ' +
      'from a text prompt. Requires a configured video API key in settings.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the video content to generate, including subject, action, scene, style, lighting and camera movement',
        },
        model: {
          type: 'string',
          description: 'Video model name (optional, uses configured default if not specified)',
        },
        duration: {
          type: 'number',
          description: 'Video duration in seconds (4-15, default 5)',
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
      },
      required: ['prompt'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const prompt = args['prompt']

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'prompt must be a non-empty string.')
    }

    // 先校验配置是否完整，避免提交后才失败
    loadVideoConfig()

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

    const duration =
      typeof args['duration'] === 'number' && Number.isFinite(args['duration'])
        ? args['duration']
        : undefined
    const model = typeof args['model'] === 'string' && args['model'] ? args['model'] : undefined

    const task = await getVideoEngine().generate({
      prompt,
      model,
      duration,
      resolution,
      aspect,
    })

    const summary = [
      `视频生成任务已提交！`,
      ``,
      `任务 ID: ${task.id}`,
      `提示词: ${task.prompt}`,
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
      },
    }
  },
}