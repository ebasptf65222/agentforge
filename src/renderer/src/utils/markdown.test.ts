// P1-14: Markdown renderer unit tests
// Verifies marked parsing, code block rendering, DOMPurify sanitization,
// and shiki integration (via mocks).

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// ─── Mock shiki ─────────────────────────────────────────────
const mockCodeToHtml = vi.fn((_code: string, _options: Record<string, unknown>) => {
  return '<pre class="shiki"><code>highlighted</code></pre>'
})

const mockGetLoadedLanguages = vi.fn(() => [
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
])

const mockGetLoadedThemes = vi.fn(() => ['one-dark-pro', 'github-light'])

vi.mock('shiki', () => ({
  createHighlighter: vi.fn(() =>
    Promise.resolve({
      codeToHtml: mockCodeToHtml,
      getLoadedLanguages: mockGetLoadedLanguages,
      getLoadedThemes: mockGetLoadedThemes,
      loadTheme: vi.fn(),
      loadLanguage: vi.fn(),
      getTheme: vi.fn(),
      getLanguage: vi.fn(),
      setTheme: vi.fn(),
      resolveLangAlias: vi.fn(),
      dispose: vi.fn(),
      codeToHast: vi.fn(),
      codeToTokens: vi.fn(),
      codeToTokensBase: vi.fn(),
      codeToTokensWithThemes: vi.fn(),
      getLastGrammarState: vi.fn(),
      getBundledLanguages: vi.fn(),
      getBundledThemes: vi.fn(),
    }),
  ),
}))

// ─── Mock DOMPurify ─────────────────────────────────────────
const mockSanitize = vi.fn((html: string) => {
  // Simplified DOMPurify: strip <script> tags and on* event attributes
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
})

vi.mock('dompurify', () => ({
  default: {
    sanitize: mockSanitize,
    isSupported: true,
    version: '3.0.0',
    setConfig: vi.fn(),
    clearConfig: vi.fn(),
    addHook: vi.fn(),
    removeHook: vi.fn(),
    removeHooks: vi.fn(),
    removeAllHooks: vi.fn(),
    isValidAttribute: vi.fn(),
    removed: [],
  },
}))

// ─── Import after mocks ─────────────────────────────────────
const { renderMarkdown, getHighlighter } = await import('./markdown')

// ─── Tests: Basic rendering (highlighter NOT loaded) ─────────

