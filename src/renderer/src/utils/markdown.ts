// P1-14: Markdown renderer with code block syntax highlighting
// Uses marked for parsing, shiki for code highlighting, DOMPurify for XSS filtering

import { marked } from 'marked'
import { createHighlighter, type Highlighter } from 'shiki'
import DOMPurify from 'dompurify'
import type { Tokens } from 'marked'

// ─── Preloaded languages for shiki ─────────────────────────────
const PRELOADED_LANGS = [
  'javascript',
  'typescript',
  'python',
  'java',
  'go',
  'rust',
  'css',
  'html',
  'json',
  'bash',
  'sql',
  'yaml',
  'markdown',
  'plaintext',
] as const

// ─── Lazy singleton highlighter ───────────────────────────────
let highlighterInstance: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null

/**
 * Get or create the shiki highlighter singleton.
 * Preloads two themes (one-dark-pro, github-light) and common languages.
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance
  if (highlighterPromise) return highlighterPromise

  highlighterPromise = createHighlighter({
    themes: ['one-dark-pro', 'github-light'],
    langs: [...PRELOADED_LANGS],
  }).then((h) => {
    highlighterInstance = h
    return h
  })

  return highlighterPromise
}

// ─── Helper: escape HTML entities ───────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ─── Configure marked ───────────────────────────────────────────

const renderer = {
  code({ text, lang }: Tokens.Code): string {
    const language = lang || 'plaintext'
    const escapedCode = escapeHtml(text)

    // If highlighter is ready, use it synchronously
    if (highlighterInstance) {
      const loadedLangs = highlighterInstance.getLoadedLanguages()
      const resolvedLang = loadedLangs.includes(language) ? language : 'plaintext'

      try {
        const highlighted = highlighterInstance.codeToHtml(text, {
          lang: resolvedLang,
          themes: {
            dark: 'one-dark-pro',
            light: 'github-light',
          },
          defaultColor: 'dark',
        })

        return `<div class="code-block">
  <div class="code-block__header">
    <span class="code-block__lang">${escapeHtml(language)}</span>
    <button class="code-block__copy" data-code="${escapedCode}">复制</button>
  </div>
  ${highlighted}
</div>`
      } catch {
        // Fall through to plain rendering
      }
    }

    // Fallback: no highlighting available
    return `<div class="code-block">
  <div class="code-block__header">
    <span class="code-block__lang">${escapeHtml(language)}</span>
    <button class="code-block__copy" data-code="${escapedCode}">复制</button>
  </div>
  <pre><code>${escapedCode}</code></pre>
</div>`
  },
}

marked.use({
  renderer,
  gfm: true,
  breaks: false,
})

// ─── DOMPurify config for code blocks ───────────────────────────

const PURIFY_CONFIG = {
  ADD_TAGS: ['button'],
  ADD_ATTR: ['data-code', 'data-lang', 'class', 'style'],
  ALLOW_DATA_ATTR: true,
}

// ─── Main export ────────────────────────────────────────────────

/**
 * Render markdown string to sanitized HTML.
 *
 * Uses marked for parsing, shiki for code highlighting (if loaded),
 * and DOMPurify for XSS filtering.
 *
 * On parse error, returns the raw markdown text escaped.
 */
export function renderMarkdown(markdown: string): string {
  try {
    const rawHtml = marked(markdown, { async: false }) as string
    return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG)
  } catch {
    // On parse error, return escaped raw text
    return `<p>${escapeHtml(markdown)}</p>`
  }
}
