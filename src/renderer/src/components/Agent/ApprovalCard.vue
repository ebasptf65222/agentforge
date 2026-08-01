<script setup lang="ts">
// ApprovalCard - Enhanced tool approval UI
// Design principles: clear visual hierarchy, prominent primary action, risk-aware styling
// Inspired by: Codex CLI (y/N/a quick keys), Cursor (diff review), Windsurf (Apply button)

import { computed, ref, onMounted, onUnmounted, type Component } from 'vue'
import { NIcon, NTag, NCollapse, NCollapseItem, NCheckbox, NInput, NTooltip } from 'naive-ui'
import {
  FolderOpenOutlined,
  CodeOutlined,
  HttpOutlined,
  SearchOutlined,
  TerminalOutlined,
  EditNoteOutlined,
  CheckCircleOutlined,
  CancelOutlined,
  ExpandMoreOutlined,
  ShieldOutlined,
  TimerOutlined,
} from '@vicons/material'
import CodeDiffPreview from './CodeDiffPreview.vue'
import type { ApprovalRequest } from '@shared/types'

const props = defineProps<{
  request: ApprovalRequest
}>()

const emit = defineEmits<{
  approve: [remember: boolean]
  reject: [reason?: string]
}>()

// ─── Risk level configuration ──────────────────────────────────

const riskConfig: Record<string, { color: string; label: string; icon: Component; description: string }> = {
  low: {
    color: 'var(--af-success, #10b981)',
    label: '低风险',
    icon: ShieldOutlined,
    description: '此操作仅读取信息，不会修改系统',
  },
  medium: {
    color: 'var(--af-warning, #f59e0b)',
    label: '中风险',
    icon: ShieldOutlined,
    description: '此操作会修改文件或执行本地命令',
  },
  high: {
    color: 'var(--af-error, #ef4444)',
    label: '高风险',
    icon: ShieldOutlined,
    description: '此操作可能影响系统配置或执行不可逆变更',
  },
}

const risk = computed(() => riskConfig[props.request.toolAction.riskLevel] || {
  color: '#999',
  label: '未知',
  icon: ShieldOutlined as Component,
  description: '风险等级未知',
})

// ─── Tool type detection ─────────────────────────────────────

type ToolCategory = 'file-read' | 'file-write' | 'command' | 'http' | 'search' | 'edit' | 'generic'

const toolCategory = computed<ToolCategory>(() => {
  const name = props.request.toolAction.toolName.toLowerCase()
  if (name.includes('read') || name.includes('view') || name.includes('open')) return 'file-read'
  if (name.includes('write') || name.includes('save') || name.includes('create_file'))
    return 'file-write'
  if (
    name.includes('exec') ||
    name.includes('run') ||
    name.includes('command') ||
    name.includes('shell') ||
    name.includes('bash')
  )
    return 'command'
  if (name.includes('http') || name.includes('fetch') || name.includes('request') || name.includes('api'))
    return 'http'
  if (name.includes('search') || name.includes('grep') || name.includes('find')) return 'search'
  if (name.includes('edit') || name.includes('replace') || name.includes('patch')) return 'edit'
  return 'generic'
})

const categoryMeta: Record<ToolCategory, { label: string; icon: Component; color: string }> = {
  'file-read': { label: '文件读取', icon: FolderOpenOutlined, color: '#60a5fa' },
  'file-write': { label: '文件写入', icon: EditNoteOutlined, color: '#f87171' },
  command: { label: '命令执行', icon: TerminalOutlined, color: '#fbbf24' },
  http: { label: '网络请求', icon: HttpOutlined, color: '#a78bfa' },
  search: { label: '搜索', icon: SearchOutlined, color: '#34d399' },
  edit: { label: '代码编辑', icon: CodeOutlined, color: '#f472b6' },
  generic: { label: '工具调用', icon: CodeOutlined, color: '#94a3b8' },
}

const meta = computed(() => categoryMeta[toolCategory.value])

const args = computed(() => props.request.toolAction.arguments)

// ─── Preview data extraction ─────────────────────────────────

const filePath = computed(() => {
  const a = args.value
  return (
    (a.path as string) ||
    (a.file_path as string) ||
    (a.filePath as string) ||
    (a.filename as string) ||
    ''
  )
})

const commandPreview = computed(() => {
  const a = args.value
  return (a.command as string) || (a.cmd as string) || (a.shell as string) || ''
})

const workingDir = computed(() => {
  const a = args.value
  return (a.cwd as string) || (a.workingDir as string) || (a.working_directory as string) || ''
})

