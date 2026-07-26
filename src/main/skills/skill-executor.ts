// AgentForge P3-04: Skill 执行集成
// 将 Skill 意图匹配引擎集成到 Agent 执行流程
//
// 职责：
// 1. resolveSkill() - 根据 skillName 或意图匹配解析 Skill
// 2. substituteVariables() - 替换 Skill prompt 中的 {{variable}} 占位符
// 3. filterTools() - 根据 Skill 的 allowedTools 过滤可用工具
// 4. buildSkillPromptSection() - 构建注入 System Prompt 的 Skill 段落

import type { Skill, SkillVariable } from '@shared/types'
import type { ModelAdapter } from '../models/adapter'
import type { RegisteredTool } from '../agent/types'
import type { ToolDefinition } from '@shared/types'
import { getSkillByName } from '../db/repos/skill'
import { matchSkill } from './matcher'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 类型定义 ─────────────────────────────────────────────────────

/**
 * Skill 解析结果。
 * 包含 Skill 实体和解析来源信息。
 */
export interface SkillResolution {
  /** 解析到的 Skill（null 表示未匹配到 Skill） */
  skill: Skill | null
  /** 解析来源：manual（用户指定）| auto（意图匹配）| none（未匹配） */
  source: 'manual' | 'auto' | 'none'
  /** 意图匹配置信度（仅 source='auto' 时有意义） */
  confidence?: number
  /** 解析原因说明 */
  reason: string
}

/**
 * Skill 执行上下文。
 * 包含执行 Skill 所需的全部信息。
 */
export interface SkillExecutionContext {
  /** 替换变量后的 Skill prompt */
  skillPrompt: string
  /** 过滤后的工具定义列表 */
  filteredTools: ToolDefinition[]
  /** Skill 指定的模型 ID（覆盖默认模型） */
  modelId?: string
  /** Skill 显示名称（用于日志/轨迹） */
  skillDisplayName: string
}

// ─── 变量替换 ─────────────────────────────────────────────────────

/**
 * 替换 Skill prompt 中的 {{variable_name}} 占位符。
 *
 * 替换规则：
 * 1. 优先使用 values 中提供的值
 * 2. 其次使用变量的 defaultValue
 * 3. 必填变量无值且无默认值时抛出 SKILL_VARIABLE_REQUIRED
 * 4. 非必填变量无值时替换为空字符串
 *
 * @param prompt - 原始 Skill prompt（含 {{variable}} 占位符）
 * @param variables - Skill 定义的变量列表
 * @param values - 用户提供的变量值映射（可选）
 * @returns 替换后的 prompt
 * @throws {AppError} SKILL_VARIABLE_MISSING - 必填变量缺失且无默认值
 */
export function substituteVariables(
  prompt: string,
  variables: SkillVariable[],
  values?: Record<string, string>,
): string {
  const valueMap = values ?? {}

  let result = prompt

  for (const variable of variables) {
    const placeholder = `{{${variable.name}}}`

    // 1. 使用显式提供的值
    const explicitValue = valueMap[variable.name]
    if (explicitValue !== undefined && explicitValue !== '') {
      result = result.split(placeholder).join(explicitValue)
      continue
    }

    // 2. 使用默认值
    if (variable.defaultValue !== undefined && variable.defaultValue !== '') {
      result = result.split(placeholder).join(variable.defaultValue)
      continue
    }

    // 3. 必填变量无值
    if (variable.required) {
      throw new AppError(
        ErrorCodes.SKILL_VARIABLE_MISSING,
        `Required variable "${variable.name}" has no value and no default.`,
        { variable: variable.name },
      )
    }

    // 4. 非必填变量替换为空字符串
    result = result.split(placeholder).join('')
  }

  return result
}

// ─── 工具过滤 ─────────────────────────────────────────────────────

/**
 * 根据Skill 的 allowedTools 过滤可用工具。
 *
 * 过滤规则：
 * - allowedTools 为空数组 → 不限制（返回所有工具）
 * - allowedTools 非空 → 仅返回 allowedTools 中列出的工具
 *
 * @param tools - 完整工具映射
 * @param allowedTools - Skill 允许的工具名列表
 * @returns 过滤后的工具映射
 */
