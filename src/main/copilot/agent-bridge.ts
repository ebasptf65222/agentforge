// Copilot SDK <-> AgentForge IPC bridge
// Manages CopilotClient lifecycle, session creation, and event streaming
// Step 3: Tool bridging + approval mechanism integration

import { randomUUID } from 'node:crypto'
import { CopilotClient } from '@github/copilot-sdk'
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

/**
 * Bridges Copilot SDK sessions to AgentForge's IPC event system.
 *
 * Lifecycle:
 * 1. execute() creates a CopilotClient + session with BYOK provider config
 * 2. SDK streaming events are converted to AgentForge StreamChunk / TAOTrajectory
 * 3. Tool calls are bridged via defineTool with embedded approval checks
 * 4. On completion (session.idle), ExecutionResult is returned
 * 5. cancel() aborts the session and returns a cancelled result
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkSession = any

export interface CopilotBridgeOptions {
  callbacks: AgentEventCallbacks
  approvalTimeoutMs: number
}

export class CopilotAgentBridge {
  private client: CopilotClient | null = null
  private session: SdkSession = null
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

  constructor(options: CopilotBridgeOptions) {
    this.callbacks = options.callbacks
    this.approvalTimeoutMs = options.approvalTimeoutMs
  }

  /**
   * Execute an agent request using Copilot SDK with BYOK streaming and tools.
   */
  async execute(request: AgentExecutionRequest): Promise<ExecutionResult> {
    this.startTime = Date.now()
    this.stepCounter = 0
    this.cancelled = false
    this.accumulatedContent = ''
    this.trajectories = []
    this.totalTokens = 0

    // Generate unique execution ID for approval tracking
    const executionId = randomUUID()

    // Create approval manager for this execution
    this.approvalManager = new ApprovalManager()

    try {
      // 1. Build BYOK provider config from AgentForge model config
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

      // 3. Create and start CopilotClient (spawns CLI subprocess)
      this.client = new CopilotClient()
      await this.client.start()

      // 4. Build MCP servers config from database (SDK manages connections)
      const mcpServers = buildMcpServersConfig()

      // 5. Create session with BYOK config, streaming, bridged tools, and MCP servers
      const session: SdkSession = await this.client.createSession({
        model,
        provider,
        streaming: true,
        tools,
        mcpServers,
      } as Record<string, unknown>)
      this.session = session

      // 6. Subscribe to SDK streaming events
      this.subscribeToEvents(session)

      // 7. Set up completion promise (resolves on session.idle)
      const idlePromise = new Promise<void>((resolve) => {
        this.idleResolve = resolve
      })

      // 8. Send user message (non-blocking, events stream via callbacks)
      await session.send({ prompt: request.userInput })

      // 9. Wait for session to become idle (completion signal)
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
      // If cancelled, return a cancelled result instead of throwing
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
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Subscribe to SDK session events and convert them to AgentForge IPC events.
   */
  private subscribeToEvents(session: SdkSession): void {
    // Streaming text deltas -> agent:stream-chunk (type: text)
    session.on('assistant.message_delta', (event: unknown) => {
      const e = event as { data?: { deltaContent?: string } }
      const delta = e.data?.deltaContent || ''
      if (delta) {
        this.accumulatedContent += delta
        this.callbacks.onStreamChunk(convertMessageDelta(delta))
      }
    })

    // Streaming reasoning deltas -> agent:stream-chunk (type: thinking)
    session.on('assistant.reasoning_delta', (event: unknown) => {
      const e = event as { data?: { deltaContent?: string } }
      const delta = e.data?.deltaContent || ''
      if (delta) {
        this.callbacks.onStreamChunk(convertReasoningDelta(delta))
      }
    })

    // Token usage tracking
    session.on('assistant.usage', (event: unknown) => {
      const e = event as { data?: { inputTokens?: number; outputTokens?: number } }
      const input = e.data?.inputTokens || 0
      const output = e.data?.outputTokens || 0
      this.totalTokens = input + output
    })

    // Session idle = generation complete
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
   * Cancel the current execution by aborting the SDK session.
   */
  async cancel(): Promise<void> {
    this.cancelled = true

    // Cancel any pending approval
    if (this.approvalManager) {
      this.approvalManager.cancel()
    }

    if (this.session) {
      try {
        await this.session.abort()
      } catch {
        // Ignore abort errors - session may already be idle
      }
    }
    // Resolve the idle promise to unblock execute()
    if (this.idleResolve) {
      this.idleResolve()
    }
  }

  /**
   * Respond to an approval request from the user.
   * Forwards the response to the ApprovalManager which unblocks the tool handler.
   */
  respondApproval(approved: boolean, reason?: string): void {
    if (this.approvalManager) {
      this.approvalManager.respond(approved, reason)
    }
  }

  /**
   * Clean up SDK resources (session + client + approval manager).
   */
  private async cleanup(): Promise<void> {
    // Clean up any pending approval
    if (this.approvalManager) {
      this.approvalManager.cancel()
      this.approvalManager = null
    }

    if (this.session) {
      try {
        await this.session.disconnect()
      } catch {
        // Ignore disconnect errors during cleanup
      }
      this.session = null
    }
    if (this.client) {
      try {
        await this.client.stop()
      } catch {
        // Ignore stop errors during cleanup
      }
      this.client = null
    }
    this.idleResolve = null
  }
}
