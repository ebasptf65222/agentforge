// P1-14: Markdown renderer with code block syntax highlighting
// Uses marked for parsing, shiki for code highlighting, DOMPurify for XSS filtering

import { marked } from 'marked'
import { createHighlighter, type Highlighter } from 'shiki'
import DOMPurify from 'dompurify'
import type { Tokens } from 'marked'
import { escapeHtml } from './html'

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

// ─── Configure marked ───────────────────────────────────────────

/** Lines above which a code block is rendered collapsed by default */
const CODE_COLLAPSE_THRESHOLD = 30

/** Build the code block header: language badge + collapse toggle + copy button */
function buildCodeHeader(language: string, escapedCode: string, lineCount: number): string {
  const collapsible = lineCount > CODE_COLLAPSE_THRESHOLD
  const collapseBtn = collapsible
    ? `<button class="code-block__collapse" data-collapsed="true">展开全部 (${lineCount} 行)</button>`
    : ''
  return `<div class="code-block__header">
    <span class="code-block__lang">${escapeHtml(language)}</span>
    <div class="code-block__header-actions">
      ${collapseBtn}
      <button class="code-block__copy" data-code="${escapedCode}">复制</button>
    </div>
  </div>`
}

const renderer = {
  code({ text, lang }: Tokens.Code): string {
    const language = lang || 'plaintext'
    const escapedCode = escapeHtml(text)
    const lineCount = text.split('\n').length
    const header = buildCodeHeader(language, escapedCode, lineCount)

    // Mermaid 图表：生成占位 div，由 MarkdownRenderer 异步渲染
    if (language.toLowerCase() === 'mermaid') {
      return `<div class="mermaid-block" data-mermaid="${encodeURIComponent(text)}">
  ${header}
  <div class="mermaid-block__loading">渲染图表中...</div>
</div>`
    }

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

        return `<div class="code-block${lineCount > CODE_COLLAPSE_THRESHOLD ? ' is-collapsed' : ''}">
  ${header}
  ${highlighted}
</div>`
      } catch {
        // Fall through to plain rendering
      }
    }

    // Fallback: no highlighting available
    return `<div class="code-block${lineCount > CODE_COLLAPSE_THRESHOLD ? ' is-collapsed' : ''}">
  ${header}
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
  ADD_ATTR: [
    'data-code',
    'data-lang',
    'data-mermaid',
    'class',
    'style',
    'viewBox',
    'xmlns',
    'd',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'width',
    'height',
    'transform',
    'points',
    'text-anchor',
    'dominant-baseline',
    'font-size',
    'font-family',
    'font-weight',
    'opacity',
    'gradientUnits',
    'offset',
    'stop-color',
    'stop-opacity',
    'id',
    'markerWidth',
    'markerHeight',
    'refX',
    'refY',
    'orient',
    'markerUnits',
    'preserveAspectRatio',
    'href',
  ],
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
