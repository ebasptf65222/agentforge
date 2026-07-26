// AgentForge P2-05: web_scrape 工具单元测试
// Mock global fetch，验证 HTML 剥离逻辑与执行流程

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AppError } from '../utils/error'
import { webScrapeTool, stripHtmlTags } from './web-scrape'

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

describe('web_scrape tool', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  // ─── 工具定义 ────────────────────────────────────────────────

  describe('definition', () => {
    it('should have name="web_scrape"', () => {
      expect(webScrapeTool.definition.name).toBe('web_scrape')
    })

    it('should have a description', () => {
      expect(webScrapeTool.definition.description).toBe('Scrape text content from a web page')
    })

    it('should have riskLevel="low"', () => {
      expect(webScrapeTool.definition.riskLevel).toBe('low')
    })

    it('should have source="builtin"', () => {
      expect(webScrapeTool.definition.source).toBe('builtin')
    })

    it('should have url in inputSchema', () => {
      expect(webScrapeTool.definition.inputSchema).toMatchObject({
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      })
    })

    it('should expose an execute function', () => {
      expect(typeof webScrapeTool.execute).toBe('function')
    })
  })

  // ─── stripHtmlTags ─────────────────────────────────────────

  describe('stripHtmlTags', () => {
    it('should remove simple HTML tags', () => {
      expect(stripHtmlTags('<p>hello</p>')).toBe('hello')
    })

    it('should remove script elements entirely', () => {
      const html = '<p>before</p><script>alert("x")</script><p>after</p>'
      expect(stripHtmlTags(html)).toBe('before\nafter')
    })

    it('should remove style elements entirely', () => {
      const html = '<p>before</p><style>body { color: red; }</style><p>after</p>'
      expect(stripHtmlTags(html)).toBe('before\nafter')
    })

    it('should remove HTML comments', () => {
      const html = '<p>before</p><!-- a comment --><p>after</p>'
      expect(stripHtmlTags(html)).toBe('before\nafter')
    })

    it('should convert <br> to newline', () => {
      expect(stripHtmlTags('line1<br>line2')).toBe('line1\nline2')
      expect(stripHtmlTags('line1<br/>line2')).toBe('line1\nline2')
      expect(stripHtmlTags('line1<br />line2')).toBe('line1\nline2')
    })

    it('should convert block-level closing tags to newline', () => {
      expect(stripHtmlTags('<p>para1</p><p>para2</p>')).toBe('para1\npara2')
      expect(stripHtmlTags('<div>a</div><div>b</div>')).toBe('a\nb')
      expect(stripHtmlTags('<h1>Title</h1><p>Body</p>')).toBe('Title\nBody')
      expect(stripHtmlTags('<li>item1</li><li>item2</li>')).toBe('item1\nitem2')
    })

    it('should decode common HTML entities', () => {
      expect(stripHtmlTags('a&amp;b')).toBe('a&b')
      expect(stripHtmlTags('a&lt;b&gt;c')).toBe('a<b>c')
      expect(stripHtmlTags('&quot;hi&quot;')).toBe('"hi"')
      expect(stripHtmlTags('it&#39;s')).toBe("it's")
      expect(stripHtmlTags('it&apos;s')).toBe("it's")
      expect(stripHtmlTags('a&nbsp;b')).toBe('a b')
    })

    it('should collapse multiple spaces into one', () => {
      expect(stripHtmlTags('a    b     c')).toBe('a b c')
    })

    it('should collapse 3+ newlines into 2', () => {
      expect(stripHtmlTags('a\n\n\n\nb')).toBe('a\n\nb')
    })

    it('should trim leading and trailing whitespace', () => {
      expect(stripHtmlTags('  \n  hello  \n  ')).toBe('hello')
    })

    it('should handle nested tags', () => {
      expect(stripHtmlTags('<div><p><span>nested</span></p></div>')).toBe('nested')
    })

    it('should return empty string for empty input', () => {
      expect(stripHtmlTags('')).toBe('')
    })

    it('should return empty string for tags-only input', () => {
      expect(stripHtmlTags('<div></div><p></p>')).toBe('')
    })
  })

  // ─── execute: validation ───────────────────────────────────

  describe('execute validation', () => {
    beforeEach(() => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, text: async () => '<p>hi</p>' })
    })

    it('should throw VALIDATION_ERROR when url is empty', async () => {
      await expectAppErrorAsync(webScrapeTool.execute({ url: '' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when url is whitespace only', async () => {
      await expectAppErrorAsync(webScrapeTool.execute({ url: '   ' }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when url is not a string', async () => {
      await expectAppErrorAsync(webScrapeTool.execute({ url: 123 }), 'VALIDATION_ERROR')
    })

    it('should throw VALIDATION_ERROR when url is missing', async () => {
      await expectAppErrorAsync(webScrapeTool.execute({}), 'VALIDATION_ERROR')
    })

    it('should throw INVALID_URL when url is not a valid URL', async () => {
      await expectAppErrorAsync(webScrapeTool.execute({ url: 'not-a-url' }), 'INVALID_URL')
    })

    it('should throw INVALID_URL when url uses file:// protocol', async () => {
      await expectAppErrorAsync(
        webScrapeTool.execute({ url: 'file:///etc/passwd' }),
        'INVALID_URL',
      )
    })

    it('should throw INVALID_URL when url uses javascript: protocol', async () => {
      await expectAppErrorAsync(
        webScrapeTool.execute({ url: 'javascript:alert(1)' }),
        'INVALID_URL',
      )
    })

    it('should not call fetch when url is invalid', async () => {
      const mockFetch = vi.fn()
      globalThis.fetch = mockFetch
      try {
        await webScrapeTool.execute({ url: 'not-a-url' })
      } catch {
        // expected
      }
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ─── execute: success ──────────────────────────────────────

  describe('execute success', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    /** 构造一个 ok 的 mock Response（包含 headers，避免实现读取 headers.get 时报错） */
    function okResponse(text: string, headers: Record<string, string> = {}): unknown {
      return {
        ok: true,
        headers: new Headers(headers),
        text: async () => text,
      }
    }

    beforeEach(() => {
      mockFetch = vi.fn()
      globalThis.fetch = mockFetch as unknown as typeof fetch
    })

    it('should call fetch with the provided URL', async () => {
      mockFetch.mockResolvedValue(okResponse('<p>hi</p>'))

      await webScrapeTool.execute({ url: 'https://example.com' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://example.com/')
      expect(options.method).toBe('GET')
    })

    it('should accept http URLs', async () => {
      mockFetch.mockResolvedValue(okResponse('<p>hi</p>'))

      await webScrapeTool.execute({ url: 'http://example.com' })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should pass AbortSignal in options', async () => {
      mockFetch.mockResolvedValue(okResponse('<p>hi</p>'))

      await webScrapeTool.execute({ url: 'https://example.com' })

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('should return stripped text with isError=false', async () => {
      mockFetch.mockResolvedValue(okResponse('<p>Hello <b>World</b></p>'))

      const result = await webScrapeTool.execute({ url: 'https://example.com' })

      expect(result.isError).toBe(false)
      expect(result.content).toBe('Hello World')
    })

    it('should include url and length in metadata', async () => {
      mockFetch.mockResolvedValue(okResponse('<p>hi</p>'))

      const result = await webScrapeTool.execute({ url: 'https://example.com' })

      expect(result.metadata).toMatchObject({
        url: 'https://example.com/',
        length: 2,
      })
    })

    it('should trim whitespace around url', async () => {
      mockFetch.mockResolvedValue(okResponse('<p>hi</p>'))

      await webScrapeTool.execute({ url: '  https://example.com  ' })

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://example.com/')
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
      mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })

      await expectAppErrorAsync(webScrapeTool.execute({ url: 'https://example.com' }), 'TOOL_EXECUTION_ERROR')
    })

    it('should throw TOOL_EXECUTION_ERROR on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expectAppErrorAsync(webScrapeTool.execute({ url: 'https://example.com' }), 'TOOL_EXECUTION_ERROR')
    })

    it('should throw TOOL_EXECUTION_ERROR on AbortError (timeout)', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      await expectAppErrorAsync(webScrapeTool.execute({ url: 'https://example.com' }), 'TOOL_EXECUTION_ERROR')
    })

    it('should throw FILE_TOO_LARGE when Content-Length header exceeds limit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': String(1024 * 1024 + 1) }),
        text: async () => 'small',
      })

      await expectAppErrorAsync(
        webScrapeTool.execute({ url: 'https://example.com' }),
        'FILE_TOO_LARGE',
      )
    })

    it('should throw FILE_TOO_LARGE when body exceeds limit', async () => {
      const bigText = 'x'.repeat(1024 * 1024 + 1)
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers(),
        text: async () => bigText,
      })

      await expectAppErrorAsync(
        webScrapeTool.execute({ url: 'https://example.com' }),
        'FILE_TOO_LARGE',
      )
    })
  })
})
