// AgentForge: 项目级规则文件支持
// 自动读取工作区根目录下的 AGENTS.md，注入到 System Prompt

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getWorkspacePath } from '../ipc/workspace'

/** AGENTS.md 文件名 */
const RULES_FILENAME = 'AGENTS.md'

/** 最大文件大小：64KB */
const MAX_RULES_SIZE = 64 * 1024

/** 缓存的规则内容（按工作区路径缓存，预留后续增量刷新使用） */
const _cachedRules: { workspacePath: string; content: string; mtime: number } | null = null

/**
 * 读取工作区中的 AGENTS.md 规则文件。
 * 如果文件不存在或工作区未设置，返回空字符串。
 *
 * @returns AGENTS.md 文件内容，或空字符串
 */
export async function loadProjectRules(): Promise<string> {
  let workspacePath: string
  try {
    workspacePath = getWorkspacePath()
  } catch {
    // 工作区未设置，返回空
    return ''
  }

  const rulesPath = join(workspacePath, RULES_FILENAME)

  if (!existsSync(rulesPath)) {
    return ''
  }

  try {
    const content = await readFile(rulesPath, 'utf-8')

    // 大小限制
    if (content.length > MAX_RULES_SIZE) {
      return content.slice(0, MAX_RULES_SIZE) + '\n\n[... AGENTS.md truncated due to size limit ...]'
    }

    return content
  } catch {
    return ''
  }
}

/**
 * 将 AGENTS.md 内容格式化为 system prompt 段落。
 *
 * @param rules - AGENTS.md 原始内容
 * @returns 格式化后的 prompt 段落，如果 rules 为空则返回空字符串
 */
export function formatRulesPrompt(rules: string): string {
  if (!rules.trim()) return ''
  return `\n\n## 项目规则（AGENTS.md）\n\n请严格遵守以下项目规则：\n\n${rules}`
}

/**
 * 清除缓存的规则内容。
 * 在工作区切换或 AGENTS.md 修改时调用。
 */
export function clearRulesCache(): void {
  cachedRules = null
}