const httpUrl = computed(() => {
  const a = args.value
  return (a.url as string) || (a.endpoint as string) || ''
})

const httpMethod = computed(() => {
  const a = args.value
  return (a.method as string) || 'GET'
})

const searchPattern = computed(() => {
  const a = args.value
  return (a.pattern as string) || (a.query as string) || (a.search as string) || ''
})

const contentPreview = computed(() => {
  const a = args.value
  const content = (a.content as string) || (a.text as string) || (a.data as string) || ''
  if (content.length > 500)
    return content.slice(0, 500) + '\n... (' + (content.length - 500) + ' more chars)'
  return content
})

// ─── Diff preview data ──────────────────────────────────

const diffOldCode = computed(() => {
  const a = args.value
  return (a.oldCode as string) || (a.old_content as string) || (a.original as string) || ''
})

const diffNewCode = computed(() => {
  const a = args.value
  return (
    (a.newCode as string) ||
    (a.new_content as string) ||
    (a.replacement as string) ||
    (a.content as string) ||
    ''
  )
})

const hasDiffData = computed(() => {
  return diffOldCode.value.length > 0 || diffNewCode.value.length > 0
})

const expandedNames = ref<string[]>([])

// ─── Approval actions ────────────────────────────────────────

const rememberChoice = ref(false)
const showRejectReason = ref(false)
const rejectReason = ref('')
const approving = ref(false)

function handleApprove(): void {
  approving.value = true
  emit('approve', rememberChoice.value)
  // Reset after a short delay for visual feedback
  setTimeout(() => {
    approving.value = false
  }, 300)
}

function handleApproveAll(): void {
  rememberChoice.value = true
  approving.value = true
  emit('approve', true)
  setTimeout(() => {
    approving.value = false
  }, 300)
}

function handleRejectClick(): void {
  showRejectReason.value = true
}

function handleRejectConfirm(): void {
  emit('reject', rejectReason.value.trim() || '用户拒绝')
  showRejectReason.value = false
  rejectReason.value = ''
}

function handleRejectCancel(): void {
  showRejectReason.value = false
  rejectReason.value = ''
}

// Expose for keyboard shortcuts from parent
defineExpose({ handleApprove, handleRejectConfirm })

// ─── Approval timeout countdown ──────────────────────────────

const remainingSeconds = ref<number | null>(null)
let countdownInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // Default 120s approval timeout
  const timeoutMs = 120_000
  const startTime = Date.now()
  remainingSeconds.value = Math.floor(timeoutMs / 1000)

  countdownInterval = setInterval(() => {
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, Math.floor((timeoutMs - elapsed) / 1000))
    remainingSeconds.value = remaining

    if (remaining <= 0) {
      if (countdownInterval) {
        clearInterval(countdownInterval)
        countdownInterval = null
      }
    }
  }, 1000)
})

onUnmounted(() => {
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
})

const timeoutProgress = computed(() => {
  if (remainingSeconds.value === null) return 100
  return Math.max(0, (remainingSeconds.value / 120) * 100)
})

const isUrgent = computed(() => remainingSeconds.value !== null && remainingSeconds.value <= 30)
</script>

