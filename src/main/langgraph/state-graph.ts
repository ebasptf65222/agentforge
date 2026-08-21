// AgentForge LangGraph 引擎: StateGraph + stream() 实时事件流 (P3-03)
//
// Phase 3 增强：
// - P3-01: SQLite Checkpointer 持久化图状态
// - P3-02: interrupt() + Command resume 审批 Gate
// - P3-03: 使用 stream() 替代 invoke()，实时推送节点级事件
//
// stream() 优势（相比 invoke()）：
// - 节点级实时事件：每个节点完成后立即推送更新，无需等待整图完成
// - 更细粒度的 UI 反馈：前端可以实时显示当前执行到哪个节点
// - 使用 getState() 检测中断：更可靠的 interrupt 检测机制
//
// 审批流程（P3-02 + P3-03）：
// 1. tools 节点在执行工具前检查是否需要审批
// 2. 如需审批，调用 interrupt(approvalRequest) 暂停图执行
// 3. Checkpointer 持久化图状态到 SQLite
// 4. stream() 结束后，通过 getState() 检测到 interrupt
// 5. 通过 ApprovalManager 发送审批请求到前端，等待用户响应
// 6. 用户响应后，调用 stream(new Command({ resume: { approved, reason } }))
// 7. interrupt() 返回 resume 值，tools 节点继续执行

