// AgentForge P2-04: Agent IPC Handlers + Preload 扩展
// 实现 agent 命名空间的 IPC handlers：
// agent:execute, agent:stop, agent:approve
// 事件推送: agent:trajectory, agent:approval-request, agent:stream-chunk
//
// 架构优化批次二（任务1）：核心执行逻辑已移至 engine-dispatcher.ts。
// 本文件仅保留 IPC handler 注册和参数校验。

import { ipcMain, app, type IpcMainInvokeHandler } from 'electron'
import type {
  AgentExecutionRequest,
  ExecutionResult,
  ApprovalMode,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { validateNonEmptyString } from '../utils/ipc-validator'
import { getSessionManager } from '../copilot/session-manager'
import {
  executeAgentFlow,
  getCurrentExecutor,
  resetCurrentExecutor,
  getCurrentBridge,
  getCurrentLangGraphBridge,
} from '../agent/engine-dispatcher'

// ─── 测试辅助函数（保持公共 API 不变） ─────────────────────────
// getCurrentExecutor / resetCurrentExecutor 直接从 engine-dispatcher 重导出，
// 避免在此文件维护并发状态副本。
export { getCurrentExecutor, resetCurrentExecutor }

// ─── 参数校验 ─────────────────────────────────────────────────────

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

// ─── IPC 处理函数 ─────────────────────────────────────────────────

/**
 * agent:execute - 启动 Agent 执行。
 *
 * 本函数仅负责参数校验，核心执行流程（三引擎路由、并发控制、
 * 保存用户消息→执行→保存助手回复→错误处理）由 engine-dispatcher.ts 的
 * executeAgentFlow 实现。
 */
export async function handleExecute(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<ExecutionResult> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Agent execute params must be an object.')
  }
  const p = params as Record<string, unknown>

  const conversationId = validateNonEmptyString(p['conversationId'], 'conversationId')
  const userInput = validateNonEmptyString(p['userInput'], 'userInput')
  const modelId = validateNonEmptyString(p['modelId'], 'modelId')
  assertApprovalMode(p['approvalMode'])

  const request: AgentExecutionRequest = {
    conversationId,
    userInput,
    modelId,
    approvalMode: p['approvalMode'] as ApprovalMode,
    maxSteps: (p['maxSteps'] as number) || 20,
    skillName: p['skillName'] as string | undefined,
    attachments: Array.isArray(p['attachments']) ? p['attachments'] : undefined,
    customAgents: Array.isArray(p['customAgents']) ? p['customAgents'] : undefined,
    activeAgent: typeof p['activeAgent'] === 'string' ? p['activeAgent'] : undefined,
    commands: Array.isArray(p['commands']) ? p['commands'] : undefined,
    systemMessageMode: p['systemMessageMode'] as 'append' | 'replace' | 'customize' | undefined,
    systemMessageSections: p['systemMessageSections'] as Record<string, unknown> | undefined,
  }

  // 核心执行流程（含并发控制）由 dispatcher 管理
  return executeAgentFlow(request)
}

/**
 * agent:stop - 取消当前 Agent 执行。
 */
export function handleStop(): void {
  const executor = getCurrentExecutor()
  const bridge = getCurrentBridge()
  const lgBridge = getCurrentLangGraphBridge()
  if (executor) {
    executor.cancel()
  }
  if (bridge) {
    void bridge.cancel()
  }
  if (lgBridge) {
    lgBridge.cancel()
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

  validateNonEmptyString(p['executionId'], 'executionId')

  // OPT2-07: 校验 approved 必须是 boolean，防止字符串 'false' 被当 truthy
  if (typeof p['approved'] !== 'boolean') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "approved" must be a boolean (true or false).',
      { approved: p['approved'] },
    )
  }
  const approved = p['approved'] as boolean
  const reason = typeof p['reason'] === 'string' ? p['reason'] : undefined
  const executionId = p['executionId'] as string

  const executor = getCurrentExecutor()
  const bridge = getCurrentBridge()
  const lgBridge = getCurrentLangGraphBridge()
  if (executor) {
    executor.respondApproval(approved, reason, executionId)
  }
  if (bridge) {
    bridge.respondApproval(approved, reason, executionId)
  }
  if (lgBridge) {
    lgBridge.respondApproval(approved, reason, executionId)
  }
}

