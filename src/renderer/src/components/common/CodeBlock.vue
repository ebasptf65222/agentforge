<script setup lang="ts">
// P1-14: CodeBlock - standalone code block component
// Used for displaying a single code block outside of markdown context (e.g., tool results in P2)

import { ref, onMounted } from 'vue'
import { getHighlighter } from '@/utils/markdown'
import { escapeHtml } from '@/utils/html'

const props = withDefaults(
  defineProps<{
    code: string
    language?: string
  }>(),
  {
    language: 'plaintext',
  },
)

const highlightedHtml = ref('')
const copyLabel = ref('复制')

onMounted(async () => {
  const highlighter = await getHighlighter()
  const loadedLangs = highlighter.getLoadedLanguages()
  const resolvedLang = loadedLangs.includes(props.language) ? props.language : 'plaintext'

  try {
    highlightedHtml.value = highlighter.codeToHtml(props.code, {
      lang: resolvedLang,
      themes: {
        dark: 'one-dark-pro',
        light: 'github-light',
      },
      defaultColor: 'dark',
    })
  } catch {
    // Fallback to plain escaped code
    highlightedHtml.value = `<pre><code>${escapeHtml(props.code)}</code></pre>`
  }
})

function handleCopy(): void {
  navigator.clipboard.writeText(props.code).then(() => {
    copyLabel.value = '已复制'
    setTimeout(() => {
      copyLabel.value = '复制'
    }, 2000)
  })
}
</script>

<template>
  <div class="code-block">
    <div class="code-block__header">
      <span class="code-block__lang">{{ language }}</span>
      <button class="code-block__copy" @click="handleCopy">{{ copyLabel }}</button>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -- content from shiki highlighter -->
    <div v-html="highlightedHtml" />
  </div>
</template>

<style scoped>
.code-block {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--af-code-border, #374151);
}

.code-block__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background-color: var(--af-code-header-bg, #1a1a2e);
  border-bottom: 1px solid var(--af-code-border, #374151);
}

.code-block__lang {
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}

.code-block__copy {
  background: none;
  border: 1px solid var(--af-code-border, #374151);
  color: var(--af-code-text, #d1d5db);
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.code-block__copy:hover {
  background-color: var(--af-code-border, #374151);
  border-color: var(--af-text-muted, #9ca3af);
}
</style>
