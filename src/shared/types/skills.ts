// AgentForge 共享类型定义 - Skills 类型
// 与 Spec v0.2 §5.6 一致

import type { SkillTrigger } from './enums'

// ─── 5.6 Skills 类型 ──────────────────────────────────────────────

/** Skill 定义 */
export interface Skill {
  id: string
  name: string
  displayName: string
  description: string
  prompt: string
  modelId?: string
  allowedTools: string[]
  trigger: SkillTrigger
  variables: SkillVariable[]
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

/** Skill 变量定义 */
export interface SkillVariable {
  name: string
  description: string
  required: boolean
  defaultValue?: string
}

/** Skill 意图匹配结果 */
export interface SkillMatchResult {
  matched: boolean
  skillName: string | null
  confidence: number
  reason: string
}

// ─── 5.6.1 Prompt 模板库类型 (PT-01) ────────────────────────────

/** Prompt 模板 */
export interface PromptTemplate {
  id: string
  title: string
  content: string
  category: string
  /** 变量名列表（用于 {{变量名}} 插值） */
  variables: string[]
  createdAt: number
  updatedAt: number
}
