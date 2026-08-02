// AgentForge 架构优化批次二 - 任务1: EngineDispatcher
//
// 从 ipc/agent.ts 中提取的三引擎路由分发逻辑。
// 职责：
// 1. 三引擎路由分发（builtin / copilot-sdk / langgraph）
// 2. 并发控制（currentExecutor / currentBridge / currentLangGraphBridge）
// 3. 主窗口事件推送（trajectory / approval-request / stream-chunk）
// 4. 微批次回调构建（createBatchedCallbacks）
//
// agent.ts 仅保留 IPC handler 注册和参数校验，核心执行逻辑移入此文件。

import type {
  AgentExecutionRequest,
  ExecutionResult,
  TAOTrajectory,
  ApprovalRequest,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { StreamBatcher } from '../utils/stream-batcher'
import { getMainWindowWebContents } from '../utils/electron-helpers'
import { getModelAdapter } from '../models/router'
import { getSettings } from '../db/repos/app-settings'
import {
  updateSdkSessionId,
  updateConversationTitle,
} from '../db/repos/conversation'
import { getToolRegistry } from '../tools/registry'
import { AgentExecutor, type AgentExecutorConfig } from './executor'
import { CopilotAgentBridge } from '../copilot/agent-bridge'
import { LangGraphAgentBridge } from '../langgraph/bridge'
import type { SessionExtras } from '../copilot/types'
import type { AgentEventCallbacks, RegisteredTool } from './types'
import { resolveSkill, buildSkillExecutionContext, filterTools } from '../skills/skill-executor'
import { loadProjectRules, formatRulesPrompt } from './project-rules'
import { getModelContextWindow } from './context-manager'
import {
  loadHistoryAndTruncate,
  saveAgentResult,
  saveAgentError,
  validateConversationAndSaveUserMessage,
} from './engine-commons'
import { ExecutionLock } from './execution-lock'

// ─── 并发控制 ─────────────────────────────────────────────────────

/**
 * 引擎句柄类型（判别联合）。
 * 锁持有时存储当前活跃引擎的类型和引用。
 */
type EngineHandle =
  | { readonly type: 'builtin'; readonly executor: AgentExecutor }
  | { readonly type: 'copilot-sdk'; readonly bridge: CopilotAgentBridge }
  | { readonly type: 'langgraph'; readonly bridge: LangGraphAgentBridge }

/** 全局执行锁，替代三个独立的模块级变量 */
const executionLock = new ExecutionLock<EngineHandle>()

/**
 * 获取当前 AgentExecutor（仅供测试使用）。
 */
export function getCurrentExecutor(): AgentExecutor | null {
  const handle = executionLock.getCurrent()
  return handle?.type === 'builtin' ? handle.executor : null
}

/**
 * 重置当前执行锁（仅供测试使用）。
 */
export function resetCurrentExecutor(): void {
  executionLock.reset()
}

/**
 * 获取当前 CopilotAgentBridge（供 IPC handler 使用）。
 */
export function getCurrentBridge(): CopilotAgentBridge | null {
  const handle = executionLock.getCurrent()
  return handle?.type === 'copilot-sdk' ? handle.bridge : null
}

/**
 * 获取当前 LangGraphAgentBridge（供 IPC handler 使用）。
 */
export function getCurrentLangGraphBridge(): LangGraphAgentBridge | null {
  const handle = executionLock.getCurrent()
  return handle?.type === 'langgraph' ? handle.bridge : null
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

/**
 * 创建带微批次优化的 AgentEventCallbacks。
 * 文本 chunk 通过 StreamBatcher 累积 50ms 后批量推送，
 * 非 text chunk（如 title/approval）立即推送。
 *
 * @param conversationId - 可选的会话 ID。提供时，title chunk 会自动更新会话标题。
 * @returns callbacks 和 flush/destroy 方法
 */
export function createBatchedCallbacks(conversationId?: string): {
  callbacks: AgentEventCallbacks
  flush: () => void
  destroy: () => void
} {
  const batcher = new StreamBatcher((combined) => {
    sendStreamChunk({ type: 'text', content: combined })
  })

  return {
    callbacks: {
      onTrajectory: (trajectory) => sendTrajectory(trajectory),
      onApprovalRequest: (approvalRequest) => sendApprovalRequest(approvalRequest),
      onStreamChunk: (chunk) => {
        if (chunk.type === 'text' && chunk.content) {
          batcher.push(chunk.content)
        } else {
          batcher.flush()
          // title chunk：更新会话标题（如果提供了 conversationId）
          if (chunk.type === 'title' && chunk.content && conversationId) {
            try {
              updateConversationTitle(conversationId, chunk.content)
            } catch {
              // Ignore title update errors
            }
          }
          sendStreamChunk(chunk)
        }
      },
    },
    flush: () => batcher.flush(),
    destroy: () => batcher.destroy(),
  }
}

// ─── 工具注册表转换 ───────────────────────────────────────────────

/**
 * 从全局 ToolRegistry 获取工具映射。
 */
export function getToolsMap(): Map<string, RegisteredTool> {
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

// ─── 引擎执行 ─────────────────────────────────────────────────────

/**
 * 使用 LangGraph 引擎执行 Agent 请求。
 *
 * LangGraph 引擎使用 LangChain + LangGraph 框架，复用现有 ModelAdapter 和 ToolRegistry。
 * 支持流式输出、工具调用、审批机制，与现有 UI 完全兼容。
 */
async function executeWithLangGraph(request: AgentExecutionRequest): Promise<ExecutionResult> {
  const { callbacks, flush, destroy } = createBatchedCallbacks(request.conversationId)

  const settings = getSettings()

  const bridge = new LangGraphAgentBridge({
    callbacks,
    approvalTimeoutMs: settings.approvalTimeoutMs,
  })
  executionLock.acquire({ type: 'langgraph', bridge })

  let result: ExecutionResult
  try {
    // 验证会话存在 + 保存用户消息
    validateConversationAndSaveUserMessage(request.conversationId, request.userInput)

    // 加载历史对话消息
    const contextWindow = getModelContextWindow(request.modelId)
    const contextResult = loadHistoryAndTruncate(
      request.conversationId,
      contextWindow,
      '[Agent LangGraph]',
    )

    // 解析 Skill
    let adapter = getModelAdapter(request.modelId)
    const tools = getToolsMap()
    let skillPrompt: string | undefined

    const skillResolution = await resolveSkill(request.userInput, request.skillName, adapter)
    if (skillResolution.skill !== null) {
      const skill = skillResolution.skill

      try {
        const skillCtx = buildSkillExecutionContext(skill, tools)
        skillPrompt = skillCtx.skillPrompt

        // Skill 指定 modelId 时切换模型适配器
        if (skill.modelId !== undefined) {
          adapter = getModelAdapter(skill.modelId)
        }

        // 过滤工具（清除后重新填充，避免冗余操作）
        const filteredTools = filterTools(tools, skill.allowedTools)
        tools.clear()
        for (const [key, value] of filteredTools) {
          tools.set(key, value)
        }
      } catch (err) {
        // 自动匹配的 Skill 如果有必填变量缺失，降级为无 Skill（不阻断对话）
        if (skillResolution.source === 'auto') {
          console.warn(
            `[Agent LangGraph] Auto-matched skill "${skill.name}" failed to build context, skipping:`,
            err instanceof Error ? err.message : err,
          )
        } else {
          throw err
        }
      }
    }

    // 执行
    result = await bridge.execute({
      request,
      adapter,
      tools,
      historyMessages: contextResult.messages,
      skillPrompt,
    })

    // 保存助手回复
    saveAgentResult(request.conversationId, result)
  } catch (error) {
    console.error('[Agent LangGraph] Execution error:', error)
    saveAgentError(request.conversationId, error)
    throw error
  } finally {
    flush()
    destroy()
    executionLock.release()
  }

  return result
}

/**
 * 使用 Copilot SDK 引擎执行 Agent 请求。
 *
 * 增强版：支持 Skill 集成（prompt 注入 + 工具过滤）、workingDirectory、
 * largeOutput、reasoningEffort 等 SDK 高级能力。
 */
async function executeWithCopilotSdk(request: AgentExecutionRequest): Promise<ExecutionResult> {
  const { callbacks, flush, destroy } = createBatchedCallbacks(request.conversationId)

  const settings = getSettings()

  const bridge = new CopilotAgentBridge({
    callbacks,
    approvalTimeoutMs: settings.approvalTimeoutMs,
  })
  executionLock.acquire({ type: 'copilot-sdk', bridge })

  let result: ExecutionResult
  try {
    // 验证会话存在 + 保存用户消息，并获取 conversation（用于读取 sdkSessionId）
    const conversation = validateConversationAndSaveUserMessage(
      request.conversationId,
      request.userInput,
    )

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

      try {
        // Skill 指定模型时，覆盖 BYOK 配置
        if (skill.modelId !== undefined) {
          request.modelId = skill.modelId
        }

        // 构建执行上下文（替换变量、构建 prompt 段落）
        // tools 参数传入空 Map — SDK 引擎的 prompt 构建不需要工具定义
        const skillCtx = buildSkillExecutionContext(skill, new Map())

        extras.systemMessageContent = skillCtx.skillPrompt
        extras.availableTools = skill.allowedTools.length > 0 ? skill.allowedTools : undefined
      } catch (err) {
        // 自动匹配的 Skill 如果有必填变量缺失，降级为无 Skill（不阻断对话）
        if (skillResolution.source === 'auto') {
          console.warn(
            `[Agent] Auto-matched skill "${skill.name}" failed to build context, skipping:`,
            err instanceof Error ? err.message : err,
          )
        } else {
          // 手动指定的 Skill 变量缺失，抛出错误提示用户
          throw err
        }
      }
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
    saveAgentResult(request.conversationId, result)
  } catch (error) {
    // 保存错误信息到消息（透传真实错误信息，而非吞掉为 "Execution failed"）
    console.error('[Agent SDK] Execution error:', error)
    saveAgentError(request.conversationId, error)
    throw error
  } finally {
    flush()
    destroy()
    executionLock.release()
  }

  return result
}

/**
 * 使用内置 ReAct 引擎执行 Agent 请求。
 *
 * 流程：
 * 1. 验证会话存在
 * 2. 加载历史对话消息并进行上下文窗口管理
 * 3. 保存用户消息
 * 4. 解析 Skill（用户指定或意图匹配）
 * 5. 创建 AgentExecutor 并执行
 * 6. 保存执行结果到消息表
 */
async function executeWithBuiltin(
  request: AgentExecutionRequest,
  settings: ReturnType<typeof getSettings>,
): Promise<ExecutionResult> {
  // 根据模型配置获取上下文窗口大小（替代硬编码的 4096）
  const contextWindow = getModelContextWindow(request.modelId)
  const { callbacks: batchedCallbacks, flush: flushBatcher, destroy: destroyBatcher } = createBatchedCallbacks()
  const executorConfig: AgentExecutorConfig = {
    adapter: getModelAdapter(request.modelId),
    tools: getToolsMap(),
    callbacks: batchedCallbacks,
    approvalTimeoutMs: settings.approvalTimeoutMs,
    maxContextLength: contextWindow,
    skillPrompt: undefined,
  }

  // 在任何 await 之前创建执行器并持有锁
  const executor = new AgentExecutor(executorConfig)
  executionLock.acquire({ type: 'builtin', executor })

  // 所有后续操作包入 try/finally，确保锁在异常时也能释放
  let result: ExecutionResult
  try {
    // 加载历史对话消息并进行上下文窗口管理
    //    在保存当前用户消息之前加载，避免重复包含当前输入
    const contextResult = loadHistoryAndTruncate(
      request.conversationId,
      contextWindow,
      '[Agent Builtin]',
    )
    executorConfig.historyMessages = contextResult.messages

    // 验证会话存在 + 保存用户消息
    validateConversationAndSaveUserMessage(request.conversationId, request.userInput)

    // 解析 Skill（用户指定或意图匹配）
    const skillResolution = await resolveSkill(request.userInput, request.skillName, executorConfig.adapter)

    if (skillResolution.skill !== null) {
      const skill = skillResolution.skill

      // 如果 Skill 指定了 modelId，使用该模型
      if (skill.modelId !== undefined) {
        executorConfig.adapter = getModelAdapter(skill.modelId)
      }

      try {
        // 构建执行上下文（替换变量、过滤工具）
        const skillCtx = buildSkillExecutionContext(skill, executorConfig.tools)
        executorConfig.skillPrompt = skillCtx.skillPrompt

        // 过滤工具列表
        executorConfig.tools = filterTools(executorConfig.tools, skill.allowedTools)
      } catch (err) {
        // 自动匹配的 Skill 如果有必填变量缺失，降级为无 Skill（不阻断对话）
        if (skillResolution.source === 'auto') {
          console.warn(
            `[Agent Builtin] Auto-matched skill "${skill.name}" failed to build context, skipping:`,
            err instanceof Error ? err.message : err,
          )
        } else {
          // 手动指定的 Skill 变量缺失，抛出错误提示用户
          throw err
        }
      }
    }

    // 执行 Agent
    result = await executor.execute(request)

    // 保存助手回复
    saveAgentResult(request.conversationId, result)
  } catch (error) {
    // 保存错误信息到消息（透传真实错误信息，而非吞掉为 "Execution failed"）
    console.error('[Agent Builtin] Execution error:', error)
    saveAgentError(request.conversationId, error)
    throw error
  } finally {
    flushBatcher()
    destroyBatcher()
    executionLock.release()
  }

  return result
}

/**
 * 三引擎路由分发入口。
 *
 * 根据设置中的 engineType 分发到对应引擎执行：
 * - 'builtin'    → 内置 ReAct 引擎（AgentExecutor）
 * - 'copilot-sdk' → Copilot SDK 引擎（CopilotAgentBridge）
 * - 'langgraph'  → LangGraph 引擎（LangGraphAgentBridge）
 *
 * 包含并发控制：在任何 await 之前检查并设置锁，防止竞态条件。
 *
 * @param request - 已校验的 Agent 执行请求
 * @returns 执行结果
 * @throws {AppError} CHAT_ALREADY_RUNNING - 已有执行在运行
 */
export async function executeAgentFlow(request: AgentExecutionRequest): Promise<ExecutionResult> {
  // 并发控制：锁的 acquire 会在各引擎函数内部完成
  // 此处仅做前置检查，提供更清晰的错误信息
  if (executionLock.isLocked()) {
    throw new AppError(ErrorCodes.CHAT_ALREADY_RUNNING, 'An agent execution is already running.')
  }

  // 获取设置，判断引擎类型
  const settings = getSettings()

  // SDK 引擎路径：使用 Copilot SDK
  if (settings.engineType === 'copilot-sdk') {
    return executeWithCopilotSdk(request)
  }

  // LangGraph 引擎路径：使用 LangChain + LangGraph
  if (settings.engineType === 'langgraph') {
    return executeWithLangGraph(request)
  }

  // 内置引擎路径：使用 AgentExecutor
  return executeWithBuiltin(request, settings)
}