describe('renderMarkdown (P1-14) - basic rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render plain text as a paragraph', () => {
    const result = renderMarkdown('Hello world')
    expect(result).toContain('Hello world')
    expect(result).toContain('<p>')
    expect(result).toContain('</p>')
  })

  it('should render bold text', () => {
    const result = renderMarkdown('**bold**')
    expect(result).toContain('<strong>bold</strong>')
  })

  it('should render italic text', () => {
    const result = renderMarkdown('*italic*')
    expect(result).toContain('<em>italic</em>')
  })

  it('should render headings', () => {
    const result = renderMarkdown('# Heading 1\n## Heading 2\n### Heading 3')
    expect(result).toContain('<h1>Heading 1</h1>')
    expect(result).toContain('<h2>Heading 2</h2>')
    expect(result).toContain('<h3>Heading 3</h3>')
  })

  it('should render unordered lists', () => {
    const result = renderMarkdown('- item 1\n- item 2\n- item 3')
    expect(result).toContain('<ul>')
    expect(result).toContain('<li>item 1</li>')
    expect(result).toContain('<li>item 2</li>')
    expect(result).toContain('<li>item 3</li>')
    expect(result).toContain('</ul>')
  })

  it('should render ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second')
    expect(result).toContain('<ol>')
    expect(result).toContain('<li>first</li>')
    expect(result).toContain('<li>second</li>')
    expect(result).toContain('</ol>')
  })

  it('should render code blocks with language label and copy button (fallback)', () => {
    const result = renderMarkdown('```javascript\nconst x = 1;\n```')
    expect(result).toContain('class="code-block"')
    expect(result).toContain('class="code-block__header"')
    expect(result).toContain('class="code-block__lang"')
    expect(result).toContain('javascript')
    expect(result).toContain('class="code-block__copy"')
    expect(result).toContain('data-code=')
    expect(result).toContain('复制')
  })

  it('should render code blocks without language as plaintext', () => {
    const result = renderMarkdown('```\nsome code\n```')
    expect(result).toContain('plaintext')
    expect(result).toContain('class="code-block"')
  })

  it('should render links', () => {
    const result = renderMarkdown('[OpenAI](https://openai.com)')
    expect(result).toContain('<a')
    expect(result).toContain('href="https://openai.com"')
    expect(result).toContain('>OpenAI</a>')
  })

  it('should render tables', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |'
    const result = renderMarkdown(md)
    expect(result).toContain('<table>')
    expect(result).toContain('<th>Name</th>')
    expect(result).toContain('<th>Age</th>')
    expect(result).toContain('<td>Alice</td>')
    expect(result).toContain('<td>30</td>')
  })

  it('should strip XSS script tags', () => {
    const result = renderMarkdown('<script>alert("xss")</script>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
  })

  it('should handle empty string', () => {
    const result = renderMarkdown('')
    expect(typeof result).toBe('string')
  })

  it('should handle mixed markdown with code blocks', () => {
    const md = '# Title\n\nSome text with **bold**.\n\n```python\nprint("hello")\n```'
    const result = renderMarkdown(md)
    expect(result).toContain('<h1>Title</h1>')
    expect(result).toContain('<strong>bold</strong>')
    expect(result).toContain('python')
    expect(result).toContain('class="code-block__copy"')
  })

  it('should escape code in data-code attribute', () => {
    const result = renderMarkdown('```html\n<div class="test">&amp;</div>\n```')
    // The data-code attribute should have HTML-escaped code
    expect(result).toContain('data-code=')
    // Should not contain unescaped HTML in data-code (opening tag)
    const dataCodeMatch = result.match(/data-code="([^"]*)"/)
    expect(dataCodeMatch).not.toBeNull()
    // The matched value should be HTML-escaped, not raw tags
    if (dataCodeMatch) {
      expect(dataCodeMatch[1]).not.toContain('<div')
      expect(dataCodeMatch[1]).toContain('&lt;div')
    }
  })

  it('should call DOMPurify.sanitize with correct config', () => {
    renderMarkdown('**test**')
    expect(mockSanitize).toHaveBeenCalledTimes(1)
    expect(mockSanitize).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        ADD_TAGS: ['button'],
        ADD_ATTR: expect.arrayContaining(['data-code', 'data-lang']),
        ALLOW_DATA_ATTR: true,
      }),
    )
  })

  it('should not crash on edge case input', () => {
    expect(() => renderMarkdown('\0')).not.toThrow()
    expect(typeof renderMarkdown('\0')).toBe('string')
  })
})

// ─── Tests: With shiki highlighter loaded ────────────────────

describe('renderMarkdown (P1-14) - with shiki highlighter', () => {
  beforeAll(async () => {
    vi.clearAllMocks()
    await getHighlighter()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use shiki codeToHtml for code blocks', () => {
    renderMarkdown('```javascript\nconst x = 1;\n```')
    expect(mockCodeToHtml).toHaveBeenCalledTimes(1)
    expect(mockCodeToHtml).toHaveBeenCalledWith(
      'const x = 1;',
      expect.objectContaining({
        lang: 'javascript',
        themes: expect.objectContaining({
          dark: 'one-dark-pro',
          light: 'github-light',
        }),
      }),
    )
  })

  it('should include shiki output in the rendered HTML', () => {
    const result = renderMarkdown('```python\nprint(1)\n```')
    expect(result).toContain('class="shiki"')
    expect(result).toContain('highlighted')
  })

  it('should fall back to plaintext for unknown languages', () => {
    renderMarkdown('```brainfuck\n+++[->+<]\n```')
    expect(mockCodeToHtml).toHaveBeenCalledWith(
      '+++[->+<]',
      expect.objectContaining({
        lang: 'plaintext',
      }),
    )
  })

  it('should still render non-code markdown normally', () => {
    const result = renderMarkdown('**bold** and *italic*')
    expect(result).toContain('<strong>bold</strong>')
    expect(result).toContain('<em>italic</em>')
  })
})

// ─── Tests: getHighlighter ───────────────────────────────────

describe('getHighlighter (P1-14)', () => {
  it('should return a highlighter instance', async () => {
    const h = await getHighlighter()
    expect(h).toBeDefined()
    expect(typeof h.codeToHtml).toBe('function')
    expect(typeof h.getLoadedLanguages).toBe('function')
    expect(typeof h.getLoadedThemes).toBe('function')
  })

  it('should return the same instance on repeated calls (singleton)', async () => {
    const h1 = await getHighlighter()
    const h2 = await getHighlighter()
    expect(h1).toBe(h2)
  })
})
