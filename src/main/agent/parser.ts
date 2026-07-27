// AgentForge P2-02: LLM 输出解析器
// 解析 LLM 的文本输出为结构化的 Thought + Action

import type { ParsedLLMResponse } from './types'
import { extractJson } from '../utils/json-extract'

/**
 * 解析 LLM 的完整输出，提取 Thought 和 Action。
 *
 * 期望格式：
 * ```
 * Thought: <推理过程>
 * Action: {"type": "tool", "tool": "工具名", "arguments": {...}}
 * ```
 * 或
 * ```
 * Thought: <推理过程>
 * Action: {"type": "finish", "summary": "总结"}
 * ```
 *
 * 也支持 LLM 直接输出 JSON 而没有 Thought 标记的情况。
 *
 * @param output - LLM 的原始输出文本
 * @returns 解析结果
 */
export function parseLLMOutput(output: string): ParsedLLMResponse {
  const rawOutput = output.trim()

  // 尝试提取 Thought
  let thought = ''
  const thoughtMatch = rawOutput.match(
    /(?:Thought|思考)[:：]\s*([\s\S]*?)(?=(?:Action|行动)[:：]|$)/i,
  )
  if (thoughtMatch?.[1]) {
    thought = thoughtMatch[1].trim()
  }

  // 尝试提取 Action
  let actionJson: Record<string, unknown> | null = null
  const actionMatch = rawOutput.match(/(?:Action|行动)[:：]\s*([\s\S]*?)$/i)
  if (actionMatch?.[1]) {
    actionJson = extractJson(actionMatch[1])
  }

  // 如果没有找到 Thought + Action 格式，尝试整体解析为 JSON
  if (!actionJson) {
    actionJson = extractJson(rawOutput)
  }

  // 如果仍然无法解析，将整个输出作为 thought，actionType 为 finish
  if (!actionJson) {
    return {
      thought: thought || rawOutput,
      actionType: 'finish',
      summary: thought || rawOutput,
      rawOutput,
    }
  }

  const actionType = actionJson['type'] as string | undefined

  if (actionType === 'finish') {
    return {
      thought,
      actionType: 'finish',
      summary: (actionJson['summary'] as string) || 'Task completed.',
      rawOutput,
    }
  }

  if (actionType === 'tool' || actionJson['tool']) {
    return {
      thought,
      actionType: 'tool',
      toolName: (actionJson['tool'] as string) || '',
      arguments: (actionJson['arguments'] as Record<string, unknown>) || {},
      rawOutput,
    }
  }

  // 未知 action 类型，视为 finish
  return {
    thought,
    actionType: 'finish',
    summary: `Unknown action type: ${actionType ?? 'undefined'}`,
    rawOutput,
  }
}
