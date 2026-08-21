<script setup lang="ts">
// UI-REDESIGN v0.3: PermissionInlineCard - inline permission card in the message flow
// Lightweight variant of ApprovalCard designed to live inside MessageList:
//  - risk-colored left border + compact preview
//  - approve (with remember) / reject actions
//  - resolved state collapses to a one-line summary (approved ✓ / rejected ✗)
//  - "调整审批模式" link guides users to settings

import { computed, ref, type Component } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import {
  CheckCircleOutlined,
  CancelOutlined,
  ShieldOutlined,
  SettingsOutlined,
  FolderOpenOutlined,
  CodeOutlined,
  HttpOutlined,
  SearchOutlined,
  TerminalOutlined,
  EditNoteOutlined,
} from '@vicons/material'
import type { ApprovalRequest } from '@shared/types'

const props = defineProps<{
  request: ApprovalRequest
  /** When set, the card shows a resolved summary instead of actions */
  resolved?: 'approved' | 'rejected'
}>()

const emit = defineEmits<{
  approve: [remember: boolean]
  reject: [reason?: string]
  'open-settings': []
}>()

// ─── Risk level config (mirrors ApprovalCard) ────────────────────

const riskConfig: Record<string, { color: string; label: string; description: string }> = {
  low: {
    color: 'var(--af-success, #10b981)',
    label: '低风险',
    description: '此操作仅读取信息，不会修改系统',
  },
  medium: {
    color: 'var(--af-warning, #f59e0b)',
    label: '中风险',
    description: '此操作会修改文件或执行本地命令',
  },
  high: {
    color: 'var(--af-error, #ef4444)',
    label: '高风险',
    description: '此操作可能影响系统配置或执行不可逆变更',
  },
}

const risk = computed(
  () =>
    riskConfig[props.request.toolAction.riskLevel] ?? {
      color: '#999',
      label: '未知',
      description: '风险等级未知',
    },
)

// ─── Tool category detection (mirrors ApprovalCard) ─────────────

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

const categoryMeta: Record<ToolCategory, { label: string; icon: Component }> = {
  'file-read': { label: '文件读取', icon: FolderOpenOutlined },
  'file-write': { label: '文件写入', icon: EditNoteOutlined },
  command: { label: '命令执行', icon: TerminalOutlined },
  http: { label: '网络请求', icon: HttpOutlined },
  search: { label: '搜索', icon: SearchOutlined },
  edit: { label: '代码编辑', icon: CodeOutlined },
  generic: { label: '工具调用', icon: CodeOutlined },
}

const meta = computed(() => categoryMeta[toolCategory.value])

// ─── Compact preview extraction ─────────────────────────────────

const args = computed(() => props.request.toolAction.arguments)

const primaryPreview = computed<string>(() => {
  const a = args.value
  const path =
    (a.path as string) || (a.file_path as string) || (a.filePath as string) || (a.filename as string)
  if (path) return String(path)
  const cmd = (a.command as string) || (a.cmd as string) || (a.shell as string)
  if (cmd) return String(cmd)
  const url = (a.url as string) || (a.endpoint as string)
  if (url) return String(url)
  const pattern = (a.pattern as string) || (a.query as string) || (a.search as string)
  if (pattern) return String(pattern)
  return props.request.toolAction.toolName
})

// ─── Actions ────────────────────────────────────────────────────

const rememberChoice = ref(false)
const showRejectReason = ref(false)
const rejectReason = ref('')

