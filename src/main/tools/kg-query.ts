// AgentForge KG-03: 知识图谱查询工具
// 查询知识图谱中的实体、关系及关联网络

import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import { searchKgEntitiesByName, listKgEntitiesByType } from '../db/repos/kg-entity'
import { getKgRelationsByEntity } from '../db/repos/kg-relation'

/** kg_query 工具定义与执行函数 */
export const kgQueryTool: BuiltinTool = {
  definition: {
    name: 'kg_query',
    description:
      '查询本地知识图谱数据库，检索实体、关系及关联网络。当用户询问特定人物、组织、概念之间的关联，或需要基于已构建的知识网络回答问题时使用此工具。',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: {
          type: 'string',
          description: '按名称搜索实体（支持模糊匹配）',
        },
        entityType: {
          type: 'string',
          description: '按类型过滤实体，如：人物、组织、地点、概念、技术、产品',
        },
        relation: {
          type: 'string',
          description: '按关系类型查询，如：属于、创立、位于、使用、包含、合作',
        },
        depth: {
          type: 'number',
          description: '关联查询深度（1-3，默认 1）。1 表示直接关联，2 表示二级关联',
          minimum: 1,
          maximum: 3,
        },
      },
    },
    riskLevel: 'low',
    source: 'builtin',
  },
  async execute(args: Record<string, unknown>) {
    const entityName = typeof args['entityName'] === 'string' ? args['entityName'].trim() : undefined
    const entityType = typeof args['entityType'] === 'string' ? args['entityType'].trim() : undefined
    const relation = typeof args['relation'] === 'string' ? args['relation'].trim() : undefined
    const depth =
      typeof args['depth'] === 'number' && args['depth'] >= 1 && args['depth'] <= 3
        ? Math.floor(args['depth'])
        : 1

    if (!entityName && !entityType && !relation) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        '必须提供 entityName、entityType 或 relation 中的至少一个查询条件',
        { args },
      )
    }

    try {
      const resultLines: string[] = []
      const visitedEntityIds = new Set<string>()
      const visitedRelationIds = new Set<string>()

      // 1. 查询实体
      let entities =
        entityName ? searchKgEntitiesByName(entityName) : entityType ? listKgEntitiesByType(entityType) : []

      if (entityName && entityType) {
        // 同时指定了 name 和 type，做交集过滤
        entities = entities.filter((e) => e.type === entityType)
      }

      if (entities.length === 0 && !relation) {
        return {
          isError: false,
          content: '未找到匹配的知识图谱实体。',
          metadata: { entityCount: 0, relationCount: 0 },
        }
      }

      // 2. 收集关联关系
      const relations = new Map<
        string,
        { relation: string; source: string; target: string; description?: string }
      >()

      const queue: string[] = entities.map((e) => e.id)
      let currentDepth = 0

      while (queue.length > 0 && currentDepth < depth) {
        const levelSize = queue.length
        const nextQueue: string[] = []

        for (let i = 0; i < levelSize; i++) {
          const entityId = queue.shift()!
          if (visitedEntityIds.has(entityId)) continue
          visitedEntityIds.add(entityId)

          const entityRelations = getKgRelationsByEntity(entityId)
          for (const r of entityRelations) {
            if (visitedRelationIds.has(r.id)) continue
            visitedRelationIds.add(r.id)

            // 如果指定了 relation 类型，做过滤
            if (relation && r.relation !== relation) continue

            relations.set(r.id, {
              relation: r.relation,
              source: r.sourceId,
              target: r.targetId,
              description: r.description,
            })

            // 将未访问的关联实体加入下一层队列
            const otherId = r.sourceId === entityId ? r.targetId : r.sourceId
            if (!visitedEntityIds.has(otherId)) {
              nextQueue.push(otherId)
            }
          }
        }

        queue.push(...nextQueue)
        currentDepth++
      }

      // 3. 格式化输出
      if (entities.length > 0) {
        resultLines.push(`找到 ${entities.length} 个实体：`)
        for (const e of entities) {
          resultLines.push(`\n--- 实体: ${e.name} ---`)
          resultLines.push(`类型: ${e.type}`)
          if (e.description) resultLines.push(`描述: ${e.description}`)
        }
      }

      if (relations.size > 0) {
        resultLines.push(`\n找到 ${relations.size} 条关系：`)
        for (const [, r] of relations) {
          let line = `- ${r.source} --[${r.relation}]--> ${r.target}`
          if (r.description) line += ` (${r.description})`
          resultLines.push(line)
        }
      } else if (entities.length > 0) {
        resultLines.push('\n未找到关联关系。')
      }

      return {
        isError: false,
        content: resultLines.join('\n'),
        metadata: {
          entityCount: entities.length,
          relationCount: relations.size,
          depth,
          entities: entities.map((e) => ({ id: e.id, name: e.name, type: e.type })),
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `知识图谱查询失败: ${message}`, { args })
    }
  },
}
