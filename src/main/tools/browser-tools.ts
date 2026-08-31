// AgentForge P2-01: 浏览器自动化 Agent 工具
// 6 个 browser_* 内置工具，注册到 ToolRegistry
// 让 Agent 能够导航网页、截图、提取内容、点击元素、填写表单

import type { ToolDefinition, ToolExecutionResult, BrowserElementInfo } from '@shared/types'
import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  navigateToUrl,
  captureScreenshot,
  getPageText,
  getDomStructure,
  clickElement,
  fillInput,
  getCurrentPageInfo,
  closeSession,
} from '../browser'

// ─── 辅助函数 ─────────────────────────────────────────────────

/** 格式化 DOM 元素列表为可读文本 */
function formatDomElements(elements: BrowserElementInfo[]): string {
  if (elements.length === 0) {
    return '  (无元素)'
  }

  const lines: string[] = []
  for (const el of elements) {
    const visible = el.isVisible ? '✓' : '✗'
    const clickable = el.isClickable ? '👆' : '  '
    const idStr = el.id ? `#${el.id}` : ''
    const classStr = el.className ? `.${el.className.split(/\s+/).filter(Boolean).join('.')}` : ''
    const textPreview = el.text.length > 0 ? ` "${el.text.slice(0, 80)}"` : ''
    lines.push(`  ${visible}${clickable} <${el.tagName}${idStr}${classStr}>${textPreview}`)
  }

  return lines.join('\n')
}

// ─── browser_navigate 工具 ────────────────────────────────────

export const browserNavigateTool: BuiltinTool = {
  definition: {
    name: 'browser_navigate',
    description:
      '导航到指定 URL，加载网页。在需要访问网页、打开链接、浏览在线内容时使用。支持超时控制和等待策略。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要导航到的 URL（必须为 http:// 或 https://）',
        },
        timeout: {
          type: 'number',
          description: '导航超时时间（毫秒，默认 30000，最大600000）',
          minimum: 1000,
          maximum: 600000,
        },
        waitUntil: {
          type: 'string',
          description: '等待策略: load(等待完全加载,默认) 或 domcontentloaded(DOM 就绪即可)',
          enum: ['load', 'domcontentloaded'],
        },
        sessionId: {
          type: 'string',
          description: '浏览器会话 ID（默认使用 default 会话，多会话场景可指定）',
        },
      },
      required: ['url'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const url = args['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'URL must be a non-empty string.', { url })
    }

    const options: Parameters<typeof navigateToUrl>[1] = {}

    if (args['timeout'] !== undefined) {
      const timeout = Number(args['timeout'])
      if (!Number.isNaN(timeout) && timeout >= 1000 && timeout <= 600000) {
        options.timeout = Math.floor(timeout)
      }
    }

    if (typeof args['waitUntil'] === 'string') {
      options.waitUntil = args['waitUntil'] as 'load' | 'domcontentloaded'
    }

    if (typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== '') {
      options.sessionId = args['sessionId']
    }

    try {
      const info = await navigateToUrl(url, options)

      return {
        isError: false,
        content: `已导航到: ${info.url}\n标题: ${info.title}\n加载耗时: ${info.loadTime}ms`,
        metadata: info,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_NAVIGATION_ERROR,
        `Navigation failed: ${error instanceof Error ? error.message : String(error)}`,
        { url },
      )
    }
  },
}

// ─── browser_screenshot 工具 ──────────────────────────────────

