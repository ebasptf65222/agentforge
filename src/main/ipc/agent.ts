// AgentForge P2-04: Agent IPC Handlers + Preload 扩展
// 实现 agent 命名空间的 IPC handlers：
// agent:execute, agent:stop, agent:approve
// 事件推送: agent:trajectory, agent:approval-request, agent:stream-chunk

import { ipcMain, type IpcMainInvokeHandler, BrowserWindow } from 'electron'
import type {
  AgentExecutionRequest,
  ExecutionResult,
  TAOTrajectory,
  ApprovalRequest,
  ApprovalMode,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getModelAdapter } from '../models/router'
import { getSettings } from '../db/repos/app-settings'
import { getConversationById, updateLastMessageAt } from '../db/repos/conversation'
import { createMessage } from '../db/repos/message'
import { getToolRegistry } from '../tools/registry'
import { AgentExecutor, type AgentExecutorConfig } from '../agent/executor'
import type { AgentEventCallbacks, RegisteredTool } from '../agent/types'
import { resolveSkill, buildSkillExecutionContext, filterTools } from '../skills/skill-executor'

// ─── 并发控制 ─────────────────────────────────────────────────────

/** 当前正在运行的 AgentExecutor */
let currentExecutor: AgentExecutor | null = null

/**
 * 获取当前 AgentExecutor（仅供测试使用）。
 */
export function getCurrentExecutor(): AgentExecutor | null {
  return currentExecutor
}

/**
 * 重置当前 AgentExecutor（仅供测试使用）。
 */
export function resetCurrentExecutor(): void {
  currentExecutor = null
}

// ─── 主窗口获取辅助 ───────────────────────────────────────────────

function getMainWindowWebContents(): Electron.WebContents | null {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return null
  const win = windows[0]
  if (win.isDestroyed()) return null
  return win.webContents
}

function sendTrajectory(trajectory: TAOTrajectory): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('agent:trajectory', trajectory)
  }
}

function sendApprovalRequest(request: ApprovalRequest): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('agent:approval-request', request)
  }
}

function sendStreamChunk(chunk: { type: string; content: string }): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('agent:stream-chunk', chunk)
  }
}

// ─── 参数校验 ─────────────────────────────────────────────────────

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

const VALID_APPROVAL_MODES: readonly ApprovalMode[] = ['suggest', 'auto-edit', 'full-auto']

