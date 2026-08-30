<script setup lang="ts">
// FilePreviewPanel — fullscreen file preview that takes over the main area.
// Replaces the old Sidebar/FilePreview.vue which was cramped in a 280px sidebar.
// Supports two modes:
// - viewer mode (office formats): File Viewer renders PDF/Word/Excel/PPT etc.
// - text mode (code/text): shiki syntax highlighting via useShikiHighlight composable.

import { ref, computed, watch, onErrorCaptured } from 'vue'
import { NIcon, NSpin, NTag, NEmpty } from 'naive-ui'
import { ArrowBackOutlined, ContentCopyOutlined, WarningAmberOutlined } from '@vicons/material'
import { FileViewer } from '@file-viewer/vue3'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/composables/use-theme'
import { useShikiHighlight } from '@/composables/use-shiki-highlight'
import { getFileTypeIcon, getFileTypeLabel } from '@/utils/file-type'

const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()
const { effectiveTheme } = useTheme()

// ─── Reactive state ──────────────────────────────────────────

const hasPreview = computed(() => workspaceStore.previewPath !== null)
const isError = computed(() => workspaceStore.previewError !== null)
const isLoading = computed(() => workspaceStore.previewLoading)
const isViewerMode = computed(() => workspaceStore.previewMode === 'viewer')
const viewerUrl = computed(() => workspaceStore.previewFileUrl)
const viewerFilename = computed(() => workspaceStore.previewFilename)
const previewPath = computed(() => workspaceStore.previewPath ?? '')
const previewContent = computed(() => workspaceStore.previewContent ?? '')
const previewError = computed(() => workspaceStore.previewError ?? '')

const fileTypeIcon = computed(() => getFileTypeIcon(viewerFilename.value || previewPath.value))
const fileTypeLabel = computed(() => getFileTypeLabel(viewerFilename.value || previewPath.value))

// ─── Language detection ──────────────────────────────────────

const previewLanguage = computed(() => {
  const path = previewPath.value
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const langMap: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
    vue: 'vue', html: 'html', css: 'css', scss: 'scss', sass: 'sass',
    py: 'python', java: 'java', go: 'go', rs: 'rust', c: 'c', cpp: 'cpp',
    h: 'c', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', scala: 'scala', r: 'r', sh: 'bash', bash: 'bash',
    zsh: 'bash', ps1: 'powershell', json: 'json', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', toml: 'toml', md: 'markdown', sql: 'sql', ini: 'ini',
    cfg: 'ini', conf: 'ini', env: 'ini', log: 'log', txt: 'text',
  }
  return langMap[ext] || ext || 'text'
})

// ─── Shiki highlighting ──────────────────────────────────────

const { highlightedHtml, isLoading: isHighlighting } = useShikiHighlight(
  previewContent,
  previewLanguage,
)

// ─── Viewer mode: loading/error/timeout ──────────────────────

const viewerLoading = ref(false)
const viewerError = ref<string | null>(null)
let viewerTimeoutId: ReturnType<typeof setTimeout> | null = null

watch(viewerUrl, (url) => {
  // Reset state when URL changes
  viewerLoading.value = !!url
  viewerError.value = null
  if (viewerTimeoutId) clearTimeout(viewerTimeoutId)
  // Timeout fallback: if viewer doesn't render within 30s, show error
  if (url) {
    viewerTimeoutId = setTimeout(() => {
      if (viewerLoading.value) {
        viewerLoading.value = false
        viewerError.value = '文档加载超时，请重试或检查文件是否损坏'
      }
    }, 30_000)
  }
}, { immediate: true })

// Stop loading when a FileViewer actually renders (no event API, so we
// rely on onErrorCaptured for failures and a shorter grace period for success)
watch(isViewerMode, (isViewer) => {
  if (isViewer && viewerUrl.value) {
    // Give FileViewer a brief moment to mount, then clear loading
    setTimeout(() => {
      if (viewerLoading.value && !viewerError.value) {
        viewerLoading.value = false
      }
    }, 1500)
  }
})

onErrorCaptured((err) => {
  viewerLoading.value = false
  viewerError.value = err instanceof Error ? err.message : String(err)
  if (viewerTimeoutId) clearTimeout(viewerTimeoutId)
  return false // prevent error from propagating
})

// ─── Viewer options ──────────────────────────────────────────

const viewerOptions = computed(() => ({
  preset: 'office' as const,
  rendererMode: 'replace' as const,
  theme: effectiveTheme.value,
  toolbar: {
    position: 'bottom-right' as const,
  },
}))

// ─── Copy functionality ──────────────────────────────────────

const copyLabel = ref('复制')