import { StateGraph, START, END, Annotation, interrupt, Command } from '@langchain/langgraph'
import type { CompiledStateGraph, StateSnapshot } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { ModelWrapper } from './model-adapter'
import type { WrappedTool } from './tool-adapter'
import type { EventConverter } from './event-converter'
import type { AgentContextMessage } from '../agent/types'
import type { AgentExecutionRequest, ExecutionResult, TAOTrajectory, ApprovalMode, ToolAction } from '../../shared/types'
import { shouldRequireApproval, buildToolAction, getToolRiskLevel } from '../agent/approval'
import type { ApprovalManager } from '../agent/approval'
import type { AgentEventCallbacks } from '../agent/types'
import { loadProjectRules, formatRulesPrompt } from '../agent/project-rules'
import { manageContext } from '../agent/context-manager'
import { estimateTokens } from '../agent/tokenizer'
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
 * 从 LLM 输出文本中提取 JSON 对象。
 * 支持：直接 JSON、```json 代码块、花括号提取。
 */
function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch { /* continue */ }
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>
    } catch { /* continue */ }
  }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>
    } catch { /* continue */ }
  }
  return null
}

/**
 * 解析 LLM 输出，提取 Action 或 Final Answer。
 *
 * 兼容两种格式：
 * 格式 A (builtin 引擎):
 *   Thought: <推理>
 *   Action: {"type": "tool", "tool": "工具名", "arguments": {...}}
 *   Action: {"type": "finish", "summary": "..."}
 *
 * 格式 B (LangGraph 原始):
 *   Action: <tool_name>
 *   Arguments: {"key": "value"}
 *   Final Answer: <回答>
 */
function parseOutput(output: string): ParsedOutput {
  console.warn('[parseOutput] LLM 原始输出:', output.substring(0, 500))

  // ── 优先级 1: 格式 A — 提取 Action 后的 JSON（与 builtin parser 一致）──
  const actionJsonMatch = output.match(/(?:Action|行动)[:：]\s*([\s\S]*?)$/i)
  if (actionJsonMatch?.[1]) {
    const actionJson = extractJson(actionJsonMatch[1])
    if (actionJson) {
      const actionType = actionJson['type'] as string | undefined
      if (actionType === 'finish') {
        const thoughtMatch = output.match(/(?:Thought|思考)[:：]\s*([\s\S]*?)(?=(?:Action|行动)[:：]|$)/i)
        console.warn('[parseOutput] 解析结果: Finish (JSON 格式)')
        return {
          thought: thoughtMatch?.[1]?.trim() || 'Task completed.',
          actionType: 'finish',
          summary: (actionJson['summary'] as string) || 'Task completed.',
        }
      }
      if (actionType === 'tool' || actionJson['tool']) {
        const toolName = (actionJson['tool'] as string) || ''
        const args = (actionJson['arguments'] as Record<string, unknown>) || {}
        const thoughtMatch = output.match(/(?:Thought|思考)[:：]\s*([\s\S]*?)(?=(?:Action|行动)[:：]|$)/i)
        console.warn('[parseOutput] 解析结果: Tool Call (JSON 格式)', { toolName, args })
        return {
          thought: thoughtMatch?.[1]?.trim() || `Using tool ${toolName}.`,
          actionType: 'tool',
          toolName,
          args,
        }
      }
    }
  }

  // ── 优先级 2: Final Answer 格式 ──
  const finalMatch = output.match(/Final Answer:\s*([\s\S]*?)(?:$)/i)
  if (finalMatch) {
    console.warn('[parseOutput] 解析结果: Final Answer')
    return {
      thought: output.slice(0, finalMatch.index).trim() || 'Providing final answer.',
      actionType: 'finish',
      summary: finalMatch[1].trim(),
    }
  }

  // ── 优先级 3: 格式 B — Action: <tool_name> + Arguments: <json> ──
  const actionMatch = output.match(/Action:\s*(\w+)[\s\S]*?Arguments:\s*(\{[\s\S]*?\})/i)
  if (actionMatch) {
    const toolName = actionMatch[1]
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(actionMatch[2])
    } catch {
      console.error('[parseOutput] JSON 解析失败:', actionMatch[2])
    }
    const thought = output.slice(0, actionMatch.index).trim() || `Using tool ${toolName}.`
    console.warn('[parseOutput] 解析结果: Tool Call (Action+Arguments 格式)', { toolName, args })
    return { thought, actionType: 'tool', toolName, args }
  }

  // ── 优先级 4: 整段文本尝试提取 JSON ──
  const wholeJson = extractJson(output)
  if (wholeJson) {
    const actionType = wholeJson['type'] as string | undefined
    if (actionType === 'finish') {
      console.warn('[parseOutput] 解析结果: Finish (整段 JSON)')
      return { thought: '', actionType: 'finish', summary: (wholeJson['summary'] as string) || output.trim() }
    }
    if (actionType === 'tool' || wholeJson['tool']) {
      console.warn('[parseOutput] 解析结果: Tool Call (整段 JSON)', { toolName: wholeJson['tool'] })
      return {
        thought: '',
        actionType: 'tool',
        toolName: (wholeJson['tool'] as string) || '',
        args: (wholeJson['arguments'] as Record<string, unknown>) || {},
      }
    }
  }

  // ── 优先级 5: 无法解析，视为直接回复 ──
  console.warn('[parseOutput] 未检测到明确动作，返回 finish')
  return {
    thought: output.trim(),
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
  /** 模型最大上下文窗口（tokens），用于循环内动态截断 */
  maxContextLength: number
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
    maxContextLength,
  } = options

  const executionId = generateId()
  const startTime = Date.now()
  const trajectories: TAOTrajectory[] = []
  let totalTokensUsed = 0

  // 熔断器：连续失败次数计数器（与 builtin 引擎一致）
  const MAX_CONSECUTIVE_FAILURES = 3
  let consecutiveFailures = 0

  // 加载项目规则（AGENTS.md），与 builtin 引擎一致
  let projectRules = ''
  try {
    projectRules = await loadProjectRules()
  } catch {
    // AGENTS.md 加载失败不阻断执行
  }

  const systemPrompt = buildSystemPrompt(tools, options.skillPrompt, projectRules)
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

    // 熔断器：连续失败达到上限时终止执行
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const trajectory = eventConverter.pushTrajectory({
        thought: 'Circuit breaker triggered: too many consecutive tool failures.',
        action: null,
        observation: `Execution stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`,
        status: 'error',
      })
      trajectories.push(trajectory)
      return { status: 'failed' }
    }

    // 动态上下文窗口管理：截断过长的历史消息（与 builtin 引擎一致）
    // state.messages 保留完整历史，仅截断传给 LLM 的消息
    const contextResult = manageContext(state.messages, {
      maxContextTokens: maxContextLength,
      toolDefsReserve: tools.length * 200,
    })
    const llmOutput = await model.invoke(contextResult.messages, abortSignal)
    totalTokensUsed += estimateTokens(llmOutput)
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
    // 优先使用工具定义中声明的 riskLevel，否则查内置映射表
    const riskLevel = getToolRiskLevel(tool.name, tool.riskLevel)
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
      // 工具执行成功，重置连续失败计数
      consecutiveFailures = 0
    } catch (err) {
      resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`
      status = 'error'
      // 工具执行失败，递增连续失败计数
      consecutiveFailures++
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

  // ─── 执行图（stream + interrupt/resume 循环） ──────────────
  // P3-03: 使用 stream() 替代 invoke()，实时推送节点级事件
  //
  // stream() 多模式输出：
  // - 'values': 每步完成后推送完整状态
  // - 'updates': 节点级更新（含节点名称和状态增量）
  //
  // interrupt 检测：
  // - stream() 结束后通过 getState() 获取图状态
  // - 检查 stateSnapshot.tasks 中的 interrupts 数组
  const config = {
    configurable: { thread_id: threadId },
    signal: abortSignal,
    streamMode: ['values', 'updates'] as const,
  }

  let finalState: AgentStateType | undefined
  let graphStatus: 'running' | 'completed' | 'cancelled' | 'failed' = 'running'
  let invokeInput: unknown = {
    messages: initialMessages,
    step: 0,
    finalAnswer: null,
    status: 'running' as const,
  }
  // 错误详情（保留到 summary 中返回给前端）
  let errorMessage = ''

  try {
    // Phase 3: stream + interrupt/resume 循环
    // 1. stream() 运行图，实时推送节点级事件
    // 2. stream() 结束后通过 getState() 检测 interrupt
    // 3. 检测到 interrupt 后，通过 ApprovalManager 请求用户审批
    // 4. 用户响应后，调用 stream(new Command({ resume })) 恢复
    // 5. 重复直到图完成
    for (let loopCount = 0; loopCount < 100; loopCount++) {
      if (abortSignal.aborted) {
        graphStatus = 'cancelled'
        break
      }

      // P3-03: 使用 stream() 替代 invoke()
      // stream() 返回异步可迭代流，支持实时事件推送
      const stream = await compiledGraph.stream(invokeInput, config)

      // 追踪本轮是否有 chunk 产出（用于空转检测）
      let hadChunks = false

      // 迭代流事件，实时推送到前端
      for await (const chunk of stream) {
        hadChunks = true
        // 多 streamMode 下，chunk 是 [mode, data] 元组
        const [mode, data] = chunk as [string, unknown]

        if (mode === 'values') {
          // 'values' 模式：每步完成后推送完整状态
          const stateValue = data as AgentStateType
          if (stateValue?.status && stateValue.status !== 'running') {
            graphStatus = stateValue.status
          }
        } else if (mode === 'updates') {
          // 'updates' 模式：节点级更新
          // data 是 { [nodeName]: stateUpdate } 映射
          const updates = data as Record<string, Partial<AgentStateType>>
          for (const [nodeName, update] of Object.entries(updates)) {
            eventConverter.pushNodeUpdate(nodeName, update as Record<string, unknown>)
          }
        }
      }

      // P3-03: stream() 结束后，通过 getState() 检查图状态和中断
      const stateSnapshot: StateSnapshot = await compiledGraph.getState(config)

      // 检查是否有 interrupt（审批请求）
      const interruptTask = stateSnapshot.tasks.find(
        (t) => t.interrupts && t.interrupts.length > 0,
      )

      if (interruptTask && interruptTask.interrupts.length > 0) {
        // 提取 interrupt 数据
        const approvalData = interruptTask.interrupts[0].value as InterruptApprovalData

        if (!approvalData) {
          // 无法提取审批数据，终止执行
          errorMessage = 'Interrupt occurred but no approval data was found.'
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
          timestamp: Date.now(),
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

      // 检查图是否完成（next 为空表示没有待执行的节点）
      if (stateSnapshot.next.length === 0) {
        // 图已完成
        finalState = stateSnapshot.values as AgentStateType
        if (finalState?.status) {
          graphStatus = finalState.status
        }
        break
      }

      // 图未完成但也没有 interrupt（可能需要继续执行）
      finalState = stateSnapshot.values as AgentStateType
      if (finalState?.status && finalState.status !== 'running') {
        graphStatus = finalState.status
        break
      }

      // 空转保护：如果本轮无 chunk 产出且 invokeInput 未变（非 Command resume），
      // 说明图无法推进，避免无限空转
      if (!hadChunks && !(invokeInput instanceof Command)) {
        errorMessage = 'Graph stalled: no progress detected in stream output.'
        graphStatus = 'failed'
        break
      }
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))) {
      graphStatus = 'cancelled'
    } else {
      // 非 Abort 错误：保留已收集的 trajectories，设为 failed 状态
      errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[LangGraph StateGraph] Execution error:', error)
      graphStatus = 'failed'
    }
  }

  // ─── finalState 兜底 ─────────────────────────────────────
  // 当循环因 abort / interrupt 无数据 / 超出循环次数而 break 时，
  // finalState 可能仍未赋值，需要构造一个兜底状态
  // 如果循环耗尽仍未完成，graphStatus 可能为初始值 'running'，
  // 这不是合法终态，应转为 'failed'
  if (graphStatus === 'running') {
    graphStatus = 'failed'
  }
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
    summary: status === 'completed'
      ? summary
      : errorMessage
        ? `Execution ${status}: ${errorMessage}`
        : `Execution ${status}.`,
    trajectories,
    totalSteps: trajectories.length,
    duration: Date.now() - startTime,
    tokensUsed: totalTokensUsed,
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────

