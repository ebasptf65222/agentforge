// AgentForge P2-01: Browser Tools 测试
// 测试 7 个 browser_* 工具的定义、参数校验和错误处理

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  browserNavigateTool,
  browserScreenshotTool,
  browserGetTextTool,
  browserGetDomTool,
  browserClickTool,
  browserFillTool,
  browserCloseTool,
  allBrowserTools,
} from './browser-tools'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

// ─── Mock 浏览器核心模块 ───────────────────────────────────────

vi.mock('../browser', () => ({
  navigateToUrl: vi.fn(),
  captureScreenshot: vi.fn(),
  getPageText: vi.fn(),
  getDomStructure: vi.fn(),
  clickElement: vi.fn(),
  fillInput: vi.fn(),
  closeSession: vi.fn(),
  closeAllSessions: vi.fn(),
  getCurrentPageInfo: vi.fn(),
}))

import {
  navigateToUrl,
  captureScreenshot,
  getPageText,
  getDomStructure,
  clickElement,
  fillInput,
  closeSession,
  getCurrentPageInfo,
} from '../browser'

// ─── 辅助函数 ─────────────────────────────────────────────────

/** 执行工具并提取 result */
async function executeTool(
  tool: BuiltinTool,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; content: string; metadata?: Record<string, unknown> }> {
  return tool.execute(args)
}

// ─── 测试 ─────────────────────────────────────────────────────