<template>
  <div class="approval-card" :class="`approval-card--${props.request.toolAction.riskLevel}`">
    <!-- Header with tool info and risk badge -->
    <div class="approval-header">
      <div class="approval-header__left">
        <div class="approval-tool-icon" :style="{ backgroundColor: meta.color + '20', color: meta.color }">
          <NIcon :size="16">
            <component :is="meta.icon" />
          </NIcon>
        </div>
        <div class="approval-header__info">
          <span class="approval-title">{{ meta.label }}</span>
          <span class="approval-tool-name">{{ props.request.toolAction.toolName }}</span>
        </div>
      </div>

      <!-- Risk badge -->
      <div class="risk-indicator" :style="{ '--risk-color': risk.color }">
        <NIcon :size="12">
          <component :is="risk.icon" />
        </NIcon>
        <span class="risk-label">{{ risk.label }}</span>
      </div>
    </div>

    <!-- Risk description banner -->
    <div v-if="risk.description" class="risk-description" :style="{ '--risk-color': risk.color }">
      <NIcon :size="12" class="risk-desc-icon">
        <ShieldOutlined />
      </NIcon>
      {{ risk.description }}
    </div>

    <!-- Reason -->
    <div v-if="props.request.reason" class="approval-reason">
      {{ props.request.reason }}
    </div>

    <!-- Preview content -->
    <div class="approval-body">
      <!-- File read/write preview -->
      <template v-if="toolCategory === 'file-read' || toolCategory === 'file-write'">
        <div class="preview-section">
          <span class="preview-label">文件路径</span>
          <code class="preview-code">{{ filePath || '(未指定)' }}</code>
        </div>
        <div v-if="contentPreview && toolCategory === 'file-write'" class="preview-section">
          <span class="preview-label">写入内容预览</span>
          <pre class="preview-content">{{ contentPreview }}</pre>
        </div>
      </template>

      <!-- Command preview -->
      <template v-else-if="toolCategory === 'command'">
        <div class="preview-section">
          <span class="preview-label">执行命令</span>
          <pre class="preview-command">{{ commandPreview || '(未指定)' }}</pre>
        </div>
        <div v-if="workingDir" class="preview-section">
          <span class="preview-label">工作目录</span>
          <code class="preview-code">{{ workingDir }}</code>
        </div>
      </template>

      <!-- HTTP preview -->
      <template v-else-if="toolCategory === 'http'">
        <div class="preview-section">
          <span class="preview-label">请求</span>
          <div class="preview-http">
            <NTag
              size="small"
              :type="httpMethod === 'GET' ? 'success' : 'warning'"
              class="http-method"
            >
              {{ httpMethod.toUpperCase() }}
            </NTag>
            <code class="preview-code">{{ httpUrl || '(未指定)' }}</code>
          </div>
        </div>
      </template>

      <!-- Search preview -->
      <template v-else-if="toolCategory === 'search'">
        <div class="preview-section">
          <span class="preview-label">搜索模式</span>
          <code class="preview-code">{{ searchPattern || '(未指定)' }}</code>
        </div>
        <div v-if="filePath" class="preview-section">
          <span class="preview-label">搜索范围</span>
          <code class="preview-code">{{ filePath }}</code>
        </div>
      </template>

      <!-- Edit preview -->
      <template v-else-if="toolCategory === 'edit'">
        <div class="preview-section">
          <span class="preview-label">编辑文件</span>
          <code class="preview-code">{{ filePath || '(未指定)' }}</code>
        </div>
        <div v-if="hasDiffData" class="preview-section">
          <span class="preview-label">代码变更 (Diff)</span>
          <CodeDiffPreview :old-code="diffOldCode" :new-code="diffNewCode" :filename="filePath" />
        </div>
        <div v-else-if="contentPreview" class="preview-section">
          <span class="preview-label">变更预览</span>
          <pre class="preview-content">{{ contentPreview }}</pre>
        </div>
      </template>

      <!-- Generic fallback -->
      <template v-else>
        <div class="preview-section">
          <span class="preview-label">工具名称</span>
          <code class="preview-code">{{ props.request.toolAction.toolName }}</code>
        </div>
      </template>

      <!-- Raw args expandable -->
      <NCollapse v-model:expanded-names="expandedNames" class="raw-args-collapse">
        <NCollapseItem name="raw" title="原始参数">
          <pre class="tool-args">{{ JSON.stringify(props.request.toolAction.arguments, null, 2) }}</pre>
        </NCollapseItem>
      </NCollapse>
    </div>

    <!-- Reject reason input (shown when user clicks reject) -->
    <div v-if="showRejectReason" class="reject-reason-section">
      <NInput
        v-model:value="rejectReason"
        type="textarea"
        :rows="2"
        placeholder="输入拒绝理由（可选，帮助 Agent 理解你的意图）..."
        autofocus
        @keydown.enter.ctrl="handleRejectConfirm"
        @keydown.enter.meta="handleRejectConfirm"
      />
      <div class="reject-reason-actions">
        <button class="btn-reject-confirm" @click="handleRejectConfirm">
          <NIcon :size="13"><CancelOutlined /></NIcon>
          确认拒绝
        </button>
        <button class="btn-reject-cancel" @click="handleRejectCancel">取消</button>
      </div>
    </div>

    <!-- Sticky action bar -->
    <div v-else class="approval-actions-bar">
      <!-- Timeout progress bar -->
      <div v-if="remainingSeconds !== null" class="timeout-bar" :class="{ 'timeout-bar--urgent': isUrgent }">
        <div class="timeout-bar__fill" :style="{ width: timeoutProgress + '%' }"></div>
        <div class="timeout-bar__label">
          <NIcon :size="10"><TimerOutlined /></NIcon>
          <span>{{ remainingSeconds }}s</span>
        </div>
      </div>

      <!-- Primary actions -->
      <div class="approval-actions">
        <!-- Approve Once -->
        <button
          class="btn-action btn-approve"
          :class="{ 'btn-approve--active': approving }"
          @click="handleApprove"
        >
          <NIcon :size="15"><CheckCircleOutlined /></NIcon>
          <span class="btn-text">批准</span>
          <kbd class="kbd-hint kbd-hint--approve">Ctrl+↵</kbd>
        </button>

        <!-- Approve All Similar -->
        <NTooltip placement="top" :delay="300">
          <template #trigger>
            <button class="btn-action btn-approve-all" @click="handleApproveAll">
              <NIcon :size="14"><ExpandMoreOutlined /></NIcon>
              <span class="btn-text">全部批准</span>
              <kbd class="kbd-hint">Ctrl+⇧+↵</kbd>
            </button>
          </template>
          <span>本次会话内自动批准同类操作</span>
        </NTooltip>

        <!-- Reject -->
        <button class="btn-action btn-reject" @click="handleRejectClick">
          <NIcon :size="14"><CancelOutlined /></NIcon>
          <span class="btn-text">拒绝</span>
          <kbd class="kbd-hint">Ctrl+⇧+X</kbd>
        </button>
      </div>

      <!-- Remember choice checkbox -->
      <div class="approval-remember">
        <NCheckbox v-model:checked="rememberChoice">
          <span class="remember-text">
            本次会话内自动批准同类操作（{{ props.request.toolAction.toolName }} ·
            {{ risk.label }}）
          </span>
        </NCheckbox>
      </div>
    </div>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid var(--af-border, #334155);
  border-radius: 10px;
  margin: 12px 0;
  overflow: hidden;
  background: var(--af-bg-surface, #1e293b);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* Risk-based left border accent */
.approval-card--low {
  border-left: 3px solid var(--af-success, #10b981);
}

.approval-card--medium {
  border-left: 3px solid var(--af-warning, #f59e0b);
  animation: approval-breathe-medium 2.5s ease-in-out infinite;
}

.approval-card--high {
  border-left: 3px solid var(--af-error, #ef4444);
  animation: approval-breathe-high 1.8s ease-in-out infinite;
}

@keyframes approval-breathe-medium {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  50% {
    box-shadow: 0 0 12px 2px rgba(245, 158, 11, 0.12), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
}

@keyframes approval-breathe-high {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  50% {
    box-shadow: 0 0 16px 4px rgba(239, 68, 68, 0.18), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
}

/* ─── Header ──────────────────────────────────────────────── */

.approval-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.3));
  border-bottom: 1px solid var(--af-border, rgba(51, 65, 85, 0.5));
}

.approval-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.approval-tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
}

.approval-header__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.approval-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
  line-height: 1.3;
}

.approval-tool-name {
  font-size: 11px;
  color: var(--af-text-muted, #64748b);
  font-family: 'Fira Code', 'Consolas', monospace;
}

/* Risk indicator */
.risk-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--risk-color);
  background: color-mix(in srgb, var(--risk-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--risk-color) 30%, transparent);
}

.risk-label {
  letter-spacing: 0.3px;
}

/* Risk description banner */
.risk-description {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--risk-color);
  background: color-mix(in srgb, var(--risk-color) 6%, transparent);
  border-bottom: 1px solid var(--af-border, rgba(51, 65, 85, 0.3));
}

