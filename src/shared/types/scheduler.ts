// AgentForge 共享类型定义 - 定时任务调度

/** 调度类型 */
export type ScheduleType = 'at' | 'every' | 'cron'

/** 任务执行状态 */
export type TaskRunStatus = 'ok' | 'error' | 'skipped' | 'timeout' | 'running'

/** 任务会话模式 */
export type SessionTarget = 'main' | 'isolated'

/** 定时任务实体 */
export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean

  // 调度配置
  scheduleType: ScheduleType
  cronExpr: string | null
  atMs: number | null
  everyMs: number | null
  anchorMs: number | null
  timezone: string | null

  // Agent 执行配置
  agentConfig: TaskAgentConfig
  sessionTarget: SessionTarget

  // 运行状态
  nextRunAtMs: number | null
  runningAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: TaskRunStatus | null
  lastDurationMs: number | null
  runCount: number
  errorCount: number

  // 元数据
  createdAt: string
  updatedAt: string
}

/** 任务 Agent 执行配置（JSON 序列化存储） */
export interface TaskAgentConfig {
  /** 用户输入（Agent 的 prompt） */
  prompt: string
  /** 模型 ID */
  modelId?: string
  /** 审批模式 */
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto'
  /** 最大步数 */
  maxSteps?: number
  /** 技能名称 */
  skillName?: string
  /** 是否为开发任务（自动使用 full-auto + 更高 maxSteps） */
  isDevTask?: boolean
  /** 关联的 Plan 任务列表（开发任务模式） */
  planTasks?: PlanTaskItem[]
}

/** Plan 模式拆分的任务项 */
export interface PlanTaskItem {
  id: string
  title: string
  description: string
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  /** 执行结果摘要 */
  resultSummary?: string
}

/** 任务执行历史记录 */
export interface ScheduledTaskRun {
  id: string
  taskId: string
  startedAtMs: number
  finishedAtMs: number | null
  status: TaskRunStatus
  conversationId: string | null
  summary: string | null
  error: string | null
  durationMs: number | null
}

/** 创建任务参数 */
export interface CreateScheduledTaskParams {
  name: string
  scheduleType: ScheduleType
  cronExpr?: string
  atMs?: number
  everyMs?: number
  timezone?: string
  agentConfig: TaskAgentConfig
  sessionTarget?: SessionTarget
  enabled?: boolean
}

/** 更新任务参数 */
export interface UpdateScheduledTaskParams {
  name?: string
  enabled?: boolean
  scheduleType?: ScheduleType
  cronExpr?: string | null
  atMs?: number | null
  everyMs?: number | null
  timezone?: string | null
  agentConfig?: TaskAgentConfig
  sessionTarget?: SessionTarget
}