describe('Browser Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── 工具注册完整性 ──────────────────────────────────────────

  describe('Tool Registration', () => {
    it('should export exactly 7 browser tools', () => {
      expect(allBrowserTools).toHaveLength(7)
    })

    it('should have all tools with correct names', () => {
      const names = allBrowserTools.map((t) => t.definition.name)
      expect(names).toEqual([
        'browser_navigate',
        'browser_screenshot',
        'browser_get_text',
        'browser_get_dom',
        'browser_click',
        'browser_fill',
        'browser_close',
      ])
    })

    it('should have all tools with source "builtin"', () => {
      for (const tool of allBrowserTools) {
        expect(tool.definition.source).toBe('builtin')
      }
    })

    it('should have all tools with valid risk levels', () => {
      for (const tool of allBrowserTools) {
        expect(['low', 'medium', 'high']).toContain(tool.definition.riskLevel)
      }
    })

    it('should have all tools with inputSchema of type "object"', () => {
      for (const tool of allBrowserTools) {
        expect(tool.definition.inputSchema['type']).toBe('object')
      }
    })

    it('should have all tools with an execute function', () => {
      for (const tool of allBrowserTools) {
        expect(typeof tool.execute).toBe('function')
      }
    })
  })

  // ─── browser_navigate ────────────────────────────────────────

  describe('browser_navigate', () => {
    it('should have risk level "medium"', () => {
      expect(browserNavigateTool.definition.riskLevel).toBe('medium')
    })

    it('should require url in inputSchema', () => {
      const required = browserNavigateTool.definition.inputSchema['required'] as string[]
      expect(required).toContain('url')
    })

    it('should navigate successfully and return page info', async () => {
      const mockInfo = {
        url: 'https://example.com',
        title: 'Example Domain',
        statusCode: 200,
        loadTime: 1234,
      }
      vi.mocked(navigateToUrl).mockResolvedValue(mockInfo)

      const result = await executeTool(browserNavigateTool, { url: 'https://example.com' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('https://example.com')
      expect(result.content).toContain('Example Domain')
      expect(result.content).toContain('1234ms')
      expect(result.metadata).toEqual(mockInfo)
    })

    it('should pass timeout and waitUntil options', async () => {
      vi.mocked(navigateToUrl).mockResolvedValue({
        url: 'https://example.com',
        title: '',
        statusCode: 200,
        loadTime: 100,
      })

      await executeTool(browserNavigateTool, {
        url: 'https://example.com',
        timeout: 5000,
        waitUntil: 'domcontentloaded',
      })

      expect(navigateToUrl).toHaveBeenCalledWith('https://example.com', {
        timeout: 5000,
        waitUntil: 'domcontentloaded',
      })
    })

    it('should pass sessionId option', async () => {
      vi.mocked(navigateToUrl).mockResolvedValue({
        url: 'https://example.com',
        title: '',
        statusCode: 200,
        loadTime: 100,
      })

      await executeTool(browserNavigateTool, {
        url: 'https://example.com',
        sessionId: 'custom-session',
      })

      expect(navigateToUrl).toHaveBeenCalledWith('https://example.com', {
        sessionId: 'custom-session',
      })
    })

    it('should throw VALIDATION_ERROR when url is empty', async () => {
      await expect(executeTool(browserNavigateTool, { url: '' })).rejects.toThrow(AppError)
      await expect(executeTool(browserNavigateTool, { url: '' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw VALIDATION_ERROR when url is not a string', async () => {
      await expect(executeTool(browserNavigateTool, { url: 123 })).rejects.toThrow(AppError)
    })

    it('should throw VALIDATION_ERROR when url is missing', async () => {
      await expect(executeTool(browserNavigateTool, {})).rejects.toThrow(AppError)
    })

    it('should ignore invalid timeout values', async () => {
      vi.mocked(navigateToUrl).mockResolvedValue({
        url: 'https://example.com',
        title: '',
        statusCode: 200,
        loadTime: 100,
      })

      await executeTool(browserNavigateTool, {
        url: 'https://example.com',
        timeout: 'invalid',
      })

      // timeout should not be set in options since it's invalid
      expect(navigateToUrl).toHaveBeenCalledWith('https://example.com', {})
    })

    it('should wrap non-AppError as BROWSER_NAVIGATION_ERROR', async () => {
      vi.mocked(navigateToUrl).mockRejectedValue(new Error('Network error'))

      await expect(executeTool(browserNavigateTool, { url: 'https://example.com' })).rejects.toMatchObject({
        code: ErrorCodes.BROWSER_NAVIGATION_ERROR,
      })
    })

    it('should rethrow AppError as-is', async () => {
      const appError = new AppError(ErrorCodes.BROWSER_TIMEOUT, 'Timed out')
      vi.mocked(navigateToUrl).mockRejectedValue(appError)

      await expect(executeTool(browserNavigateTool, { url: 'https://example.com' })).rejects.toBe(appError)
    })
  })

  // ─── browser_screenshot ──────────────────────────────────────

  describe('browser_screenshot', () => {
    it('should have risk level "low"', () => {
      expect(browserScreenshotTool.definition.riskLevel).toBe('low')
    })

    it('should capture screenshot successfully', async () => {
      const mockScreenshot = {
        base64: 'iVBORw0KGgo=',
        format: 'png' as const,
        width: 1280,
        height: 800,
        fullPage: false,
      }
      vi.mocked(captureScreenshot).mockResolvedValue(mockScreenshot)

      const result = await executeTool(browserScreenshotTool, {})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('1280x800')
      expect(result.content).toContain('png')
      expect(result.metadata?.['format']).toBe('png')
      expect(result.metadata?.['base64']).toBe('iVBORw0KGgo=')
    })

    it('should pass format and fullPage options', async () => {
      vi.mocked(captureScreenshot).mockResolvedValue({
        base64: '/9j/4AAQ=',
        format: 'jpeg',
        width: 1920,
        height: 1080,
        fullPage: true,
      })

      await executeTool(browserScreenshotTool, { format: 'jpeg', fullPage: true })

      expect(captureScreenshot).toHaveBeenCalledWith({
        format: 'jpeg',
        fullPage: true,
      })
    })

    it('should pass width and height options', async () => {
      vi.mocked(captureScreenshot).mockResolvedValue({
        base64: 'abc',
        format: 'png',
        width: 1920,
        height: 1080,
        fullPage: false,
      })

      await executeTool(browserScreenshotTool, { width: 1920, height: 1080 })

      expect(captureScreenshot).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
      })
    })

    it('should ignore invalid width values', async () => {
      vi.mocked(captureScreenshot).mockResolvedValue({
        base64: 'abc',
        format: 'png',
        width: 1280,
        height: 800,
        fullPage: false,
      })

      await executeTool(browserScreenshotTool, { width: 100 }) // Below minimum 320

      expect(captureScreenshot).toHaveBeenCalledWith({})
    })

    it('should wrap errors as BROWSER_SCREENSHOT_ERROR', async () => {
      vi.mocked(captureScreenshot).mockRejectedValue(new Error('Capture failed'))

      await expect(executeTool(browserScreenshotTool, {})).rejects.toMatchObject({
        code: ErrorCodes.BROWSER_SCREENSHOT_ERROR,
      })
    })
  })

  // ─── browser_get_text ────────────────────────────────────────

  describe('browser_get_text', () => {
    it('should have risk level "low"', () => {
      expect(browserGetTextTool.definition.riskLevel).toBe('low')
    })

    it('should extract text successfully', async () => {
      vi.mocked(getPageText).mockResolvedValue('Hello World')
      vi.mocked(getCurrentPageInfo).mockReturnValue({
        url: 'https://example.com',
        title: 'Example',
      })

      const result = await executeTool(browserGetTextTool, {})

      expect(result.isError).toBe(false)
      expect(result.content).toBe('Hello World')
      expect(result.metadata?.['url']).toBe('https://example.com')
      expect(result.metadata?.['length']).toBe(11)
    })

    it('should return placeholder when text is empty', async () => {
      vi.mocked(getPageText).mockResolvedValue('')
      vi.mocked(getCurrentPageInfo).mockReturnValue({ url: '', title: '' })

      const result = await executeTool(browserGetTextTool, {})

      expect(result.content).toBe('(页面无文本内容)')
    })

    it('should pass selector and maxLength options', async () => {
      vi.mocked(getPageText).mockResolvedValue('Text')
      vi.mocked(getCurrentPageInfo).mockReturnValue({ url: '', title: '' })

      await executeTool(browserGetTextTool, { selector: '#content', maxLength: 5000 })

      expect(getPageText).toHaveBeenCalledWith({
        selector: '#content',
        maxLength: 5000,
      })
    })

    it('should ignore invalid maxLength values', async () => {
      vi.mocked(getPageText).mockResolvedValue('Text')
      vi.mocked(getCurrentPageInfo).mockReturnValue({ url: '', title: '' })

      await executeTool(browserGetTextTool, { maxLength: 50 }) // Below minimum 100

      expect(getPageText).toHaveBeenCalledWith({})
    })

    it('should wrap errors as BROWSER_OPERATION_ERROR', async () => {
      vi.mocked(getPageText).mockRejectedValue(new Error('Extract failed'))

      await expect(executeTool(browserGetTextTool, {})).rejects.toMatchObject({
        code: ErrorCodes.BROWSER_OPERATION_ERROR,
      })
    })
  })

  // ─── browser_get_dom ─────────────────────────────────────────

  describe('browser_get_dom', () => {
    it('should have risk level "low"', () => {
      expect(browserGetDomTool.definition.riskLevel).toBe('low')
    })

    it('should extract DOM structure successfully', async () => {
      const mockElements = [
        {
          tagName: 'div',
          id: 'header',
          className: 'nav',
          text: 'Header',
          attributes: {},
          isVisible: true,
          isClickable: false,
          rect: { x: 0, y: 0, width: 1280, height: 60 },
        },
        {
          tagName: 'button',
          id: 'submit',
          className: 'btn',
          text: 'Submit',
          attributes: { type: 'submit' },
          isVisible: true,
          isClickable: true,
          rect: { x: 10, y: 10, width: 100, height: 40 },
        },
      ]
      vi.mocked(getDomStructure).mockResolvedValue(mockElements)
      vi.mocked(getCurrentPageInfo).mockReturnValue({
        url: 'https://example.com',
        title: 'Example',
      })

      const result = await executeTool(browserGetDomTool, {})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('https://example.com')
      expect(result.content).toContain('元素数: 2')
      expect(result.content).toContain('<div#header.nav>')
      expect(result.content).toContain('<button#submit.btn>')
      expect(result.metadata?.['count']).toBe(2)
      expect(result.metadata?.['elements']).toEqual(mockElements)
    })

    it('should handle empty element list', async () => {
      vi.mocked(getDomStructure).mockResolvedValue([])
      vi.mocked(getCurrentPageInfo).mockReturnValue({ url: '', title: '' })

      const result = await executeTool(browserGetDomTool, {})

      expect(result.content).toContain('元素数: 0')
      expect(result.content).toContain('(无元素)')
    })

    it('should pass maxElements option', async () => {
      vi.mocked(getDomStructure).mockResolvedValue([])
      vi.mocked(getCurrentPageInfo).mockReturnValue({ url: '', title: '' })

      await executeTool(browserGetDomTool, { maxElements: 200 })

      expect(getDomStructure).toHaveBeenCalledWith({ maxElements: 200 })
    })

    it('should ignore invalid maxElements values', async () => {
      vi.mocked(getDomStructure).mockResolvedValue([])
      vi.mocked(getCurrentPageInfo).mockReturnValue({ url: '', title: '' })

      await executeTool(browserGetDomTool, { maxElements: 0 }) // Below minimum 1

      expect(getDomStructure).toHaveBeenCalledWith({})
    })

    it('should wrap errors as BROWSER_OPERATION_ERROR', async () => {
      vi.mocked(getDomStructure).mockRejectedValue(new Error('DOM failed'))

      await expect(executeTool(browserGetDomTool, {})).rejects.toMatchObject({
        code: ErrorCodes.BROWSER_OPERATION_ERROR,
      })
    })
  })

  // ─── browser_click ───────────────────────────────────────────

  describe('browser_click', () => {
    it('should have risk level "medium"', () => {
      expect(browserClickTool.definition.riskLevel).toBe('medium')
    })

    it('should require selector in inputSchema', () => {
      const required = browserClickTool.definition.inputSchema['required'] as string[]
      expect(required).toContain('selector')
    })

    it('should click element successfully', async () => {
      vi.mocked(clickElement).mockResolvedValue({
        clicked: true,
        selector: '#btn',
        text: 'Click Me',
      })

      const result = await executeTool(browserClickTool, { selector: '#btn' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('#btn')
      expect(result.content).toContain('Click Me')
      expect(result.metadata).toEqual({ clicked: true, selector: '#btn', text: 'Click Me' })
    })

    it('should pass sessionId option', async () => {
      vi.mocked(clickElement).mockResolvedValue({
        clicked: true,
        selector: '#btn',
        text: '',
      })

      await executeTool(browserClickTool, { selector: '#btn', sessionId: 's1' })

      expect(clickElement).toHaveBeenCalledWith('#btn', { sessionId: 's1' })
    })

    it('should throw VALIDATION_ERROR when selector is empty', async () => {
      await expect(executeTool(browserClickTool, { selector: '' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should throw VALIDATION_ERROR when selector is missing', async () => {
      await expect(executeTool(browserClickTool, {})).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      })
    })

    it('should wrap errors as BROWSER_OPERATION_ERROR', async () => {
      vi.mocked(clickElement).mockRejectedValue(new Error('Click failed'))

      await expect(executeTool(browserClickTool, { selector: '#btn' })).rejects.toMatchObject({
        code: ErrorCodes.BROWSER_OPERATION_ERROR,
      })
    })
  })

  // ─── browser_fill ────────────────────────────────────────────

  describe('browser_fill', () => {
    it('should have risk level "medium"', () => {
      expect(browserFillTool.definition.riskLevel).toBe('medium')
    })

    it('should require selector and value in inputSchema', () => {
      const required = browserFillTool.definition.inputSchema['required'] as string[]
      expect(required).toContain('selector')
      expect(required).toContain('value')
    })

    it('should fill input successfully', async () => {
      vi.mocked(fillInput).mockResolvedValue({
        filled: true,
        selector: '#search',
        value: 'hello world',
      })

      const result = await executeTool(browserFillTool, {
        selector: '#search',
        value: 'hello world',
      })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('#search')
      expect(result.content).toContain('hello world')
    })

    it('should truncate long values in content output', async () => {
      const longValue = 'a'.repeat(200)
      vi.mocked(fillInput).mockResolvedValue({
        filled: true,
        selector: '#input',
        value: longValue,
      })

      const result = await executeTool(browserFillTool, {
        selector: '#input',
        value: longValue,
      })

      expect(result.content).toContain('...')
      expect(result.content.length).toBeLessThan(longValue.length + 100)
    })

    it('should pass clearFirst option', async () => {
      vi.mocked(fillInput).mockResolvedValue({
        filled: true,
        selector: '#input',
        value: 'test',
      })

      await executeTool(browserFillTool, {
        selector: '#input',
        value: 'test',
        clearFirst: false,
      })

      expect(fillInput).toHaveBeenCalledWith('#input', 'test', { clearFirst: false })
    })

    it('should default clearFirst to true when not specified', async () => {
      vi.mocked(fillInput).mockResolvedValue({
        filled: true,
        selector: '#input',
        value: 'test',
      })

      await executeTool(browserFillTool, {
        selector: '#input',
        value: 'test',
      })

      // clearFirst should not be set (defaults to true in core module)
      expect(fillInput).toHaveBeenCalledWith('#input', 'test', {})
    })

    it('should throw VALIDATION_ERROR when selector is empty', async () => {
      await expect(
        executeTool(browserFillTool, { selector: '', value: 'test' }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should throw VALIDATION_ERROR when value is not a string', async () => {
      await expect(
        executeTool(browserFillTool, { selector: '#input', value: 123 }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should throw VALIDATION_ERROR when value is missing', async () => {
      await expect(
        executeTool(browserFillTool, { selector: '#input' }),
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR })
    })

    it('should wrap errors as BROWSER_OPERATION_ERROR', async () => {
      vi.mocked(fillInput).mockRejectedValue(new Error('Fill failed'))

      await expect(
        executeTool(browserFillTool, { selector: '#input', value: 'test' }),
      ).rejects.toMatchObject({ code: ErrorCodes.BROWSER_OPERATION_ERROR })
    })
  })

  // ─── browser_close ───────────────────────────────────────────

  describe('browser_close', () => {
    it('should have risk level "low"', () => {
      expect(browserCloseTool.definition.riskLevel).toBe('low')
    })

    it('should close default session when no sessionId provided', async () => {
      vi.mocked(closeSession).mockImplementation(() => {})

      const result = await executeTool(browserCloseTool, {})

      expect(result.isError).toBe(false)
      expect(result.content).toContain('default')
      expect(closeSession).toHaveBeenCalledWith('default')
    })

    it('should close specified session', async () => {
      vi.mocked(closeSession).mockImplementation(() => {})

      const result = await executeTool(browserCloseTool, { sessionId: 'custom' })

      expect(result.isError).toBe(false)
      expect(result.content).toContain('custom')
      expect(closeSession).toHaveBeenCalledWith('custom')
    })

    it('should use default session for empty sessionId', async () => {
      vi.mocked(closeSession).mockImplementation(() => {})

      await executeTool(browserCloseTool, { sessionId: '' })

      expect(closeSession).toHaveBeenCalledWith('default')
    })

    it('should wrap errors as BROWSER_OPERATION_ERROR', async () => {
      vi.mocked(closeSession).mockImplementation(() => {
        throw new Error('Close failed')
      })

      await expect(executeTool(browserCloseTool, {})).rejects.toMatchObject({
        code: ErrorCodes.BROWSER_OPERATION_ERROR,
      })
    })
  })

  // ─── 工具描述验证 ─────────────────────────────────────────────

  describe('Tool Descriptions', () => {
    it('should have non-empty descriptions for all tools', () => {
      for (const tool of allBrowserTools) {
        expect(tool.definition.description.length).toBeGreaterThan(10)
      }
    })

    it('should have Chinese descriptions', () => {
      // 至少 navigate 工具应有中文描述
      expect(browserNavigateTool.definition.description).toMatch(/导航|网页|URL/)
    })
  })
})
