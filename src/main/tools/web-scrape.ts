// AgentForge P2-05: web_scrape 内置工具
// 下载 URL 并剥离 HTML 标签，返回纯文本
// 与 Spec v0.2 §5.5 工具类型一致

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

/** 抓取请求超时时间（毫秒） */
const SCRAPE_TIMEOUT_MS = 10_000

/** 响应体最大字节数（1MB） */
const MAX_CONTENT_LENGTH = 1024 * 1024

/**
 * 剥离 HTML 标签，返回纯文本。
 * - 移除 script / style / 注释
 * - 块级标签转换为换行
 * - 解码常见 HTML 实体
 * - 折叠多余空白
 */
export function stripHtmlTags(html: string): string {
  let cleaned = html
  // 完整移除 script / style / 注释内容
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '')
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '')
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')
  // 块级闭合标签与 <br> 转为换行
  cleaned = cleaned.replace(
    /<\/(p|div|h[1-6]|li|ul|ol|tr|td|th|hr|table|section|article|header|footer|nav|main|aside|figure|figcaption|blockquote|pre)>/gi,
    '\n',
  )
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n')
  // 移除所有剩余标签
  cleaned = cleaned.replace(/<[^>]*>/g, '')
  // 解码常见 HTML 实体
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
  // 折叠空白
  cleaned = cleaned.replace(/[ \t]+/g, ' ')
  cleaned = cleaned.replace(/ *\n */g, '\n')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.trim()
}

/** web_scrape 工具定义与执行函数 */
export const webScrapeTool: BuiltinTool = {
  definition: {
    name: 'web_scrape',
    description: 'Scrape text content from a web page',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to scrape',
        },
      },
      required: ['url'],
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const url = args['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'URL must be a non-empty string.', { url })
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url.trim())
    } catch {
      throw new AppError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`, { url })
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new AppError(ErrorCodes.INVALID_URL, `URL must be http or https: ${url}`, {
        url,
        protocol: parsedUrl.protocol,
      })
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'AgentForge/0.1',
          Accept: 'text/html,application/xhtml+xml,application/xml,text/plain',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new AppError(
          ErrorCodes.TOOL_EXECUTION_ERROR,
          `Scrape request failed: ${response.status} ${response.statusText}`,
          { status: response.status, statusText: response.statusText, url: parsedUrl.toString() },
        )
      }

      // 优先依据 Content-Length 头判断大小
      const contentLengthHeader = response.headers.get('content-length')
      if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10)
        if (!Number.isNaN(contentLength) && contentLength > MAX_CONTENT_LENGTH) {
          throw new AppError(
            ErrorCodes.FILE_TOO_LARGE,
            `Response too large: ${contentLength} bytes (max ${MAX_CONTENT_LENGTH})`,
            { contentLength, max: MAX_CONTENT_LENGTH, url: parsedUrl.toString() },
          )
        }
      }

      const html = await response.text()
      if (html.length > MAX_CONTENT_LENGTH) {
        throw new AppError(
          ErrorCodes.FILE_TOO_LARGE,
          `Response too large: ${html.length} bytes (max ${MAX_CONTENT_LENGTH})`,
          { length: html.length, max: MAX_CONTENT_LENGTH, url: parsedUrl.toString() },
        )
      }

      const text = stripHtmlTags(html)

      return {
        isError: false,
        content: text,
        metadata: {
          url: parsedUrl.toString(),
          length: text.length,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(
          ErrorCodes.TOOL_EXECUTION_ERROR,
          `Scrape request timed out after ${SCRAPE_TIMEOUT_MS}ms`,
          { url, timeout: SCRAPE_TIMEOUT_MS },
        )
      }
      throw new AppError(
        ErrorCodes.TOOL_EXECUTION_ERROR,
        `Scrape failed: ${error instanceof Error ? error.message : String(error)}`,
        { url },
      )
    } finally {
      clearTimeout(timeoutId)
    }
  },
}
