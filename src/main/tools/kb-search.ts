// AgentForge P4-04: 知识库语义搜索工具
// 让 Agent 能够检索本地知识库中的文档片段

import type { BuiltinTool } from './types'
import { semanticSearch } from '../knowledge-base/search'
import type { SearchOptions } from '../knowledge-base/search'
import { AppError, ErrorCodes } from '../utils/error'

/**
 * 将搜索结果格式化为 Agent 可读的文本。
 */
function formatSearchResults(results: Awaited<ReturnType<typeof semanticSearch>>): string {
  if (results.length === 0) {
    return '未找到相关知识库内容。'
  }

  const lines: string[] = [`找到 ${results.length} 条相关知识库内容：`]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`\n--- 结果 ${i + 1}（相似度: ${(r.score * 100).toFixed(1)}%）---`)
    lines.push(`来源: ${r.fileName}`)
    lines.push(`内容: ${r.content}`)
  }

  return lines.join('\n')
}

/** kb_search 工具定义与执行函数 */
export const kbSearchTool: BuiltinTool = {
  definition: {
    name: 'kb_search',
    description:
      '在本地知识库中执行语义搜索，检索与查询相关的文档片段。当用户询问文档内容、需要引用已有资料或需要基于本地知识回答问题时使用此工具。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询文本，描述你想在知识库中查找的内容',
        },
        topK: {
          type: 'number',
          description: '返回的结果数量（1-20，默认 5）',
          minimum: 1,
          maximum: 20,
        },
        documentId: {
          type: 'string',
          description: '可选：限定搜索的特定文档 ID',
        },
        threshold: {
          type: 'number',
          description: '相似度阈值（0-1，默认 0.5）。越高结果越精确但可能遗漏',
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

    const options: SearchOptions = {}

    if (args['topK'] !== undefined) {
      const topK = Number(args['topK'])
      if (!Number.isNaN(topK) && topK >= 1 && topK <= 20) {
        options.topK = Math.floor(topK)
      }
    }

    if (args['documentId'] !== undefined && typeof args['documentId'] === 'string') {
      options.documentId = args['documentId']
    }

    if (args['threshold'] !== undefined) {
      const threshold = Number(args['threshold'])
      if (!Number.isNaN(threshold) && threshold >= 0 && threshold <= 1) {
        options.threshold = threshold
      }
    }

    try {
      const results = await semanticSearch(query, options)
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
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `知识库搜索失败: ${message}`, {
        query,
        options,
      })
    }
  },
}