export function filterTools(
  tools: Map<string, RegisteredTool>,
  allowedTools: string[],
): Map<string, RegisteredTool> {
  // allowedTools 为空表示不限制
  if (allowedTools.length === 0) {
    return new Map(tools)
  }

  const filtered = new Map<string, RegisteredTool>()
  for (const name of allowedTools) {
    const tool = tools.get(name)
    if (tool !== undefined) {
      filtered.set(name, tool)
    }
  }
  return filtered
}

// ─── Skill Prompt 构建 ───────────────────────────────────────────

/**
 * 构建 Skill prompt 段落，注入到 Agent System Prompt 末尾。
 *
 * @param skill - Skill 实体
 * @param substitutedPrompt - 变量替换后的 prompt
 * @returns 格式化的 Skill prompt 段落
 */
export function buildSkillPromptSection(skill: Skill, substitutedPrompt: string): string {
  return `---

## Skill: ${skill.displayName}

${substitutedPrompt}`
}

// ─── Skill 解析 ──────────────────────────────────────────────────

/**
 * 解析 Skill。
 *
 * 流程：
 * 1. 如果 skillName 提供 → 直接从 DB 加载（manual 模式）
 * 2. 如果 skillName 未提供 → 调用 matchSkill 进行意图匹配（auto 模式）
 * 3. 匹配失败或无 auto Skill → 返回 none
 *
 * @param userInput - 用户输入消息
 * @param skillName - 可选的 Skill 名称（用户指定）
 * @param adapter - 模型适配器（用于意图匹配）
 * @param abortSignal - 可选的中断信号
 * @returns SkillResolution
 */
export async function resolveSkill(
  userInput: string,
  skillName: string | undefined,
  adapter: ModelAdapter,
  abortSignal?: AbortSignal,
): Promise<SkillResolution> {
  // 1. 用户指定了 Skill（manual 模式）
  if (skillName !== undefined && skillName.trim() !== '') {
    const skill = getSkillByName(skillName)

    if (skill === undefined) {
      throw new AppError(ErrorCodes.SKILL_NOT_FOUND, `Skill "${skillName}" not found.`, {
        skillName,
      })
    }

    return {
      skill,
      source: 'manual',
      reason: `Skill "${skillName}" manually selected.`,
    }
  }

  // 2. 意图匹配（auto 模式）
  const matchResult = await matchSkill(userInput, { adapter, abortSignal })

  if (!matchResult.matched || matchResult.skillName === null) {
    return {
      skill: null,
      source: 'none',
      reason: matchResult.reason,
    }
  }

  // 从 DB 加载匹配到的 Skill
  const skill = getSkillByName(matchResult.skillName)

  if (skill === undefined) {
    // 匹配到了但 DB 中找不到（理论上不应发生）
    return {
      skill: null,
      source: 'none',
      reason: `Matched skill "${matchResult.skillName}" not found in database.`,
    }
  }

  return {
    skill,
    source: 'auto',
    confidence: matchResult.confidence,
    reason: matchResult.reason,
  }
}

// ─── Skill 执行上下文构建 ────────────────────────────────────────

/**
 * 构建 Skill 执行上下文。
 *
 * 将 Skill 定义转换为 Agent 执行所需的上下文：
 * 1. 替换 prompt 中的变量占位符
 * 2. 构建 Skill prompt 段落
 * 3. 过滤工具列表
 *
 * @param skill - Skill 实体
 * @param tools - 完整工具映射
 * @param variableValues - 可选的变量值映射
 * @returns SkillExecutionContext
 * @throws {AppError} SKILL_VARIABLE_MISSING - 必填变量缺失
 */
export function buildSkillExecutionContext(
  skill: Skill,
  tools: Map<string, RegisteredTool>,
  variableValues?: Record<string, string>,
): SkillExecutionContext {
  // 1. 替换变量
  const substitutedPrompt = substituteVariables(skill.prompt, skill.variables, variableValues)

  // 2. 构建 Skill prompt 段落
  const skillPrompt = buildSkillPromptSection(skill, substitutedPrompt)

  // 3. 过滤工具
  const filteredToolMap = filterTools(tools, skill.allowedTools)
  const filteredTools = Array.from(filteredToolMap.values()).map((t) => t.definition)

  return {
    skillPrompt,
    filteredTools,
    modelId: skill.modelId,
    skillDisplayName: skill.displayName,
  }
}
