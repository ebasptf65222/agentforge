<script setup lang="ts">
// P1-14: MarkdownRenderer - renders markdown as HTML with code copy support
// UI-REDESIGN v0.3: + rAF-throttled re-render for streaming content
//   (full marked+shiki parse per chunk is expensive; coalesce to one
//    render per animation frame)

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { renderMarkdown, getHighlighter } from '@/utils/markdown'
import { renderMermaid } from '@/utils/mermaid'

const props = defineProps<{
  content: string
}>()

const rootRef = ref<HTMLElement | null>(null)
const ready = ref(false)

/**
 * Initialize shiki highlighter, then trigger re-render.
 * After the highlighter loads, `renderMarkdown` will use it on subsequent calls.
 */
async function initHighlighter(): Promise<void> {
  await getHighlighter()
  ready.value = true
  // 渲染 mermaid 图表
  await renderMermaidBlocks()
}

onMounted(() => {
  initHighlighter()
})

// ─── rAF-throttled rendering (UI-REDESIGN v0.3) ─────────────────

/** Last rendered source content */
const throttledContent = ref(props.content)

let rafId: number | null = null

/**
 * Schedule a throttled re-render. Multiple content changes within the
 * same frame are coalesced into a single render pass.
 */
function scheduleRender(): void {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    throttledContent.value = props.content
  })
}

// Watch raw content and throttle updates to one render per frame
watch(
  () => props.content,
  (newContent, oldContent) => {
    // 流结束/内容清空时立即同步渲染，避免最后一帧被节流丢弃
    if (newContent.length < oldContent.length) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      throttledContent.value = newContent
      return
    }
    scheduleRender()
  },
)

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})

const renderedHtml = computed(() => renderMarkdown(throttledContent.value))

// Re-render once the highlighter is loaded to get syntax highlighting
const finalHtml = computed(() => {
  // When the highlighter becomes ready, re-render to apply syntax highlighting
  if (ready.value) {
    return renderMarkdown(throttledContent.value)
  }
  return renderedHtml.value
})

/**
 * 异步渲染所有 mermaid 占位 div。
 */
async function renderMermaidBlocks(): Promise<void> {
  if (!rootRef.value) return
  const mermaidDivs = rootRef.value.querySelectorAll<HTMLElement>('.mermaid-block')
  for (const div of mermaidDivs) {
    const code = div.getAttribute('data-mermaid')
    if (!code) continue
    const loadingEl = div.querySelector('.mermaid-block__loading')
    try {
      const svg = await renderMermaid(decodeURIComponent(code))
      if (loadingEl) {
        loadingEl.outerHTML = `<div class="mermaid-block__svg">${svg}</div>`
      }
    } catch {
      if (loadingEl) {
        loadingEl.textContent = '图表渲染失败'
      }
    }
  }
}

// 内容变化时重新渲染 mermaid
watch(finalHtml, () => {
  nextTick(() => {
    renderMermaidBlocks()
  })
})

// ─── Event delegation for copy & collapse buttons ───────────────

function handleCopyClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  const button = target.closest('.code-block__copy') as HTMLButtonElement | null
  if (!button) return

  const code = button.getAttribute('data-code')
  if (!code) return

  // Decode HTML entities back to raw text
  const textarea = document.createElement('textarea')
  textarea.innerHTML = code
  const rawCode = textarea.value

  navigator.clipboard.writeText(rawCode).then(() => {
    const originalText = button.textContent
    button.textContent = '已复制'
    setTimeout(() => {
      button.textContent = originalText
    }, 2000)
  })
}

/**
 * Toggle collapsed state of long code blocks (>30 lines).
 * The collapse button lives in the block header; the visual
 * clamping is done via the .is-collapsed CSS class.
 */
function handleCollapseClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  const button = target.closest('.code-block__collapse') as HTMLButtonElement | null
  if (!button) return

  const block = button.closest('.code-block')
  if (!block) return

  const isCollapsed = block.classList.toggle('is-collapsed')
  button.setAttribute('data-collapsed', String(isCollapsed))
  button.textContent = isCollapsed
    ? `展开全部 (${button.textContent?.match(/\d+/)?.[0] ?? ''} 行)`
    : '收起'
}

onMounted(() => {
  rootRef.value?.addEventListener('click', handleCopyClick)
  rootRef.value?.addEventListener('click', handleCollapseClick)
})

