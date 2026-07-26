// AgentForge KG-02: 知识图谱提取工具
// 将结构化实体和关系数据存入知识图谱

import type { BuiltinTool } from './types'
import { AppError, ErrorCodes } from '../utils/error'
import { batchCreateKgEntities } from '../db/repos/kg-entity'
import { batchCreateKgRelations } from '../db/repos/kg-relation'
import type { CreateKgEntityParams, CreateKgRelationParams } from '../db/repos/kg-entity'

interface KgExtractEntity {
  name: string
  type: string
  description?: string
}

interface KgExtractRelation {
  source: string
  target: string
  relation: string
  description?: string
}

function validateEntities(entities: unknown[]): KgExtractEntity[] {
  const result: KgExtractEntity[] = []
  for (const e of entities) {
    if (typeof e !== 'object' || e === null) continue
    const obj = e as Record<string, unknown>
    const name = obj['name']
    const type = obj['type']
    if (typeof name !== 'string' || name.trim() === '') continue
    if (typeof type !== 'string' || type.trim() === '') continue
    result.push({
      name: name.trim(),
      type: type.trim(),
      description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
    })
  }
  return result
}

function validateRelations(relations: unknown[]): KgExtractRelation[] {
  const result: KgExtractRelation[] = []
  for (const r of relations) {
    if (typeof r !== 'object' || r === null) continue
    const obj = r as Record<string, unknown>
    const source = obj['source']
    const target = obj['target']
    const relation = obj['relation']
    if (typeof source !== 'string' || source.trim() === '') continue
    if (typeof target !== 'string' || target.trim() === '') continue
    if (typeof relation !== 'string' || relation.trim() === '') continue
    result.push({
      source: source.trim(),
      target: target.trim(),
      relation: relation.trim(),
      description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
    })
  }
  return result
}

/** kg_extract 工具定义与执行函数 */
export const kgExtractTool: BuiltinTool = {
  definition: {
    name: 'kg_extract',
    description:
      '从结构化数据中提取实体和关系，存入知识图谱数据库。用于构建和扩展知识图谱。当用户要求分析文档、提取知识点、构建知识网络时使用此工具。',
    inputSchema: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          description: '实体列表，每个实体包含 name（名称）和 type（类型），可选 description（描述）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '实体名称' },
              type: { type: 'string', description: '实体类型，如：人物、组织、地点、概念、技术、产品' },
              description: { type: 'string', description: '实体描述' },
            },
            required: ['name', 'type'],
          },
        },
        relations: {
          type: 'array',
          description: '关系列表，每个关系包含 source（源实体名称）、target（目标实体名称）、relation（关系类型）',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '源实体名称' },
              target: { type: 'string', description: '目标实体名称' },
              relation: { type: 'string', description: '关系类型，如：属于、创立、位于、使用、包含、合作' },
              description: { type: 'string', description: '关系描述' },
            },
            required: ['source', 'target', 'relation'],
          },
        },
        sourceDocId: {
          type: 'string',
          description: '可选：来源文档 ID，用于追溯数据来源',
        },
      },
      required: ['entities', 'relations'],
    },
    riskLevel: 'low',
    source: 'builtin',
  },
  async execute(args: Record<string, unknown>) {
    const rawEntities = args['entities']
    const rawRelations = args['relations']
    const sourceDocId = typeof args['sourceDocId'] === 'string' ? args['sourceDocId'] : undefined

    if (!Array.isArray(rawEntities) || !Array.isArray(rawRelations)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'entities 和 relations 必须为数组',
        { entities: rawEntities, relations: rawRelations },
      )
    }

    const entities = validateEntities(rawEntities)
    const relations = validateRelations(rawRelations)

    if (entities.length === 0) {
      return {
        isError: false,
        content: '未提供有效实体，知识图谱未更新。',
        metadata: { entityCount: 0, relationCount: 0 },
      }
    }

    try {
      // 1. 批量创建实体
      const entityParams: CreateKgEntityParams[] = entities.map((e) => ({
        name: e.name,
        type: e.type,
        description: e.description,
        sourceDocId,
      }))
      const createdEntities = batchCreateKgEntities(entityParams)

      // 2. 构建名称到 ID 的映射
      const nameToId = new Map<string, string>()
      for (const entity of createdEntities) {
        nameToId.set(entity.name, entity.id)
      }

      // 3. 批量创建关系（只创建能找到对应实体 ID 的）
      const relationParams: CreateKgRelationParams[] = []
      for (const r of relations) {
        const sourceId = nameToId.get(r.source)
        const targetId = nameToId.get(r.target)
        if (sourceId && targetId) {
          relationParams.push({
            sourceId,
            targetId,
            relation: r.relation,
            description: r.description,
            sourceDocId,
          })
        }
      }
      const createdRelations = batchCreateKgRelations(relationParams)

      const content = [
        `成功提取并存储知识图谱数据：`,
        `- 实体数量: ${createdEntities.length}`,
        `- 关系数量: ${createdRelations.length}`,
        `- 实体列表: ${createdEntities.map((e) => `${e.name}(${e.type})`).join(', ')}`,
        createdRelations.length > 0
          ? `- 关系列表: ${createdRelations.map((r) => `${r.sourceId} -[${r.relation}]-> ${r.targetId}`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')

      return {
        isError: false,
        content,
        metadata: {
          entityCount: createdEntities.length,
          relationCount: createdRelations.length,
          entities: createdEntities.map((e) => ({ id: e.id, name: e.name, type: e.type })),
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `知识图谱提取失败: ${message}`, {
        entityCount: entities.length,
        relationCount: relations.length,
      })
    }
  },
}
