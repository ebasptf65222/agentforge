// AgentForge 定时任务 IPC Handlers
// 提供 scheduler 命名空间的 IPC 接口：
// scheduler:create, scheduler:list, scheduler:update, scheduler:delete,
// scheduler:toggle, scheduler:run-now, scheduler:history, scheduler:recent-runs

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type {
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { validateNonEmptyString } from '../utils/ipc-validator'
import { getSchedulerService, type SchedulerService } from '../services/scheduler-service'

// ─── 参数校验辅助 ───────────────────────────────────────────────

const VALID_SCHEDULE_TYPES = ['at', 'every', 'cron'] as const
const VALID_SESSION_TARGETS = ['main', 'isolated'] as const

function assertScheduleType(value: unknown): asserts value is 'at' | 'every' | 'cron' {
  if (typeof value !== 'string' || !VALID_SCHEDULE_TYPES.includes(value as typeof VALID_SCHEDULE_TYPES[number])) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid scheduleType: ${String(value)}. Must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}.`,
    )
  }
}

function assertSessionTarget(value: unknown): asserts value is 'main' | 'isolated' {
  if (typeof value !== 'string' || !VALID_SESSION_TARGETS.includes(value as typeof VALID_SESSION_TARGETS[number])) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid sessionTarget: ${String(value)}. Must be one of: ${VALID_SESSION_TARGETS.join(', ')}.`,
    )
  }
}

// ─── IPC 处理函数 ───────────────────────────────────────────────

/**
 * scheduler:create - 创建定时任务
 */
async function handleCreate(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ReturnType<SchedulerService['createTask']>> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Create task params must be an object.')
  }
  const p = params as Record<string, unknown>

  const name = validateNonEmptyString(p['name'], 'name')
  assertScheduleType(p['scheduleType'])

  const scheduleType = p['scheduleType'] as 'at' | 'every' | 'cron'

  // 根据 scheduleType 校验必填字段
  const cronExpr = scheduleType === 'cron' ? validateNonEmptyString(p['cronExpr'], 'cronExpr') : undefined
  const atMs = scheduleType === 'at' ? Number(p['atMs']) : undefined
  const everyMs = scheduleType === 'every' ? Number(p['everyMs']) : undefined

  if (scheduleType === 'at' && (!atMs || atMs <= Date.now())) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'atMs must be a future timestamp.')
  }
  if (scheduleType === 'every' && (!everyMs || everyMs < 60_000)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'everyMs must be at least 60000 (1 minute).')
  }

  // agentConfig 校验
  const agentConfigRaw = p['agentConfig']
  if (agentConfigRaw === null || typeof agentConfigRaw !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'agentConfig must be an object.')
  }
  const ac = agentConfigRaw as Record<string, unknown>
  const prompt = validateNonEmptyString(ac['prompt'], 'agentConfig.prompt')

  const sessionTarget = p['sessionTarget'] ? (assertSessionTarget(p['sessionTarget']), p['sessionTarget'] as 'main' | 'isolated') : 'isolated'

  const createParams: CreateScheduledTaskParams = {
    name,
    scheduleType,
    cronExpr,
    atMs,
    everyMs,
    timezone: typeof p['timezone'] === 'string' ? p['timezone'] : undefined,
    sessionTarget,
    agentConfig: {
      prompt,
      modelId: typeof ac['modelId'] === 'string' ? ac['modelId'] : undefined,
      approvalMode: ac['approvalMode'] as 'suggest' | 'auto-edit' | 'full-auto' | undefined,
      maxSteps: typeof ac['maxSteps'] === 'number' ? ac['maxSteps'] : undefined,
      skillName: typeof ac['skillName'] === 'string' ? ac['skillName'] : undefined,
      isDevTask: typeof ac['isDevTask'] === 'boolean' ? ac['isDevTask'] : undefined,
      planTasks: Array.isArray(ac['planTasks']) ? ac['planTasks'] : undefined,
    },
    enabled: typeof p['enabled'] === 'boolean' ? p['enabled'] : true,
  }

  return getSchedulerService().createTask(createParams)
}

/**
 * scheduler:list - 列出所有定时任务
 */
async function handleList(): Promise<ReturnType<SchedulerService['listAllTasks']>> {
  return getSchedulerService().listAllTasks()
}

