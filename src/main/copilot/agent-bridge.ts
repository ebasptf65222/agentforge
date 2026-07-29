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
import type { SessionExtras } from './types'
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
        const agents = extras.customAgents.map((a) => ({
          name: a.name,
          displayName: a.displayName ?? a.name,
          description: a.description ?? '',
          tools: a.tools ?? null,
          prompt: a.prompt,
          infer: a.infer ?? true,
        }))
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
      await this.session.sendAndWait(sendParams)

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
   */
  private subscribeToEvents(session: SdkSession): void {
    // 先移除旧监听器（如果有）
    session.removeAllListeners?.('assistant.message_delta')
    session.removeAllListeners?.('assistant.reasoning_delta')
    session.removeAllListeners?.('assistant.usage')
    session.removeAllListeners?.('session.idle')
    session.removeAllListeners?.('session.compaction_start')
    session.removeAllListeners?.('session.compaction_complete')
    session.removeAllListeners?.('tool.execution_start')
    session.removeAllListeners?.('tool.execution_complete')
    session.removeAllListeners?.('tool.execution_progress')
    session.removeAllListeners?.('session.title_changed')
    session.removeAllListeners?.('session.usage_info')
    session.removeAllListeners?.('session.error')
    session.removeAllListeners?.('subagent.selected')
    session.removeAllListeners?.('subagent.completed')
    session.removeAllListeners?.('subagent.failed')

    session.on('assistant.message_delta', (event: unknown) => {
      const e = event as { data?: { deltaContent?: string } }
      const delta = e.data?.deltaContent || ''
      if (delta) {
        this.accumulatedContent += delta
        this.callbacks.onStreamChunk(convertMessageDelta(delta))
      }
    })

    session.on('assistant.reasoning_delta', (event: unknown) => {
      const e = event as { data?: { deltaContent?: string } }
      const delta = e.data?.deltaContent || ''
      if (delta) {
        this.callbacks.onStreamChunk(convertReasoningDelta(delta))
      }
    })

    session.on('assistant.usage', (event: unknown) => {
      const e = event as { data?: { inputTokens?: number; outputTokens?: number } }
      const input = e.data?.inputTokens || 0
      const output = e.data?.outputTokens || 0
      this.totalTokens = input + output
    })

    session.on('session.idle', () => {
      this.stepCounter++
      const trajectory = buildFinalTrajectory(this.stepCounter, this.accumulatedContent, Date.now())
      this.trajectories.push(trajectory)
      this.callbacks.onTrajectory(trajectory)
      // 不再需要 idleResolve，sendAndWait 内部管理
    })

    // ─── 上下文压缩开始 ────────────────────────────────────────
    session.on('session.compaction_start', () => {
      this.isCompacting = true
      this.callbacks.onStreamChunk(convertCompactionStart('上下文压缩中...'))
    })

    // ─── 上下文压缩完成 ────────────────────────────────────────
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
    })

    // ─── 工具执行开始 ────────────────────────────────────────────
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
    })

    // ─── 工具执行完成 ────────────────────────────────────────────
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
    })

    // ─── 工具执行进度 ────────────────────────────────────────────
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
    })

    // ─── 会话标题自动生成 ────────────────────────────────────────
    session.on('session.title_changed', (event: unknown) => {
      const e = event as { data?: { title?: string } }
      const title = e.data?.title
      if (title) {
        // 通过 stream-chunk 推送标题变更（IPC 层会更新数据库）
        this.callbacks.onStreamChunk(convertTitle(title))
      }
    })

    // ─── 上下文窗口使用量 ────────────────────────────────────────
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
    })

    // ─── 会话错误 ────────────────────────────────────────────────
    session.on('session.error', (event: unknown) => {
      const e = event as { data?: { errorType?: string; message?: string; statusCode?: number } }
      const data = e.data
      if (data) {
        console.error(`[CopilotAgentBridge] Session error: ${data.errorType} - ${data.message}`)
        this.callbacks.onStreamChunk(convertSessionError(JSON.stringify(data)))
      }
    })

    // 子代理选择
    session.on('subagent.selected', (event: unknown) => {
      const e = event as { data?: { agentName?: string; agentDisplayName?: string } }
      const data = e.data
      if (data?.agentName) {
        this.callbacks.onStreamChunk({
          type: 'tool-start',
          content: JSON.stringify({ subagent: data.agentName, displayName: data.agentDisplayName }),
        })
      }
    })

    // 子代理完成
    session.on('subagent.completed', (event: unknown) => {
      const e = event as { data?: { toolCallId?: string } }
      const data = e.data
      if (data?.toolCallId) {
        this.callbacks.onStreamChunk({
          type: 'tool-complete',
          content: JSON.stringify({ subagent: true, toolCallId: data.toolCallId }),
        })
      }
    })

    // 子代理失败
    session.on('subagent.failed', (event: unknown) => {
      const e = event as { data?: { error?: string } }
      const data = e.data
      if (data?.error) {
        this.callbacks.onStreamChunk({
          type: 'error',
          content: JSON.stringify({ subagent: true, error: data.error }),
        })
      }
    })
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
   */
  respondApproval(approved: boolean, reason?: string): void {
    if (this.approvalManager) {
      this.approvalManager.respond(approved, reason)
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
   * 清理本次执行的状态（不销毁持久化 session）。
   */
  private cleanupExecutionState(): void {
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
