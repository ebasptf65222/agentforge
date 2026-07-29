// AgentForge P2-04: Agent IPC Handlers + Preload 扩展
// 实现 agent 命名空间的 IPC handlers：
// agent:execute, agent:stop, agent:approve
// 事件推送: agent:trajectory, agent:approval-request, agent:stream-chunk

import { ipcMain, app, type IpcMainInvokeHandler } from 'electron'
import type {
  AgentExecutionRequest,
  ExecutionResult,
  TAOTrajectory,
  ApprovalRequest,
  ApprovalMode,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { assertNonEmptyString } from '../utils/assertions'
import { getMainWindowWebContents } from '../utils/electron-helpers'
import { getModelAdapter } from '../models/router'
import { getSettings } from '../db/repos/app-settings'
import {
  getConversationById,
  updateLastMessageAt,
  updateSdkSessionId,
  updateConversationTitle,
} from '../db/repos/conversation'
import { createMessage, getMessagesByConversationId } from '../db/repos/message'
import { getToolRegistry } from '../tools/registry'
import { AgentExecutor, type AgentExecutorConfig } from '../agent/executor'
import { CopilotAgentBridge } from '../copilot/agent-bridge'
import type { SessionExtras } from '../copilot/types'
import type { AgentEventCallbacks, RegisteredTool } from '../agent/types'
import { resolveSkill, buildSkillExecutionContext, filterTools } from '../skills/skill-executor'
import { loadProjectRules, formatRulesPrompt } from '../agent/project-rules'
import {
  manageContext,
  getModelContextWindow,
  chatMessagesToContext,
} from '../agent/context-manager'
import { getSessionManager } from '../copilot/session-manager'

// ─── 并发控制 ─────────────────────────────────────────────────────

/** 当前正在运行的 AgentExecutor */
let currentExecutor: AgentExecutor | null = null
/** 当前正在运行的 CopilotAgentBridge（SDK 引擎） */
let currentBridge: CopilotAgentBridge | null = null

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

// ─── 主窗口事件推送 ───────────────────────────────────────────────

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
 * 使用 Copilot SDK 引擎执行 Agent 请求。
 *
 * 增强版：支持 Skill 集成（prompt 注入 + 工具过滤）、workingDirectory、
 * largeOutput、reasoningEffort 等 SDK 高级能力。
 */
async function executeWithCopilotSdk(request: AgentExecutionRequest): Promise<ExecutionResult> {
  const callbacks: AgentEventCallbacks = {
    onTrajectory: (trajectory) => sendTrajectory(trajectory),
    onApprovalRequest: (approvalRequest) => sendApprovalRequest(approvalRequest),
    onStreamChunk: (chunk) => {
      // 标题自动生成：更新对话标题
      if (chunk.type === 'title' && chunk.content) {
        try {
          updateConversationTitle(request.conversationId, chunk.content)
        } catch {
          // Ignore title update errors
        }
      }
      sendStreamChunk(chunk)
    },
  }

  const settings = getSettings()

  const bridge = new CopilotAgentBridge({
    callbacks,
    approvalTimeoutMs: settings.approvalTimeoutMs,
  })
  currentBridge = bridge

  let result: ExecutionResult
  try {
    // 验证会话存在，并读取 sdkSessionId（用于 resume）
    const conversation = getConversationById(request.conversationId)

    // 保存用户消息
    createMessage({
      conversationId: request.conversationId,
      role: 'user',
      content: request.userInput,
    })

    // ─── 构建 SessionExtras ────────────────────────────────────
    const extras: SessionExtras = {}

    // SDK 持久化会话模式：不再需要手动加载历史对话
    // SDK 的 Infinite Sessions 机制自动管理上下文窗口和对话历史
    // 传入 conversationId 以复用 SDK session
    extras.conversationId = request.conversationId

    // 1. 解析 Skill（用户指定或意图匹配）
    //    SDK 引擎复用现有 skills/ 模块，使用当前会话模型做意图匹配
    const skillResolution = await resolveSkill(
      request.userInput,
      request.skillName,
      getModelAdapter(request.modelId),
    )

    if (skillResolution.skill !== null) {
      const skill = skillResolution.skill

      // Skill 指定模型时，覆盖 BYOK 配置
      if (skill.modelId !== undefined) {
        request.modelId = skill.modelId
      }

      // 构建执行上下文（替换变量、构建 prompt 段落）
      // tools 参数传入空 Map — SDK 引擎的 prompt 构建不需要工具定义
      const skillCtx = buildSkillExecutionContext(skill, new Map())

      extras.systemMessageContent = skillCtx.skillPrompt
      extras.availableTools = skill.allowedTools.length > 0 ? skill.allowedTools : undefined
    }

    // 2. 传入工作区路径（文件操作上下文）
    if (settings.workspace.path) {
      extras.workingDirectory = settings.workspace.path
    }

    // 3. 加载项目规则文件（AGENTS.md）
    const projectRules = await loadProjectRules()
    if (projectRules) {
      const rulesPrompt = formatRulesPrompt(projectRules)
      if (extras.systemMessageContent) {
        extras.systemMessageContent += rulesPrompt
      } else {
        extras.systemMessageContent = rulesPrompt.trim()
      }
    }

    // 4. 传入推理强度（如果设置中有配置）
    if (settings.copilotReasoningEffort) {
      extras.reasoningEffort = settings.copilotReasoningEffort
    }

    // 5. 传入 sdkSessionId（从数据库读取，用于 resume 已有 SDK session）
    if (conversation.sdkSessionId) {
      extras.sdkSessionId = conversation.sdkSessionId
    }

    // 6. 传入技能目录配置（从 app_settings 读取）
    // SDK 会自动从这些目录加载技能文件（.md 格式的技能定义）
    if (settings.copilotSkillDirectories && settings.copilotSkillDirectories.length > 0) {
      extras.skillDirectories = settings.copilotSkillDirectories
    }

    // 7. 配置自动发现（从工作目录自动发现 .mcp.json 和 skill 目录）
    if (settings.copilotEnableConfigDiscovery) {
      extras.enableConfigDiscovery = true
    }

    // 8. 上下文层级
    if (settings.copilotContextTier) {
      extras.contextTier = settings.copilotContextTier
    }

    // 9. 推理摘要模式
    if (settings.copilotReasoningSummary) {
      extras.reasoningSummary = settings.copilotReasoningSummary
    }

    // 10. 排除的工具列表
    if (settings.copilotExcludedTools && settings.copilotExcludedTools.length > 0) {
      extras.excludedTools = settings.copilotExcludedTools
    }

    // 11. 主机 Git 操作
    if (settings.copilotEnableHostGitOperations !== undefined) {
      extras.enableHostGitOperations = settings.copilotEnableHostGitOperations
    }

    // 12. 客户端名称
    extras.clientName = 'AgentForge'

    // 13. 工具搜索配置
    if (settings.copilotToolSearchDeferThreshold !== undefined && settings.copilotToolSearchDeferThreshold > 0) {
      extras.toolSearch = { deferThreshold: settings.copilotToolSearchDeferThreshold }
    }

    // 14. 默认代理排除的工具
    if (settings.copilotDefaultAgentExcludedTools && settings.copilotDefaultAgentExcludedTools.length > 0) {
      extras.defaultAgentExcludedTools = settings.copilotDefaultAgentExcludedTools
    }

    // 15. Open Plugins 目录
    if (settings.copilotPluginDirectories && settings.copilotPluginDirectories.length > 0) {
      extras.pluginDirectories = settings.copilotPluginDirectories
    }

    // 16. 自定义指令目录
    if (settings.copilotInstructionDirectories && settings.copilotInstructionDirectories.length > 0) {
      extras.instructionDirectories = settings.copilotInstructionDirectories
    }

    // 17. 记忆功能
    if (settings.copilotEnableMemory) {
      extras.enableMemory = true
    }

    // 18. 跳过自定义指令
    if (settings.copilotSkipCustomInstructions) {
      extras.skipCustomInstructions = true
    }

    // 19. ask_user 双向交互
    if (settings.copilotEnableAskUser) {
      extras.enableAskUser = true
    }

    // 20. elicitation 表单交互
    if (settings.copilotEnableElicitation) {
      extras.enableElicitation = true
    }

    // 21. Agent 执行模式
    if (settings.copilotAgentMode) {
      extras.agentMode = settings.copilotAgentMode
    }

    // 22. 最大提示词 token 数（压缩阈值）
    if (settings.copilotMaxPromptTokens && settings.copilotMaxPromptTokens > 0) {
      extras.maxPromptTokens = settings.copilotMaxPromptTokens
    }

    // 23. 排除的内置代理
    if (settings.copilotExcludedBuiltinAgents && settings.copilotExcludedBuiltinAgents.length > 0) {
      extras.excludedBuiltinAgents = settings.copilotExcludedBuiltinAgents
    }

    // 24. 技能加载开关
    if (settings.copilotEnableSkills !== undefined) {
      extras.enableSkills = settings.copilotEnableSkills
    }

    // 25. 禁用的技能列表
    if (settings.copilotDisabledSkills && settings.copilotDisabledSkills.length > 0) {
      extras.disabledSkills = settings.copilotDisabledSkills
    }

    // 26. 上下文压缩阈值
    if (settings.copilotInfiniteSessionThreshold && settings.copilotInfiniteSessionThreshold > 0) {
      extras.infiniteSessionThreshold = settings.copilotInfiniteSessionThreshold
    }

    // 27. 大输出最大字节数
    if (settings.copilotLargeOutputMaxSize && settings.copilotLargeOutputMaxSize > 0) {
      extras.largeOutputMaxSize = settings.copilotLargeOutputMaxSize
    }

    // 28. Per-conversation 配置（从请求参数传递）
    // 自定义代理配置
    if (request.customAgents && request.customAgents.length > 0) {
      extras.customAgents = request.customAgents.map((a) => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        tools: a.tools ?? null,
        prompt: a.prompt,
        infer: a.infer ?? true,
        model: a.model,
        reasoningEffort: a.reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh' | undefined,
        skills: a.skills,
      }))
    }

    // 预选激活的代理
    if (request.activeAgent) {
      extras.activeAgent = request.activeAgent
    }

    // 自定义斜杠命令
    if (request.commands && request.commands.length > 0) {
      extras.commands = request.commands
    }

    // 系统提示词模式
    if (request.systemMessageMode) {
      extras.systemMessageMode = request.systemMessageMode
    }

    // 系统提示词分区配置
    if (request.systemMessageSections) {
      extras.systemMessageSections = request.systemMessageSections as SessionExtras['systemMessageSections']
    }

    // 执行 SDK Agent（传入 extras 配置）
    result = await bridge.execute(request, extras)

    // 如果是新 session，将 sdkSessionId 持久化到数据库（供下次 resume）
    if (bridge.wasNewSession()) {
      const sdkSessionId = bridge.getSdkSessionId()
      if (sdkSessionId) {
        updateSdkSessionId(request.conversationId, sdkSessionId)
      }
    }

    // 保存助手回复
    createMessage({
      conversationId: request.conversationId,
      role: 'assistant',
      content: result.summary,
      thinking: result.trajectories.map((t) => `Step ${t.step}: ${t.thought}`).join('\n\n'),
    })

    updateLastMessageAt(request.conversationId)
  } catch (error) {
    // 保存错误信息到消息（透传真实错误信息，而非吞掉为 "Execution failed"）
    console.error('[Agent SDK] Execution error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Execution failed'
    createMessage({
      conversationId: request.conversationId,
      role: 'assistant',
      content: errorMessage,
      thinking: undefined,
    })
    updateLastMessageAt(request.conversationId)
    throw error
  } finally {
    currentBridge = null
  }

  return result
}

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
    attachments: Array.isArray(p['attachments']) ? p['attachments'] : undefined,
    customAgents: Array.isArray(p['customAgents']) ? p['customAgents'] : undefined,
    activeAgent: typeof p['activeAgent'] === 'string' ? p['activeAgent'] : undefined,
    commands: Array.isArray(p['commands']) ? p['commands'] : undefined,
    systemMessageMode: p['systemMessageMode'] as 'append' | 'replace' | 'customize' | undefined,
    systemMessageSections: p['systemMessageSections'] as Record<string, unknown> | undefined,
  }

  // 1. 并发控制 - OPT-02: 在任何 await 之前设置锁，防止竞态条件
  if (currentExecutor !== null || currentBridge !== null) {
    throw new AppError(ErrorCodes.CHAT_ALREADY_RUNNING, 'An agent execution is already running.')
  }

  // 2. 获取设置，判断引擎类型
  const settings = getSettings()

  // SDK 引擎路径：使用 Copilot SDK
  if (settings.engineType === 'copilot-sdk') {
    return executeWithCopilotSdk(request)
  }

  // 内置引擎路径：使用 AgentExecutor
  // 根据模型配置获取上下文窗口大小（替代硬编码的 4096）
  const contextWindow = getModelContextWindow(request.modelId)
  const executorConfig: AgentExecutorConfig = {
    adapter: getModelAdapter(request.modelId),
    tools: getToolsMap(),
    callbacks: {
      onTrajectory: (trajectory) => sendTrajectory(trajectory),
      onApprovalRequest: (approvalRequest) => sendApprovalRequest(approvalRequest),
      onStreamChunk: (chunk) => sendStreamChunk(chunk),
    },
    approvalTimeoutMs: settings.approvalTimeoutMs,
    maxContextLength: contextWindow,
    skillPrompt: undefined,
  }

  // 3. 在任何 await 之前创建执行器并持有锁
  const executor = new AgentExecutor(executorConfig)
  currentExecutor = executor

  // OPT2-03: 所有后续操作包入 try/finally，确保锁在异常时也能释放
  let result: ExecutionResult
  try {
    // 4. 验证会话存在
    getConversationById(request.conversationId)

    // 5. 加载历史对话消息并进行上下文窗口管理
    //    在保存当前用户消息之前加载，避免重复包含当前输入
    const rawHistory = getMessagesByConversationId(request.conversationId)
    const historyContext = chatMessagesToContext(rawHistory)
    const contextResult = manageContext(historyContext, {
      maxContextTokens: contextWindow,
    })
    executorConfig.historyMessages = contextResult.messages
    if (contextResult.truncated) {
      console.info(
        `[Agent Builtin] Context truncated: ${contextResult.originalCount} -> ${contextResult.retainedCount} messages, ~${contextResult.estimatedTokens} tokens`,
      )
    }

    // 6. 保存用户消息
    createMessage({
      conversationId: request.conversationId,
      role: 'user',
      content: request.userInput,
    })

    // 7. 解析 Skill（用户指定或意图匹配）
    const skillResolution = await resolveSkill(request.userInput, request.skillName, executorConfig.adapter)

    if (skillResolution.skill !== null) {
      const skill = skillResolution.skill

      // 7a. 如果 Skill 指定了 modelId，使用该模型
      if (skill.modelId !== undefined) {
        executorConfig.adapter = getModelAdapter(skill.modelId)
      }

      // 7b. 构建执行上下文（替换变量、过滤工具）
      const skillCtx = buildSkillExecutionContext(skill, executorConfig.tools)
      executorConfig.skillPrompt = skillCtx.skillPrompt

      // 7c. 过滤工具列表
      executorConfig.tools = filterTools(executorConfig.tools, skill.allowedTools)
    }

    // 8. 执行 Agent
    result = await executor.execute(request)

    // 9. 保存助手回复
    createMessage({
      conversationId: request.conversationId,
      role: 'assistant',
      content: result.summary,
      thinking: result.trajectories.map((t) => `Step ${t.step}: ${t.thought}`).join('\n\n'),
    })

    updateLastMessageAt(request.conversationId)
  } catch (error) {
    // 保存错误信息到消息（透传真实错误信息，而非吞掉为 "Execution failed"）
    console.error('[Agent Builtin] Execution error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Execution failed'
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

  return result
}

/**
 * agent:stop - 取消当前 Agent 执行。
 */
export function handleStop(): void {
  if (currentExecutor) {
    currentExecutor.cancel()
  }
  if (currentBridge) {
    void currentBridge.cancel()
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

  if (currentExecutor) {
    currentExecutor.respondApproval(approved, reason)
  }
  if (currentBridge) {
    currentBridge.respondApproval(approved, reason)
  }
}

/**
 * agent:respond-user-input - 响应 AI 主动提问（ask_user）。
 */
export function handleRespondUserInput(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['requestId'], 'requestId')
  if (typeof p['response'] !== 'string') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "response" must be a string.',
    )
  }

  if (currentBridge) {
    const success = currentBridge.respondToUserInput(p['requestId'], p['response'] as string)
    if (!success) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No matching user input request found. It may have timed out or been cancelled.',
      )
    }
  }
}

/**
 * agent:respond-elicitation - 响应 elicitation 表单交互。
 */
export function handleRespondElicitation(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['requestId'], 'requestId')
  if (typeof p['response'] !== 'object' || p['response'] === null) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "response" must be an object.',
    )
  }

  if (currentBridge) {
    const success = currentBridge.respondToElicitation(
      p['requestId'],
      p['response'] as Record<string, unknown>,
    )
    if (!success) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No matching elicitation request found. It may have timed out or been cancelled.',
      )
    }
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

  assertNonEmptyString(p['modelId'], 'modelId')

  if (!currentBridge) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'No active agent session. Switch model can only be used during an active conversation.',
    )
  }

  const { buildProviderConfigById } = await import('../copilot/provider-config')
  const providerConfig = buildProviderConfigById(p['modelId'] as string)
  if (!providerConfig) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Model not found: ${p['modelId'] as string}`,
    )
  }

  return currentBridge.setModel(p['modelId'] as string, providerConfig)
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
