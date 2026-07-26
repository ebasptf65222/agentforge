// AgentForge P2-02: System Prompt 构建器
// 与 Spec v0.2 §9.5 System Prompt 模板一致

import type { ToolDefinition } from './types'

/**
 * 构建 Agent 执行的 System Prompt。
 *
 * 模板（Spec v0.2 §9.5）：
 * ```
 * 你是一个自主执行 Agent。你可以使用以下工具来完成任务：
 *
 * {{tool_definitions}}
 *
 * 执行规则：
 * 1. 每次输出一个 Thought（推理过程）和一个 Action（工具调用）
 * 2. Action 格式为 JSON: {"type": "tool", "tool": "工具名", "arguments": {...}}
 * 3. 任务完成时输出: {"type": "finish", "summary": "总结"}
 * 4. 不要编造工具结果，等待系统返回 Observation
 * {{skill_prompt}}
 * ```
 *
 * @param tools - 可用工具定义列表
 * @param skillPrompt - 可选的 Skill 附加 prompt
 * @returns 完整的 System Prompt 字符串
 */
export function buildSystemPrompt(
  tools: ToolDefinition[],
  skillPrompt?: string,
): string {
  const toolDefs = tools.map((tool) => {
    const schemaStr = JSON.stringify(tool.inputSchema, null, 2)
    return `### ${tool.name}\n${tool.description}\n参数 Schema:\n\`\`\`json\n${schemaStr}\n\`\`\``
  })

  const toolSection =
    toolDefs.length > 0
      ? toolDefs.join('\n\n')
      : '（暂无可用工具，请直接回复用户）'

  const skillSection = skillPrompt ? `\n${skillPrompt}` : ''

  return `你是一个自主执行 Agent。你可以使用以下工具来完成任务：

${toolSection}

执行规则：
1. 每次输出一个 Thought（推理过程）和一个 Action（工具调用）
2. Action 格式为 JSON: {"type": "tool", "tool": "工具名", "arguments": {...}}
3. 任务完成时输出: {"type": "finish", "summary": "总结"}
4. 不要编造工具结果，等待系统返回 Observation${skillSection}`
}

/**
 * 构建工具调用的 Observation 消息。
 * 将工具执行结果格式化为 LLM 可理解的文本。
 *
 * @param toolName - 工具名称
 * @param result - 工具执行结果
 * @returns Observation 文本
 */
export function buildObservation(
  toolName: string,
  result: { isError: boolean; content: string },
): string {
  const status = result.isError ? 'ERROR' : 'SUCCESS'
  return `[Observation | ${toolName} | ${status}]\n${result.content}`
}

/**
 * 构建用户输入的上下文消息。
 *
 * @param userInput - 用户输入
 * @returns user 角色消息
 */
export function buildUserMessage(userInput: string): string {
  return userInput
}

/**
 * 构建助手输出的上下文消息（Thought + Action）。
 *
 * @param thought - 推理过程
 * @param actionJson - Action 的 JSON 字符串
 * @returns assistant 角色消息内容
 */
export function buildAssistantMessage(thought: string, actionJson: string): string {
  return `Thought: ${thought}\nAction: ${actionJson}`
}
