// LangGraph 引擎: ReAct 循环实现
// 编排 ModelWrapper + WrappedTool 的 Thought → Action → Observation 循环

import type { ModelWrapper } from './model-adapter'
import type { WrappedTool } from './tool-adapter'
import type { EventConverter } from './event-converter'
import type { AgentContextMessage } from '../agent/types'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory } from '../../shared/types'
import { generateId } from '../utils/id'

/** ReAct 循环选项 */
export interface ReactLoopOptions {
  model: ModelWrapper
  tools: WrappedTool[]
  eventConverter: EventConverter
  maxSteps: number
  systemPrompt?: string
  skillPrompt?: string
  historyMessages: AgentContextMessage[]
  request: AgentExecutionRequest
  abortSignal: AbortSignal
}

/** parseOutput 返回类型 */
interface ParsedOutput {
  thought: string
  actionType: 'tool' | 'finish'
  toolName?: string
  args?: Record<string, unknown>
  summary?: string
}

/**
 * 构建 System Prompt
 */
function buildSystemPrompt(tools: WrappedTool[], skillPrompt?: string): string {
  const toolDefs = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
  let prompt = `You are a helpful AI assistant with access to the following tools:\n\n${toolDefs}\n\n`
  prompt += `When you want to use a tool, output EXACTLY this format:\n`
  prompt += `Action: <tool_name>\nArguments: <json_arguments>\n\n`
  prompt += `When you are done, output:\n`
  prompt += `Final Answer: <your response>\n\n`
  if (skillPrompt) {
    prompt += `\n${skillPrompt}\n`
  }
  return prompt
}

/**
 * 解析 LLM 输出，提取 Action 或 Final Answer
 */
function parseOutput(output: string): ParsedOutput {
  const finalMatch = output.match(/Final Answer:\s*([\s\S]*?)(?:$)/i)
  if (finalMatch) {
    return {
      thought: output.slice(0, finalMatch.index).trim() || 'Providing final answer.',
      actionType: 'finish',
      summary: finalMatch[1].trim(),
    }
  }

  const actionMatch = output.match(/Action:\s*(\w+)[\s\S]*?Arguments:\s*(\{[\s\S]*?\})/i)
  if (actionMatch) {
    const toolName = actionMatch[1]
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(actionMatch[2])
    } catch {
      // JSON 解析失败，使用空参数
    }
    const thought = output.slice(0, actionMatch.index).trim() || `Using tool ${toolName}.`
    return { thought, actionType: 'tool', toolName, args }
  }

  // 无法解析，视为完成
  return {
    thought: 'No clear action detected, providing response.',
    actionType: 'finish',
    summary: output.trim(),
  }
}

/**
 * 执行 ReAct 循环
 */
export async function createReactLoop(options: ReactLoopOptions): Promise<ExecutionResult> {
  const { model, tools, eventConverter, request, abortSignal } = options
  const executionId = generateId()
  const startTime = Date.now()
  const trajectories: TAOTrajectory[] = []
  const totalTokens = 0

  // 构建上下文
  const systemPrompt = buildSystemPrompt(tools, options.skillPrompt)
  const context: AgentContextMessage[] = [
    { role: 'system', content: systemPrompt },
    ...options.historyMessages,
    { role: 'user', content: request.userInput },
  ]

  let status: ExecutionResult['status'] = 'running'

  try {
    for (let step = 1; step <= options.maxSteps; step++) {
      if (abortSignal.aborted) {
        status = 'cancelled'
        break
      }

      // 调用 LLM
      const llmOutput = await model.invoke(context, abortSignal)
      context.push({ role: 'assistant', content: llmOutput })

      // 解析输出
      const parsed = parseOutput(llmOutput)

      if (parsed.actionType === 'finish') {
        const trajectory = eventConverter.pushTrajectory({
          thought: parsed.thought,
          action: null,
          observation: parsed.summary ?? '',
          status: 'success',
        })
        trajectories.push(trajectory)
        status = 'completed'
        break
      }

      // 工具调用
      if (parsed.toolName && parsed.args) {
        const tool = tools.find((t) => t.name === parsed.toolName)
        if (!tool) {
          const trajectory = eventConverter.pushTrajectory({
            thought: parsed.thought,
            action: {
              toolName: parsed.toolName,
              arguments: parsed.args,
              riskLevel: 'high',
              requiresApproval: false,
            },
            observation: `Tool "${parsed.toolName}" not found.`,
            status: 'error',
          })
          trajectories.push(trajectory)
          context.push({ role: 'tool', content: `Tool "${parsed.toolName}" not found.` })
          continue
        }

        eventConverter.pushToolStart(tool.name, parsed.args)

        // 执行工具（内含审批检查）
        const result = await tool.execute(parsed.args)
        eventConverter.pushToolComplete(tool.name, result)

        const trajectory = eventConverter.pushTrajectory({
          thought: parsed.thought,
          action: {
            toolName: parsed.toolName,
            arguments: parsed.args,
            riskLevel: 'high',
            requiresApproval: false,
          },
          observation: result,
          status: 'success',
        })
        trajectories.push(trajectory)

        context.push({ role: 'tool', content: result })
      }
    }

    if (status === 'running') {
      status = 'failed'
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      status = 'cancelled'
    } else {
      throw error
    }
  }

  const summary =
    trajectories.length > 0
      ? trajectories[trajectories.length - 1].observation || 'Execution completed.'
      : 'No output.'

  return {
    executionId,
    status,
    summary: status === 'completed' ? summary : `Execution ${status}.`,
    trajectories,
    totalSteps: trajectories.length,
    duration: Date.now() - startTime,
    tokensUsed: totalTokens,
  }
}
