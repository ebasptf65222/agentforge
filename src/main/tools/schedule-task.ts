// AgentForge: schedule_task 内置工具
// 允许 AI 在对话中创建定时任务
// 中风险工具（创建后台任务，需要用户确认调度配置）

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getSchedulerService } from '../services/scheduler-service'
import type { BuiltinTool } from './types'

/** schedule_task 工具定义与执行函数 */
export const scheduleTaskTool: BuiltinTool = {
  definition: {
    name: 'schedule_task',
    description:
      'Schedule a task to run automatically at specified times. ' +
      'Supports cron expressions, one-time execution, and interval-based scheduling. ' +
      'Use this tool when the user wants to automate recurring tasks or schedule future execution. ' +
      'For development tasks, set isDevTask=true to enable full-auto mode with higher step limits.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable name for the scheduled task',
        },
        scheduleType: {
          type: 'string',
          enum: ['cron', 'at', 'every'],
          description:
            'Scheduling type: "cron" for cron expression, "at" for one-time execution at a specific timestamp, "every" for interval-based',
        },
        cronExpr: {
          type: 'string',
          description:
            'Cron expression (required when scheduleType="cron"). ' +
            'Format: minute hour day-of-month month day-of-week. ' +
            'Examples: "0 9 * * 1-5" (weekdays 9AM), "0 22 * * *" (daily 10PM), "*/30 * * * *" (every 30 min)',
        },
        atMs: {
          type: 'number',
          description:
            'Unix timestamp in milliseconds for one-time execution (required when scheduleType="at")',
        },
        everyMs: {
          type: 'number',
          description:
            'Interval in milliseconds between executions (required when scheduleType="every"). Minimum: 60000 (1 minute)',
        },
        prompt: {
          type: 'string',
          description: 'The prompt/instructions that the AI agent will execute when the task runs',
        },
        modelId: {
          type: 'string',
          description: 'Model ID to use for task execution (optional, uses default model if not specified)',
        },
        isDevTask: {
          type: 'boolean',
          description:
            'Set to true for development tasks. Enables full-auto approval mode and higher max steps (50 instead of 20)',
        },
        planTasks: {
          type: 'array',
          description:
            'List of development task items (for isDevTask=true). Each item has id, title, description, and status',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in-progress', 'completed', 'failed'] },
            },
          },
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "Asia/Shanghai", "America/Los_Angeles"). Defaults to system timezone.',
        },
        approvalMode: {
          type: 'string',
          enum: ['suggest', 'auto-edit', 'full-auto'],
          description: 'Approval mode for task execution. Defaults to "auto-edit" (or "full-auto" for dev tasks)',
        },
        maxSteps: {
          type: 'number',
          description: 'Maximum execution steps. Defaults to 20 (or 50 for dev tasks)',
        },
        skillName: {
          type: 'string',
          description: 'Optional skill name to use for task execution',
        },
      },
      required: ['name', 'scheduleType', 'prompt'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const name = args['name']
    const scheduleType = args['scheduleType']
    const prompt = args['prompt']

    // ─── 参数校验 ────────────────────────────────────────────────

    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'name must be a non-empty string.')
    }
    if (typeof scheduleType !== 'string' || !['cron', 'at', 'every'].includes(scheduleType)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'scheduleType must be "cron", "at", or "every".')
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'prompt must be a non-empty string.')
    }

    // 根据 scheduleType 校验必填字段
    const cronExpr = scheduleType === 'cron' ? (args['cronExpr'] as string) : undefined
    const atMs = scheduleType === 'at' ? (args['atMs'] as number) : undefined
    const everyMs = scheduleType === 'every' ? (args['everyMs'] as number) : undefined

    if (scheduleType === 'cron' && (!cronExpr || cronExpr.trim() === '')) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'cronExpr is required when scheduleType="cron".')
    }
    if (scheduleType === 'at' && (!atMs || atMs <= Date.now())) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'atMs must be a future timestamp when scheduleType="at".')
    }
    if (scheduleType === 'every' && (!everyMs || everyMs < 60_000)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'everyMs must be at least 60000 (1 minute) when scheduleType="every".')
    }

    // 构建创建参数
    const isDevTask = args['isDevTask'] === true
    const planTasks = Array.isArray(args['planTasks']) ? args['planTasks'] : undefined

    const task = getSchedulerService().createTask({
      name,
      scheduleType: scheduleType as 'cron' | 'at' | 'every',
      cronExpr,
      atMs,
      everyMs,
      timezone: typeof args['timezone'] === 'string' ? args['timezone'] : undefined,
      agentConfig: {
        prompt,
        modelId: typeof args['modelId'] === 'string' ? args['modelId'] : undefined,
        approvalMode: args['approvalMode'] as 'suggest' | 'auto-edit' | 'full-auto' | undefined,
        maxSteps: typeof args['maxSteps'] === 'number' ? args['maxSteps'] : undefined,
        skillName: typeof args['skillName'] === 'string' ? args['skillName'] : undefined,
        isDevTask,
        planTasks,
      },
      sessionTarget: 'isolated',
      enabled: true,
    })

    // 格式化返回信息
    const nextRunStr = task.nextRunAtMs
      ? new Date(task.nextRunAtMs).toLocaleString('zh-CN')
      : '未计算'

    const summary = [
      `定时任务创建成功！`,
      ``,
      `任务名称: ${task.name}`,
      `调度方式: ${task.scheduleType}`,
      task.cronExpr ? `Cron 表达式: ${task.cronExpr}` : '',
      task.atMs ? `执行时间: ${new Date(task.atMs).toLocaleString('zh-CN')}` : '',
      task.everyMs ? `执行间隔: 每 ${Math.round(task.everyMs / 1000 / 60)} 分钟` : '',
      `下次执行: ${nextRunStr}`,
      isDevTask ? `模式: 开发任务 (full-auto, maxSteps=50)` : `模式: 普通任务`,
      `任务 ID: ${task.id}`,
    ].filter(Boolean).join('\n')

    return {
      isError: false,
      content: summary,
      metadata: {
        taskId: task.id,
        nextRunAtMs: task.nextRunAtMs,
        scheduleType: task.scheduleType,
      },
    }
  },
}
