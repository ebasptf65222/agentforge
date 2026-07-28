// Copilot SDK <-> AgentForge IPC bridge
// Manages CopilotClient lifecycle, session creation, and event streaming
// Step 2: Basic integration - BYOK streaming text only (no tools yet)

import { CopilotClient } from '@github/copilot-sdk'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory } from '@shared/types'
import type { AgentEventCallbacks } from '../agent/types'
import { buildProviderConfigById } from './provider-config'
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
 * 3. On completion (session.idle), ExecutionResult is returned
 * 4. cancel() aborts the session and returns a cancelled result
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkSession = any

export class CopilotAgentBridge {
  private client: CopilotClient | null = null
  private session: SdkSession = null
  private readonly callbacks: AgentEventCallbacks
  private cancelled = false
  private startTime = 0
  private accumulatedContent = ''
  private trajectories: TAOTrajectory[] = []
  private totalTokens = 0
  private stepCounter = 0
  private idleResolve: (() => void) | null = null

  constructor(callbacks: AgentEventCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Execute an agent request using Copilot SDK with BYOK streaming.
   */
  async execute(request: AgentExecutionRequest): Promise<ExecutionResult> {
    this.startTime = Date.now()
    this.stepCounter = 0
    this.cancelled = false
    this.accumulatedContent = ''
    this.trajectories = []
    this.totalTokens = 0

    try {
      // 1. Build BYOK provider config from AgentForge model config
      const { model, provider } = buildProviderConfigById(request.modelId)

      // 2. Create and start CopilotClient (spawns CLI subprocess)
      this.client = new CopilotClient()
      await this.client.start()

      // 3. Create session with BYOK config and streaming enabled
      const session: SdkSession = await this.client.createSession({
        model,
        provider,
        streaming: true,
      } as Record<string, unknown>)
      this.session = session

      // 4. Subscribe to SDK streaming events
      this.subscribeToEvents(session)

      // 5. Set up completion promise (resolves on session.idle)
      const idlePromise = new Promise<void>((resolve) => {
        this.idleResolve = resolve
      })

      // 6. Send user message (non-blocking, events stream via callbacks)
      await session.send({ prompt: request.userInput })

      // 7. Wait for session to become idle (completion signal)
      await idlePromise

      // 8. Build and return execution result
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
   * Respond to an approval request.
   * Placeholder - will be implemented in Step 3 (tool-bridge).
   */
  respondApproval(_approved: boolean, _reason?: string): void {
    // Step 3 will implement tool approval via onPermissionRequest / hooks
  }

  /**
   * Clean up SDK resources (session + client).
   */
  private async cleanup(): Promise<void> {
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
