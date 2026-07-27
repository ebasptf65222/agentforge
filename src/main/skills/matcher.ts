// AgentForge P3-03: Skill 意图匹配引擎
// 与 Spec v0.2 §11.3 一致
//
// 流程：
// 1. 获取所有 trigger='auto' 的 Skill
// 2. 将各 Skill 的 name + description 拼接为选项列表
// 3. 使用当前会话配置的模型调用 LLM，返回 SkillMatchResult
// 4. 解析 LLM 返回的 JSON，提取 confidence
// 5. confidence >= 0.6 才视为匹配
// 6. LLM 返回无法解析的 JSON → 视为不匹配（不报错）

import type { Skill, SkillMatchResult } from '@shared/types'
import type { AdapterMessage } from '../models/adapter'
import type { ModelAdapter } from '../models/adapter'
import { listAutoTriggerSkills } from '../db/repos/skill'
import { extractJson } from '../utils/json-extract'

/** 置信度阈值：低于此值不视为匹配 */
export const CONFIDENCE_THRESHOLD = 0.6

/** 不匹配时的默认结果 */
const NO_MATCH: SkillMatchResult = {
  matched: false,
  skillName: null,
  confidence: 0,
  reason: 'No matching skill found.',
}

/**
 * 构建意图匹配的 prompt。
 * 与 Spec v0.2 §11.3 模板一致。
 */
function buildMatchPrompt(userMessage: string, skills: Skill[]): string {
  const skillList = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')

  return `用户消息: "${userMessage}"

可选 Skill:
${skillList}

请判断用户意图匹配哪个 Skill。返回 JSON:
{"matched": true/false, "skillName": "skill名或null", "confidence": 0-1, "reason": "判断理由"}`
}

/**
 * 解析 LLM 返回的匹配结果。
 * 无法解析时返回 null（不报错）。
 */
function parseMatchResult(llmOutput: string, skills: Skill[]): SkillMatchResult | null {
  const json = extractJson(llmOutput)
  if (json === null) {
    return null
  }

  const matched = json['matched']
  const skillName = json['skillName']
  const confidence = json['confidence']
  const reason = json['reason']

  // 验证字段类型
  if (typeof matched !== 'boolean') return null
  if (typeof confidence !== 'number') return null

  const reasonStr = typeof reason === 'string' ? reason : ''

  // 不匹配
  if (!matched) {
    return {
      matched: false,
      skillName: null,
      confidence,
      reason: reasonStr,
    }
  }

  // 匹配但 skillName 为空或无效
  if (typeof skillName !== 'string' || skillName.trim() === '') {
    return {
      matched: false,
      skillName: null,
      confidence,
      reason: 'Matched but no skill name provided.',
    }
  }

  // 验证 skillName 是否在可选列表中
  const skillExists = skills.some((s) => s.name === skillName)
  if (!skillExists) {
    return {
      matched: false,
      skillName: null,
      confidence,
      reason: `Skill "${skillName}" not found in available skills.`,
    }
  }

  return {
    matched: true,
    skillName,
    confidence,
    reason: reasonStr,
  }
}

/**
 * 收集 ModelAdapter 流式输出的所有 chunk，拼接为完整文本。
 */
async function collectStream(
  adapter: ModelAdapter,
  messages: AdapterMessage[],
  abortSignal?: AbortSignal,
): Promise<string> {
  let fullText = ''
  for await (const chunk of adapter.streamChat(messages, abortSignal)) {
    if (chunk.type === 'text') {
      fullText += chunk.content
    }
  }
  return fullText
}

/**
 * 匹配选项接口。
 * 用于依赖注入，便于测试。
 */
export interface SkillMatcherOptions {
  /** 模型适配器（用于调用 LLM） */
  adapter: ModelAdapter
  /** 可选的 AbortSignal */
  abortSignal?: AbortSignal
  /** 可选：自定义 skills 列表（默认从 DB 查询 auto 触发的） */
  skills?: Skill[]
}

/**
 * 执行 Skill 意图匹配。
 *
 * @param userMessage - 用户消息
 * @param options - 匹配选项
 * @returns SkillMatchResult
 */
export async function matchSkill(
  userMessage: string,
  options: SkillMatcherOptions,
): Promise<SkillMatchResult> {
  // 获取可选 Skill（trigger='auto'）
  const skills = options.skills ?? listAutoTriggerSkills()

  // 没有 auto 触发的 Skill，直接返回不匹配
  if (skills.length === 0) {
    return {
      matched: false,
      skillName: null,
      confidence: 0,
      reason: 'No auto-trigger skills available.',
    }
  }

  // 构建匹配 prompt
  const prompt = buildMatchPrompt(userMessage, skills)

  const messages: AdapterMessage[] = [
    {
      role: 'system',
      content:
        '你是一个意图分类器。根据用户消息判断应该使用哪个 Skill。只返回 JSON，不要额外解释。',
    },
    { role: 'user', content: prompt },
  ]

  // 调用 LLM
  let llmOutput: string
  try {
    llmOutput = await collectStream(options.adapter, messages, options.abortSignal)
  } catch {
    // LLM 调用失败，视为不匹配（不报错）
    return {
      matched: false,
      skillName: null,
      confidence: 0,
      reason: 'LLM call failed during intent matching.',
    }
  }

  // 解析 LLM 输出
  const result = parseMatchResult(llmOutput, skills)

  if (result === null) {
    // 无法解析 JSON，视为不匹配（Spec §11.3: 不报错）
    return { ...NO_MATCH, reason: 'Failed to parse LLM response.' }
  }

  // 应用置信度阈值
  if (result.matched && result.confidence < CONFIDENCE_THRESHOLD) {
    return {
      matched: false,
      skillName: null,
      confidence: result.confidence,
      reason: `Confidence ${result.confidence} below threshold ${CONFIDENCE_THRESHOLD}.`,
    }
  }

  return result
}

// ─── 导出辅助函数（仅供测试） ───────────────────────────────────

export { buildMatchPrompt, parseMatchResult, extractJson }
