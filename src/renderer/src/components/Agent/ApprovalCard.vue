<script setup lang="ts">
// P2-09: ApprovalCard - tool approval request UI with enhanced previews (OPT-UI-11)

import { computed, ref } from 'vue'
import { NIcon, NTag, NCollapse, NCollapseItem } from 'naive-ui'
import {
  FolderOpenOutlined,
  CodeOutlined,
  HttpOutlined,
  SearchOutlined,
  TerminalOutlined,
  EditNoteOutlined,
  ExpandMoreOutlined,
} from '@vicons/material'
import type { ApprovalRequest } from '@shared/types'

const props = defineProps<{
  request: ApprovalRequest
}>()

const emit = defineEmits<{
  approve: []
  reject: [reason?: string]
}>()

const riskColors: Record<string, string> = {
  low: 'var(--af-success, #10b981)',
  medium: 'var(--af-warning, #f59e0b)',
  high: 'var(--af-error, #ef4444)',
}

const riskLabels: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
}

// ─── Tool type detection ─────────────────────────────────────

type ToolCategory = 'file-read' | 'file-write' | 'command' | 'http' | 'search' | 'edit' | 'generic'

const toolCategory = computed<ToolCategory>(() => {
  const name = props.request.toolAction.toolName.toLowerCase()
  if (name.includes('read') || name.includes('view') || name.includes('open')) return 'file-read'
  if (name.includes('write') || name.includes('save') || name.includes('create_file')) return 'file-write'
  if (name.includes('exec') || name.includes('run') || name.includes('command') || name.includes('shell') || name.includes('bash')) return 'command'
  if (name.includes('http') || name.includes('fetch') || name.includes('request') || name.includes('api')) return 'http'
  if (name.includes('search') || name.includes('grep') || name.includes('find')) return 'search'
  if (name.includes('edit') || name.includes('replace') || name.includes('patch')) return 'edit'
  return 'generic'
})

const categoryMeta: Record<ToolCategory, { label: string; icon: any; color: string }> = {
  'file-read': { label: '文件读取', icon: FolderOpenOutlined, color: '#60a5fa' },
  'file-write': { label: '文件写入', icon: EditNoteOutlined, color: '#f87171' },
  'command': { label: '命令执行', icon: TerminalOutlined, color: '#fbbf24' },
  'http': { label: '网络请求', icon: HttpOutlined, color: '#a78bfa' },
  'search': { label: '搜索', icon: SearchOutlined, color: '#34d399' },
  'edit': { label: '代码编辑', icon: CodeOutlined, color: '#f472b6' },
  'generic': { label: '工具调用', icon: CodeOutlined, color: '#94a3b8' },
}

const meta = computed(() => categoryMeta[toolCategory.value])

const args = computed(() => props.request.toolAction.arguments)

// ─── Preview data extraction ─────────────────────────────────

const filePath = computed(() => {
  const a = args.value
  return (a.path as string) || (a.file_path as string) || (a.filePath as string) || (a.filename as string) || ''
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
  if (content.length > 500) return content.slice(0, 500) + '\n... (' + (content.length - 500) + ' more chars)'
  return content
})

const expandedNames = ref<string[]>([])

function handleApprove(): void {
  emit('approve')
}

function handleReject(): void {
  emit('reject', '用户拒绝')
}
</script>

<template>
  <div class="approval-card">
    <!-- Header -->
    <div class="approval-header">
      <div class="approval-header__left">
        <NIcon :size="16" :color="meta.color">
          <component :is="meta.icon" />
        </NIcon>
        <span class="approval-title">{{ meta.label }}</span>
      </div>
      <span
        class="risk-badge"
        :style="{ backgroundColor: riskColors[props.request.toolAction.riskLevel] || '#999' }"
      >
        {{ riskLabels[props.request.toolAction.riskLevel] || '未知' }}
      </span>
    </div>

    <!-- Reason -->
    <div class="approval-body">
      <p v-if="props.request.reason" class="approval-reason">{{ props.request.reason }}</p>

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
            <NTag size="small" :type="httpMethod === 'GET' ? 'success' : 'warning'" class="http-method">
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
        <div v-if="contentPreview" class="preview-section">
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

    <!-- Actions -->
    <div class="approval-actions">
      <button class="btn-approve" @click="handleApprove">
        <NIcon :size="14"><ExpandMoreOutlined /></NIcon>
        批准
      </button>
      <button class="btn-reject" @click="handleReject">拒绝</button>
    </div>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  margin: 12px 0;
  overflow: hidden;
  background: var(--af-bg-surface, #1e293b);
}

.approval-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--af-bg-hover, #334155);
  border-bottom: 1px solid var(--af-border, #334155);
}

.approval-header__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.approval-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
}

.risk-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--af-radius-sm, 6px);
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.approval-body {
  padding: 12px 14px;
}

.approval-reason {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  line-height: 1.5;
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
  border-radius: var(--af-radius-sm, 6px);
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
  border-radius: var(--af-radius-sm, 6px);
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
  border-radius: var(--af-radius-sm, 6px);
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
  border-radius: var(--af-radius-sm, 6px);
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
  border-radius: var(--af-radius-sm, 6px);
  padding: 8px 10px;
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
  border-radius: var(--af-radius-sm, 6px);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition:
    opacity 0.15s ease,
    transform 0.1s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.btn-approve {
  background: var(--af-success, #10b981);
  color: #fff;
}

.btn-approve:hover {
  opacity: 0.85;
}

.btn-reject {
  background: var(--af-bg-hover, #334155);
  color: var(--af-text-primary, #f1f5f9);
  border: 1px solid var(--af-border, #334155);
}

.btn-reject:hover {
  opacity: 0.85;
}

.btn-approve:active,
.btn-reject:active {
  transform: scale(0.97);
}
</style>
