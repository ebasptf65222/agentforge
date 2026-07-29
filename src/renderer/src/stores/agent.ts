// P2-09: AgentStore - Pinia store for Agent execution state

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
} from '@shared/types'

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

  /** Respond to pending approval */
  async function respondApproval(approved: boolean, reason?: string): Promise<void> {
    if (!pendingApproval.value) return
    await window.electron.agent.approve({
      executionId: pendingApproval.value.executionId,
      approved,
      reason,
    })
    pendingApproval.value = null
  }

  // ─── Event Handlers ──────────────────────────────────────────

  /**
   * Trigger audit evaluation after execution completes.
   * Uses lastResult + trajectories to build AuditInput and calls the audit engine via IPC.
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
    // Update existing trajectory or add new one
    const idx = trajectories.value.findIndex((t) => t.step === trajectory.step)
    if (idx >= 0) {
      trajectories.value[idx] = trajectory
    } else {
      trajectories.value.push(trajectory)
    }
  }

  /** Handle approval request event */
  function handleApprovalRequest(request: ApprovalRequest): void {
    pendingApproval.value = request
  }

  /** Handle stream chunk event */
  function handleStreamChunk(chunk: StreamChunk): void {
    if (chunk.type === 'text' && chunk.content) {
      streamingContent.value += chunk.content
    } else if (chunk.type === 'thinking' && chunk.content) {
      streamingThinking.value += chunk.content
    }
  }

  /** Reset state (preserves auditReport so it remains visible after execution) */
  function reset(): void {
    status.value = 'idle'
    executionId.value = null
    trajectories.value = []
    pendingApproval.value = null
    streamingContent.value = ''
    streamingThinking.value = ''
    lastResult.value = null
    error.value = null
    lastConversationId.value = null
    lastApprovalMode.value = null
  }

  return {
    // State
    status,
    executionId,
    trajectories,
    pendingApproval,
    streamingContent,
    streamingThinking,
    lastResult,
    error,
    auditReport,
    auditLoading,
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
    runAudit,
    // Handlers
    handleTrajectory,
    handleApprovalRequest,
    handleStreamChunk,
    handleAuditReport,
    reset,
  }
})
