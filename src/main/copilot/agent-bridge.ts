// Copilot SDK <-> AgentForge IPC bridge
// Manages Copilot SDK session lifecycle and event streaming
// 使用持久化会话模式：每个对话复用同一 session，启用 SDK 原生上下文压缩

import { randomUUID } from 'node:crypto'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory } from '@shared/types'
import type { AgentEventCallbacks } from '../agent/types'
import { ApprovalManager } from '../agent/approval'
import { UserInputManager } from '../agent/user-input'
import { buildProviderConfigById } from './provider-config'
import { bridgeAllTools, type ToolBridgeContext } from './tool-bridge'
import { buildMcpServersConfig } from './mcp-bridge'
import {
  convertMessageDelta,
  convertReasoningDelta,
  convertCompactionStart,
  convertCompactionComplete,
  convertToolStart,
  convertToolComplete,
  convertToolProgress,
  convertTitle,
  convertUsageInfo,
  convertSessionError,
  buildFinalTrajectory,
} from './event-converter'
import type { SessionExtras, SdkProviderConfig } from './types'
import { getSessionManager } from './session-manager'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkSession = any

export interface CopilotBridgeOptions {
  callbacks: AgentEventCallbacks
  approvalTimeoutMs: number
}

/**
 * Bridges Copilot SDK sessions to AgentForge's IPC event system.
 *
 * 持久化会话模式：
 * 1. 通过 SessionManager 获取/复用 session（每个 conversationId 一个）
 * 2. SDK 自动管理上下文窗口（Infinite Sessions + 后台压缩）
 * 3. 工具调用通过 defineTool 桥接并嵌入审批检查
 * 4. session.idle 表示本次消息处理完成（session 保持活跃）
 * 5. cancel() 中止当前消息处理但不销毁 session
 */
export class CopilotAgentBridge {
  private session: SdkSession | null = null
  private readonly callbacks: AgentEventCallbacks
  private readonly approvalTimeoutMs: number
  private approvalManager: ApprovalManager | null = null
  private userInputManager: UserInputManager | null = null
  private cancelled = false
  private startTime = 0
  private accumulatedContent = ''
  private trajectories: TAOTrajectory[] = []
  private totalTokens = 0
  private stepCounter = 0
  /** 标记是否为新建 session（首次对话） */
  private isNewSession = false
  /** SDK 分配的 sessionId（execute 完成后供 IPC 层读取并持久化） */
  private sdkSessionId: string | undefined = undefined
  /** SDK session 事件 unsubscribe 函数集合（防止重复订阅） */
  private eventUnsubscribers: Array<() => void> = []
  /** 上下文使用量信息 */
  private contextUsage: {
    tokenLimit: number
    currentTokens: number
    messagesLength: number
  } | null = null
  /** 压缩状态 */
  private isCompacting = false

  constructor(options: CopilotBridgeOptions) {
    this.callbacks = options.callbacks
    this.approvalTimeoutMs = options.approvalTimeoutMs
  }

