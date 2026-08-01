<script setup lang="ts">
// ExecutionPanel - Enhanced Agent execution visualization
// Design: visual timeline with status markers, progress bar, compact observations
// Inspired by: Cursor (step counter), Codex (execution logs), Stream of Thought (step states)

import { computed, ref, watch, nextTick, type Component } from 'vue'
import { NIcon } from 'naive-ui'
import {
  CheckCircleOutlined,
  ErrorOutlined,
  HourglassEmptyOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopCircleOutlined,
} from '@vicons/material'
import { useAgentStore } from '@/stores/agent'
import type { TAOTrajectory } from '@shared/types'
import ThinkingBlock from './ThinkingBlock.vue'
import ApprovalCard from './ApprovalCard.vue'

const agentStore = useAgentStore()

const statusLabels: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
}

const statusColors: Record<string, string> = {
  idle: 'var(--af-text-muted, #64748b)',
  running: 'var(--af-info, #0ea5e9)',
  paused: 'var(--af-warning, #f59e0b)',
  completed: 'var(--af-success, #10b981)',
  failed: 'var(--af-error, #ef4444)',
  cancelled: 'var(--af-text-muted, #64748b)',
}

const statusLabel = computed(() => statusLabels[agentStore.status] ?? '未知')
const statusColor = computed(() => statusColors[agentStore.status] ?? '#666')
const hasTrajectories = computed(() => agentStore.trajectories.length > 0)

// ─── Step status configuration ─────────────────────────────────

const stepStatusConfig: Record<string, { icon: Component; color: string; label: string }> = {
  success: { icon: CheckCircleOutlined, color: 'var(--af-success, #10b981)', label: '成功' },
  error: { icon: ErrorOutlined, color: 'var(--af-error, #ef4444)', label: '失败' },
  'pending-approval': {
    icon: PauseCircleOutlined,
    color: 'var(--af-warning, #f59e0b)',
    label: '等待审批',
  },
  approved: { icon: PlayCircleOutlined, color: 'var(--af-info, #0ea5e9)', label: '已批准' },
  rejected: { icon: StopCircleOutlined, color: 'var(--af-error, #ef4444)', label: '已拒绝' },
  running: { icon: HourglassEmptyOutlined, color: 'var(--af-info, #0ea5e9)', label: '执行中' },
}

function getStepStatus(status: string): { icon: Component; color: string; label: string } {
  return stepStatusConfig[status] || { icon: HourglassEmptyOutlined as Component, color: '#999', label: status }
}

function getActionLabel(traj: TAOTrajectory): string {
  if (!traj.action) return '完成'
  return traj.action.toolName
}

// ─── Progress bar ────────────────────────────────────────────────

const progressPercent = computed(() => {
  if (agentStore.trajectories.length === 0) return 0
  const completed = agentStore.trajectories.filter(
    (t) => t.status === 'success' || t.status === 'error',
  ).length
  return Math.round((completed / agentStore.trajectories.length) * 100)
})

// ─── Approval handlers ─────────────────────────────────────────

function handleApprove(remember: boolean): void {
  agentStore.respondApproval(true, undefined, remember)
}

function handleReject(reason?: string): void {
  agentStore.respondApproval(false, reason)
}

// ─── Auto-scroll to approval card ────────────────────────────────

const panelRef = ref<HTMLElement | null>(null)
const approvalRef = ref<InstanceType<typeof ApprovalCard> | null>(null)

watch(
  () => agentStore.pendingApproval,
  async (approval) => {
    if (approval) {
      await nextTick()
      if (panelRef.value) {
        panelRef.value.scrollTo({
          top: panelRef.value.scrollHeight,
          behavior: 'smooth',
        })
      }
    }
  },
)

// ─── Collapsible observations ──────────────────────────────────

const expandedObservations = ref<Set<number>>(new Set())

function toggleObservation(step: number): void {
  if (expandedObservations.value.has(step)) {
    expandedObservations.value.delete(step)
  } else {
    expandedObservations.value.add(step)
  }
}

function isObservationExpanded(step: number): boolean {
  return expandedObservations.value.has(step)
}

