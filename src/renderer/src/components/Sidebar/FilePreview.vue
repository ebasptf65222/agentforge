<script setup lang="ts">
// WS-05: FilePreview - previews workspace file content.
// 预览模式分流：
// - viewer 模式（办公格式）：使用 File Viewer（@file-viewer/vue3 + preset-office）渲染，
//   通过 agentfile:// 协议流式加载，支持 PDF/Word/Excel/PPT/OFD 等。
// - text 模式（文本/代码）：保留简单语法高亮预览。
// - none 模式：提示不支持预览。

import { computed } from 'vue'
import { NIcon, NSpin, NTag } from 'naive-ui'
import { CloseOutlined, WarningAmberOutlined } from '@vicons/material'
import { FileViewer } from '@file-viewer/vue3'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTheme } from '@/composables/use-theme'

const workspaceStore = useWorkspaceStore()
const { effectiveTheme } = useTheme()

const hasPreview = computed(() => workspaceStore.previewPath !== null)
const isError = computed(() => workspaceStore.previewError !== null)
const isLoading = computed(() => workspaceStore.previewLoading)
const isViewerMode = computed(() => workspaceStore.previewMode === 'viewer')
const viewerUrl = computed(() => workspaceStore.previewFileUrl)
const viewerFilename = computed(() => workspaceStore.previewFilename)

/** File Viewer 配置：office preset（由 vite 插件自动注册），跟随应用主题 */
const viewerOptions = computed(() => ({
  preset: 'office' as const,
  rendererMode: 'replace' as const,
  theme: effectiveTheme.value,
  toolbar: {
    position: 'bottom-right' as const,
  },
}))

/** Detect language from file path for text highlighting */
const previewLanguage = computed(() => {
  const path = workspaceStore.previewPath ?? ''
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const langMap: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
    vue: 'vue', html: 'html', css: 'css', scss: 'scss', sass: 'sass',
    py: 'python', java: 'java', go: 'go', rs: 'rust', c: 'c', cpp: 'cpp',
    h: 'c', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', scala: 'scala', r: 'r', m: 'objective-c', mm: 'objective-c',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell',
    json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', toml: 'toml',
    md: 'markdown', sql: 'sql', dockerfile: 'dockerfile', env: 'ini',
    ini: 'ini', cfg: 'ini', conf: 'ini', log: 'log',
  }
  return langMap[ext] || ext || 'text'
})

/** Simple regex-based syntax highlighting */
const highlightedContent = computed(() => {
  const raw = workspaceStore.previewContent ?? ''
  const lang = previewLanguage.value

  // Skip highlighting for large files (>50KB) or non-code files
  if (raw.length > 50000 || ['text', 'log', 'markdown', 'txt'].includes(lang)) {
    return escapeHtml(raw)
  }

  return simpleHighlight(raw, lang)
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function simpleHighlight(code: string, _lang: string): string {
  let html = escapeHtml(code)

  // Comments (single line)
  html = html.replace(/(\/\/.*$|#.*$|--.*$)/gm, '<span class="token-comment">$1</span>')
  // Multi-line comments (basic)
  html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token-comment">$1</span>')
  // Strings (single/double quotes, basic)
  html = html.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="token-string">$1</span>')
  // Numbers
  html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-number">$1</span>')
  // Common keywords
  const keywords = [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'import', 'export', 'from', 'class', 'extends', 'new', 'try', 'catch',
    'async', 'await', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined',
    'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 'from',
    'public', 'private', 'static', 'void', 'int', 'float', 'double', 'boolean',
  ]
  const kwPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')
  html = html.replace(kwPattern, '<span class="token-keyword">$1</span>')

  return html
}
</script>

<template>
  <div v-if="hasPreview" class="file-preview">
    <!-- Header -->
    <div class="file-preview__header">
      <div class="file-preview__meta">
        <NTag size="tiny" :type="isViewerMode ? 'success' : 'info'" class="file-preview__lang">
          {{ isViewerMode ? '文档' : previewLanguage }}
        </NTag>
        <span class="file-preview__filename" :title="workspaceStore.previewPath ?? ''">
          {{ workspaceStore.previewPath }}
        </span>
      </div>
      <button
        class="file-preview__close"
        type="button"
        title="关闭预览"
        @click="workspaceStore.closePreview()"
      >
        <NIcon :size="14">
          <CloseOutlined />
        </NIcon>
      </button>
    </div>

    <!-- Body -->
    <div class="file-preview__body">
      <!-- viewer 模式：File Viewer 渲染办公文档 -->
      <div v-if="isViewerMode && viewerUrl" class="file-preview__viewer">
        <FileViewer
          :key="viewerUrl"
          :url="viewerUrl"
          :filename="viewerFilename"
          :options="viewerOptions"
        />
      </div>

      <!-- 文本/代码模式 -->
      <template v-else>
        <!-- Loading -->
        <div v-if="isLoading" class="file-preview__loading">
          <NSpin size="small" />
        </div>

        <!-- Error -->
        <div v-else-if="isError" class="file-preview__error">
          <NIcon :size="32" class="file-preview__error-icon">
            <WarningAmberOutlined />
          </NIcon>
          <p class="file-preview__error-text">{{ workspaceStore.previewError }}</p>
        </div>

        <!-- Content -->
        <pre
          v-else
          class="file-preview__content"
          :data-language="previewLanguage"
          v-html="highlightedContent"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.file-preview {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 45%;
  min-height: 0;
  background-color: var(--af-bg, #0f172a);
  border-top: 1px solid var(--af-border, #374151);
}

.file-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background-color: var(--af-bg-surface, #111827);
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.file-preview__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.file-preview__lang {
  flex-shrink: 0;
  text-transform: lowercase;
}

.file-preview__filename {
  font-size: 12px;
  font-family: monospace;
  color: var(--af-text-tertiary, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.file-preview__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-tertiary, #9ca3af);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.file-preview__close:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.file-preview__body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* File Viewer 渲染区：占满剩余空间 */
.file-preview__viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-preview__loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 32px;
}

.file-preview__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 12px;
}

.file-preview__error-icon {
  color: var(--af-warning, #f59e0b);
}

.file-preview__error-text {
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
  text-align: center;
  margin: 0;
}

.file-preview__content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 12px;
  font-size: 13px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  color: var(--af-text-primary, #e5e7eb);
  background-color: transparent;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Simple syntax highlighting tokens */
:deep(.token-comment) {
  color: #6b7280;
  font-style: italic;
}

:deep(.token-string) {
  color: #a5d6ff;
}

:deep(.token-number) {
  color: #fca5a5;
}

:deep(.token-keyword) {
  color: #c4b5fd;
  font-weight: 600;
}
</style>