function assertApprovalMode(value: unknown): asserts value is ApprovalMode {
  if (typeof value !== 'string' || !VALID_APPROVAL_MODES.includes(value as ApprovalMode)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid approvalMode: ${String(value)}. Must be one of: ${VALID_APPROVAL_MODES.join(', ')}.`,
      { approvalMode: value },
    )
  }
}

// ─── 工具注册表转换 ───────────────────────────────────────────────

/**
 * 从全局 ToolRegistry 获取工具映射。
 */
function getToolsMap(): Map<string, RegisteredTool> {
  const registry = getToolRegistry()
  const tools = new Map<string, RegisteredTool>()

  for (const tool of registry.list()) {
    tools.set(tool.definition.name, {
      definition: tool.definition,
      execute: tool.execute,
    })
  }

  return tools
}

// ─── IPC 处理函数 ─────────────────────────────────────────────────

/**
 * agent:execute - 启动 Agent 执行。
 *
 * 流程：
 * 1. 验证参数和并发锁
 * 2. 获取模型适配器、设置、工具列表
 * 3. 解析 Skill（用户指定或意图匹配）
 * 4. 如果 Skill 匹配成功：替换变量、过滤工具、可能覆盖模型
 * 5. 创建 AgentExecutor
 * 6. 执行并实时推送 trajectory / approval-request / stream-chunk 事件
 * 7. 保存执行结果到消息表
 * 8. 返回 ExecutionResult
 */
export async function handleExecute(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ExecutionResult> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Agent execute params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['conversationId'], 'conversationId')
  assertNonEmptyString(p['userInput'], 'userInput')
  assertNonEmptyString(p['modelId'], 'modelId')
  assertApprovalMode(p['approvalMode'])

  const request: AgentExecutionRequest = {
    conversationId: p['conversationId'] as string,
    userInput: p['userInput'] as string,
    modelId: p['modelId'] as string,
    approvalMode: p['approvalMode'] as ApprovalMode,
    maxSteps: (p['maxSteps'] as number) || 20,
    skillName: p['skillName'] as string | undefined,
  }

  // 1. 并发控制
  if (currentExecutor !== null) {
    throw new AppError(
      ErrorCodes.CHAT_ALREADY_RUNNING,
      'An agent execution is already running.',
    )
  }

  // 2. 验证会话存在
  getConversationById(request.conversationId)

  // 3. 获取模型适配器
  const adapter = getModelAdapter(request.modelId)

  // 4. 获取设置
  const settings = getSettings()
  const approvalTimeoutMs = settings.approvalTimeoutMs

  // 5. 保存用户消息
  createMessage({
    conversationId: request.conversationId,
    role: 'user',
    content: request.userInput,
  })

  // 6. 构建事件回调
  const callbacks: AgentEventCallbacks = {
    onTrajectory: (trajectory) => sendTrajectory(trajectory),
    onApprovalRequest: (approvalRequest) => sendApprovalRequest(approvalRequest),
    onStreamChunk: (chunk) => sendStreamChunk(chunk),
  }

  // 7. 获取工具列表
  let tools = getToolsMap()

  // 8. 解析 Skill（用户指定或意图匹配）
  let skillPrompt: string | undefined
  let effectiveAdapter = adapter

  const skillResolution = await resolveSkill(
    request.userInput,
    request.skillName,
    adapter,
  )

  if (skillResolution.skill !== null) {
    const skill = skillResolution.skill

    // 8a. 如果 Skill 指定了 modelId，使用该模型
    if (skill.modelId !== undefined) {
      effectiveAdapter = getModelAdapter(skill.modelId)
    }

    // 8b. 构建执行上下文（替换变量、过滤工具）
    const skillCtx = buildSkillExecutionContext(skill, tools)
    skillPrompt = skillCtx.skillPrompt

    // 8c. 过滤工具列表
    const filteredToolMap = filterTools(tools, skill.allowedTools)
    tools = filteredToolMap
  }

  // 9. 获取模型能力中的 maxContextLength
  const maxContextLength = 4096 // 从 model config 获取，暂用默认值

  // 10. 创建执行器配置
  const executorConfig: AgentExecutorConfig = {
    adapter: effectiveAdapter,
    tools,
    callbacks,
    approvalTimeoutMs,
    maxContextLength,
    skillPrompt,
  }

  // 11. 创建并执行
  const executor = new AgentExecutor(executorConfig)
  currentExecutor = executor

  let result: ExecutionResult
  try {
    result = await executor.execute(request)
  } catch (error) {
    // 保存错误信息到消息
    const errorMessage = error instanceof AppError ? error.message : 'Execution failed'
    createMessage({
      conversationId: request.conversationId,
      role: 'assistant',
      content: errorMessage,
      thinking: undefined,
    })
    updateLastMessageAt(request.conversationId)
    throw error
  } finally {
    currentExecutor = null
  }

  // 12. 保存助手回复
  createMessage({
    conversationId: request.conversationId,
    role: 'assistant',
    content: result.summary,
    thinking: result.trajectories.map((t) => `Step ${t.step}: ${t.thought}`).join('\n\n'),
  })

  updateLastMessageAt(request.conversationId)

  return result
}

/**
 * agent:stop - 取消当前 Agent 执行。
 */
export function handleStop(): void {
  if (currentExecutor) {
    currentExecutor.cancel()
  }
}

/**
 * agent:approve - 响应审批请求。
 */
export function handleApprove(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Approve params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['executionId'], 'executionId')

  const approved = p['approved'] as boolean
  const reason = p['reason'] as string | undefined

  if (currentExecutor) {
    currentExecutor.respondApproval(approved, reason)
  }
}

// ─── 通道注册 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'agent:execute',
    handler: (event, params: unknown) => handleExecute(event, params),
  },
  {
    channel: 'agent:stop',
    handler: () => handleStop(),
  },
  {
    channel: 'agent:approve',
    handler: (_event, params: unknown) => handleApprove(params),
  },
]

/**
 * 注册 Agent 域的 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerAgentHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