onUnmounted(() => {
  rootRef.value?.removeEventListener('click', handleCopyClick)
  rootRef.value?.removeEventListener('click', handleCollapseClick)
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- content sanitized via DOMPurify in renderMarkdown() -->
  <div ref="rootRef" class="markdown-renderer" v-html="finalHtml" />
</template>

<style scoped>
.markdown-renderer {
  line-height: 1.6;
  word-wrap: break-word;
}
.markdown-renderer :deep(h1),
.markdown-renderer :deep(h2),
.markdown-renderer :deep(h3),
.markdown-renderer :deep(h4),
.markdown-renderer :deep(h5),
.markdown-renderer :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-renderer :deep(h1) {
  font-size: 1.5em;
}
.markdown-renderer :deep(h2) {
  font-size: 1.3em;
}
.markdown-renderer :deep(h3) {
  font-size: 1.15em;
}
.markdown-renderer :deep(p) {
  margin: 0 0 8px;
}
.markdown-renderer :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol) {
  padding-left: 20px;
  margin: 4px 0 8px;
}
.markdown-renderer :deep(li) {
  margin: 2px 0;
}
.markdown-renderer :deep(a) {
  color: var(--af-link, #60a5fa);
  text-decoration: none;
}
.markdown-renderer :deep(a:hover) {
  text-decoration: underline;
}
.markdown-renderer :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}
.markdown-renderer :deep(th),
.markdown-renderer :deep(td) {
  border: 1px solid var(--af-code-border, #374151);
  padding: 6px 12px;
  text-align: left;
}
.markdown-renderer :deep(th) {
  background-color: var(--af-code-bg, #1f2937);
  font-weight: 600;
}
.markdown-renderer :deep(pre) {
  background-color: var(--af-code-bg, #1f2937);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 0;
}
.markdown-renderer :deep(code) {
  font-size: 13px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}
.markdown-renderer :deep(p code) {
  background-color: var(--af-code-bg, #1f2937);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}
.markdown-renderer :deep(.code-block) {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--af-code-border, #374151);
}
.markdown-renderer :deep(.code-block__header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background-color: var(--af-code-header-bg, #1a1a2e);
  border-bottom: 1px solid var(--af-code-border, #374151);
}

/* Language badge (UI-REDESIGN v0.3) */
.markdown-renderer :deep(.code-block__lang) {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: lowercase;
  color: var(--af-brand, #818cf8);
  background-color: color-mix(in srgb, var(--af-brand, #6366f1) 12%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}

.markdown-renderer :deep(.code-block__header-actions) {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Collapse toggle for long code blocks */
.markdown-renderer :deep(.code-block__collapse) {
  background: none;
  border: none;
  color: var(--af-text-muted, #9ca3af);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.markdown-renderer :deep(.code-block__collapse:hover) {
  color: var(--af-text-primary, #e5e7eb);
  background-color: var(--af-bg-hover, #374151);
}

/* Collapsed state: clamp visible height with fade-out gradient */
.markdown-renderer :deep(.code-block.is-collapsed pre) {
  max-height: 200px;
  overflow: hidden;
  position: relative;
}

.markdown-renderer :deep(.code-block.is-collapsed pre::after) {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--af-code-bg, #1f2937));
  pointer-events: none;
}
.markdown-renderer :deep(.code-block__lang) {
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}
.markdown-renderer :deep(.code-block__copy) {
  background: none;
  border: 1px solid var(--af-code-border, #374151);
  color: var(--af-code-text, #d1d5db);
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.markdown-renderer :deep(.code-block__copy:hover) {
  background-color: var(--af-code-border, #374151);
  border-color: var(--af-text-muted, #9ca3af);
}

/* Mermaid header reuses lang badge styling */
.markdown-renderer :deep(.mermaid-block .code-block__lang) {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--af-brand, #818cf8);
  background-color: color-mix(in srgb, var(--af-brand, #6366f1) 12%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}
.markdown-renderer :deep(blockquote) {
  border-left: 3px solid var(--af-blockquote-border, #4b5563);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--af-blockquote-text, #9ca3af);
}
.markdown-renderer :deep(hr) {
  border: none;
  border-top: 1px solid var(--af-hr, #374151);
  margin: 12px 0;
}
.markdown-renderer :deep(strong) {
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
}
.markdown-renderer :deep(em) {
  font-style: italic;
}
.markdown-renderer :deep(.mermaid-block) {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--af-code-border, #374151);
}
.markdown-renderer :deep(.mermaid-block__header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background-color: var(--af-code-header-bg, #1a1a2e);
  border-bottom: 1px solid var(--af-code-border, #374151);
}
.markdown-renderer :deep(.mermaid-block__loading) {
  padding: 24px;
  text-align: center;
  color: var(--af-text-muted, #9ca3af);
  font-size: 13px;
}
.markdown-renderer :deep(.mermaid-block__svg) {
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow-x: auto;
}
.markdown-renderer :deep(.mermaid-block__svg svg) {
  max-width: 100%;
  height: auto;
}
.markdown-renderer :deep(.mermaid-error) {
  padding: 12px;
  color: var(--af-error, #ef4444);
  font-size: 13px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 4px;
}
</style>
