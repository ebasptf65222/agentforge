// P2-09: AgentStore - Pinia store for Agent execution state
// Enhanced: auto-approval rules, approval history, remember choice

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  TAOTrajectory,
  ApprovalRequest,
  ExecutionResult,
  ExecutionStatus,
  ApprovalMode,
  StreamChunk,
  AuditReport,
  AuditInput,
  UserInputRequest,
  ElicitationRequest,
} from '@shared/types'
import { useContextUsageStore } from '@/stores/context-usage'

export const useAgentStore = defineStore('agent', () => {
  // ─── State ───────────────────────────────────────────────────

  /** Current execution status */
  const status = ref<ExecutionStatus>('idle')

  /** Current execution ID */
  const executionId = ref<string | null>(null)

  /** Trajectory list for current execution */
  const trajectories = ref<TAOTrajectory[]>([])

  /** Current pending approval request */
  const pendingApproval = ref<ApprovalRequest | null>(null)

  /** Pending ask_user request (AI is asking the user a question) */
  const pendingUserInput = ref<UserInputRequest | null>(null)

  /** Pending elicitation request (AI is asking the user to fill a form) */
  const pendingElicitation = ref<ElicitationRequest | null>(null)

  /** Streaming text content */
  const streamingContent = ref('')

  /** Streaming thinking/reasoning content (from SDK reasoning_delta events) */
  const streamingThinking = ref('')

  /** Last execution result */
  const lastResult = ref<ExecutionResult | null>(null)

  /** Error message if execution failed */
  const error = ref<string | null>(null)

  /** Last audit report (persists after execution until next execution starts) */
  const auditReport = ref<AuditReport | null>(null)

  /** Whether audit is currently being generated */
  const auditLoading = ref(false)

  /** Last execution conversationId (not in ExecutionResult, needed for audit) */
  const lastConversationId = ref<string | null>(null)

  /** Last execution approvalMode (not in ExecutionResult, needed for audit) */
  const lastApprovalMode = ref<ApprovalMode | null>(null)

  /**
   * Auto-approval rules for current session.
   * Key format: `${toolName}:${riskLevel}` — matching requests are auto-approved.
   */
  const autoApprovalRules = ref<Set<string>>(new Set())

  /** Approval history for current session (audit trail) */
  const approvalHistory = ref<
    Array<{
      request: ApprovalRequest
      approved: boolean
      reason?: string
      respondedAt: number
      autoApproved: boolean
    }>
  >([])

  // ─── Getters ─────────────────────────────────────────────────

  /** Whether agent is currently running */
  const isRunning = computed(() => status.value === 'running')

  /** Whether agent is waiting for approval */
  const isWaitingApproval = computed(() => pendingApproval.value !== null)

  /** Total steps executed */
  const totalSteps = computed(() => trajectories.value.length)

  /** Success count */
  const successCount = computed(
    () => trajectories.value.filter((t) => t.status === 'success').length,
  )

  /** Error count */
  const errorCount = computed(() => trajectories.value.filter((t) => t.status === 'error').length)

  // ─── Actions ─────────────────────────────────────────────────

  /** Start a new agent execution */
  async function execute(params: {
    conversationId: string
    userInput: string
    modelId: string
    approvalMode: ApprovalMode
    maxSteps?: number
    skillName?: string
  }): Promise<ExecutionResult | null> {
    // Reset state
    status.value = 'running'
    executionId.value = null
    trajectories.value = []
    pendingApproval.value = null
    streamingContent.value = ''
    streamingThinking.value = ''
    lastResult.value = null
    error.value = null
    auditReport.value = null
    auditLoading.value = false

    // Store params needed for audit (not in ExecutionResult)
    lastConversationId.value = params.conversationId
    lastApprovalMode.value = params.approvalMode

    try {
      const result = await window.electron.agent.execute(params)
      lastResult.value = result
      status.value = result.status
      executionId.value = result.executionId
      return result
    } catch (e) {
      status.value = 'failed'
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Stop current execution */
  async function stop(): Promise<void> {
    await window.electron.agent.stop()
    status.value = 'cancelled'
  }

  /** Respond to pending approval (with optional "remember" flag) */
  async function respondApproval(
    approved: boolean,
    reason?: string,
    remember?: boolean,
  ): Promise<void> {
    if (!pendingApproval.value) return
    const request = pendingApproval.value

    // If user chose to remember, add auto-approval rule for this tool+risk combo
    if (remember && approved) {
      const ruleKey = `${request.toolAction.toolName}:${request.toolAction.riskLevel}`
      autoApprovalRules.value.add(ruleKey)
    }

    // Record in approval history
    approvalHistory.value.push({
      request,
      approved,
      reason,
      respondedAt: Date.now(),
      autoApproved: false,
    })

    await window.electron.agent.approve({
      executionId: request.executionId,
      approved,
      reason,
    })
    pendingApproval.value = null
  }

  // ─── Event Handlers ──────────────────────────────────────────

  /**
   * Trigger audit evaluation after execution completes.
   */
  async function runAudit(): Promise<void> {
    if (!lastResult.value || !lastConversationId.value || !lastApprovalMode.value) return

    auditLoading.value = true
    try {
      const input: AuditInput = {
        executionId: lastResult.value.executionId,
        conversationId: lastConversationId.value,
        trajectories: trajectories.value,
        approvalMode: lastApprovalMode.value,
        totalSteps: lastResult.value.totalSteps,
        duration: lastResult.value.duration,
        tokensUsed: lastResult.value.tokensUsed,
        summary: lastResult.value.summary,
      }

      const report = await window.electron.audit.run(input)
      auditReport.value = report
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      auditLoading.value = false
    }
  }

  /** Handle audit report push event from main process */
  function handleAuditReport(report: AuditReport): void {
    auditReport.value = report
    auditLoading.value = false
  }

  /** Handle trajectory event */
  function handleTrajectory(trajectory: TAOTrajectory): void {
    const idx = trajectories.value.findIndex((t) => t.step === trajectory.step)
    if (idx >= 0) {
      trajectories.value[idx] = trajectory
    } else {
      trajectories.value.push(trajectory)
    }
  }

  /** Handle approval request event (with auto-approval check) */
  async function handleApprovalRequest(request: ApprovalRequest): Promise<void> {
    const ruleKey = `${request.toolAction.toolName}:${request.toolAction.riskLevel}`
    if (autoApprovalRules.value.has(ruleKey)) {
      approvalHistory.value.push({
        request,
        approved: true,
        reason: '自动批准（用户已记住选择）',
        respondedAt: Date.now(),
        autoApproved: true,
      })
      await window.electron.agent.approve({
        executionId: request.executionId,
        approved: true,
        reason: '自动批准（用户已记住选择）',
      })
      return
    }
    pendingApproval.value = request
  }

  /** Handle stream chunk event */
  function handleStreamChunk(chunk: StreamChunk): void {
    if (chunk.type === 'text' && chunk.content) {
      streamingContent.value += chunk.content
    } else if (chunk.type === 'thinking' && chunk.content) {
      streamingThinking.value += chunk.content
    } else if (chunk.type === 'usage-info' && chunk.content) {
      try {
        const usage = JSON.parse(chunk.content) as {
          tokenLimit: number
          currentTokens: number
          messagesLength: number
        }
        useContextUsageStore().update(usage)
      } catch {
        // Ignore malformed usage-info payloads
      }
    } else if (chunk.type === 'ask-user' && chunk.content) {
      try {
        pendingUserInput.value = JSON.parse(chunk.content) as UserInputRequest
      } catch {
        // Ignore malformed ask-user payloads
      }
    } else if (chunk.type === 'elicitation-request' && chunk.content) {
      try {
        pendingElicitation.value = JSON.parse(chunk.content) as ElicitationRequest
      } catch {
        // Ignore malformed elicitation payloads
      }
    }
  }

  /** Respond to an ask_user request */
  async function respondUserInput(response: string): Promise<void> {
    if (!pendingUserInput.value) return
    const requestId = pendingUserInput.value.requestId
    pendingUserInput.value = null
    try {
      await window.electron.agent.respondUserInput({ requestId, response })
    } catch (error) {
      console.error('Failed to respond to user input:', error)
    }
  }

  /** Respond to an elicitation request */
  async function respondElicitation(response: Record<string, unknown>): Promise<void> {
    if (!pendingElicitation.value) return
    const requestId = pendingElicitation.value.requestId
    pendingElicitation.value = null
    try {
      await window.electron.agent.respondElicitation({ requestId, response })
    } catch (error) {
      console.error('Failed to respond to elicitation:', error)
    }
  }

  /** Reset state (preserves auditReport + autoApprovalRules for session continuity) */
  function reset(): void {
    status.value = 'idle'
    executionId.value = null
    trajectories.value = []
    pendingApproval.value = null
    pendingUserInput.value = null
    pendingElicitation.value = null
    streamingContent.value = ''
    streamingThinking.value = ''
    lastResult.value = null
    error.value = null
    lastConversationId.value = null
    lastApprovalMode.value = null
  }

  /** Clear auto-approval rules (reset session trust) */
  function clearAutoApprovalRules(): void {
    autoApprovalRules.value.clear()
  }

  return {
    // State
    status,
    executionId,
    trajectories,
    pendingApproval,
    pendingUserInput,
    pendingElicitation,
    streamingContent,
    streamingThinking,
    lastResult,
    error,
    auditReport,
    auditLoading,
    autoApprovalRules,
    approvalHistory,
    // Getters
    isRunning,
    isWaitingApproval,
    totalSteps,
    successCount,
    errorCount,
    // Actions
    execute,
    stop,
    respondApproval,
    respondUserInput,
    respondElicitation,
    runAudit,
    clearAutoApprovalRules,
    // Handlers
    handleTrajectory,
    handleApprovalRequest,
    handleStreamChunk,
    handleAuditReport,
    reset,
  }
})
