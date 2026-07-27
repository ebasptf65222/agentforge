// AgentForge LLM Wiki - wiki-ingest 工具
// 将原始资料编译到 LLM Wiki 中。
// 工具职责：初始化 wiki 结构、复制 raw 源、返回内容和索引信息供 LLM 编译。
// LLM 的职责：使用 file_read/file_write 读取 raw 源，编写 wiki 页面，更新 index。

import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import { addRawSource, initWikiWorkspace, listRawSources, listWikiPages, readRawSource, regenerateIndex, updateIndex, appendLog, isWikiInitialized } from '../wiki/wiki-manager'

/** wiki_ingest 工具定义与执行函数 */
export const wikiIngestTool: BuiltinTool = {
  definition: {
    name: 'wiki_ingest',
    description: `初始化 LLM Wiki 结构并引入新的原始资料进行编译。

工作流：
1. 首次调用自动在工作区创建 .llm-wiki/ 目录结构（raw/ wiki/ rules/）
2. 将 source_path 指向的文件复制到 raw/ 目录（不可变副本）
3. 返回文件内容，你需要使用 file_read 读取原始资料，然后使用 file_write 在 wiki/ 下创建结构化页面

注意事项：
- raw/ 中的文件是只读的，不要修改
- wiki/ 下的页面由你（LLM）负责创建和维护
- 每次编译后必须更新 index.md（使用 regenerate_index 获取最新内容）
- 每次编译后必须追加日志到 log.md`,
    inputSchema: {
      type: 'object',
      properties: {
        source_path: {
          type: 'string',
          description: '要编译的源文件绝对路径（支持 .md, .txt, .pdf, .docx, .xlsx, .csv）',
        },
        action: {
          type: 'string',
          enum: ['init', 'ingest', 'list_raw', 'list_wiki', 'regenerate_index'],
          description: '操作类型：init（初始化结构）、ingest（编译新资料）、list_raw（列出 raw/ 内容）、list_wiki（列出 wiki/ 页面）、regenerate_index（重新生成 index.md）',
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
      switch (action) {
        case 'init': {
          await initWikiWorkspace()
          await appendLog('ingest', '初始化 LLM Wiki 工作区结构')
          return {
            isError: false,
            content: '✅ LLM Wiki 工作区已初始化。\n\n目录结构：\n.llm-wiki/\n├── raw/          ← 原始资料（不可变）\n├── wiki/         ← LLM 编译的知识页面\n├── rules/        ← 规则定义\n├── index.md      ← 内容目录\n├── log.md        ← 活动日志\n└── AGENTS.md     ← Schema 规则\n\n请使用 wiki-ingest action=ingest 添加原始资料开始编译。',
          }
        }

        case 'ingest': {
          const sourcePath = args['source_path']
          if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, 'source_path 必须为非空字符串', { sourcePath })
          }

          // 确保 wiki 已初始化
          if (!(await isWikiInitialized())) {
            await initWikiWorkspace()
          }

          // 复制源文件到 raw/
          const rawRelPath = await addRawSource(sourcePath)
          const fileName = rawRelPath.replace('raw/', '')

          // 读取内容供 LLM 处理
          const content = await readRawSource(fileName)

          // 获取现有 wiki 页面列表用于上下文
          const existingPages = await listWikiPages()
          const existingContext = existingPages.length > 0
            ? `\n\n现有 wiki 页面（${existingPages.length} 个）：\n${existingPages.map((p) => `  - ${p.title} (${p.path})`).join('\n')}`
            : '\n\nWiki 目前为空，这是第一个源文件。'

          await appendLog('ingest', `导入新资料: ${fileName} (${content.length} 字符)`)

          return {
            isError: false,
            content: `✅ 资料已导入 raw/ 目录：\n\n文件: ${fileName}\n大小: ${content.length} 字符\n位置: ${rawRelPath}\n\n---\n\n文件内容如下：\n\n\`\`\`\n${content.slice(0, 8000)}${content.length > 8000 ? `\n\n... (内容过长，截断至 8000 字符，共 ${content.length} 字符)` : ''}\n\`\`\`\n\n请执行以下操作：\n1. 读取此文件内容${content.length > 8000 ? '（使用 file_read 读取完整文件）' : ''}\n2. 分析关键信息（实体、概念、数据）\n3. 在 wiki/ 下创建或更新相关页面\n4. 更新 index.md（使用 wiki_ingest action=regenerate_index 获取最新内容）\n5. 追加日志到 log.md${existingContext}`,
          }
        }

        case 'list_raw': {
          const files = await listRawSources()
          if (files.length === 0) {
            return {
              isError: false,
              content: 'raw/ 目录为空。请使用 wiki_ingest action=ingest 添加原始资料。',
            }
          }
          return {
            isError: false,
            content: `raw/ 目录中的原始资料（${files.length} 个）：\n${files.map((f) => `  - ${f}`).join('\n')}`,
          }
        }

        case 'list_wiki': {
          const pages = await listWikiPages()
          if (pages.length === 0) {
            return {
              isError: false,
              content: 'wiki/ 目录为空。请使用 wiki_ingest action=ingest 添加并编译原始资料。',
            }
          }
          return {
            isError: false,
            content: `wiki/ 编译页面（${pages.length} 个）：\n\n${pages.map((p) => `  - **${p.title}** (${p.path})\n    ${p.summary ? `摘要：${p.summary}` : ''}`).join('\n\n')}`,
          }
        }

        case 'regenerate_index': {
          const indexContent = await regenerateIndex()
          return {
            isError: false,
            content: `以下是重新生成的 index.md 内容。请使用 file_write 将其写入 .llm-wiki/index.md：\n\n\`\`\`markdown\n${indexContent}\n\`\`\``,
            metadata: { indexContent },
          }
        }

        default:
          throw new AppError(ErrorCodes.VALIDATION_ERROR, `未知操作: ${action}`, { action })
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `Wiki ingest 失败: ${message}`, { action })
    }
  },
}