/**
 * scheduler:update - 更新定时任务
 */
async function handleUpdate(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ReturnType<SchedulerService['updateTask']>> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Update task params must be an object.')
  }
  const p = params as Record<string, unknown>

  const id = validateNonEmptyString(p['id'], 'id')

  const updateParams: UpdateScheduledTaskParams = {}

  if (typeof p['name'] === 'string') updateParams.name = p['name']
  if (typeof p['enabled'] === 'boolean') updateParams.enabled = p['enabled']
  if (p['scheduleType'] !== undefined) {
    assertScheduleType(p['scheduleType'])
    updateParams.scheduleType = p['scheduleType']
  }
  if (p['cronExpr'] !== undefined) updateParams.cronExpr = p['cronExpr'] as string | null
  if (p['atMs'] !== undefined) updateParams.atMs = p['atMs'] as number | null
  if (p['everyMs'] !== undefined) updateParams.everyMs = p['everyMs'] as number | null
  if (p['timezone'] !== undefined) updateParams.timezone = p['timezone'] as string | null
  if (p['agentConfig'] !== undefined) {
    updateParams.agentConfig = p['agentConfig'] as UpdateScheduledTaskParams['agentConfig']
  }
  if (p['sessionTarget'] !== undefined) {
    assertSessionTarget(p['sessionTarget'])
    updateParams.sessionTarget = p['sessionTarget']
  }

  return getSchedulerService().updateTask(id, updateParams)
}

/**
 * scheduler:delete - 删除定时任务
 */
async function handleDelete(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<{ success: boolean }> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Delete task params must be an object.')
  }
  const p = params as Record<string, unknown>
  const id = validateNonEmptyString(p['id'], 'id')
  getSchedulerService().deleteTask(id)
  return { success: true }
}

/**
 * scheduler:toggle - 启用/禁用定时任务
 */
async function handleToggle(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ReturnType<SchedulerService['toggleTask']>> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Toggle task params must be an object.')
  }
  const p = params as Record<string, unknown>
  const id = validateNonEmptyString(p['id'], 'id')
  if (typeof p['enabled'] !== 'boolean') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "enabled" must be a boolean.')
  }
  return getSchedulerService().toggleTask(id, p['enabled'])
}

/**
 * scheduler:run-now - 立即执行一次
 */
async function handleRunNow(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ReturnType<SchedulerService['runTaskNow']>> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Run-now params must be an object.')
  }
  const p = params as Record<string, unknown>
  const id = validateNonEmptyString(p['id'], 'id')
  return getSchedulerService().runTaskNow(id)
}

/**
 * scheduler:history - 获取任务执行历史
 */
async function handleHistory(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ReturnType<SchedulerService['getTaskHistory']>> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'History params must be an object.')
  }
  const p = params as Record<string, unknown>
  const id = validateNonEmptyString(p['id'], 'id')
  const limit = typeof p['limit'] === 'number' ? p['limit'] : 20
  return getSchedulerService().getTaskHistory(id, limit)
}

/**
 * scheduler:recent-runs - 获取最近的执行记录
 */
async function handleRecentRuns(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ReturnType<SchedulerService['getRecentRuns']>> {
  const limit = params && typeof params === 'object' && 'limit' in params
    ? Number((params as Record<string, unknown>)['limit'])
    : 50
  return getSchedulerService().getRecentRuns(limit || 50)
}

// ─── 通道注册 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'scheduler:create', handler: (event, params) => handleCreate(event, params) },
  { channel: 'scheduler:list', handler: () => handleList() },
  { channel: 'scheduler:update', handler: (event, params) => handleUpdate(event, params) },
  { channel: 'scheduler:delete', handler: (event, params) => handleDelete(event, params) },
  { channel: 'scheduler:toggle', handler: (event, params) => handleToggle(event, params) },
  { channel: 'scheduler:run-now', handler: (event, params) => handleRunNow(event, params) },
  { channel: 'scheduler:history', handler: (event, params) => handleHistory(event, params) },
  { channel: 'scheduler:recent-runs', handler: (event, params) => handleRecentRuns(event, params) },
]

/**
 * 注册 Scheduler 域的 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerSchedulerHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
