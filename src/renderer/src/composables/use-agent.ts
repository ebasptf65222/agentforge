// P2-09: useAgent composable
// Sets up agent event listeners and wires them to AgentStore
// WA-07: Added audit:report event listener
// FIX: HMR-safe singleton listener registration to prevent duplicate IPC events

import { onMounted, onUnmounted } from 'vue'
import type { TAOTrajectory, ApprovalRequest, StreamChunk, AuditReport } from '@shared/types'
import { useAgentStore } from '@/stores/agent'

/**
 * Module-level cleanup storage on window to survive HMR module re-evaluation.
 * Without this, HMR can cause onMounted to fire without onUnmounted,
 * leading to duplicate IPC listeners and tripled streaming text.
 */
const HMR_KEY = '__af_agent_cleanup__'

interface AgentCleanupFns {
  trajectory?: () => void
  approval?: () => void
  chunk?: () => void
  audit?: () => void
}

function getPrevCleanup(): AgentCleanupFns {
  return ((window as Record<string, unknown>)[HMR_KEY] as AgentCleanupFns) || {}
}

function setPrevCleanup(fns: AgentCleanupFns): void {
  (window as Record<string, unknown>)[HMR_KEY] = fns
}

/**
 * Composable that sets up agent event listeners.
 * Must be called in a component's setup() that has AgentStore access.
 */
export function useAgent(): void {
  const agentStore = useAgentStore()

  let cleanupTrajectory: (() => void) | undefined
  let cleanupApproval: (() => void) | undefined
  let cleanupChunk: (() => void) | undefined
  let cleanupAuditReport: (() => void) | undefined

  onMounted(() => {
    if (!window.electron?.agent) return

    // HMR safety: clean up any lingering listeners from previous module evaluation
    const prev = getPrevCleanup()
    prev.trajectory?.()
    prev.approval?.()
    prev.chunk?.()
    prev.audit?.()

    // Trajectory listener
    cleanupTrajectory = window.electron.agent.onTrajectory((trajectory: TAOTrajectory) => {
      agentStore.handleTrajectory(trajectory)
    })

    // Approval request listener
    cleanupApproval = window.electron.agent.onApprovalRequest((request: ApprovalRequest) => {
      agentStore.handleApprovalRequest(request)
    })

    // Stream chunk listener
    cleanupChunk = window.electron.agent.onStreamChunk((chunk: StreamChunk) => {
      agentStore.handleStreamChunk(chunk)
    })

    // Audit report listener (WA-07)
    if (window.electron?.audit) {
      cleanupAuditReport = window.electron.audit.onReport((report: AuditReport) => {
        agentStore.handleAuditReport(report)
      })
    }

    // Store cleanup functions globally so HMR re-evaluation can clean them up
    setPrevCleanup({
      trajectory: cleanupTrajectory,
      approval: cleanupApproval,
      chunk: cleanupChunk,
      audit: cleanupAuditReport,
    })
  })

  onUnmounted(() => {
    cleanupTrajectory?.()
    cleanupApproval?.()
    cleanupChunk?.()
    cleanupAuditReport?.()
    setPrevCleanup({})
  })
}