/**
 * agent:respond-user-input - 响应 AI 主动提问（ask_user）。
 *
 * 支持 Copilot SDK 引擎和 LangGraph 引擎（委托工具集成）。
 * 优先检查 Copilot SDK bridge，其次检查 LangGraph bridge。
 */
export function handleRespondUserInput(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Params must be an object.')
  }
  const p = params as Record<string, unknown>

  const requestId = validateNonEmptyString(p['requestId'], 'requestId')
  if (typeof p['response'] !== 'string') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "response" must be a string.',
    )
  }

  const response = p['response'] as string

  // Copilot SDK 引擎
  const bridge = getCurrentBridge()
  if (bridge) {
    const success = bridge.respondToUserInput(requestId, response)
    if (!success) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No matching user input request found. It may have timed out or been cancelled.',
      )
    }
    return
  }

  // LangGraph 引擎（委托工具集成）
  const lgBridge = getCurrentLangGraphBridge()
  if (lgBridge) {
    const success = lgBridge.respondToUserInput(requestId, response)
    if (!success) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No matching user input request found. It may have timed out or been cancelled.',
      )
    }
    return
  }
}

/**
 * agent:respond-elicitation - 响应 elicitation 表单交互。
 *
 * 支持 Copilot SDK 引擎和 LangGraph 引擎（委托工具集成）。
 * 优先检查 Copilot SDK bridge，其次检查 LangGraph bridge。
 */
export function handleRespondElicitation(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Params must be an object.')
  }
  const p = params as Record<string, unknown>

  const requestId = validateNonEmptyString(p['requestId'], 'requestId')
  if (typeof p['response'] !== 'object' || p['response'] === null) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "response" must be an object.',
    )
  }

  const response = p['response'] as Record<string, unknown>

  // Copilot SDK 引擎
  const bridge = getCurrentBridge()
  if (bridge) {
    const success = bridge.respondToElicitation(requestId, response)
    if (!success) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No matching elicitation request found. It may have timed out or been cancelled.',
      )
    }
    return
  }

  // LangGraph 引擎（委托工具集成）
  const lgBridge = getCurrentLangGraphBridge()
  if (lgBridge) {
    const success = lgBridge.respondToElicitation(requestId, response)
    if (!success) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No matching elicitation request found. It may have timed out or been cancelled.',
      )
    }
    return
  }
}

/**
 * agent:switch-model - 运行时切换模型（保持对话历史）。
 * 使用 SDK 的 session.setModel()，无需重建 session。
 */
async function handleSwitchModel(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<boolean> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Switch model params must be an object.')
  }
  const p = params as Record<string, unknown>

  const modelId = validateNonEmptyString(p['modelId'], 'modelId')

  const bridge = getCurrentBridge()
  if (!bridge) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'No active agent session. Switch model can only be used during an active conversation.',
    )
  }

  const { buildProviderConfigById } = await import('../copilot/provider-config')
  const providerConfig = buildProviderConfigById(modelId)
  if (!providerConfig) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Model not found: ${modelId}`,
    )
  }

  return bridge.setModel(modelId, providerConfig)
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
  // B7: 查询当前活跃的 SDK 会话列表（用于会话管理 UI）
  {
    channel: 'agent:list-sessions',
    handler: () => getSessionManager().listActiveSessions(),
  },
  // ask_user: 响应 AI 主动提问
  {
    channel: 'agent:respond-user-input',
    handler: (_event, params: unknown) => handleRespondUserInput(params),
  },
  // elicitation: 响应表单交互请求
  {
    channel: 'agent:respond-elicitation',
    handler: (_event, params: unknown) => handleRespondElicitation(params),
  },
  // 运行时切换模型（保持对话历史）
  {
    channel: 'agent:switch-model',
    handler: (event, params: unknown) => handleSwitchModel(event, params),
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

  // 应用退出时清理所有 SDK session
  // 使用 before-quit 事件确保在窗口关闭前清理
  if (!app._sessionCleanupRegistered) {
    app.on('before-quit', () => {
      void getSessionManager().destroyAllSessions()
    })
    app._sessionCleanupRegistered = true
  }
}