.risk-desc-icon {
  opacity: 0.8;
  flex-shrink: 0;
}

/* ─── Body ──────────────────────────────────────────────── */

.approval-reason {
  padding: 10px 14px 0;
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  line-height: 1.5;
}

.approval-body {
  padding: 12px 14px;
}

.preview-section {
  margin-bottom: 10px;
}

.preview-section:last-child {
  margin-bottom: 0;
}

.preview-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--af-text-tertiary, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.preview-code {
  display: block;
  font-size: 12px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  color: var(--af-text-primary, #e5e7eb);
  background: var(--af-bg-input, #1f2937);
  border-radius: 6px;
  padding: 6px 8px;
  word-break: break-all;
  white-space: pre-wrap;
}

.preview-command {
  display: block;
  font-size: 12px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  color: #fca5a5;
  background: var(--af-bg-input, #1f2937);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  border-left: 3px solid #ef4444;
}

.preview-content {
  display: block;
  font-size: 12px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  color: var(--af-text-secondary, #cbd5e1);
  background: var(--af-bg-input, #1f2937);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.preview-http {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--af-bg-input, #1f2937);
  border-radius: 6px;
  padding: 6px 8px;
}

.http-method {
  flex-shrink: 0;
  font-family: monospace;
  font-weight: 600;
}

.raw-args-collapse {
  margin-top: 10px;
}

:deep(.raw-args-collapse .n-collapse-item__header) {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
}

:deep(.raw-args-collapse .n-collapse-item__content-wrapper) {
  background: transparent;
}

.tool-args {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  margin: 0;
  overflow-x: auto;
  max-height: 200px;
  background: var(--af-bg-input, #1f2937);
  border-radius: 6px;
  padding: 8px 10px;
}

/* ─── Reject reason section ─────────────────────────────── */

.reject-reason-section {
  padding: 0 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reject-reason-actions {
  display: flex;
  gap: 8px;
}

.btn-reject-confirm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: var(--af-error, #ef4444);
  color: #fff;
  transition: opacity 0.15s ease;
}

.btn-reject-confirm:hover {
  opacity: 0.85;
}

.btn-reject-cancel {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--af-border, #334155);
  background: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  transition: opacity 0.15s ease;
}

.btn-reject-cancel:hover {
  opacity: 0.85;
}

/* ─── Sticky action bar ──────────────────────────────────── */

.approval-actions-bar {
  position: sticky;
  bottom: 0;
  background: var(--af-bg-surface, #1e293b);
  border-top: 1px solid var(--af-border, rgba(51, 65, 85, 0.5));
  padding: 10px 14px 12px;
  z-index: 5;
}

/* Timeout progress bar */
.timeout-bar {
  position: relative;
  height: 3px;
  background: var(--af-bg-hover, rgba(51, 65, 85, 0.5));
  border-radius: 2px;
  margin-bottom: 10px;
  overflow: hidden;
}

.timeout-bar__fill {
  height: 100%;
  background: var(--af-info, #0ea5e9);
  border-radius: 2px;
  transition: width 1s linear, background-color 0.3s ease;
}

.timeout-bar--urgent .timeout-bar__fill {
  background: var(--af-error, #ef4444);
  animation: timeout-pulse 1s ease-in-out infinite;
}

@keyframes timeout-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.timeout-bar__label {
  position: absolute;
  right: 0;
  top: -16px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--af-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

/* Action buttons */
.approval-actions {
  display: flex;
  gap: 6px;
}

.btn-action {
  flex: 1;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  position: relative;
  overflow: hidden;
}

.btn-action::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transform: translate(-50%, -50%);
  transition: width 0.3s ease, height 0.3s ease;
}

.btn-action:active::after {
  width: 200px;
  height: 200px;
}

/* Approve - prominent green with glow */
.btn-approve {
  background: var(--af-success, #10b981);
  color: #fff;
  flex: 2;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.3);
  animation: approve-glow 2s ease-in-out infinite;
}

@keyframes approve-glow {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.2);
  }
  50% {
    box-shadow: 0 0 12px 2px rgba(16, 185, 129, 0.25);
  }
}

.btn-approve:hover {
  background: color-mix(in srgb, var(--af-success, #10b981) 90%, #ffffff 10%);
  transform: translateY(-1px);
}

.btn-approve--active {
  transform: scale(0.96);
}

/* Approve All - secondary style */
.btn-approve-all {
  background: color-mix(in srgb, var(--af-success, #10b981) 15%, transparent);
  color: var(--af-success, #10b981);
  border: 1px solid color-mix(in srgb, var(--af-success, #10b981) 30%, transparent);
  flex: 1.2;
}

.btn-approve-all:hover {
  background: color-mix(in srgb, var(--af-success, #10b981) 25%, transparent);
  border-color: color-mix(in srgb, var(--af-success, #10b981) 50%, transparent);
}

/* Reject - subtle but clear */
.btn-reject {
  background: var(--af-bg-hover, #334155);
  color: var(--af-text-secondary, #cbd5e1);
  border: 1px solid var(--af-border, #475569);
  flex: 1;
}

.btn-reject:hover {
  background: color-mix(in srgb, var(--af-error, #ef4444) 15%, var(--af-bg-hover, #334155));
  color: var(--af-error, #ef4444);
  border-color: var(--af-error, #ef4444);
}

.btn-action:active {
  transform: scale(0.97);
}

.btn-text {
  white-space: nowrap;
}

/* Keyboard hint */
.kbd-hint {
  font-size: 10px;
  font-family: 'SF Mono', 'Consolas', monospace;
  opacity: 0.7;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  margin-left: 4px;
}

.kbd-hint--approve {
  background: rgba(255, 255, 255, 0.2);
}

/* Remember choice */
.approval-remember {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--af-border-subtle, rgba(51, 65, 85, 0.3));
}

:deep(.approval-remember .n-checkbox) {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
}

.remember-text {
  font-size: 12px;
}
</style>
