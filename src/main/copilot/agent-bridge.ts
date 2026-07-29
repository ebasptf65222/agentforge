// Copilot SDK <-> AgentForge IPC bridge
// Manages Copilot SDK session lifecycle and event streaming
// 使用持久化会话模式：每个对话复用同一 session，启用 SDK 原生上下文压缩

import { randomUUID } from 'node:crypto'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory } from '@shared/types'
import type { AgentEventCallbacks } from '../agent/types'
import { ApprovalManager } from '../agent/approval'
import { buildProviderConfigById } from './provider-config'
import { bridgeAllTools, type ToolBridgeContext } from './tool-bridge'
import { buildMcpServersConfig } from './mcp-bridge'
import {
  convertMessageDelta,
  convertReasoningDelta,
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
  private cancelled = false
  private startTime = 0
  private accumulatedContent = ''
  private trajectories: TAOTrajectory[] = []
  private totalTokens = 0
  private stepCounter = 0
  private idleResolve: (() => void) | null = null
  /** 标记是否为新建 session（首次对话） */
  private isNewSession = false

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
  async execute(
    request: AgentExecutionRequest,
    extras?: SessionExtras,
  ): Promise<ExecutionResult> {
    this.startTime = Date.now()
    this.stepCounter = 0
    this.cancelled = false
    this.accumulatedContent = ''
    this.trajectories = []
    this.totalTokens = 0

    const executionId = randomUUID()
    this.approvalManager = new ApprovalManager()

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

      // 4a. 注入 Skill 系统提示词（仅新 session 生效）
      if (extras?.systemMessageContent) {
        sessionConfig['systemMessage'] = { content: extras.systemMessageContent }
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

      // 5. 通过 SessionManager 获取或创建 session
      const conversationId = extras?.conversationId || request.conversationId
      const sessionManager = getSessionManager()
      this.isNewSession = !sessionManager.hasSession(conversationId)
      this.session = await sessionManager.getOrCreateSession(conversationId, sessionConfig)

      // 6. Subscribe to SDK streaming events
      this.subscribeToEvents(this.session)

      // 7. Set up completion promise
      const idlePromise = new Promise<void>((resolve) => {
        this.idleResolve = resolve
      })

      // 8. Send user message (直接发送，无需拼接历史)
      //    SDK 持久化 session 自动维护对话历史和上下文压缩
      await this.session.send({ prompt: request.userInput })

      // 9. Wait for session to become idle
      await idlePromise

      // 10. Build and return execution result
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
      const trajectory = buildFinalTrajectory(
        this.stepCounter,
        this.accumulatedContent,
        Date.now(),
      )
      this.trajectories.push(trajectory)
      this.callbacks.onTrajectory(trajectory)

      if (this.idleResolve) {
        this.idleResolve()
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

    if (this.session) {
      try {
        await this.session.abort()
      } catch {
        // Ignore abort errors
      }
    }
    if (this.idleResolve) {
      this.idleResolve()
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
   * 清理本次执行的状态（不销毁持久化 session）。
   */
  private cleanupExecutionState(): void {
    if (this.approvalManager) {
      this.approvalManager.cancel()
      this.approvalManager = null
    }
    // 注意：不 disconnect session 和不 stop client
    // session 由 SessionManager 统一管理生命周期
    this.session = null
    this.idleResolve = null
  }
}
