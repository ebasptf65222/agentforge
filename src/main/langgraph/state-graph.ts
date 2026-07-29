// AgentForge LangGraph 引擎: StateGraph + interrupt() 审批 Gate (P3-02)
//
// Phase 3: 使用 LangGraph 原生 interrupt() + Command resume 替代
// Phase 2 的 ApprovalManager Promise 阻塞模式。
//
// 审批流程：
// 1. tools 节点在执行工具前检查是否需要审批
// 2. 如需审批，调用 interrupt(approvalRequest) 暂停图执行
// 3. Checkpointer 持久化图状态到 SQLite
// 4. executeWithStateGraph() 的 invoke 循环检测到 interrupt
// 5. 通过 ApprovalManager 发送审批请求到前端，等待用户响应
// 6. 用户响应后，调用 invoke(new Command({ resume: { approved, reason } }))
// 7. interrupt() 返回 resume 值，tools 节点继续执行
//
// 优势（相比 Phase 2）：
// - 图状态持久化：应用崩溃/重启后可恢复中断的审批
// - 审批超时不再阻塞图执行线程
// - 更清晰的关注分离：图级别处理审批，工具只负责执行

import { StateGraph, START, END, Annotation, interrupt, Command } from '@langchain/langgraph'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { isInterrupted, INTERRUPT } from '@langchain/langgraph'
import type { ModelWrapper } from './model-adapter'
import type { WrappedTool } from './tool-adapter'
import type { EventConverter } from './event-converter'
import type { AgentContextMessage } from '../agent/types'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory, ApprovalMode, ToolAction } from '../../shared/types'
import { shouldRequireApproval, buildToolAction, getToolRiskLevel } from '../agent/approval'
import type { ApprovalManager } from '../agent/approval'
import type { AgentEventCallbacks } from '../agent/types'
import { generateId } from '../utils/id'

// ─── State 定义 ───────────────────────────────────────────────────

/**
 * StateGraph 的状态定义。
 * 使用 Annotation 定义 messages 通道（使用 reducer 追加消息）。
 */
const AgentState = Annotation.Root({
  messages: Annotation<AgentContextMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  step: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),
  finalAnswer: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  status: Annotation<'running' | 'completed' | 'cancelled' | 'failed'>({
    reducer: (_, next) => next,
    default: () => 'running',
  }),
})

type AgentStateType = typeof AgentState.State

// ─── 审批中断数据 ─────────────────────────────────────────────────

/** interrupt() 传递的审批请求数据 */
interface InterruptApprovalData {
  toolName: string
  args: Record<string, unknown>
  riskLevel: ToolAction['riskLevel']
  reason: string
}

/** Command resume 返回的审批响应 */
interface ApprovalResumeValue {
  approved: boolean
  reason?: string
}

// ─── 输出解析 ─────────────────────────────────────────────────────

interface ParsedOutput {
  thought: string
  actionType: 'tool' | 'finish'
  toolName?: string
  args?: Record<string, unknown>
  summary?: string
}

/**
 * 解析 LLM 输出，提取 Action 或 Final Answer。
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

  return {
    thought: 'No clear action detected, providing response.',
    actionType: 'finish',
    summary: output.trim(),
  }
}

// ─── 图构建选项 ───────────────────────────────────────────────────

export interface StateGraphOptions {
  model: ModelWrapper
  tools: WrappedTool[]
  eventConverter: EventConverter
  maxSteps: number
  skillPrompt?: string
  historyMessages: AgentContextMessage[]
  request: AgentExecutionRequest
  abortSignal: AbortSignal
  approvalManager: ApprovalManager
  approvalMode: ApprovalMode
  approvalTimeoutMs: number
  checkpointer: BaseCheckpointSaver
  threadId: string
  callbacks: AgentEventCallbacks
}

// ─── 构建并执行 StateGraph ────────────────────────────────────────

/**
 * 构建并执行 StateGraph Agent。
 *
 * Phase 3 审批流程：
 * 1. tools 节点检查审批 → interrupt() 暂停
 * 2. invoke() 返回中断结果
 * 3. ApprovalManager 发送审批请求到前端
 * 4. 用户响应 → invoke(new Command({ resume })) 恢复
 * 5. 循环直到图完成
 *
 * @param options - 图构建和执行选项
 * @returns ExecutionResult
 */
