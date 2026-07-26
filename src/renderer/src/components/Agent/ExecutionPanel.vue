<script setup lang="ts">
// P2-09: ExecutionPanel - Agent execution visualization
// Shows real-time TAO trajectories, approval requests, and execution status

import { computed } from 'vue'
import { useAgentStore } from '@/stores/agent'
import type { TAOTrajectory } from '@shared/types'
import ThinkingBlock from './ThinkingBlock.vue'
import ApprovalCard from './ApprovalCard.vue'

const agentStore = useAgentStore()

const statusLabels: Record<string, string> = {
  idle: 'Idle',
  running: 'Running...',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const statusColors: Record<string, string> = {
  idle: 'var(--af-text-muted, #64748b)',
  running: 'var(--af-info, #0ea5e9)',
  paused: 'var(--af-warning, #f59e0b)',
  completed: 'var(--af-success, #10b981)',
  failed: 'var(--af-error, #ef4444)',
  cancelled: 'var(--af-text-muted, #64748b)',
}

const statusLabel = computed(() => statusLabels[agentStore.status] ?? 'Unknown')
const statusColor = computed(() => statusColors[agentStore.status] ?? '#666')
const hasTrajectories = computed(() => agentStore.trajectories.length > 0)

const actionStatusColors: Record<string, string> = {
  success: 'var(--af-success, #10b981)',
  error: 'var(--af-error, #ef4444)',
  'pending-approval': 'var(--af-warning, #f59e0b)',
  approved: 'var(--af-info, #0ea5e9)',
  rejected: 'var(--af-error, #ef4444)',
}

function getActionLabel(traj: TAOTrajectory): string {
  if (!traj.action) return 'Finish'
  return traj.action.toolName
}

function handleApprove(): void {
  agentStore.respondApproval(true)
}

function handleReject(reason?: string): void {
  agentStore.respondApproval(false, reason)
}
</script>

<template>
  <div v-if="agentStore.status !== 'idle'" class="execution-panel">
    <!-- Status header -->
    <div class="panel-header">
      <div class="status-indicator">
        <span
          class="status-dot"
          :style="{ backgroundColor: statusColor }"
          :class="{ pulsing: agentStore.isRunning }"
        ></span>
        <span class="status-text" :style="{ color: statusColor }">{{ statusLabel }}</span>
      </div>
      <div v-if="hasTrajectories" class="stats">
        <span class="stat">{{ agentStore.totalSteps }} steps</span>
        <span v-if="agentStore.successCount > 0" class="stat success">
          {{ agentStore.successCount }} ok
        </span>
        <span v-if="agentStore.errorCount > 0" class="stat error">
          {{ agentStore.errorCount }} err
        </span>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="agentStore.error" class="error-message">
      {{ agentStore.error }}
    </div>

    <!-- Trajectories -->
    <div v-if="hasTrajectories" class="trajectories">
      <div v-for="traj in agentStore.trajectories" :key="traj.step" class="trajectory-item">
        <!-- Thinking block (collapsible) -->
        <ThinkingBlock v-if="traj.thought" :thought="traj.thought" :step="traj.step" />

        <!-- Action info -->
        <div v-if="traj.action" class="action-info">
          <div class="action-header">
            <span class="action-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 1V13M1 7H13"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <span class="action-label">Action:</span>
            <span class="action-name">{{ getActionLabel(traj) }}</span>
            <span
              class="action-status"
              :style="{
                color: actionStatusColors[traj.status] || '#999',
              }"
            >
              {{ traj.status }}
            </span>
          </div>
          <pre v-if="traj.action.arguments" class="action-args">{{
            JSON.stringify(traj.action.arguments, null, 2)
          }}</pre>
        </div>

        <!-- Observation -->
        <div v-if="traj.observation" class="observation">
          <span class="obs-label">Observation:</span>
          <p class="obs-text">{{ traj.observation }}</p>
        </div>
      </div>
    </div>

    <!-- Approval card -->
    <ApprovalCard
      v-if="agentStore.pendingApproval"
      :request="agentStore.pendingApproval"
      @approve="handleApprove"
      @reject="handleReject"
    />

    <!-- Summary (when completed) -->
    <div v-if="agentStore.lastResult && agentStore.status === 'completed'" class="summary">
      <div class="summary-header">Summary</div>
      <p class="summary-text">{{ agentStore.lastResult.summary }}</p>
      <div class="summary-stats">
        <span>{{ agentStore.lastResult.totalSteps }} steps</span>
        <span>{{ Math.round(agentStore.lastResult.duration / 1000) }}s</span>
        <span>~{{ agentStore.lastResult.tokensUsed }} tokens</span>
      </div>
    </div>

    <!-- Stop button -->
    <button v-if="agentStore.isRunning" class="btn-stop" @click="agentStore.stop()">
      Stop Execution
    </button>
  </div>
</template>

<style scoped>
.execution-panel {
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  background: var(--af-bg-surface, #1e293b);
  padding: 14px;
  margin: 8px 0;
  max-height: 600px;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.pulsing {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}

.status-text {
  font-size: 13px;
  font-weight: 600;
}

.stats {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
}

.stat {
  padding: 2px 6px;
  border-radius: var(--af-radius-sm, 6px);
  background: var(--af-bg-hover, #334155);
}

.stat.success {
  color: var(--af-success, #10b981);
}
.stat.error {
  color: var(--af-error, #ef4444);
}

.error-message {
  padding: 10px 12px;
  background: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--af-error, #ef4444) 30%, transparent);
  border-radius: var(--af-radius-sm, 6px);
  font-size: 13px;
  color: var(--af-error, #ef4444);
  margin-bottom: 12px;
}

.trajectories {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trajectory-item {
  border-left: 2px solid var(--af-border, #334155);
  padding-left: 12px;
  margin-bottom: 8px;
}

.action-info {
  margin: 6px 0;
}

.action-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.action-icon {
  color: var(--af-text-tertiary, #94a3b8);
  display: flex;
}

.action-label {
  color: var(--af-text-secondary, #cbd5e1);
  font-weight: 500;
}

.action-name {
  color: var(--af-brand, #818cf8);
  font-weight: 600;
}

.action-status {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.action-args {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  background: var(--af-bg-input, #1f2937);
  border-radius: var(--af-radius-sm, 6px);
  padding: 6px 8px;
  margin: 4px 0 0;
  overflow-x: auto;
  max-height: 150px;
}

.observation {
  margin: 6px 0;
  padding: 8px 10px;
  background: var(--af-bg-hover, #334155);
  border-radius: var(--af-radius-sm, 6px);
}

.obs-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
  display: block;
  margin-bottom: 4px;
}

.obs-text {
  margin: 0;
  font-size: 13px;
  color: var(--af-text-primary, #f1f5f9);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.summary {
  margin-top: 12px;
  padding: 12px;
  background: color-mix(in srgb, var(--af-success, #10b981) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--af-success, #10b981) 20%, transparent);
  border-radius: var(--af-radius, 8px);
}

.summary-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-success, #10b981);
  margin-bottom: 6px;
}

.summary-text {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--af-text-primary, #f1f5f9);
  white-space: pre-wrap;
  word-break: break-word;
}

.summary-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
}

.btn-stop {
  width: 100%;
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: var(--af-radius-sm, 6px);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--af-error, #ef4444) 40%, transparent);
  background: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
  color: var(--af-error, #ef4444);
  transition: background 0.15s ease;
}

.btn-stop:hover {
  background: color-mix(in srgb, var(--af-error, #ef4444) 20%, transparent);
}
</style>
