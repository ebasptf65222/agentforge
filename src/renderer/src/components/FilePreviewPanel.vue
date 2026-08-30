<script setup lang="ts">
// FilePreviewPanel — fullscreen file preview that takes over the main area.
// Replaces the old Sidebar/FilePreview.vue which was cramped in a 280px sidebar.
// Supports modes:
// - viewer mode (office/image/media formats): File Viewer renders PDF/Word/Excel/PPT/png/mp4 etc.
// - text mode (code/text): shiki syntax highlighting via useShikiHighlight composable.
// - rendered view (md/html/svg): source + rendered dual view with a「预览 | 源码」toggle.

import { ref, computed, watch, onErrorCaptured } from 'vue'
import type { WebviewTag } from 'electron'
import { NIcon, NSpin, NTag, NEmpty } from 'naive-ui'
import {
  ArrowBackOutlined,
  ContentCopyOutlined,
  WarningAmberOutlined,
  VisibilityOutlined,
  CodeOutlined,
  RefreshOutlined,
} from '@vicons/material'
import { FileViewer } from '@file-viewer/vue3'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/composables/use-theme'
import { useShikiHighlight } from '@/composables/use-shiki-highlight'
import { getFileTypeIcon, getFileTypeLabel } from '@/utils/file-type'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

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

// ─── Rendered view (md/html/svg): 预览 | 源码 toggle ─────────

type RenderedKind = 'markdown' | 'html' | 'svg'

const viewMode = ref<'rendered' | 'source'>('rendered')

const renderedKind = computed<RenderedKind | null>(() => {
  const name = viewerFilename.value || previewPath.value
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  return null
})

const canRender = computed(
  () => workspaceStore.previewRenderable && renderedKind.value !== null,
)

const effectiveView = computed<'rendered' | 'source'>(() =>
  canRender.value && viewMode.value === 'rendered' ? 'rendered' : 'source',
)

// 切换文件时重置为渲染视图
watch(previewPath, () => {
  viewMode.value = 'rendered'
})

// ─── HTML rendered view: webview loading/error state ─────────

const htmlLoading = ref(false)
const htmlError = ref(false)
const htmlRetryCount = ref(0)

watch([effectiveView, renderedKind, viewerUrl], ([view, kind]) => {
  if (view === 'rendered' && kind === 'html') {
    htmlLoading.value = true
    htmlError.value = false
  }
})

function handleHtmlRetry(): void {
  htmlRetryCount.value += 1
  htmlLoading.value = true
  htmlError.value = false
}

let webviewCleanup: (() => void) | null = null