  /**
   * Execute an agent request using Copilot SDK.
   *
   * 持久化会话模式：复用已有 session 或创建新 session。
   * SDK 通过 Infinite Sessions 自动管理上下文窗口。
   *
   * @param request - Agent execution request
   * @param extras - Optional session extras (Skill prompt, tool filter, working dir, reasoning)
   */
  async execute(request: AgentExecutionRequest, extras?: SessionExtras): Promise<ExecutionResult> {
    this.startTime = Date.now()
    this.stepCounter = 0
    this.cancelled = false
    this.accumulatedContent = ''
    this.trajectories = []
    this.totalTokens = 0
    this.isCompacting = false

    const executionId = randomUUID()
    this.approvalManager = new ApprovalManager()
    this.userInputManager = new UserInputManager()

    try {
      // 1. Build BYOK provider config
      const { model, provider } = buildProviderConfigById(request.modelId)

      // 2. Bridge all registered tools with embedded approval checks
      const toolCtx: ToolBridgeContext = {
        executionId,
        approvalMode: request.approvalMode,
        approvalTimeoutMs: this.approvalTimeoutMs,
        approvalManager: this.approvalManager,
        callbacks: this.callbacks,
      }
      const tools = bridgeAllTools(toolCtx)

      // 3. Build MCP servers config
      const mcpServers = buildMcpServersConfig()

      // 4. Build session config (仅创建时使用，复用时不生效)
      const sessionConfig: Record<string, unknown> = {
        model,
        provider,
        streaming: true,
        tools,
        mcpServers,
      }

      // 4a. 注入系统提示词
      if (extras?.systemMessageContent || extras?.systemMessageSections) {
        if (extras?.systemMessageMode === 'customize' && extras.systemMessageSections) {
          // customize 模式：细粒度定制各分区
          const sections: Record<string, unknown> = {}
          for (const [key, config] of Object.entries(extras.systemMessageSections)) {
            const section: Record<string, unknown> = { action: config.action }
            if (config.content !== undefined) {
              section['content'] = config.content
            }
            sections[key] = section
          }
          sessionConfig['systemMessage'] = { mode: 'customize', sections }
        } else if (extras?.systemMessageMode === 'replace' && extras.systemMessageContent) {
          // replace 模式：完全替换
          sessionConfig['systemMessage'] = { mode: 'replace', content: extras.systemMessageContent }
        } else if (extras?.systemMessageContent) {
          // append 模式（默认）：追加到末尾
          sessionConfig['systemMessage'] = { content: extras.systemMessageContent }
        }
      }

      // 4b. 工具过滤
      if (extras?.availableTools && extras.availableTools.length > 0) {
        sessionConfig['availableTools'] = extras.availableTools
      }

      // 4c. 工作目录
      if (extras?.workingDirectory) {
        sessionConfig['workingDirectory'] = extras.workingDirectory
      }

      // 4d. 推理强度
      if (extras?.reasoningEffort) {
        sessionConfig['reasoningEffort'] = extras.reasoningEffort
      }

      // 4e. SDK Hooks — 生命周期钩子
      sessionConfig['hooks'] = {
        onPreToolUse: (_ctx: { toolName: string; toolArgs: Record<string, unknown> }) => {
          // 项目已通过 tool-bridge.ts 实现审批机制
          // SDK hooks 层面允许所有工具，审批由 tool handler 内部处理
          return { permissionDecision: 'allow' as const }
        },
        onPostToolUse: (ctx: { toolName: string; toolResult: unknown }) => {
          // 工具执行后：可以转换结果
          return { modifiedResult: ctx.toolResult }
        },
        onPreMcpToolCall: (ctx: {
          serverName: string
          toolName: string
          toolArgs: Record<string, unknown>
        }) => {
          // MCP 工具调用前：记录日志并允许执行
          // 如需按 serverName 过滤 MCP 工具，可在此实现
          console.log(
            `[CopilotAgentBridge] Pre MCP tool call: ${ctx.serverName}.${ctx.toolName}`,
          )
          return { permissionDecision: 'allow' as const }
        },
        onPostToolUseFailure: (ctx: { toolName: string; error: Error }) => {
          // 工具调用失败后：记录错误并通知前端
          console.error(
            `[CopilotAgentBridge] Tool use failure: ${ctx.toolName}, error: ${ctx.error.message}`,
          )
          this.callbacks.onStreamChunk({
            type: 'error',
            content: JSON.stringify({
              phase: 'tool-use-failure',
              toolName: ctx.toolName,
              message: ctx.error.message,
            }),
          })
          return { errorHandling: 'skip' as const }
        },
        onUserPromptSubmitted: (ctx: { prompt: string }) => {
          // 用户提交消息前：可以修改 prompt 或注入上下文
          return { modifiedPrompt: ctx.prompt }
        },
        onErrorOccurred: (ctx: { errorContext: string; recoverable: boolean }) => {
          // 错误处理
          console.error(
            `[CopilotAgentBridge] SDK Error: ${ctx.errorContext}, recoverable: ${ctx.recoverable}`,
          )
          return { errorHandling: 'skip' as const }
        },
        onSessionStart: (ctx: { source: string }) => {
          console.warn(`[CopilotAgentBridge] Session started: ${ctx.source}`)
          return { additionalContext: undefined }
        },
        onSessionEnd: (ctx: { reason: string }) => {
          console.warn(`[CopilotAgentBridge] Session ended: ${ctx.reason}`)
        },
      }

      // 4f. 自定义代理/子代理编排
      if (extras?.customAgents && extras.customAgents.length > 0) {
        const agents = extras.customAgents.map((a) => {
          const agent: Record<string, unknown> = {
            name: a.name,
            displayName: a.displayName ?? a.name,
            description: a.description ?? '',
            tools: a.tools ?? null,
            prompt: a.prompt,
            infer: a.infer ?? true,
          }
          // 代理专属模型（运行时解析为 SDK provider+model）
          if (a.model) {
            try {
              const providerConfig = buildProviderConfigById(a.model)
              if (providerConfig) {
                agent['model'] = providerConfig.model
                agent['provider'] = providerConfig.provider
              }
            } catch {
              // 模型解析失败，忽略（使用默认模型）
            }
          }
          // 代理专属推理强度
          if (a.reasoningEffort) {
            agent['reasoningEffort'] = a.reasoningEffort
          }
          // 预加载技能
          if (a.skills && a.skills.length > 0) {
            agent['skills'] = a.skills
          }
          return agent
        })
        sessionConfig['customAgents'] = agents
      }

      // 4g. 预选激活代理
      if (extras?.activeAgent) {
        sessionConfig['agent'] = extras.activeAgent
      }

      // 4h. ask_user — AI 主动向用户提问（双向 IPC 通信）
      if (extras?.enableAskUser) {
        const executionIdLocal = executionId
        sessionConfig['onUserInputRequest'] = async (request: { prompt: string }) => {
          if (!this.userInputManager) return { response: '' }
          // 推送问题到前端，等待用户通过 IPC 回复
          const response = await this.userInputManager.requestUserInput(
            executionIdLocal,
            request.prompt,
            (req) => {
              this.callbacks.onStreamChunk({
                type: 'ask-user',
                content: JSON.stringify(req),
              })
            },
            this.approvalTimeoutMs,
          )
          return { response }
        }
      }

      // 4i. Elicitation 表单交互（双向 IPC 通信）
      if (extras?.enableElicitation) {
        const executionIdLocal = executionId
        sessionConfig['onElicitationRequest'] = async (request: {
          message?: string
          form?: Record<string, unknown>
        }) => {
          if (!this.userInputManager) return { response: {} }
          // 推送表单到前端，等待用户通过 IPC 回复
          const response = await this.userInputManager.requestElicitation(
            executionIdLocal,
            request.message ?? '',
            request.form ?? {},
            (req) => {
              this.callbacks.onStreamChunk({
                type: 'elicitation-request',
                content: JSON.stringify(req),
              })
            },
            this.approvalTimeoutMs,
          )
          return { response }
        }
      }

      // 4j. 斜杠命令
      if (extras?.commands && extras.commands.length > 0) {
        sessionConfig['commands'] = extras.commands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description ?? '',
          handler: async (args: unknown) => {
            // 命令处理：推送事件到前端
            this.callbacks.onStreamChunk({
              type: 'tool-progress',
              content: JSON.stringify({ command: cmd.name, args }),
            })
            return { result: `Command ${cmd.name} executed` }
          },
        }))
      }

      // 4k. 技能目录（SDK skillDirectories）
      if (extras?.skillDirectories && extras.skillDirectories.length > 0) {
        sessionConfig['skillDirectories'] = extras.skillDirectories
      }

      // 4l. 技能加载开关
      if (extras?.enableSkills !== undefined) {
        sessionConfig['enableSkills'] = extras.enableSkills
      }

      // 4m. 禁用的技能列表
      if (extras?.disabledSkills && extras.disabledSkills.length > 0) {
        sessionConfig['disabledSkills'] = extras.disabledSkills
      }

      // 4n. 配置自动发现
      if (extras?.enableConfigDiscovery !== undefined) {
        sessionConfig['enableConfigDiscovery'] = extras.enableConfigDiscovery
      }

      // 4o. 客户端名称
      if (extras?.clientName) {
        sessionConfig['clientName'] = extras.clientName
      }

      // 4p. 上下文窗口层级
      if (extras?.contextTier) {
        sessionConfig['contextTier'] = extras.contextTier
      }

      // 4q. 推理摘要模式
      if (extras?.reasoningSummary) {
        sessionConfig['reasoningSummary'] = extras.reasoningSummary
      }

      // 4r. 排除的工具列表
      if (extras?.excludedTools && extras.excludedTools.length > 0) {
        sessionConfig['excludedTools'] = extras.excludedTools
      }

      // 4s. 主机 Git 操作
      if (extras?.enableHostGitOperations !== undefined) {
        sessionConfig['enableHostGitOperations'] = extras.enableHostGitOperations
      }

      // 4t. 工具搜索配置
      if (extras?.toolSearch !== undefined) {
        sessionConfig['toolSearch'] = extras.toolSearch
      }

      // 4u. 默认代理排除的工具
      if (extras?.defaultAgentExcludedTools && extras.defaultAgentExcludedTools.length > 0) {
        sessionConfig['defaultAgent'] = { excludedTools: extras.defaultAgentExcludedTools }
      }

      // 4v. Open Plugins 目录
      if (extras?.pluginDirectories && extras.pluginDirectories.length > 0) {
        sessionConfig['pluginDirectories'] = extras.pluginDirectories
      }

      // 4w. 自定义指令目录
      if (extras?.instructionDirectories && extras.instructionDirectories.length > 0) {
        sessionConfig['instructionDirectories'] = extras.instructionDirectories
      }

      // 4x. 记忆功能
      if (extras?.enableMemory !== undefined) {
        sessionConfig['memory'] = { enabled: extras.enableMemory }
      }

      // 4y. 跳过自定义指令
      if (extras?.skipCustomInstructions !== undefined) {
        sessionConfig['skipCustomInstructions'] = extras.skipCustomInstructions
      }

      // 4z. Agent 执行模式（plan/autopilot/shell）
      if (extras?.agentMode) {
        sessionConfig['agentMode'] = extras.agentMode
      }

      // 4aa. 最大提示词 token 数（压缩阈值）
      if (extras?.maxPromptTokens !== undefined && extras.maxPromptTokens > 0) {
        sessionConfig['maxPromptTokens'] = extras.maxPromptTokens
      }

      // 4ab. 排除的内置代理
      if (extras?.excludedBuiltinAgents && extras.excludedBuiltinAgents.length > 0) {
        sessionConfig['excludedBuiltinAgents'] = extras.excludedBuiltinAgents
      }

      // 4ac. 上下文压缩阈值（传递到 sessionConfig，由 session-manager 读取）
      if (extras?.infiniteSessionThreshold !== undefined && extras.infiniteSessionThreshold > 0) {
        sessionConfig['infiniteSessionThreshold'] = extras.infiniteSessionThreshold
      }

      // 4ad. 大输出最大字节数
      if (extras?.largeOutputMaxSize !== undefined && extras.largeOutputMaxSize > 0) {
        sessionConfig['largeOutputMaxSize'] = extras.largeOutputMaxSize
      }

      // 注：enableAskUser 和 enableElicitation 已在 4h/4i 中处理
      // IPC 层只需设置 extras.enableAskUser / extras.enableElicitation 即可触发

      // 5. 通过 SessionManager 获取或恢复 session
      const conversationId = extras?.conversationId || request.conversationId
      const sessionManager = getSessionManager()
      const { session, isNew } = await sessionManager.getOrResumeSession(
        conversationId,
        extras?.sdkSessionId ?? null,
        sessionConfig,
      )
      this.isNewSession = isNew
      this.session = session
      // 保存 SDK 分配的 sessionId，供 IPC 层持久化到数据库
      this.sdkSessionId = session.sessionId || session.id || undefined

      // 5a. 如果是新 session，通过流式通道通知前端 sdkSessionId
      if (isNew && this.sdkSessionId) {
        this.callbacks.onStreamChunk({ type: 'session-id', content: this.sdkSessionId })
      }

      // 6. Subscribe to SDK streaming events
      this.subscribeToEvents(this.session)

      // 7. Build send params (prompt + optional image attachments)
      const sendParams: {
        prompt: string
        attachments?: Array<{ type: string; data?: string; path?: string; mimeType: string }>
      } = { prompt: request.userInput }

      if (request.attachments && request.attachments.length > 0) {
        sendParams.attachments = request.attachments.map((img) => {
          // 从 dataUrl 中提取 mime type 和 base64 data
          // dataUrl 格式: "data:image/png;base64,iVBOR..."
          const match = img.dataUrl.match(/^data:(image\/\w+);base64,(.*)$/)
          if (match) {
            return {
              type: 'blob',
              data: match[2],
              mimeType: match[1],
            }
          }
          // 如果不是 dataUrl，尝试作为文件路径
          return {
            type: 'file',
            path: img.dataUrl,
            mimeType: 'image/png',
          }
        })
      }

      // 8. Send user message with attachments and wait for completion
      //    使用 SDK 的 sendAndWait，内部自动管理 idle 事件
      //    超时设为5分钟，避免模型响应慢时误报超时（默认60秒太短）
      await this.session.sendAndWait(sendParams, 5 * 60 * 1000)

      // 9. Build and return execution result
      const status = this.cancelled ? 'cancelled' : 'completed'
      const summary = this.accumulatedContent || 'No response generated.'

      const result: ExecutionResult = {
        executionId: request.conversationId,
        status,
        summary,
        trajectories: this.trajectories,
        totalSteps: this.stepCounter,
        duration: Date.now() - this.startTime,
        tokensUsed: this.totalTokens,
      }

      return result
    } catch (error) {
      if (this.cancelled) {
        return {
          executionId: request.conversationId,
          status: 'cancelled',
          summary: 'Execution cancelled by user.',
          trajectories: this.trajectories,
          totalSteps: this.stepCounter,
          duration: Date.now() - this.startTime,
          tokensUsed: this.totalTokens,
        }
      }
      console.error('[CopilotAgentBridge] Execution error:', error)
      throw error
    } finally {
      // 清理本次执行的状态（不销毁 session）
      this.cleanupExecutionState()
    }
  }

  /**
   * Subscribe to SDK session events.
   * 注意：每次 execute 都会重新订阅，需确保不重复订阅。
   * SDK session.on() 返回 unsubscribe 函数，不支持 removeAllListeners。
   */
  private subscribeToEvents(session: SdkSession): void {
    // 先清理旧监听器（使用 unsubscribe 函数，而非 removeAllListeners）
    for (const unsub of this.eventUnsubscribers) {
      try {
        unsub()
      } catch {
        // Ignore cleanup errors
      }
    }
    this.eventUnsubscribers = []

    this.eventUnsubscribers.push(
      session.on('assistant.message_delta', (event: unknown) => {
        const e = event as { data?: { deltaContent?: string } }
        const delta = e.data?.deltaContent || ''
        if (delta) {
          this.accumulatedContent += delta
          this.callbacks.onStreamChunk(convertMessageDelta(delta))
        }
      }),
    )

    this.eventUnsubscribers.push(
      session.on('assistant.reasoning_delta', (event: unknown) => {
        const e = event as { data?: { deltaContent?: string } }
        const delta = e.data?.deltaContent || ''
        if (delta) {
          this.callbacks.onStreamChunk(convertReasoningDelta(delta))
        }
      }),
    )

    this.eventUnsubscribers.push(
      session.on('assistant.usage', (event: unknown) => {
        const e = event as { data?: { inputTokens?: number; outputTokens?: number } }
        const input = e.data?.inputTokens || 0
        const output = e.data?.outputTokens || 0
        this.totalTokens = input + output
      }),
    )

    this.eventUnsubscribers.push(
      session.on('session.idle', () => {
        this.stepCounter++
        const trajectory = buildFinalTrajectory(this.stepCounter, this.accumulatedContent, Date.now())
        this.trajectories.push(trajectory)
        this.callbacks.onTrajectory(trajectory)
        // 不再需要 idleResolve，sendAndWait 内部管理
      }),
    )

    // ─── 上下文压缩开始 ────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('session.compaction_start', () => {
        this.isCompacting = true
        this.callbacks.onStreamChunk(convertCompactionStart('上下文压缩中...'))
      }),
    )

    // ─── 上下文压缩完成 ────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('session.compaction_complete', (event: unknown) => {
        this.isCompacting = false
        const e = event as {
          data?: {
            success?: boolean
            preCompactionTokens?: number
            postCompactionTokens?: number
            messagesRemoved?: number
            tokensRemoved?: number
            summaryContent?: string
          }
        }
        const data = e.data
        if (data) {
          const saved = (data.preCompactionTokens ?? 0) - (data.postCompactionTokens ?? 0)
          const msg = `上下文压缩完成：移除 ${data.messagesRemoved ?? 0} 条消息，节省 ${saved} tokens`
          this.callbacks.onStreamChunk(convertCompactionComplete(msg))
          console.warn(
            `[CopilotAgentBridge] Compaction: ${data.messagesRemoved ?? 0} messages removed, ${saved} tokens saved`,
          )
        }
      }),
    )

    // ─── 工具执行开始 ────────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('tool.execution_start', (event: unknown) => {
        const e = event as {
          data?: {
            toolCallId?: string
            toolName?: string
            arguments?: Record<string, unknown>
            parentToolCallId?: string
          }
        }
        const data = e.data
        if (data?.toolName) {
          this.callbacks.onStreamChunk(
            convertToolStart(
              JSON.stringify({
                toolName: data.toolName,
                toolCallId: data.toolCallId,
                arguments: data.arguments,
              }),
            ),
          )
        }
      }),
    )

    // ─── 工具执行完成 ────────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('tool.execution_complete', (event: unknown) => {
        const e = event as {
          data?: {
            toolCallId?: string
            success?: boolean
            result?: { content?: string }
            error?: { message?: string }
          }
        }
        const data = e.data
        if (data) {
          const content = data.success
            ? (data.result?.content ?? '')
            : (data.error?.message ?? 'Tool failed')
          this.callbacks.onStreamChunk(
            convertToolComplete(
              JSON.stringify({
                toolCallId: data.toolCallId,
                success: data.success,
                content,
              }),
            ),
          )
        }
      }),
    )

    // ─── 工具执行进度 ────────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('tool.execution_progress', (event: unknown) => {
        const e = event as { data?: { toolCallId?: string; progressMessage?: string } }
        const data = e.data
        if (data?.progressMessage) {
          this.callbacks.onStreamChunk(
            convertToolProgress(
              JSON.stringify({ toolCallId: data.toolCallId, message: data.progressMessage }),
            ),
          )
        }
      }),
    )

    // ─── 会话标题自动生成 ────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('session.title_changed', (event: unknown) => {
        const e = event as { data?: { title?: string } }
        const title = e.data?.title
        if (title) {
          // 通过 stream-chunk 推送标题变更（IPC 层会更新数据库）
          this.callbacks.onStreamChunk(convertTitle(title))
        }
      }),
    )

    // ─── 上下文窗口使用量 ────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('session.usage_info', (event: unknown) => {
        const e = event as {
          data?: { tokenLimit?: number; currentTokens?: number; messagesLength?: number }
        }
        const data = e.data
        if (data) {
          this.contextUsage = {
            tokenLimit: data.tokenLimit ?? 0,
            currentTokens: data.currentTokens ?? 0,
            messagesLength: data.messagesLength ?? 0,
          }
          this.callbacks.onStreamChunk(convertUsageInfo(JSON.stringify(this.contextUsage)))
        }
      }),
    )

    // ─── 会话错误 ────────────────────────────────────────────────
    this.eventUnsubscribers.push(
      session.on('session.error', (event: unknown) => {
        const e = event as { data?: { errorType?: string; message?: string; statusCode?: number } }
        const data = e.data
        if (data) {
          console.error(`[CopilotAgentBridge] Session error: ${data.errorType} - ${data.message}`)
          this.callbacks.onStreamChunk(convertSessionError(JSON.stringify(data)))
        }
      }),
    )

    // 子代理选择
    this.eventUnsubscribers.push(
      session.on('subagent.selected', (event: unknown) => {
        const e = event as { data?: { agentName?: string; agentDisplayName?: string } }
        const data = e.data
        if (data?.agentName) {
          this.callbacks.onStreamChunk({
            type: 'tool-start',
            content: JSON.stringify({ subagent: data.agentName, displayName: data.agentDisplayName }),
          })
        }
      }),
    )

    // 子代理完成
    this.eventUnsubscribers.push(
      session.on('subagent.completed', (event: unknown) => {
        const e = event as { data?: { toolCallId?: string } }
        const data = e.data
        if (data?.toolCallId) {
          this.callbacks.onStreamChunk({
            type: 'tool-complete',
            content: JSON.stringify({ subagent: true, toolCallId: data.toolCallId }),
          })
        }
      }),
    )

    // 子代理失败
    this.eventUnsubscribers.push(
      session.on('subagent.failed', (event: unknown) => {
        const e = event as { data?: { error?: string } }
        const data = e.data
        if (data?.error) {
          this.callbacks.onStreamChunk({
            type: 'error',
            content: JSON.stringify({ subagent: true, error: data.error }),
          })
        }
      }),
    )
  }

  /**
   * Cancel the current execution.
   * 中止当前消息处理，但不销毁 session（session 保持活跃供下次使用）。
   */
  async cancel(): Promise<void> {
    this.cancelled = true
    if (this.approvalManager) {
      this.approvalManager.cancel()
    }
    if (this.userInputManager) {
      this.userInputManager.cancel()
    }
    if (this.session) {
      try {
        await this.session.abort()
      } catch {
        // Ignore abort errors
      }
    }
  }

  /**
   * Respond to an approval request.
   *
   * @param approved - Whether the approval is granted
   * @param reason - Optional reason for the decision
   * @param executionId - Optional execution ID for validation
   */
  respondApproval(approved: boolean, reason?: string, executionId?: string): void {
    if (this.approvalManager) {
      this.approvalManager.respond(approved, reason, executionId)
    }
  }

  /**
   * Respond to an ask_user request (from frontend via IPC).
   */
  respondToUserInput(requestId: string, response: string): boolean {
    if (this.userInputManager) {
      return this.userInputManager.respondToUserInput(requestId, response)
    }
    return false
  }

  /**
   * Respond to an elicitation request (from frontend via IPC).
   */
  respondToElicitation(requestId: string, response: Record<string, unknown>): boolean {
    if (this.userInputManager) {
      return this.userInputManager.respondToElicitation(requestId, response)
    }
    return false
  }

  /**
   * 返回本次执行是否创建了新 session。
   * 在 execute() 返回后由 IPC 层调用，用于决定是否持久化 sdkSessionId。
   */
  wasNewSession(): boolean {
    return this.isNewSession
  }

  /**
   * 返回本次执行获取到的 SDK sessionId。
   * 在 execute() 返回后由 IPC 层调用，用于持久化到数据库。
   */
  getSdkSessionId(): string | undefined {
    return this.sdkSessionId
  }

  /**
   * 运行时切换模型（保持对话历史）。
   * SDK 的 session.setModel() 允许在不重建 session 的情况下切换模型。
   *
   * @param modelId - 新的模型 ID（AgentForge 内部 ID）
   * @param providerConfig - BYOK provider 配置
   * @returns 是否切换成功
   */
  async setModel(modelId: string, providerConfig: { provider: SdkProviderConfig; model: string }): Promise<boolean> {
    if (!this.session) {
      console.warn('[CopilotAgentBridge] Cannot setModel: no active session')
      return false
    }
    try {
      this.session.setModel?.({
        provider: providerConfig.provider,
        model: providerConfig.model,
      })
      console.info(`[CopilotAgentBridge] Model switched to: ${modelId}`)
      return true
    } catch (error) {
      console.error(`[CopilotAgentBridge] Failed to switch model to ${modelId}:`, error)
      return false
    }
  }

  /**
   * 清理本次执行的状态（不销毁持久化 session）。
   */
  private cleanupExecutionState(): void {
    // 清理 SDK 事件监听器（防止下次 execute 时重复订阅）
    for (const unsub of this.eventUnsubscribers) {
      try {
        unsub()
      } catch {
        // Ignore cleanup errors
      }
    }
    this.eventUnsubscribers = []

    if (this.approvalManager) {
      this.approvalManager.cancel()
      this.approvalManager = null
    }
    if (this.userInputManager) {
      this.userInputManager.cancel()
      this.userInputManager = null
    }
    // 注意：不 disconnect session 和不 stop client
    // session 由 SessionManager 统一管理生命周期
    this.session = null
  }
}
