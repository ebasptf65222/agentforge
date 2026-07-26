// AgentForge P2-05: web_search 内置工具
// 调用 DuckDuckGo HTML 端点获取搜索结果
// 与 Spec v0.2 §5.5 工具类型一致

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { BuiltinTool } from './types'

/** 搜索请求超时时间（毫秒） */
const SEARCH_TIMEOUT_MS = 10_000

/** DuckDuckGo HTML 搜索端点 */
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'

/** 单次返回的最大结果数 */
const MAX_RESULTS = 10

/** 搜索结果项 */
export interface SearchResult {
  title: string
  snippet: string
  url: string
}

/**
 * 从 HTML 中解码常见实体与剥离标签，返回纯文本。
 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 从 DuckDuckGo 的重定向链接中提取真实 URL。
 * DuckDuckGo HTML 端点的链接形如 `//duckduckgo.com/l/?uddg=<encoded>&rut=...`。
 */
function extractDuckDuckGoUrl(rawUrl: string): string {
  try {
    let candidate = rawUrl
    if (candidate.startsWith('//')) {
      candidate = `https:${candidate}`
    }
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      const u = new URL(candidate)
      const uddg = u.searchParams.get('uddg')
      if (uddg) return uddg
      return candidate
    }
    return rawUrl
  } catch {
    return rawUrl
  }
}

/**
 * 从 DuckDuckGo HTML 响应中解析搜索结果。
 * 按出现顺序匹配 `result__a`（标题 + URL）与 `result__snippet`（摘要）。
 */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const titles: Array<{ url: string; title: string }> = []
  const snippets: string[] = []

  const titleRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  let titleMatch: RegExpExecArray | null
  while ((titleMatch = titleRegex.exec(html)) !== null) {
    const rawUrl = titleMatch[1] ?? ''
    const titleText = stripTags(titleMatch[2] ?? '')
    titles.push({ url: extractDuckDuckGoUrl(rawUrl), title: titleText })
  }

  let snippetMatch: RegExpExecArray | null
  while ((snippetMatch = snippetRegex.exec(html)) !== null) {
    snippets.push(stripTags(snippetMatch[1] ?? ''))
  }

  for (let i = 0; i < titles.length && results.length < MAX_RESULTS; i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] ?? '',
    })
  }

  return results
}

/** web_search 工具定义与执行函数 */
export const webSearchTool: BuiltinTool = {
  definition: {
    name: 'web_search',
    description: 'Search the web for information',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
      },
      required: ['query'],
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = args['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Query must be a non-empty string.', {
        query,
      })
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

    try {
      const response = await fetch(DDG_HTML_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AgentForge/0.1',
        },
        body: `q=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new AppError(
          ErrorCodes.TOOL_EXECUTION_ERROR,
          `Search request failed: ${response.status} ${response.statusText}`,
          { status: response.status, statusText: response.statusText, query },
        )
      }

      const html = await response.text()
      const results = parseDuckDuckGoHtml(html)

      return {
        isError: false,
        content: JSON.stringify({ query, results }),
        metadata: { count: results.length },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(
          ErrorCodes.TOOL_EXECUTION_ERROR,
          `Search request timed out after ${SEARCH_TIMEOUT_MS}ms`,
          { query, timeout: SEARCH_TIMEOUT_MS },
        )
      }
      throw new AppError(
        ErrorCodes.TOOL_EXECUTION_ERROR,
        `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        { query },
      )
    } finally {
      clearTimeout(timeoutId)
    }
  },
}