async function handleCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(previewContent.value)
    copyLabel.value = '已复制'
    setTimeout(() => { copyLabel.value = '复制' }, 2000)
  } catch {
    copyLabel.value = '复制失败'
    setTimeout(() => { copyLabel.value = '复制' }, 2000)
  }
}

// ─── Close handler ───────────────────────────────────────────

function handleClose(): void {
  uiStore.closePreviewPanel()
}
</script>

<template>
  <div class="preview-panel">
    <!-- Header: back button + file info + actions -->
    <header class="preview-panel__header">
      <div class="preview-panel__left">
        <button
          class="preview-panel__back"
          type="button"
          title="返回聊天 (Esc)"
          @click="handleClose"
        >
          <NIcon :size="18"><ArrowBackOutlined /></NIcon>
        </button>
        <div class="preview-panel__divider" />
        <NIcon :size="16" class="preview-panel__type-icon">
          <component :is="fileTypeIcon" />
        </NIcon>
        <NTag size="tiny" :type="isViewerMode ? 'success' : 'info'">
          {{ isViewerMode ? '文档' : fileTypeLabel }}
        </NTag>
        <span class="preview-panel__filename" :title="previewPath">
          {{ previewPath }}
        </span>
      </div>
      <div class="preview-panel__actions">
        <button
          v-if="!isViewerMode && previewContent"
          class="preview-panel__action-btn"
          type="button"
          title="复制内容"
          @click="handleCopy"
        >
          <NIcon :size="16"><ContentCopyOutlined /></NIcon>
          <span class="preview-panel__btn-label">{{ copyLabel }}</span>
        </button>
      </div>
    </header>

    <!-- Body: fills remaining space -->
    <div class="preview-panel__body">
      <!-- Empty state -->
      <NEmpty v-if="!hasPreview" description="选择文件预览" class="preview-panel__empty" />

      <template v-else>
        <!-- Viewer mode (office documents) -->
        <template v-if="isViewerMode && viewerUrl">
          <div v-if="viewerLoading" class="preview-panel__loading">
            <NSpin size="large" />
          </div>
          <div v-else-if="viewerError" class="preview-panel__error">
            <NIcon :size="40" class="preview-panel__error-icon">
              <WarningAmberOutlined />
            </NIcon>
            <p class="preview-panel__error-text">{{ viewerError }}</p>
          </div>
          <FileViewer
            v-else
            :key="viewerUrl"
            :url="viewerUrl"
            :filename="viewerFilename"
            :options="viewerOptions"
            class="preview-panel__viewer"
          />
        </template>

        <!-- Text/code mode -->
        <template v-else>
          <div v-if="isLoading || isHighlighting" class="preview-panel__loading">
            <NSpin size="large" />
          </div>
          <div v-else-if="isError" class="preview-panel__error">
            <NIcon :size="40" class="preview-panel__error-icon">
              <WarningAmberOutlined />
            </NIcon>
            <p class="preview-panel__error-text">{{ previewError }}</p>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="preview-panel__content" v-html="highlightedHtml" />
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: var(--af-bg, #0f172a);
}

/* ─── Header ──────────────────────────────────────────────────── */

.preview-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--af-space-2, 8px) var(--af-space-3, 12px);
  flex-shrink: 0;
  background-color: var(--af-bg-surface, #111827);
  border-bottom: 1px solid var(--af-border, #374151);
}

.preview-panel__left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.preview-panel__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.preview-panel__back:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.preview-panel__divider {
  width: 1px;
  height: 20px;
  background-color: var(--af-border, #374151);
  flex-shrink: 0;
}

.preview-panel__type-icon {
  color: var(--af-text-tertiary, #9ca3af);
  flex-shrink: 0;
}

.preview-panel__filename {
  font-size: 13px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  color: var(--af-text-secondary, #cbd5e1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.preview-panel__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.preview-panel__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.preview-panel__action-btn:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  border-color: var(--af-border, #4b5563);
  color: var(--af-text-primary, #e5e7eb);
}

.preview-panel__btn-label {
  white-space: nowrap;
}

/* ─── Body ────────────────────────────────────────────────────── */

.preview-panel__body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-panel__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-panel__viewer {
  flex: 1;
  min-height: 0;
}

.preview-panel__loading {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
}

.preview-panel__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 16px;
  padding: 32px 16px;
}

.preview-panel__error-icon {
  color: var(--af-warning, #f59e0b);
}

.preview-panel__error-text {
  font-size: 14px;
  color: var(--af-text-tertiary, #94a3b8);
  text-align: center;
  margin: 0;
  max-width: 400px;
}

.preview-panel__content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

/* shiki code block styling */
:deep(.shiki) {
  margin: 0;
  padding: var(--af-space-4, 16px);
  font-size: var(--af-font-base, 14px);
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
}

:deep(.shiki code) {
  font-family: inherit;
}
</style>
