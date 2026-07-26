<script setup lang="ts">
// P2-09: ApprovalCard - tool approval request UI

import type { ApprovalRequest } from '@shared/types'

const props = defineProps<{
  request: ApprovalRequest
}>()

const emit = defineEmits<{
  approve: []
  reject: [reason?: string]
}>()

const riskColors: Record<string, string> = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
}

const riskLabels: Record<string, string> = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
}

function handleApprove(): void {
  emit('approve')
}

function handleReject(): void {
  emit('reject', 'User rejected')
}
</script>

<template>
  <div class="approval-card">
    <div class="approval-header">
      <span class="approval-title">Approval Required</span>
      <span
        class="risk-badge"
        :style="{ backgroundColor: riskColors[props.request.toolAction.riskLevel] || '#999' }"
      >
        {{ riskLabels[props.request.toolAction.riskLevel] || 'Unknown' }}
      </span>
    </div>
    <div class="approval-body">
      <p class="approval-reason">{{ props.request.reason }}</p>
      <div class="tool-info">
        <span class="tool-name">{{ props.request.toolAction.toolName }}</span>
        <pre class="tool-args">{{ JSON.stringify(props.request.toolAction.arguments, null, 2) }}</pre>
      </div>
    </div>
    <div class="approval-actions">
      <button class="btn-approve" @click="handleApprove">
        Approve
      </button>
      <button class="btn-reject" @click="handleReject">
        Reject
      </button>
    </div>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 10px;
  margin: 12px 0;
  overflow: hidden;
  background: var(--bg-secondary, #1e1e1e);
}

.approval-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-tertiary, #252525);
  border-bottom: 1px solid var(--border-color, #3a3a3a);
}

.approval-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #ddd);
}

.risk-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.approval-body {
  padding: 12px 14px;
}

.approval-reason {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-secondary, #999);
}

.tool-info {
  background: var(--bg-code, #161616);
  border-radius: 6px;
  padding: 8px 10px;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-color, #4fc3f7);
  display: block;
  margin-bottom: 4px;
}

.tool-args {
  font-size: 12px;
  color: var(--text-tertiary, #888);
  margin: 0;
  overflow-x: auto;
  max-height: 200px;
}

.approval-actions {
  display: flex;
  gap: 8px;
  padding: 0 14px 12px;
}

.btn-approve,
.btn-reject {
  flex: 1;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s ease, transform 0.1s ease;
}

.btn-approve {
  background: #4caf50;
  color: #fff;
}

.btn-approve:hover {
  opacity: 0.85;
}

.btn-reject {
  background: var(--bg-hover, #2a2a2a);
  color: var(--text-primary, #ddd);
  border: 1px solid var(--border-color, #3a3a3a);
}

.btn-reject:hover {
  opacity: 0.85;
}

.btn-approve:active,
.btn-reject:active {
  transform: scale(0.97);
}
</style>