// Truncate observation for collapsed view
function truncateObservation(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

// Expose approval ref for keyboard shortcuts from parent
defineExpose({ approvalRef })
</script>

<template>
  <div v-if="agentStore.status !== 'idle'" ref="panelRef" class="execution-panel">
    <!-- Status header with progress bar -->
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
        <span class="stat stat--total">{{ agentStore.totalSteps }} 步</span>
        <span v-if="agentStore.successCount > 0" class="stat stat--success">
          {{ agentStore.successCount }} 成功
        </span>
        <span v-if="agentStore.errorCount > 0" class="stat stat--error">
          {{ agentStore.errorCount }} 失败
        </span>
      </div>
    </div>

    <!-- Progress bar -->
    <div v-if="hasTrajectories" class="progress-bar">
      <div
        class="progress-bar__fill"
        :style="{ width: progressPercent + '%', backgroundColor: statusColor }"
      ></div>
    </div>

    <!-- Error message -->
    <div v-if="agentStore.error" class="error-message">
      <NIcon :size="14" class="error-icon"><ErrorOutlined /></NIcon>
      {{ agentStore.error }}
    </div>

    <!-- Trajectories -->
    <div v-if="hasTrajectories" class="trajectories">
      <div
        v-for="(traj, idx) in agentStore.trajectories"
        :key="traj.step"
        class="trajectory-item"
        :class="`trajectory-item--${traj.status}`"
      >
        <!-- Step connector line -->
        <div class="trajectory-connector">
          <NIcon :size="14" :color="getStepStatus(traj.status).color">
            <component :is="getStepStatus(traj.status).icon" />
          </NIcon>
        </div>

        <div class="trajectory-content">
          <!-- Thinking block -->
          <ThinkingBlock
            v-if="traj.thought"
            :thought="traj.thought"
            :step="traj.step"
            :total-steps="agentStore.totalSteps"
            :is-streaming="agentStore.isRunning && idx === agentStore.trajectories.length - 1"
            :status="traj.status === 'error' ? 'error' : 'completed'"
          />

          <!-- Action info (compact) -->
          <div v-if="traj.action" class="action-info">
            <div class="action-header">
              <span class="action-name">{{ getActionLabel(traj) }}</span>
              <span
                class="action-status"
                :style="{ color: getStepStatus(traj.status).color }"
              >
                {{ getStepStatus(traj.status).label }}
              </span>
            </div>
          </div>

          <!-- Observation (collapsible) -->
          <div v-if="traj.observation" class="observation">
            <button class="observation-toggle" @click="toggleObservation(traj.step)">
              <span class="observation-label">结果</span>
              <span v-if="!isObservationExpanded(traj.step)" class="observation-preview">
                {{ truncateObservation(traj.observation) }}
              </span>
              <span class="observation-chevron" :class="{ expanded: isObservationExpanded(traj.step) }">
                ▸
              </span>
            </button>
            <div v-if="isObservationExpanded(traj.step)" class="observation-full">
              <pre class="obs-text">{{ traj.observation }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Streaming thinking (SDK reasoning_delta) -->
    <div v-if="agentStore.streamingThinking && agentStore.isRunning" class="streaming-thinking">
      <ThinkingBlock
        :thought="agentStore.streamingThinking"
        :is-streaming="true"
        status="running"
        :started-at="Date.now()"
      />
    </div>

    <!-- Approval card (auto-scrolled into view) -->
    <ApprovalCard
      v-if="agentStore.pendingApproval"
      ref="approvalRef"
      :request="agentStore.pendingApproval"
      @approve="handleApprove"
      @reject="handleReject"
    />

    <!-- Summary (when completed) -->
    <div v-if="agentStore.lastResult && agentStore.status === 'completed'" class="summary">
      <div class="summary-header">
        <NIcon :size="14" class="summary-icon"><CheckCircleOutlined /></NIcon>
        执行完成
      </div>
      <p class="summary-text">{{ agentStore.lastResult.summary }}</p>
      <div class="summary-stats">
        <span class="summary-stat">
          <span class="summary-stat-value">{{ agentStore.lastResult.totalSteps }}</span>
          <span class="summary-stat-label">步</span>
        </span>
        <span class="summary-stat">
          <span class="summary-stat-value">{{ Math.round(agentStore.lastResult.duration / 1000) }}</span>
          <span class="summary-stat-label">秒</span>
        </span>
        <span class="summary-stat">
          <span class="summary-stat-value">{{ agentStore.lastResult.tokensUsed.toLocaleString() }}</span>
          <span class="summary-stat-label">tokens</span>
        </span>
      </div>
    </div>

    <!-- Stop button -->
    <button v-if="agentStore.isRunning" class="btn-stop" @click="agentStore.stop()">
      <NIcon :size="14"><StopCircleOutlined /></NIcon>
      停止执行
    </button>
  </div>
</template>

<style scoped>
.execution-panel {
  border: 1px solid var(--af-border, #334155);
  border-radius: 10px;
  background: var(--af-bg-surface, #1e293b);
  padding: 14px;
  margin: 8px 0;
  max-height: 600px;
  overflow-y: auto;
  scroll-behavior: smooth;
}

/* ─── Header ──────────────────────────────────────────────── */

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
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
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(1.3);
  }
}

.status-text {
  font-size: 13px;
  font-weight: 600;
}

.stats {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--af-text-tertiary, #94a3b8);
}

.stat {
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.4));
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stat--total {
  color: var(--af-info, #0ea5e9);
}

.stat--success {
  color: var(--af-success, #10b981);
}

.stat--error {
  color: var(--af-error, #ef4444);
}

/* ─── Progress bar ──────────────────────────────────────────── */

.progress-bar {
  height: 3px;
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.4));
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-bar__fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease, background-color 0.3s ease;
}

/* ─── Error message ──────────────────────────────────────────── */

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--af-error, #ef4444) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--af-error, #ef4444) 25%, transparent);
  border-radius: 8px;
  font-size: 13px;
  color: var(--af-error, #ef4444);
  margin-bottom: 12px;
}

.error-icon {
  flex-shrink: 0;
}

/* ─── Trajectories ──────────────────────────────────────────── */

.trajectories {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.trajectory-item {
  display: flex;
  gap: 8px;
  padding-bottom: 8px;
  position: relative;
}

/* Vertical connector line between steps */
.trajectory-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 20px;
  bottom: 0;
  width: 1px;
  background: var(--af-border, rgba(51, 65, 85, 0.5));
}

.trajectory-connector {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  position: relative;
  background: var(--af-bg-surface, #1e293b);
  border-radius: 50%;
}

.trajectory-content {
  flex: 1;
  min-width: 0;
}

/* ─── Action info ──────────────────────────────────────────── */

.action-info {
  margin: 4px 0;
}

.action-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.action-name {
  color: var(--af-brand, #818cf8);
  font-weight: 600;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

.action-status {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
}

/* ─── Observation ──────────────────────────────────────────── */

.observation {
  margin: 4px 0;
  border-radius: 6px;
  overflow: hidden;
}

.observation-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.3));
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.observation-toggle:hover {
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.5));
}

.observation-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--af-text-tertiary, #94a3b8);
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.observation-preview {
  flex: 1;
  font-size: 12px;
  color: var(--af-text-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.observation-chevron {
  font-size: 10px;
  color: var(--af-text-muted, #64748b);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.observation-chevron.expanded {
  transform: rotate(90deg);
}

.observation-full {
  padding: 6px 8px;
  background: var(--af-bg-input, #1f2937);
  border-radius: 0 0 6px 6px;
}

.obs-text {
  margin: 0;
  font-size: 12px;
  color: var(--af-text-secondary, #cbd5e1);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

/* ─── Streaming thinking ────────────────────────────────────── */

.streaming-thinking {
  margin: 8px 0;
}

/* ─── Summary ──────────────────────────────────────────────── */

.summary {
  margin-top: 12px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--af-success, #10b981) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--af-success, #10b981) 20%, transparent);
  border-radius: 8px;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--af-success, #10b981);
  margin-bottom: 6px;
}

.summary-icon {
  flex-shrink: 0;
}

.summary-text {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--af-text-primary, #f1f5f9);
  white-space: pre-wrap;
  word-break: break-word;
}

.summary-stats {
  display: flex;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--af-success, #10b981) 15%, transparent);
}

.summary-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.summary-stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--af-success, #10b981);
  font-variant-numeric: tabular-nums;
}

.summary-stat-label {
  font-size: 10px;
  color: var(--af-text-muted, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* ─── Stop button ──────────────────────────────────────────── */

.btn-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--af-error, #ef4444) 40%, transparent);
  background: color-mix(in srgb, var(--af-error, #ef4444) 8%, transparent);
  color: var(--af-error, #ef4444);
  transition: background 0.15s ease;
}

.btn-stop:hover {
  background: color-mix(in srgb, var(--af-error, #ef4444) 18%, transparent);
}
</style>
