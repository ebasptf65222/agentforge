// AgentForge CB: 代码库语义搜索工具
// 让 Agent 能够检索代码库中的代码片段

import type { BuiltinTool } from './types'
import { searchCodebase } from '../codebase/search'
import type { CodebaseSearchOptions } from '../codebase/search'
import { AppError, ErrorCodes } from '../utils/error'

/**
 * 将搜索结果格式化为 Agent 可读的文本。
 */
function formatSearchResults(results: Awaited<ReturnType<typeof searchCodebase>>): string {
  if (results.length === 0) {
    return '未找到相关代码。'
  }

  const lines: string[] = [`找到 ${results.length} 条相关代码：`]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`\n--- 结果 ${i + 1}（相似度: ${(r.score * 100).toFixed(1)}%）---`)
    lines.push(`文件: ${r.filePath} (语言: ${r.language})`)
    lines.push(`行号: ${r.startLine}-${r.endLine}`)
    lines.push(`类型: ${r.chunkType}`)
    lines.push(`内容:`)
    lines.push(r.content)
  }

  return lines.join('\n')
}

/** codebase_search 工具定义与执行函数 */
export const codebaseSearchTool: BuiltinTool = {
  definition: {
    name: 'codebase_search',
    description:
      '在已索引的代码库中执行语义搜索，检索与查询相关的代码片段。当用户询问代码实现、需要查找特定函数/类/接口、或需要理解项目结构时使用此工具。支持按语言和代码类型过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询文本，描述你想在代码库中查找的代码内容',
        },
        topK: {
          type: 'number',
          description: '返回的结果数量（1-30，默认 10）',
          minimum: 1,
          maximum: 30,
        },
        language: {
          type: 'string',
          description: '可选：限定搜索的编程语言（如 typescript, python, go, rust 等）',
        },
        chunkType: {
          type: 'string',
          description: '可选：限定搜索的代码类型（module, function, class, block, comment）',
          enum: ['module', 'function', 'class', 'block', 'comment'],
        },
        threshold: {
          type: 'number',
          description: '相似度阈值（0-1，默认 0.3）。越高结果越精确但可能遗漏',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['query'],
    },
    riskLevel: 'low',
    source: 'builtin',
  },
  async execute(args: Record<string, unknown>) {
    const query = args['query']
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'query 必须为非空字符串', { query })
    }

    const options: CodebaseSearchOptions = {}

    if (args['topK'] !== undefined) {
      const topK = Number(args['topK'])
      if (!Number.isNaN(topK) && topK >= 1 && topK <= 30) {
        options.topK = Math.floor(topK)
      }
    }

    if (args['language'] !== undefined && typeof args['language'] === 'string') {
      options.language = args['language'] as CodebaseSearchOptions['language']
    }

    if (args['chunkType'] !== undefined && typeof args['chunkType'] === 'string') {
      options.chunkType = args['chunkType'] as CodebaseSearchOptions['chunkType']
    }

    if (args['threshold'] !== undefined) {
      const threshold = Number(args['threshold'])
      if (!Number.isNaN(threshold) && threshold >= 0 && threshold <= 1) {
        options.threshold = threshold
      }
    }

    try {
      const results = await searchCodebase(query, options)
      const formatted = formatSearchResults(results)

      return {
        isError: false,
        content: formatted,
        metadata: {
          query,
          resultCount: results.length,
          options,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AppError(ErrorCodes.CB_SEARCH_ERROR, `代码库搜索失败: ${message}`, {
        query,
        options,
      })
    }
  },
}
