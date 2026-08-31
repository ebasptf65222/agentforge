// AgentForge LLM Wiki - wiki-query 工具
// 从 LLM Wiki 中查询已编译的知识。
// 返回 index.md 和相关页面内容，供 LLM 综合回答。

import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import { isWikiInitialized, readIndex, readWikiPage, listWikiPages, listRawSources, getWikiPath } from '../wiki/wiki-manager'

/** wiki_query 工具定义与执行函数 */
export const wikiQueryTool: BuiltinTool = {
  definition: {
    name: 'wiki_query',
    description: `从 LLM Wiki 中查询已编译的知识。
LLM Wiki 是一个由 AI 持续维护的结构化 Markdown 知识库，包含实体页面、概念页面、源摘要和交叉引用。

与 kb_search 的区别：
- kb_search 使用向量检索在原始文档片段中搜索
- wiki_query 直接读取已编译的结构化知识页面

工作流：
1. 先使用 action=index 获取 index.md 了解全貌
2. 再使用 action=page 读取具体页面获取详细信息
3. 综合回答，引用 [[页面链接]]

支持的操作：
- index: 获取 wiki 内容目录（index.md）
- page: 读取 wiki/ 下的具体页面
- search: 全文搜索 wiki 页面内容
- status: 查看 wiki 当前状态`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['index', 'page', 'search', 'status'],
          description: '操作类型：index（获取目录）、page（读取页面内容）、search（搜索页面）、status（查看 Wiki 状态）',
        },
        page_path: {
          type: 'string',
          description: '页面路径（相对于 wiki/ 目录，如 "entities/karpathy.md"），用于 action=page 时指定',
        },
        query: {
          type: 'string',
          description: '搜索关键词，用于 action=search 时指定',
        },
      },
      required: ['action'],
    },
    riskLevel: 'low',
    source: 'builtin',
  } satisfies BuiltinTool['definition'],
  async execute(args: Record<string, unknown>) {
    const action = args['action']
    if (typeof action !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'action 必须为字符串', { action })
    }

    try {
      // 检查 wiki 是否已初始化
      const initialized = await isWikiInitialized()
      const wikiRoot = getWikiPath()

      switch (action) {
        case 'index': {
          if (!initialized) {
            return {
              isError: false,
              content: `LLM Wiki 尚未初始化（Wiki 根目录：${wikiRoot}）。请先使用 wiki_ingest action=init 初始化；如果该目录不存在，请提示用户检查应用当前选择的工作区是否正确。`,
            }
          }
          const indexContent = await readIndex()
          return {
            isError: false,
            content: `📖 LLM Wiki 内容目录（index.md）：\n\n${indexContent}`,
          }
        }

        case 'page': {
          if (!initialized) {
            return {
              isError: false,
              content: `LLM Wiki 尚未初始化（Wiki 根目录：${wikiRoot}）。请先使用 wiki_ingest action=init 初始化；如果该目录不存在，请提示用户检查应用当前选择的工作区是否正确。`,
            }
          }

          const pagePath = args['page_path']
          if (typeof pagePath !== 'string' || pagePath.trim() === '') {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, 'page_path 必须为非空字符串', { pagePath })
          }

          const content = await readWikiPage(pagePath)
          return {
            isError: false,
            content: `📄 Wiki 页面: ${pagePath}\n\n${content}`,
            metadata: { pagePath, length: content.length },
          }
        }

        case 'search': {
          if (!initialized) {
            return {
              isError: false,
              content: `LLM Wiki 尚未初始化（Wiki 根目录：${wikiRoot}）。请先使用 wiki_ingest action=init 初始化；如果该目录不存在，请提示用户检查应用当前选择的工作区是否正确。`,
            }
          }

          const query = args['query']
          if (typeof query !== 'string' || query.trim() === '') {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, 'query 必须为非空字符串', { query })
          }

          const pages = await listWikiPages()
          const queryLower = query.toLowerCase()

          // 简单全文搜索（标题 + 摘要 + 文件路径）
          const matches = pages.filter((p) => {
            const title = p.title.toLowerCase()
            const summary = p.summary.toLowerCase()
            const path = p.path.toLowerCase()
            return title.includes(queryLower) || summary.includes(queryLower) || path.includes(queryLower)
          })

          if (matches.length === 0) {
            return {
              isError: false,
              content: `在 wiki 中未找到与 "${query}" 相关的页面。\n\n建议：\n1. 使用 wiki_query action=index 查看所有页面\n2. 使用 wiki_ingest action=ingest 添加更多原始资料\n3. 使用 kb_search 在原始文档中搜索`,
            }
          }

          return {
            isError: false,
            content: `🔍 在 wiki 中找到 ${matches.length} 个相关页面：\n\n${matches.map((p, i) => `${i + 1}. **${p.title}** (${p.path})\n   摘要：${p.summary || '（无摘要）'}\n   使用 wiki_query action=page page_path="${p.path}" 读取完整内容`).join('\n\n')}`,
            metadata: { query, matchCount: matches.length },
          }
        }

        case 'status': {
          if (!initialized) {
            return {
              isError: false,
              content: `LLM Wiki 尚未初始化（Wiki 根目录：${wikiRoot}）。请使用 wiki_ingest action=init 初始化。\n\n如果该目录不存在，请提示用户检查应用当前选择的工作区是否正确——Wiki 绑定工作区，切换工作区后 Wiki 会随之变化。\n\n初始化后，你将获得一个三层知识库结构：\n- raw/ ← 原始资料（不可变）\n- wiki/ ← LLM 编译的知识页面\n- rules/ ← 规则定义`,
            }
          }

          const pages = await listWikiPages()
          const rawSources = await listRawSources()

          return {
            isError: false,
            content: `📊 LLM Wiki 状态\n\n- 原始资料（raw/）: ${rawSources.length} 个\n- 编译页面（wiki/）: ${pages.length} 个\n- 内容目录已就绪\n\n使用方法：\n1. wiki_query action=index — 查看完整目录\n2. wiki_query action=page page_path="path/to/page.md" — 读取具体页面\n3. wiki_ingest action=ingest source_path="..." — 添加新资料`,
            metadata: { pageCount: pages.length, rawCount: rawSources.length },
          }
        }

        default:
          throw new AppError(ErrorCodes.VALIDATION_ERROR, `未知操作: ${action}`, { action })
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `Wiki query 失败: ${message}`, { action })
    }
  },
}