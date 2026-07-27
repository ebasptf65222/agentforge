<script setup lang="ts">
// P1-14: MarkdownRenderer - renders markdown as HTML with code copy support

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { renderMarkdown, getHighlighter } from '@/utils/markdown'

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
}

onMounted(() => {
  initHighlighter()
})

const renderedHtml = computed(() => renderMarkdown(props.content))

// Re-render once the highlighter is loaded to get syntax highlighting
const finalHtml = computed(() => {
  // When the highlighter becomes ready, re-render to apply syntax highlighting
  if (ready.value) {
    return renderMarkdown(props.content)
  }
  return renderedHtml.value
})

// ─── Event delegation for copy buttons ─────────────────────────

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

onMounted(() => {
  rootRef.value?.addEventListener('click', handleCopyClick)
})

onUnmounted(() => {
  rootRef.value?.removeEventListener('click', handleCopyClick)
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
</style>
