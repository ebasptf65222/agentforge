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

  /** Last execution result */
  const lastResult = ref<ExecutionResult | null>(null)

  /** Error message if execution failed */
  const error = ref<string | null>(null)

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
  const errorCount = computed(
    () => trajectories.value.filter((t) => t.status === 'error').length,
  )

  // ─── Actions ─────────────────────────────────────────────────

  /** Start a new agent execution */
  async function execute(params: {
    conversationId: string
    userInput: string
    modelId: string
    approvalMode: ApprovalMode
    maxSteps?: number
  }): Promise<ExecutionResult | null> {
    // Reset state
    status.value = 'running'
    executionId.value = null
    trajectories.value = []
    pendingApproval.value = null
    streamingContent.value = ''
    lastResult.value = null
    error.value = null

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
    }
  }

  /** Reset state */
  function reset(): void {
    status.value = 'idle'
    executionId.value = null
    trajectories.value = []
    pendingApproval.value = null
    streamingContent.value = ''
    lastResult.value = null
    error.value = null
  }

  return {
    // State
    status,
    executionId,
    trajectories,
    pendingApproval,
    streamingContent,
    lastResult,
    error,
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
    // Handlers
    handleTrajectory,
    handleApprovalRequest,
    handleStreamChunk,
    reset,
  }
})
