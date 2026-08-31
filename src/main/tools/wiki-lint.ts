// AgentForge LLM Wiki - wiki-lint 工具
// 对 LLM Wiki 进行健康检查，发现矛盾、孤立页面、缺失引用等问题。
// 实际检查由 LLM 完成，工具提供扫描基础数据和上下文。

import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import { isWikiInitialized, listWikiPages, listRawSources, getWikiPath } from '../wiki/wiki-manager'

/** wiki_lint 工具定义与执行函数 */
export const wikiLintTool: BuiltinTool = {
  definition: {
    name: 'wiki_lint',
    description: `对 LLM Wiki 进行健康检查，发现并报告以下问题：

1. 页面间的矛盾信息
2. 被新资料推翻的陈旧说法
3. 没有任何入链的孤立页面
4. 被提及但缺少独立页面的重要概念
5. 缺失的交叉引用
6. 可通过网络搜索填补的信息空白

工作流：
1. 使用 action=scan 获取所有页面列表和原始资料列表
2. 逐页检查内容一致性
3. 使用 action=report 查看当前已知问题
4. 修复后使用 action=update_status 标记已修复

支持的操作：
- scan: 扫描 wiki 状态，返回页面列表和原始资料信息
- report: 返回当前已知问题列表
- status: 快速查看 wiki 健康概览`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['scan', 'report', 'status'],
          description: '操作类型：scan（扫描页面和原始资料）、report（查看问题报告）、status（健康概览）',
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
      const initialized = await isWikiInitialized()
      if (!initialized) {
        return {
          isError: false,
          content: `LLM Wiki 尚未初始化（Wiki 根目录：${getWikiPath()}）。请先使用 wiki_ingest action=init 初始化；如果该目录不存在，请提示用户检查应用当前选择的工作区是否正确。`,
        }
      }

      switch (action) {
        case 'scan': {
          const pages = await listWikiPages()
          const rawSources = await listRawSources()

          // 构建扫描上下文
          const pageList = pages.map((p) => `  - ${p.title} (${p.path})${p.summary ? `: ${p.summary}` : ''}`).join('\n')

          return {
            isError: false,
            content: `🔍 Wiki 扫描结果\n\n原始资料（${rawSources.length} 个）：\n${rawSources.map((f) => `  - raw/${f}`).join('\n') || '  （无）'}\n\n编译页面（${pages.length} 个）：\n${pageList || '  （无）'}\n\n---\n\n请逐页检查以下问题：\n1. 页面间的矛盾信息\n2. 被新资料推翻的陈旧说法\n3. 没有任何入链的孤立页面（使用 wiki_query action=index 查看 index.md 中的链接）\n4. 被提及但缺少独立页面的重要概念\n5. 缺失的交叉引用\n6. 可通过网络搜索填补的信息空白\n\n使用 wiki_query action=page page_path="..." 读取具体页面内容进行检查。`,
            metadata: { pageCount: pages.length, rawCount: rawSources.length },
          }
        }

        case 'report': {
          return {
            isError: false,
            content: '📋 Wiki 问题报告\n\n请先使用 wiki_lint action=scan 获取完整扫描上下文，然后逐页阅读内容进行人工检查。\n\n检查清单：\n- [ ] 页面间是否存在矛盾？\n- [ ] 是否有陈旧信息需要更新？\n- [ ] 是否有孤立页面（无入链）？\n- [ ] 是否有重要概念缺少独立页面？\n- [ ] 是否有缺失的交叉引用？\n- [ ] 是否有信息空白需要补充？\n\n修复建议：\n1. 矛盾信息 > 使用 [!warning] 标注\n2. 陈旧信息 > 更新或添加时间戳\n3. 孤立页面 > 在相关页面添加 [[双向链接]]\n4. 缺失页面 > 创建新页面\n5. 交叉引用 > 补充 [[链接]]\n6. 信息空白 > 使用 web_search 补充',
          }
        }

        case 'status': {
          const pages = await listWikiPages()
          const rawSources = await listRawSources()

          return {
            isError: false,
            content: `📊 LLM Wiki 健康概览\n\n✅ 基础结构：已初始化\n📄 编译页面：${pages.length} 个\n📁 原始资料：${rawSources.length} 个\n\n上次检查提醒：\n- 请使用 wiki_lint action=scan 进行完整扫描\n- 请使用 wiki_lint action=report 查看问题清单\n\n最佳实践：\n- 建议每编译 5 个新源文件后做一次 lint\n- 每次 lint 后记录发现的问题和修复方案`,
            metadata: { pageCount: pages.length, rawCount: rawSources.length, health: 'ok' },
          }
        }

        default:
          throw new AppError(ErrorCodes.VALIDATION_ERROR, `未知操作: ${action}`, { action })
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `Wiki lint 失败: ${message}`, { action })
    }
  },
}