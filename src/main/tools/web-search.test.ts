// AgentForge P2-05: web_search 工具单元测试
// Mock global fetch，验证解析逻辑与执行流程

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AppError } from '../utils/error'
import { webSearchTool, parseDuckDuckGoHtml } from './web-search'

// ─── 测试夹具 ────────────────────────────────────────────────────

const sampleHtml = `
<div class="results">
  <div class="result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&amp;rut=abc">Example Title</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&amp;rut=abc">This is a snippet.</a>
  </div>
  <div class="result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com&amp;rut=def">GitHub</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com&amp;rut=def">Build software collaboratively.</a>
  </div>
</div>
`

// ─── Helpers ─────────────────────────────────────────────────────

async function expectAppErrorAsync(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected AppError to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('web_search tool', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  // ─── 工具定义 ────────────────────────────────────────────────

  describe('definition', () => {
    it('should have name="web_search"', () => {
      expect(webSearchTool.definition.name).toBe('web_search')
    })

    it('should have a description', () => {
      expect(webSearchTool.definition.description).toBe('Search the web for information')
    })

    it('should have riskLevel="low"', () => {
      expect(webSearchTool.definition.riskLevel).toBe('low')
    })

    it('should have source="builtin"', () => {
      expect(webSearchTool.definition.source).toBe('builtin')
    })

    it('should have query in inputSchema', () => {
      expect(webSearchTool.definition.inputSchema).toMatchObject({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      })
    })

    it('should expose an execute function', () => {
      expect(typeof webSearchTool.execute).toBe('function')
    })
  })

  // ─── parseDuckDuckGoHtml ────────────────────────────────────

  describe('parseDuckDuckGoHtml', () => {
    it('should parse results from HTML', () => {
      const results = parseDuckDuckGoHtml(sampleHtml)
      expect(results).toHaveLength(2)
      expect(results[0].title).toBe('Example Title')
      expect(results[0].url).toBe('https://example.com')
      expect(results[0].snippet).toBe('This is a snippet.')
      expect(results[1].title).toBe('GitHub')
      expect(results[1].url).toBe('https://github.com')
      expect(results[1].snippet).toBe('Build software collaboratively.')
    })

    it('should return empty array for empty HTML', () => {
      expect(parseDuckDuckGoHtml('')).toEqual([])
    })

    it('should return empty array for HTML with no results', () => {
      expect(parseDuckDuckGoHtml('<html><body>no results</body></html>')).toEqual([])
    })

    it('should strip HTML tags from titles and snippets', () => {
      const html = `<div class="result">
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com"><b>Bold</b> Title</a></h2>
        <a class="result__snippet"><em>Italic</em> snippet</a>
      </div>`
      const results = parseDuckDuckGoHtml(html)
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Bold Title')
      expect(results[0].snippet).toBe('Italic snippet')
    })

    it('should decode HTML entities', () => {
      const html = `<div class="result">
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Tom &amp; Jerry</a></h2>
        <a class="result__snippet">a &lt;b&gt; tag</a>
      </div>`
      const results = parseDuckDuckGoHtml(html)
      expect(results[0].title).toBe('Tom & Jerry')
      expect(results[0].snippet).toBe('a <b> tag')
    })

    it('should use empty snippet when snippet is missing', () => {
      const html = `<div class="result">
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Title only</a></h2>
      </div>`
      const results = parseDuckDuckGoHtml(html)
      expect(results).toHaveLength(1)
      expect(results[0].snippet).toBe('')
    })

    it('should handle direct http URLs (without DDG redirect)', () => {
      const html = `<div class="result">
        <h2 class="result__title"><a class="result__a" href="https://direct.example.com">Direct</a></h2>
        <a class="result__snippet">snip</a>
      </div>`
      const results = parseDuckDuckGoHtml(html)
      expect(results[0].url).toBe('https://direct.example.com')
    })

    it('should cap results at 10', () => {
      let html = ''
      for (let i = 0; i < 15; i++) {
        html += `<div class="result"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F${i}">Title ${i}</a></h2><a class="result__snippet">snip ${i}</a></div>`
      }
      const results = parseDuckDuckGoHtml(html)
      expect(results).toHaveLength(10)
    })
  })

  // ─── execute: validation ───────────────────────────────────

  describe('execute validation', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => sampleHtml })
    })

    it('should throw VALIDATION_ERROR when query is empty', async () => {
      await expectAppErrorAsync(webSearchTool.execute({ query: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when query is whitespace only', async () => {
      await expectAppErrorAsync(webSearchTool.execute({ query: '   ' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when query is not a string', async () => {
      await expectAppErrorAsync(webSearchTool.execute({ query: 123 }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when query is missing', async () => {
      await expectAppErrorAsync(webSearchTool.execute({}), 'VALIDATION_ERROR')
    })

    it('should not call fetch when query is invalid', async () => {
      const mockFetch = vi.fn()
      globalThis.fetch = mockFetch
      try {
        await webSearchTool.execute({ query: '' })
      } catch {
        // expected
      }
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      globalThis.fetch = mockFetch as unknown as typeof fetch
    })

    it('should call fetch with DuckDuckGo URL and POST method', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => sampleHtml })

      await webSearchTool.execute({ query: 'test query' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://html.duckduckgo.com/html/')
      expect(options.method).toBe('POST')
    })

    it('should encode query in request body', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => sampleHtml })

      await webSearchTool.execute({ query: 'hello world & more' })

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(options.body).toBe('q=hello%20world%20%26%20more')
    })

    it('should pass AbortSignal in options', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => sampleHtml })

      await webSearchTool.execute({ query: 'test' })

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('should return parsed results as JSON with isError=false', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => sampleHtml })

      const result = await webSearchTool.execute({ query: 'test' })

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.content) as {
        query: string
        results: Array<{ title: string; url: string; snippet: string }>
      }
      expect(parsed.query).toBe('test')
      expect(parsed.results).toHaveLength(2)
      expect(parsed.results[0].title).toBe('Example Title')
      expect(parsed.results[0].url).toBe('https://example.com')
      expect(parsed.results[1].title).toBe('GitHub')
    })

    it('should include count in metadata', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => sampleHtml })

      const result = await webSearchTool.execute({ query: 'test' })

      expect(result.metadata).toMatchObject({ count: 2 })
    })

    it('should return empty results array when HTML has no results', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => '<html>no results</html>' })

      const result = await webSearchTool.execute({ query: 'empty' })

      const parsed = JSON.parse(result.content) as { results: unknown[] }
      expect(parsed.results).toEqual([])
    })
  })

  // ─── execute: error cases ──────────────────────────────────

  describe('execute error cases', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      globalThis.fetch = mockFetch as unknown as typeof fetch
    })

    it('should throw TOOL_EXECUTION_ERROR on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expectAppErrorAsync(webSearchTool.execute({ query: 'test' }), 'TOOL_EXECUTION_ERROR')
    })

    it('should throw TOOL_EXECUTION_ERROR on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expectAppErrorAsync(webSearchTool.execute({ query: 'test' }), 'TOOL_EXECUTION_ERROR')
    })

    it('should throw TOOL_EXECUTION_ERROR on AbortError (timeout)', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      await expectAppErrorAsync(webSearchTool.execute({ query: 'test' }), 'TOOL_EXECUTION_ERROR')
    })

    it('should include timeout in details when aborted', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      try {
        await webSearchTool.execute({ query: 'test' })
        expect.fail('Expected AppError to be thrown')
      } catch (error) {
        const appErr = error as AppError
        expect(appErr.details).toMatchObject({ timeout: 10_000 })
      }
    })
  })
})
