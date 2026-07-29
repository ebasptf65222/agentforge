// P2-09: useAgent composable
// Sets up agent event listeners and wires them to AgentStore
// WA-07: Added audit:report event listener

import { onMounted, onUnmounted } from 'vue'
import type { TAOTrajectory, ApprovalRequest, StreamChunk, AuditReport } from '@shared/types'
import { useAgentStore } from '@/stores/agent'

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
  })

  onUnmounted(() => {
    cleanupTrajectory?.()
    cleanupApproval?.()
    cleanupChunk?.()
    cleanupAuditReport?.()
  })
}
