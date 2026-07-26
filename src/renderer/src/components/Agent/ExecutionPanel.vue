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
  idle: '#666',
  running: '#4fc3f7',
  paused: '#ff9800',
  completed: '#4caf50',
  failed: '#f44336',
  cancelled: '#999',
}

const statusLabel = computed(() => statusLabels[agentStore.status] ?? 'Unknown')
const statusColor = computed(() => statusColors[agentStore.status] ?? '#666')
const hasTrajectories = computed(() => agentStore.trajectories.length > 0)

const actionStatusColors: Record<string, string> = {
  success: '#4caf50',
  error: '#f44336',
  'pending-approval': '#ff9800',
  approved: '#4fc3f7',
  rejected: '#f44336',
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
      <div
        v-for="traj in agentStore.trajectories"
        :key="traj.step"
        class="trajectory-item"
      >
        <!-- Thinking block (collapsible) -->
        <ThinkingBlock
          v-if="traj.thought"
          :thought="traj.thought"
          :step="traj.step"
        />

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
                color: actionStatusColors[traj.status] || '#999'
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
    <button
      v-if="agentStore.isRunning"
      class="btn-stop"
      @click="agentStore.stop()"
    >
      Stop Execution
    </button>
  </div>
</template>

<style scoped>
.execution-panel {
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 10px;
  background: var(--bg-secondary, #1a1a1a);
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
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}

.status-text {
  font-size: 13px;
  font-weight: 600;
}

.stats {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--text-tertiary, #777);
}

.stat {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary, #252525);
}

.stat.success { color: #4caf50; }
.stat.error { color: #f44336; }

.error-message {
  padding: 10px 12px;
  background: rgba(244, 67, 54, 0.1);
  border: 1px solid rgba(244, 67, 54, 0.3);
  border-radius: 6px;
  font-size: 13px;
  color: #f44336;
  margin-bottom: 12px;
}

.trajectories {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trajectory-item {
  border-left: 2px solid var(--border-color, #3a3a3a);
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
  color: var(--text-tertiary, #777);
  display: flex;
}

.action-label {
  color: var(--text-secondary, #999);
  font-weight: 500;
}

.action-name {
  color: var(--accent-color, #4fc3f7);
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
  color: var(--text-tertiary, #888);
  background: var(--bg-code, #161616);
  border-radius: 4px;
  padding: 6px 8px;
  margin: 4px 0 0;
  overflow-x: auto;
  max-height: 150px;
}

.observation {
  margin: 6px 0;
  padding: 8px 10px;
  background: var(--bg-tertiary, #252525);
  border-radius: 6px;
}

.obs-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #999);
  display: block;
  margin-bottom: 4px;
}

.obs-text {
  margin: 0;
  font-size: 13px;
  color: var(--text-primary, #ddd);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.summary {
  margin-top: 12px;
  padding: 12px;
  background: rgba(76, 175, 80, 0.08);
  border: 1px solid rgba(76, 175, 80, 0.2);
  border-radius: 8px;
}

.summary-header {
  font-size: 13px;
  font-weight: 600;
  color: #4caf50;
  margin-bottom: 6px;
}

.summary-text {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #ddd);
  white-space: pre-wrap;
  word-break: break-word;
}

.summary-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-tertiary, #777);
}

.btn-stop {
  width: 100%;
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(244, 67, 54, 0.4);
  background: rgba(244, 67, 54, 0.1);
  color: #f44336;
  transition: background 0.15s ease;
}

.btn-stop:hover {
  background: rgba(244, 67, 54, 0.2);
}
</style>