function handleApprove(): void {
  emit('approve', rememberChoice.value)
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
</script>

<template>
  <div
    class="perm-card"
    :class="[`perm-card--${props.request.toolAction.riskLevel}`, { 'perm-card--resolved': resolved }]"
  >
    <!-- Resolved summary (one line) -->
    <div v-if="resolved" class="perm-card__summary" :class="`perm-card__summary--${resolved}`">
      <NIcon :size="14">
        <CheckCircleOutlined v-if="resolved === 'approved'" />
        <CancelOutlined v-else />
      </NIcon>
      <span class="perm-card__summary-text">
        {{ resolved === 'approved' ? '已批准' : '已拒绝' }} ·
        {{ meta.label }} <code>{{ primaryPreview }}</code>
      </span>
    </div>

    <!-- Pending: full card -->
    <template v-else>
      <!-- Header -->
      <div class="perm-card__header">
        <div class="perm-card__header-left">
          <NIcon :size="15" :style="{ color: risk.color }">
            <component :is="meta.icon" />
          </NIcon>
          <span class="perm-card__title">权限请求 · {{ meta.label }}</span>
          <span class="perm-card__risk" :style="{ '--risk-color': risk.color }">
            <NIcon :size="11"><ShieldOutlined /></NIcon>
            {{ risk.label }}
          </span>
        </div>
      </div>

      <!-- Preview -->
      <div class="perm-card__preview">
        <code class="perm-card__preview-code">{{ primaryPreview }}</code>
        <span v-if="risk.description" class="perm-card__desc">{{ risk.description }}</span>
      </div>

      <!-- Reject reason input -->
      <div v-if="showRejectReason" class="perm-card__reject">
        <input
          v-model="rejectReason"
          class="perm-card__reject-input"
          type="text"
          placeholder="拒绝理由（可选）..."
          @keydown.enter="handleRejectConfirm"
          @keydown.esc="handleRejectCancel"
        />
        <button class="perm-card__btn perm-card__btn--reject-confirm" @click="handleRejectConfirm">
          确认拒绝
        </button>
        <button class="perm-card__btn perm-card__btn--ghost" @click="handleRejectCancel">取消</button>
      </div>

      <!-- Actions -->
      <div v-else class="perm-card__actions">
        <button class="perm-card__btn perm-card__btn--approve" @click="handleApprove">
          <NIcon :size="13"><CheckCircleOutlined /></NIcon>
          批准
          <kbd class="perm-card__kbd">Ctrl+↵</kbd>
        </button>
        <button class="perm-card__btn perm-card__btn--reject" @click="handleRejectClick">
          <NIcon :size="13"><CancelOutlined /></NIcon>
          拒绝
        </button>
        <NTooltip placement="top" :delay="300">
          <template #trigger>
            <button
              class="perm-card__btn perm-card__btn--remember"
              :class="{ 'is-on': rememberChoice }"
              @click="rememberChoice = !rememberChoice"
            >
              记住选择
            </button>
          </template>
          <span>本次会话内自动批准同类操作</span>
        </NTooltip>
        <button class="perm-card__settings-link" title="前往设置调整审批模式" @click="emit('open-settings')">
          <NIcon :size="12"><SettingsOutlined /></NIcon>
          审批模式
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.perm-card {
  margin: 8px 0;
  border: 1px solid var(--af-border, #334155);
  border-left: 3px solid var(--af-border, #334155);
  border-radius: 8px;
  background: var(--af-bg-surface, #1e293b);
  overflow: hidden;
  font-size: 13px;
}

.perm-card--low {
  border-left-color: var(--af-success, #10b981);
}

.perm-card--medium {
  border-left-color: var(--af-warning, #f59e0b);
}

.perm-card--high {
  border-left-color: var(--af-error, #ef4444);
}

/* ─── Resolved summary ─────────────────────────────────────── */

.perm-card--resolved {
  border-left-color: var(--af-border, #334155);
  opacity: 0.85;
}

.perm-card__summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
}

.perm-card__summary--approved {
  color: var(--af-success, #10b981);
}

.perm-card__summary--rejected {
  color: var(--af-text-muted, #94a3b8);
}

.perm-card__summary-text code {
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  color: var(--af-text-tertiary, #94a3b8);
  background: var(--af-bg-input, #1f2937);
  padding: 1px 6px;
  border-radius: 4px;
}

/* ─── Pending card ─────────────────────────────────────────── */

.perm-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 0;
}

.perm-card__header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.perm-card__title {
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
}

.perm-card__risk {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--risk-color);
  background: color-mix(in srgb, var(--risk-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--risk-color) 30%, transparent);
}

.perm-card__preview {
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.perm-card__preview-code {
  display: block;
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  color: var(--af-text-primary, #e5e7eb);
  background: var(--af-bg-input, #1f2937);
  border-radius: 6px;
  padding: 5px 8px;
  word-break: break-all;
  white-space: pre-wrap;
  max-height: 80px;
  overflow-y: auto;
}

.perm-card__desc {
  font-size: 11px;
  color: var(--af-text-muted, #94a3b8);
}

/* ─── Actions ──────────────────────────────────────────────── */

.perm-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 10px;
  flex-wrap: wrap;
}

.perm-card__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.perm-card__btn--approve {
  background: var(--af-success, #10b981);
  color: #fff;
}

.perm-card__btn--approve:hover {
  background: color-mix(in srgb, var(--af-success, #10b981) 88%, #ffffff);
}

.perm-card__btn--reject {
  background: var(--af-bg-hover, #334155);
  color: var(--af-text-secondary, #cbd5e1);
  border: 1px solid var(--af-border, #475569);
}

.perm-card__btn--reject:hover {
  color: var(--af-error, #ef4444);
  border-color: var(--af-error, #ef4444);
}

.perm-card__btn--remember {
  background: transparent;
  color: var(--af-text-tertiary, #94a3b8);
  border: 1px dashed var(--af-border, #475569);
}

.perm-card__btn--remember.is-on {
  color: var(--af-success, #10b981);
  border-color: var(--af-success, #10b981);
  border-style: solid;
  background: color-mix(in srgb, var(--af-success, #10b981) 10%, transparent);
}

.perm-card__btn--reject-confirm {
  background: var(--af-error, #ef4444);
  color: #fff;
}

.perm-card__btn--ghost {
  background: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  border: 1px solid var(--af-border, #475569);
}

.perm-card__kbd {
  font-size: 10px;
  font-family: 'SF Mono', 'Consolas', monospace;
  opacity: 0.75;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
}

.perm-card__settings-link {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--af-text-muted, #94a3b8);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  transition: color 0.15s ease;
}

.perm-card__settings-link:hover {
  color: var(--af-brand, #818cf8);
}

/* ─── Reject reason ────────────────────────────────────────── */

.perm-card__reject {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 10px;
}

.perm-card__reject-input {
  flex: 1;
  min-width: 0;
  background: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: 6px;
  color: var(--af-text-primary, #e5e7eb);
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
}

.perm-card__reject-input:focus {
  border-color: var(--af-brand, #6366f1);
}
</style>
