// AgentForge LangGraph 引擎: 显式 StateGraph + 审批 Gate (P2-02)
//
// 使用 LangGraph 的 StateGraph 构建正式的 Agent 图：
// - agent 节点：调用 LLM，解析输出（Action / Final Answer）
// - tools 节点：执行工具，内嵌 ApprovalManager 审批检查
// - 条件边：根据 LLM 输出路由到 tools 或 END
//
// 审批机制：
// - 当工具需要审批时，tools 节点调用 ApprovalManager.requestApproval()
// - ApprovalManager 通过 Promise 等待用户响应
// - Bridge 层通过 respondApproval() 响应审批
// - 这与 Phase 1 的审批机制完全一致，保证兼容性
//
// 与 Phase 1 的 createReactLoop 相比：
// - 使用 StateGraph 替代手动循环
// - 使用 MemorySaver checkpointer 支持状态持久化
// - 使用条件边路由替代手动 if/else
// - 保留 ApprovalManager 审批机制（interrupt() 留作 Phase 3 增强）

import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { MemorySaver } from '@langchain/langgraph'
import type { ModelWrapper } from './model-adapter'
import type { WrappedTool } from './tool-adapter'
import type { EventConverter } from './event-converter'
import type { AgentContextMessage } from '../agent/types'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory, ApprovalMode } from '../../shared/types'
import { shouldRequireApproval, buildToolAction } from '../agent/approval'
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
  // 当前步骤数
  step: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),
  // 最终答案
  finalAnswer: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  // 执行状态
  status: Annotation<'running' | 'completed' | 'cancelled' | 'failed'>({
    reducer: (_, next) => next,
    default: () => 'running',
  }),
})

type AgentStateType = typeof AgentState.State

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
 * 与 react-loop.ts 中的 parseOutput 一致。
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

// ─── 图构建选项 ───────────────────────────────────────────────────

export interface StateGraphOptions {
  model: ModelWrapper
  tools: WrappedTool[]
  eventConverter: EventConverter
  maxSteps: number
  systemPrompt?: string
  skillPrompt?: string
  historyMessages: AgentContextMessage[]
  request: AgentExecutionRequest
  abortSignal: AbortSignal
  approvalManager: ApprovalManager
  approvalMode: ApprovalMode
  approvalTimeoutMs: number
  checkpointer: MemorySaver
  threadId: string
  callbacks: AgentEventCallbacks
}

// ─── 构建并执行 StateGraph ────────────────────────────────────────

/**
 * 构建并执行 StateGraph Agent。
 *
 * 1. 定义 agent 和 tools 两个节点
 * 2. agent 节点调用 LLM，解析输出
 * 3. tools 节点执行工具，内嵌 ApprovalManager 审批检查
 * 4. 条件边路由：finish → END, tool → tools, tools → agent
 * 5. 使用 MemorySaver checkpointer 支持状态持久化
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

  // 构建 System Prompt
  const systemPrompt = buildSystemPrompt(tools, options.skillPrompt)
  const initialMessages: AgentContextMessage[] = [
    { role: 'system', content: systemPrompt },
    ...options.historyMessages,
    { role: 'user', content: request.userInput },
  ]

  // ─── agent 节点 ───────────────────────────────────────────
  const agentNode = async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // 检查中断
    if (abortSignal.aborted) {
      return { status: 'cancelled' }
    }

    // 检查步骤上限
    if (state.step >= options.maxSteps) {
      return { status: 'failed' }
    }

    // 调用 LLM
    const llmOutput = await model.invoke(state.messages, abortSignal)

    // 解析输出
    const parsed = parseOutput(llmOutput)

    // 添加 assistant 消息到上下文
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

    // 工具调用 - assistant 消息中包含 Action
    return {
      messages: newMessages,
      step: 1,
    }
  }

  // ─── tools 节点 ───────────────────────────────────────────
  const toolsNode = async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // 从最后一条 assistant 消息中解析工具调用
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

    // 审批检查由 wrapAllTools/wrapTool 在 tool.execute() 内部处理，
    // tools 节点只需调用 execute() 即可，无需重复审批逻辑。

    // 执行工具（内含审批检查）
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

    const trajectory = eventConverter.pushTrajectory({
      thought: parsed.thought,
      action: {
        toolName: tool.name,
        arguments: parsed.args,
        riskLevel: 'high',
        requiresApproval: false,
      },
      observation: resultContent,
      status,
    })
    trajectories.push(trajectory)

    return {
      messages: [{ role: 'tool', content: resultContent }],
    }
  }

  // ─── 条件边 ───────────────────────────────────────────────
  const routeAfterAgent = (state: AgentStateType): 'tools' | typeof END => {
    if (state.status === 'completed') {
      return END
    }
    if (state.status === 'cancelled' || state.status === 'failed') {
      return END
    }

    // 检查最后一条消息是否包含工具调用
    const lastMessage = state.messages[state.messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return END
    }

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

  // ─── 执行图 ───────────────────────────────────────────────
  const config = {
    configurable: { thread_id: threadId },
    signal: abortSignal,
  }

  let finalState: AgentStateType
  let graphStatus: 'running' | 'completed' | 'cancelled' | 'failed' = 'running'

  try {
    // 使用 invoke 直接运行图到完成。
    // invoke 是 async 方法，内部 node 执行时若遇到 requestApproval() 阻塞，
    // 事件循环仍可处理 respondApproval() 调用。
    const result = await compiledGraph.invoke(
      { messages: initialMessages, step: 0, finalAnswer: null, status: 'running' as const },
      config,
    )
    finalState = result as AgentStateType
    graphStatus = finalState.status
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))) {
      graphStatus = 'cancelled'
      finalState = { messages: [], step: 0, finalAnswer: null, status: 'cancelled' }
    } else {
      throw error
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
 * 与 react-loop.ts 中的 buildSystemPrompt 一致
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
