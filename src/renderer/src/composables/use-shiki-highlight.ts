// useShikiHighlight — reusable composable for shiki-based code highlighting.
// Replaces the regex-based highlighting in the old FilePreview component.
// Uses the project's shiki singleton (getHighlighter) with dual themes.

import { ref, watch, type Ref } from 'vue'
import { getHighlighter } from '@/utils/markdown'
import { escapeHtml } from '@/utils/html'

/** Files larger than this skip shiki highlighting (fallback to plain text) */
const MAX_HIGHLIGHT_LENGTH = 50_000

/** Languages that skip highlighting (plain text) */
const SKIP_LANGS = ['text', 'log', 'plaintext', 'txt']

export interface UseShikiHighlightReturn {
  /** Highlighted HTML string (ready for v-html) */
  highlightedHtml: Ref<string>
  /** Whether highlighting is in progress */
  isLoading: Ref<boolean>
}

/**
 * Reactive shiki code highlighter.
 *
 * @param code - reactive ref to the raw code string
 * @param language - reactive ref to the language identifier
 * @returns highlighted HTML + loading state
 */
export function useShikiHighlight(
  code: Ref<string>,
  language: Ref<string>,
): UseShikiHighlightReturn {
  const highlightedHtml = ref('')
  const isLoading = ref(false)

  async function highlight(): Promise<void> {
    const raw = code.value

    if (!raw) {
      highlightedHtml.value = ''
      return
    }

    // Large file: skip highlighting, output escaped plain text
    if (raw.length > MAX_HIGHLIGHT_LENGTH) {
      highlightedHtml.value = `<pre class="shiki"><code>${escapeHtml(raw)}</code></pre>`
      return
    }

    // Plain text languages: skip highlighting
    if (SKIP_LANGS.includes(language.value)) {
      highlightedHtml.value = `<pre class="shiki"><code>${escapeHtml(raw)}</code></pre>`
      return
    }

    isLoading.value = true
    try {
      const highlighter = await getHighlighter()
      const loadedLangs = highlighter.getLoadedLanguages()
      const resolvedLang = loadedLangs.includes(language.value)
        ? language.value
        : 'plaintext'

      highlightedHtml.value = highlighter.codeToHtml(raw, {
        lang: resolvedLang,
        themes: {
          dark: 'one-dark-pro',
          light: 'github-light',
        },
        defaultColor: 'dark',
      })
    } catch {
      // Fallback: escaped plain text
      highlightedHtml.value = `<pre class="shiki"><code>${escapeHtml(raw)}</code></pre>`
    } finally {
      isLoading.value = false
    }
  }

  watch([code, language], highlight, { immediate: true })

  return { highlightedHtml, isLoading }
}