/** webview 挂载/更新时绑定加载事件（function ref，每次元素变化都会重新调用） */
function handleWebviewRef(el: unknown): void {
  webviewCleanup?.()
  webviewCleanup = null
  const wv = el as WebviewTag | null
  if (!wv) return
  const onFinish = (): void => {
    htmlLoading.value = false
    htmlError.value = false
  }
  const onFail = (event: Event): void => {
    // errorCode -3 = ERR_ABORTED（导航被取消），不算失败
    const code = (event as Event & { errorCode?: number }).errorCode
    if (code === -3) return
    htmlLoading.value = false
    htmlError.value = true
  }
  wv.addEventListener('did-finish-load', onFinish)
  wv.addEventListener('did-fail-load', onFail)
  webviewCleanup = () => {
    wv.removeEventListener('did-finish-load', onFinish)
    wv.removeEventListener('did-fail-load', onFail)
  }
}

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
        <!-- 预览 | 源码 切换（md/html/svg 等可渲染文件） -->
        <div
          v-if="canRender && !isViewerMode"
          class="preview-panel__view-toggle"
          role="group"
          aria-label="切换预览视图"
        >
          <button
            :class="[
              'preview-panel__toggle-btn',
              { 'preview-panel__toggle-btn--active': effectiveView === 'rendered' },
            ]"
            type="button"
            title="渲染效果"
            @click="viewMode = 'rendered'"
          >
            <NIcon :size="14"><VisibilityOutlined /></NIcon>
            <span>预览</span>
          </button>
          <button
            :class="[
              'preview-panel__toggle-btn',
              { 'preview-panel__toggle-btn--active': effectiveView === 'source' },
            ]"
            type="button"
            title="源代码"
            @click="viewMode = 'source'"
          >
            <NIcon :size="14"><CodeOutlined /></NIcon>
            <span>源码</span>
          </button>
        </div>
        <button
          v-if="!isViewerMode && previewContent && effectiveView === 'source'"
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

        <!-- Text-based modes: rendered view / source view -->
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

          <!-- Rendered view (md/html/svg) -->
          <template v-else-if="effectiveView === 'rendered'">
            <!-- Markdown: 复用聊天渲染管线（marked + shiki + mermaid） -->
            <div v-if="renderedKind === 'markdown'" class="preview-panel__markdown">
              <MarkdownRenderer :content="previewContent" />
            </div>

            <!-- SVG: 图像直接显示 -->
            <div v-else-if="renderedKind === 'svg'" class="preview-panel__svg">
              <img
                v-if="viewerUrl"
                :key="viewerUrl"
                :src="viewerUrl"
                alt="SVG 预览"
                class="preview-panel__svg-img"
              >
            </div>

            <!-- HTML: webview 真实渲染（独立 guest 页面，不受主窗口 CSP 限制） -->
            <div v-else-if="renderedKind === 'html' && viewerUrl" class="preview-panel__html">
              <webview
                :key="`${viewerUrl}#${htmlRetryCount}`"
                :ref="handleWebviewRef"
                :src="viewerUrl"
                class="preview-panel__webview"
                allowpopups="false"
              />
              <div v-if="htmlLoading" class="preview-panel__webview-overlay">
                <NSpin size="large" />
              </div>
              <div v-else-if="htmlError" class="preview-panel__webview-overlay">
                <NIcon :size="40" class="preview-panel__error-icon">
                  <WarningAmberOutlined />
                </NIcon>
                <p class="preview-panel__error-text">页面加载失败</p>
                <button class="preview-panel__action-btn" type="button" @click="handleHtmlRetry">
                  <NIcon :size="16"><RefreshOutlined /></NIcon>
                  <span class="preview-panel__btn-label">重新加载</span>
                </button>
              </div>
            </div>
          </template>

          <!-- Source view (shiki highlighting) -->
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

/* ─── View toggle（预览 | 源码） ──────────────────────────────── */

.preview-panel__view-toggle {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  background-color: var(--af-bg-input, rgba(255, 255, 255, 0.04));
  flex-shrink: 0;
}

.preview-panel__toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.preview-panel__toggle-btn:hover {
  color: var(--af-text-primary, #e5e7eb);
}

.preview-panel__toggle-btn--active {
  background-color: var(--af-brand, #4f46e5);
  color: #ffffff;
}

/* ─── Rendered view: markdown ─────────────────────────────────── */

.preview-panel__markdown {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.preview-panel__markdown :deep(.markdown-renderer) {
  max-width: 860px;
  margin: 0 auto;
  padding: var(--af-space-4, 16px) var(--af-space-6, 24px);
}

/* ─── Rendered view: svg ──────────────────────────────────────── */

.preview-panel__svg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 24px;
  overflow: auto;
  /* 棋盘格透明背景，便于查看带透明度的 SVG */
  background-image:
    linear-gradient(45deg, rgba(128, 128, 128, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.12) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}

.preview-panel__svg-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* ─── Rendered view: html (webview) ───────────────────────────── */

.preview-panel__html {
  position: relative;
  flex: 1;
  min-height: 0;
}

.preview-panel__webview {
  display: inline-flex;
  width: 100%;
  height: 100%;
  background-color: #ffffff;
}

.preview-panel__webview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background-color: var(--af-bg, #0f172a);
}
</style>