export const browserScreenshotTool: BuiltinTool = {
  definition: {
    name: 'browser_screenshot',
    description:
      '截取当前网页的截图。可截取可视区域或完整页面。返回 Base64 编码的图片数据。当需要查看网页外观、验证页面内容时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: '图片格式: png(默认) 或 jpeg',
          enum: ['png', 'jpeg'],
        },
        fullPage: {
          type: 'boolean',
          description: '是否截取完整页面（包括滚动区域，默认 false）',
        },
        width: {
          type: 'number',
          description: '视口宽度（像素，默认 1280）',
          minimum: 320,
          maximum: 3840,
        },
        height: {
          type: 'number',
          description: '视口高度（像素，默认 800）',
          minimum: 240,
          maximum: 2160,
        },
        sessionId: {
          type: 'string',
          description: '浏览器会话 ID',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const options: Parameters<typeof captureScreenshot>[0] = {}

    if (args['format'] === 'png' || args['format'] === 'jpeg') {
      options.format = args['format']
    }

    if (args['fullPage'] === true) {
      options.fullPage = true
    }

    if (args['width'] !== undefined) {
      const width = Number(args['width'])
      if (!Number.isNaN(width) && width >= 320 && width <= 3840) {
        options.width = Math.floor(width)
      }
    }

    if (args['height'] !== undefined) {
      const height = Number(args['height'])
      if (!Number.isNaN(height) && height >= 240 && height <= 2160) {
        options.height = Math.floor(height)
      }
    }

    if (typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== '') {
      options.sessionId = args['sessionId']
    }

    try {
      const screenshot = await captureScreenshot(options)

      return {
        isError: false,
        content: `截图完成: ${screenshot.width}x${screenshot.height} (${screenshot.format}, ${screenshot.base64.length} bytes base64)${screenshot.fullPage ? ' [完整页面]' : ''}`,
        metadata: {
          format: screenshot.format,
          width: screenshot.width,
          height: screenshot.height,
          fullPage: screenshot.fullPage,
          base64Length: screenshot.base64.length,
          // 注意: base64 数据放在 metadata 中供前端使用
          base64: screenshot.base64,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_SCREENSHOT_ERROR,
        `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
      )
    }
  },
}

// ─── browser_get_text 工具 ────────────────────────────────────

export const browserGetTextTool: BuiltinTool = {
  definition: {
    name: 'browser_get_text',
    description:
      '提取当前网页的文本内容。可提取整个页面或指定 CSS 选择器元素的文本。当需要读取网页内容、提取文章文本时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS 选择器（默认 "body"，提取整个页面文本）',
        },
        maxLength: {
          type: 'number',
          description: '最大返回字符数（默认 10000）',
          minimum: 100,
          maximum: 100000,
        },
        sessionId: {
          type: 'string',
          description: '浏览器会话 ID',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const options: Parameters<typeof getPageText>[0] = {}

    if (typeof args['selector'] === 'string' && args['selector'].trim() !== '') {
      options.selector = args['selector']
    }

    if (args['maxLength'] !== undefined) {
      const maxLength = Number(args['maxLength'])
      if (!Number.isNaN(maxLength) && maxLength >= 100 && maxLength <= 100000) {
        options.maxLength = Math.floor(maxLength)
      }
    }

    if (typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== '') {
      options.sessionId = args['sessionId']
    }

    try {
      const text = await getPageText(options)

      const pageInfo = getCurrentPageInfo(options.sessionId)

      return {
        isError: false,
        content: text.length > 0 ? text : '(页面无文本内容)',
        metadata: {
          url: pageInfo.url,
          title: pageInfo.title,
          selector: options.selector ?? 'body',
          length: text.length,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_OPERATION_ERROR,
        `Failed to get page text: ${error instanceof Error ? error.message : String(error)}`,
        { selector: options.selector },
      )
    }
  },
}

// ─── browser_get_dom 工具 ─────────────────────────────────────

export const browserGetDomTool: BuiltinTool = {
  definition: {
    name: 'browser_get_dom',
    description:
      '提取当前网页的 DOM 结构信息。返回元素的标签名、ID、类名、文本、属性、位置等结构化数据。当需要了解页面结构、查找可交互元素时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS 选择器（默认 "body"，提取整个页面的 DOM）',
        },
        maxElements: {
          type: 'number',
          description: '最大返回元素数（默认 100，最大 500）',
          minimum: 1,
          maximum: 500,
        },
        sessionId: {
          type: 'string',
          description: '浏览器会话 ID',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const options: Parameters<typeof getDomStructure>[0] = {}

    if (typeof args['selector'] === 'string' && args['selector'].trim() !== '') {
      options.selector = args['selector']
    }

    if (args['maxElements'] !== undefined) {
      const maxElements = Number(args['maxElements'])
      if (!Number.isNaN(maxElements) && maxElements >= 1 && maxElements <= 500) {
        options.maxElements = Math.floor(maxElements)
      }
    }

    if (typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== '') {
      options.sessionId = args['sessionId']
    }

    try {
      const elements = await getDomStructure(options)
      const pageInfo = getCurrentPageInfo(options.sessionId)

      const formatted = `URL: ${pageInfo.url}\n元素数: ${elements.length}\n\n${formatDomElements(elements)}`

      return {
        isError: false,
        content: formatted,
        metadata: {
          url: pageInfo.url,
          selector: options.selector ?? 'body',
          count: elements.length,
          elements,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_OPERATION_ERROR,
        `Failed to get DOM structure: ${error instanceof Error ? error.message : String(error)}`,
        { selector: options.selector },
      )
    }
  },
}

// ─── browser_click 工具 ───────────────────────────────────────

export const browserClickTool: BuiltinTool = {
  definition: {
    name: 'browser_click',
    description:
      '点击网页上的元素。通过 CSS 选择器定位目标元素并模拟点击。当需要点击按钮、链接或其他可交互元素时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: '要点击元素的 CSS 选择器（如 "#submit-btn", ".nav-link", "button.primary"）',
        },
        sessionId: {
          type: 'string',
          description: '浏览器会话 ID',
        },
      },
      required: ['selector'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const selector = args['selector']
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Selector must be a non-empty string.', {
        selector,
      })
    }

    const options: Parameters<typeof clickElement>[1] = {}

    if (typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== '') {
      options.sessionId = args['sessionId']
    }

    try {
      const result = await clickElement(selector, options)

      return {
        isError: false,
        content: `已点击: ${result.selector}${result.text ? ` ("${result.text}")` : ''}`,
        metadata: result,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_OPERATION_ERROR,
        `Click failed: ${error instanceof Error ? error.message : String(error)}`,
        { selector },
      )
    }
  },
}

// ─── browser_fill 工具 ────────────────────────────────────────

export const browserFillTool: BuiltinTool = {
  definition: {
    name: 'browser_fill',
    description:
      '在网页输入框中填写内容。通过 CSS 选择器定位 input/textarea 元素并设置值。当需要在表单中输入文本时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            '目标 input/textarea 元素的 CSS 选择器（如 "#search-input", "textarea[name=content]"）',
        },
        value: {
          type: 'string',
          description: '要填写的文本内容',
        },
        clearFirst: {
          type: 'boolean',
          description: '是否先清空已有内容（默认 true）',
        },
        sessionId: {
          type: 'string',
          description: '浏览器会话 ID',
        },
      },
      required: ['selector', 'value'],
    },
    riskLevel: 'medium',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const selector = args['selector']
    const value = args['value']

    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Selector must be a non-empty string.', {
        selector,
      })
    }
    if (typeof value !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Value must be a string.', { value })
    }

    const options: Parameters<typeof fillInput>[2] = {}

    if (args['clearFirst'] === false) {
      options.clearFirst = false
    }

    if (typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== '') {
      options.sessionId = args['sessionId']
    }

    try {
      const result = await fillInput(selector, value, options)

      return {
        isError: false,
        content: `已填写: ${result.selector} = "${result.value.slice(0, 100)}${result.value.length > 100 ? '...' : ''}"`,
        metadata: result,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_OPERATION_ERROR,
        `Fill failed: ${error instanceof Error ? error.message : String(error)}`,
        { selector, value },
      )
    }
  },
}

// ─── browser_close 工具 ───────────────────────────────────────

export const browserCloseTool: BuiltinTool = {
  definition: {
    name: 'browser_close',
    description:
      '关闭浏览器会话，释放资源。当完成浏览器操作后使用此工具清理会话。如果不指定 sessionId，则关闭默认会话。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: '要关闭的浏览器会话 ID（默认关闭 default 会话）',
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const sessionId =
      typeof args['sessionId'] === 'string' && args['sessionId'].trim() !== ''
        ? args['sessionId']
        : 'default'

    try {
      closeSession(sessionId)

      return {
        isError: false,
        content: `浏览器会话已关闭: ${sessionId}`,
        metadata: { sessionId },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.BROWSER_OPERATION_ERROR,
        `Failed to close session: ${error instanceof Error ? error.message : String(error)}`,
        { sessionId },
      )
    }
  },
}

// ─── 导出所有 browser_* 工具 ──────────────────────────────────

export const allBrowserTools: BuiltinTool[] = [
  browserNavigateTool,
  browserScreenshotTool,
  browserGetTextTool,
  browserGetDomTool,
  browserClickTool,
  browserFillTool,
  browserCloseTool,
]
