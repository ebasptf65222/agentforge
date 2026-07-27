// AgentForge 共享 JSON 提取工具
// 从 LLM 输出中提取 JSON，支持多种格式：
// - 直接 JSON: {"type": "tool", ...}
// - 代码块包裹: ```json\n{...}\n```
// - 花括号提取: 找到第一个 { 和最后一个 } 之间的内容

/**
 * 从文本中提取 JSON 对象。
 * 按优先级尝试：直接解析 → 代码块提取 → 花括号提取。
 *
 * @param text - 可能包含 JSON 的文本
 * @returns 解析后的对象，解析失败返回 null
 */
export function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()

  // 尝试直接解析
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // continue
  }

  // 尝试从代码块中提取
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>
    } catch {
      // continue
    }
  }

  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>
    } catch {
      // continue
    }
  }

  return null
}