/**
 * 构建 System Prompt
 *
 * 包含：
 * - 工具定义（含参数 Schema JSON）
 * - 执行格式说明（Action/Arguments/Final Answer）
 * - Skill 提示词（可选）
 * - 项目规则 AGENTS.md（可选）
 */
function buildSystemPrompt(tools: WrappedTool[], skillPrompt?: string, projectRules?: string): string {
  // 工具定义：注入完整的参数 Schema（与 builtin 引擎一致）
  const toolDefs = tools.map((t) => {
    const schemaStr = JSON.stringify(t.inputSchema, null, 2)
    return `### ${t.name}\n${t.description}\n参数 Schema:\n\`\`\`json\n${schemaStr}\n\`\`\``
  })
  const toolSection = toolDefs.length > 0
    ? toolDefs.join('\n\n')
    : '（暂无可用工具，请直接回复用户）'

  let prompt = `你是一个自主执行 Agent。你可以使用以下工具来完成任务：\n\n${toolSection}\n\n`
  prompt += `执行规则：\n`
  prompt += `1. 每次输出一个 Thought（推理过程）和一个 Action（工具调用）\n`
  prompt += `2. Action 格式为 JSON: {"type": "tool", "tool": "工具名", "arguments": {...}}\n`
  prompt += `3. 任务完成时输出: {"type": "finish", "summary": "总结"}\n`
  prompt += `4. 不要编造工具结果，等待系统返回 Observation\n`
  prompt += `5. 文件操作请使用 ws_write（工作区写入）工具，不要直接回复说已创建文件\n\n`

  if (skillPrompt) {
    prompt += `\n${skillPrompt}\n`
  }

  if (projectRules) {
    prompt += formatRulesPrompt(projectRules)
  }

  return prompt
}