export async function executeWithStateGraph(options: StateGraphOptions): Promise<ExecutionResult> {
  const {
    model,
    tools,
    eventConverter,
    request,
    abortSignal,
    approvalManager,
    approvalMode,
    approvalTimeoutMs,
    checkpointer,
    threadId,
    callbacks,
  } = options

  const executionId = generateId()
  const startTime = Date.now()
  const trajectories: TAOTrajectory[] = []

  const systemPrompt = buildSystemPrompt(tools, options.skillPrompt)
  const initialMessages: AgentContextMessage[] = [
    { role: 'system', content: systemPrompt },
    ...options.historyMessages,
    { role: 'user', content: request.userInput },
  ]

  // ─── agent 节点 ───────────────────────────────────────────
  const agentNode = async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    if (abortSignal.aborted) {
      return { status: 'cancelled' }
    }

    if (state.step >= options.maxSteps) {
      return { status: 'failed' }
    }

    const llmOutput = await model.invoke(state.messages, abortSignal)
    const parsed = parseOutput(llmOutput)

    const newMessages: AgentContextMessage[] = [
      { role: 'assistant', content: llmOutput },
    ]

    if (parsed.actionType === 'finish') {
      const trajectory = eventConverter.pushTrajectory({
        thought: parsed.thought,
        action: null,
        observation: parsed.summary ?? '',
        status: 'success',
      })
      trajectories.push(trajectory)

      return {
        messages: newMessages,
        finalAnswer: parsed.summary ?? '',
        status: 'completed',
        step: 1,
      }
    }

    return {
      messages: newMessages,
      step: 1,
    }
  }

  // ─── tools 节点（含 interrupt() 审批 Gate） ────────────────
  const toolsNode = async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return { messages: [] }
    }

    const parsed = parseOutput(lastMessage.content)
    if (parsed.actionType !== 'tool' || !parsed.toolName || !parsed.args) {
      return { messages: [] }
    }

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

      return {
        messages: [{ role: 'tool', content: `Tool "${parsed.toolName}" not found.` }],
      }
    }

    // ─── Phase 3: interrupt() 审批 Gate ───────────────────
    // 检查工具是否需要审批
    const riskLevel = getToolRiskLevel(tool.name)
    const toolAction = buildToolAction(tool.name, parsed.args, riskLevel)
    const needsApproval = shouldRequireApproval(toolAction, approvalMode)

    if (needsApproval) {
      // 调用 interrupt() 暂停图执行
      // 图状态由 Checkpointer 持久化，可在任意时刻恢复
      const approvalData: InterruptApprovalData = {
        toolName: tool.name,
        args: parsed.args,
        riskLevel,
        reason: `Tool "${tool.name}" requires approval (risk: ${riskLevel})`,
      }

      // interrupt() 暂停图执行，返回值为 Command resume 传入的数据
      const approvalResult = interrupt<InterruptApprovalData, ApprovalResumeValue>(approvalData)

      if (!approvalResult.approved) {
        // 审批被拒绝，记录轨迹并返回拒绝消息
        const trajectory = eventConverter.pushTrajectory({
          thought: parsed.thought,
          action: {
            toolName: tool.name,
            arguments: parsed.args,
            riskLevel,
            requiresApproval: true,
          },
          observation: `Tool execution was ${approvalResult.reason === 'TIMEOUT' ? 'timed out' : 'rejected'}.`,
          status: 'error',
        })
        trajectories.push(trajectory)

        return {
          messages: [{ role: 'tool', content: `Tool execution was ${approvalResult.reason === 'TIMEOUT' ? 'timed out' : 'rejected'}.` }],
        }
      }

      // 审批通过，继续执行工具
      const trajectory = eventConverter.pushTrajectory({
        thought: parsed.thought,
        action: {
          toolName: tool.name,
          arguments: parsed.args,
          riskLevel,
          requiresApproval: true,
        },
        observation: '',
        status: 'success',
      })
      trajectories.push(trajectory)
    }

    // 执行工具
    eventConverter.pushToolStart(tool.name, parsed.args)

    let resultContent: string
    let status: TAOTrajectory['status'] = 'success'

    try {
      resultContent = await tool.execute(parsed.args)
      eventConverter.pushToolComplete(tool.name, resultContent)
    } catch (err) {
      resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`
      status = 'error'
    }

    // 如果没有审批（不需要审批的工具），也要记录轨迹
    if (!needsApproval) {
      const trajectory = eventConverter.pushTrajectory({
        thought: parsed.thought,
        action: {
          toolName: tool.name,
          arguments: parsed.args,
          riskLevel,
          requiresApproval: false,
        },
        observation: resultContent,
        status,
      })
      trajectories.push(trajectory)
    } else {
      // 更新已有轨迹的 observation
      const lastTraj = trajectories[trajectories.length - 1]
      if (lastTraj) {
        lastTraj.observation = resultContent
        lastTraj.status = status
      }
    }

    return {
      messages: [{ role: 'tool', content: resultContent }],
    }
  }

  // ─── 条件边 ───────────────────────────────────────────────
  const routeAfterAgent = (state: AgentStateType): 'tools' | typeof END => {
    if (state.status === 'completed') return END
    if (state.status === 'cancelled' || state.status === 'failed') return END

    const lastMessage = state.messages[state.messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') return END

    const parsed = parseOutput(lastMessage.content)
    return parsed.actionType === 'tool' ? 'tools' : END
  }

  // ─── 构建图 ───────────────────────────────────────────────
  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent)
    .addEdge('tools', 'agent')

  const compiledGraph: CompiledStateGraph = graph.compile({
    checkpointer,
  })

  // ─── 执行图（含 interrupt/resume 循环） ────────────────────
  const config = {
    configurable: { thread_id: threadId },
    signal: abortSignal,
  }

  let finalState: AgentStateType | undefined
  let graphStatus: 'running' | 'completed' | 'cancelled' | 'failed' = 'running'
  let invokeInput: unknown = {
    messages: initialMessages,
    step: 0,
    finalAnswer: null,
    status: 'running' as const,
  }

  try {
    // Phase 3: interrupt/resume 循环
    // 1. invoke() 运行图，如果遇到 interrupt() 则暂停并返回
    // 2. 检测到 interrupt 后，通过 ApprovalManager 请求用户审批
    // 3. 用户响应后，调用 invoke(new Command({ resume })) 恢复
    // 4. 重复直到图完成
    for (let loopCount = 0; loopCount < 100; loopCount++) {
      if (abortSignal.aborted) {
        graphStatus = 'cancelled'
        break
      }

      const result = await compiledGraph.invoke(invokeInput, config)

      // 检查是否被 interrupt 暂停
      if (isInterrupted(result)) {
        // 提取 interrupt 数据
        const interrupts = result[INTERRUPT] as Array<{ value: InterruptApprovalData }>
        const approvalData = interrupts[0]?.value

        if (!approvalData) {
          // 无法提取审批数据，终止执行
          graphStatus = 'failed'
          break
        }

        // 通过 ApprovalManager 发送审批请求到前端
        const toolAction = buildToolAction(
          approvalData.toolName,
          approvalData.args,
          approvalData.riskLevel,
        )
        const approvalRequest = {
          executionId: request.conversationId,
          step: Date.now(),
          toolAction,
          reason: approvalData.reason,
        }

        const response = await approvalManager.requestApproval(
          approvalRequest,
          approvalTimeoutMs,
          callbacks.onApprovalRequest,
        )

        // 用 Command resume 恢复图执行
        invokeInput = new Command({
          resume: {
            approved: response.approved,
            reason: response.reason,
          } satisfies ApprovalResumeValue,
        })
        continue
      }

      // 图正常完成
      finalState = result as AgentStateType
      graphStatus = finalState.status
      break
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))) {
      graphStatus = 'cancelled'
    } else {
      throw error
    }
  }

  // ─── finalState 兜底 ─────────────────────────────────────
  // 当循环因 abort / interrupt 无数据 / 超出循环次数而 break 时，
  // finalState 可能仍未赋值，需要构造一个兜底状态
  if (!finalState) {
    finalState = {
      messages: [],
      step: 0,
      finalAnswer: null,
      status: graphStatus,
    }
  }

  // ─── 构建结果 ─────────────────────────────────────────────
  const status = finalState.status ?? graphStatus
  const summary =
    finalState.finalAnswer ??
    (trajectories.length > 0
      ? trajectories[trajectories.length - 1].observation || 'Execution completed.'
      : 'No output.')

  return {
    executionId,
    status,
    summary: status === 'completed' ? summary : `Execution ${status}.`,
    trajectories,
    totalSteps: trajectories.length,
    duration: Date.now() - startTime,
    tokensUsed: 0,
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────

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
