// AgentForge P2-02: Agent ReAct 执行引擎
// 与 Spec v0.2 §9 Agent ReAct 执行引擎规格一致
//
// 执行流程：
// 用户输入 → 构建System Prompt → [ReAct 循环]
//                                    │
//                              ┌───────┴───────┐
//                              │ Thought (LLM) │
//                              │ Action (解析) │
//                              │ 审批检查       │
//                              │ 执行工具       │
//                              │ Observation   │
//                              └───────┬───────┘
//                                      │
//                               type=finish → 结束

import type {
  AgentExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  TAOTrajectory,
  ToolDefinition,
  ToolExecutionResult,
  ToolRiskLevel,
  ApprovalRequest,
  RegisteredTool,
  AgentContextMessage,
  AgentEventCallbacks,
} from './types'
import type { ModelAdapter, AdapterMessage } from '../models/adapter'
import { buildSystemPrompt, buildObservation } from './prompt-builder'
import { loadProjectRules } from './project-rules'
import { parseLLMOutput } from './parser'
import { estimateTokens } from './tokenizer'
import { manageContext } from './context-manager'
import { shouldRequireApproval, buildToolAction, ApprovalManager } from './approval'
import { AppError, ErrorCodes, createError } from '../utils/error'
import { generateId } from '../utils/id'

/** 连续工具失败熔断阈值 */
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * Agent 执行器配置。
 */
export interface AgentExecutorConfig {
  /** 模型适配器 */
  adapter: ModelAdapter
  /** 已注册的工具映射 */
  tools: Map<string, RegisteredTool>
  /** 事件回调 */
  callbacks: AgentEventCallbacks
  /** 审批超时时间（ms） */
  approvalTimeoutMs: number
  /** 最大上下文长度（token） */
  maxContextLength: number
  /** 可选的 Skill 附加 prompt（注入到 System Prompt 末尾） */
  skillPrompt?: string
  /** 可选的历史对话消息（在 system prompt 之后、当前用户输入之前插入） */
  historyMessages?: AgentContextMessage[]
}

/**
 * Agent ReAct 执行引擎。
 *
 * 实现 Thought → Action → Observation 循环：
 * 1. 构建 System Prompt（含工具定义）
 * 2. 将用户输入加入上下文
 * 3. 调用 LLM 获取回复
 * 4. 解析回复提取 Thought + Action
 * 5. 如果是工具调用：审批检查 → 执行工具 → 生成 Observation
 * 6. 将结果反馈给 LLM，重复 3-5
 * 7. 直到 finish / maxSteps / 熔断 / 用户取消
 */
export class AgentExecutor {
  private abortController: AbortController | null = null
  private approvalManager = new ApprovalManager()
  private cancelled = false

  constructor(private config: AgentExecutorConfig) {}

  /**
   * 执行 Agent 任务。
   */
  async execute(request: AgentExecutionRequest): Promise<ExecutionResult> {
    const executionId = generateId()
    const startTime = Date.now()
    this.cancelled = false
    this.abortController = new AbortController()

    const trajectories: TAOTrajectory[] = []
    let totalTokensUsed = 0
    let status: ExecutionStatus = 'running'
    let summary = ''

    // 构建上下文
    const context: AgentContextMessage[] = []

    // 1. System Prompt
    const toolDefs = this.collectToolDefinitions()
    const projectRules = await loadProjectRules()
    const systemPrompt = buildSystemPrompt(toolDefs, this.config.skillPrompt, projectRules)
    context.push({ role: 'system', content: systemPrompt })

    // 1b. 历史对话消息（在 system prompt 之后、当前用户输入之前）
    // 已由 IPC handler 层通过 manageContext 截断处理
    if (this.config.historyMessages && this.config.historyMessages.length > 0) {
      context.push(...this.config.historyMessages)
    }

    // 2. 用户输入
    context.push({ role: 'user', content: request.userInput })

    // ReAct 循环
    let consecutiveFailures = 0

    try {
      for (let step = 1; step <= request.maxSteps; step++) {
        // 检查取消
        if (this.cancelled) {
          status = 'cancelled'
          break
        }

        // 3. 上下文窗口管理：截断过长的历史消息
        const contextResult = manageContext(context, {
          maxContextTokens: this.config.maxContextLength,
          toolDefsReserve: this.collectToolDefinitions().length * 200, // 按工具数量估算工具定义 token
        })
        const truncatedContext = contextResult.messages

        // 4. 调用 LLM
        const adapterMessages: AdapterMessage[] = truncatedContext.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }))

        let llmOutput = ''
        try {
          for await (const chunk of this.config.adapter.streamChat(
            adapterMessages,
            this.abortController.signal,
          )) {
            if (chunk.type === 'text' && chunk.content) {
              llmOutput += chunk.content
              this.config.callbacks.onStreamChunk({ type: 'text', content: chunk.content })
            }
          }
        } catch (error) {
          // LLM 调用失败
          if (this.cancelled) {
            status = 'cancelled'
            break
          }
          throw error
        }

        // 检查取消（LLM 调用返回后）
        if (this.cancelled) {
          status = 'cancelled'
          break
        }

        totalTokensUsed += estimateTokens(llmOutput)

        // 5. 解析 LLM 输出
        const parsed = parseLLMOutput(llmOutput)

        // 6. 处理 finish
        if (parsed.actionType === 'finish') {
          summary = parsed.summary || 'Task completed.'
          const trajectory: TAOTrajectory = {
            step,
            thought: parsed.thought,
            action: null,
            observation: summary,
            timestamp: Date.now(),
            status: 'success',
          }
          trajectories.push(trajectory)
          this.config.callbacks.onTrajectory(trajectory)
          status = 'completed'
          break
        }

        // 7. 处理工具调用
        if (parsed.actionType === 'tool' && parsed.toolName) {
          const toolExists = this.config.tools.has(parsed.toolName)
          const toolAction = buildToolAction(
            parsed.toolName,
            parsed.arguments || {},
            this.getToolDeclaredRisk(parsed.toolName),
          )

          const trajectory: TAOTrajectory = {
            step,
            thought: parsed.thought,
            action: toolAction,
            observation: '',
            timestamp: Date.now(),
            status: 'pending-approval',
          }

          // 7a. 审批检查（工具不存在时跳过审批，直接进入错误流程）
          const needsApproval =
            toolExists && shouldRequireApproval(toolAction, request.approvalMode)

          if (needsApproval) {
            const approvalRequest: ApprovalRequest = {
              executionId,
              step,
              toolAction,
              reason: `Tool "${parsed.toolName}" requires approval in ${request.approvalMode} mode.`,
            }

            // 推送轨迹（pending-approval 状态）
            this.config.callbacks.onTrajectory(trajectory)

            // 等待用户审批
            const response = await this.approvalManager.requestApproval(
              approvalRequest,
              this.config.approvalTimeoutMs,
              this.config.callbacks.onApprovalRequest,
            )

            if (!response.approved) {
              // 审批被拒绝或超时
              const rejectionReason = response.reason || 'REJECTED'
              trajectory.observation = `Action rejected: ${rejectionReason}`
              trajectory.status = 'rejected'

              if (rejectionReason === 'TIMEOUT') {
                // 审批超时，终止执行
                trajectories.push(trajectory)
                this.config.callbacks.onTrajectory(trajectory)
                status = 'failed'
                throw createError(
                  ErrorCodes.AGENT_APPROVAL_TIMEOUT,
                  `Approval timed out after ${this.config.approvalTimeoutMs}ms. Execution terminated.`,
                  { step, toolName: parsed.toolName },
                )
              }

              // 用户拒绝，将拒绝信息作为 Observation 反馈给 LLM
              trajectories.push(trajectory)
              this.config.callbacks.onTrajectory(trajectory)

              context.push({
                role: 'assistant',
                content: `Thought: ${parsed.thought}\nAction: ${JSON.stringify({ type: 'tool', tool: parsed.toolName, arguments: parsed.arguments })}`,
              })
              context.push({
                role: 'tool',
                content: buildObservation(parsed.toolName, {
                  isError: true,
                  content: `Action was rejected by user: ${rejectionReason}`,
                }),
              })
              continue
            }

            // 审批通过
            trajectory.status = 'approved'
          } else {
            // 不需要审批，直接推送 pending 轨迹
            trajectory.status = 'approved'
          }

          // 7b. 执行工具
          let toolResult: ToolExecutionResult
          try {
            toolResult = await this.executeTool(parsed.toolName, parsed.arguments || {})
          } catch (error) {
            toolResult = {
              isError: true,
              content: error instanceof Error ? error.message : String(error),
            }
          }

          // 7c. 生成 Observation
          trajectory.observation = toolResult.content
          trajectory.status = toolResult.isError ? 'error' : 'success'

          // 更新熔断计数
          if (toolResult.isError) {
            consecutiveFailures++
          } else {
            consecutiveFailures = 0
          }

          trajectories.push(trajectory)
          this.config.callbacks.onTrajectory(trajectory)

          // 7d. 熔断检查
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            status = 'failed'
            throw createError(
              ErrorCodes.AGENT_CIRCUIT_BREAK,
              `Circuit breaker: ${MAX_CONSECUTIVE_FAILURES} consecutive tool failures.`,
              { consecutiveFailures, lastTool: parsed.toolName },
            )
          }

          // 7e. 将结果反馈到上下文
          context.push({
            role: 'assistant',
            content: `Thought: ${parsed.thought}\nAction: ${JSON.stringify({ type: 'tool', tool: parsed.toolName, arguments: parsed.arguments })}`,
          })
          context.push({
            role: 'tool',
            content: buildObservation(parsed.toolName, toolResult),
          })
        }
      }

      // 检查是否达到最大步数
      if (status === 'running') {
        status = 'failed'
        throw createError(
          ErrorCodes.AGENT_MAX_STEPS,
          `Max steps (${request.maxSteps}) reached without completion.`,
          { maxSteps: request.maxSteps },
        )
      }
    } catch (error) {
      // 如果是 AppError，重新抛出（status 已在 try 中设置）
      if (error instanceof AppError) {
        throw error
      }
      // 包装未知错误
      throw createError(
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Unknown execution error',
      )
    } finally {
      this.abortController = null
      this.approvalManager.cancel()
    }

    const duration = Date.now() - startTime

    return {
      executionId,
      status,
      summary:
        summary || (status === 'cancelled' ? 'Execution cancelled.' : 'Execution completed.'),
      trajectories,
      totalSteps: trajectories.length,
      duration,
      tokensUsed: totalTokensUsed,
    }
  }

  /**
   * 取消当前执行。
   */
  cancel(): void {
    this.cancelled = true
    if (this.abortController) {
      this.abortController.abort()
    }
    this.approvalManager.cancel()
  }

  /**
   * 响应当前审批请求。
   * 供 IPC handler 的 agent:approve 调用。
   *
   * @param approved - 是否批准
   * @param reason - 可选的审批理由
   * @param executionId - 可选的执行 ID，用于校验响应是否对应当前等待中的审批
   */
  respondApproval(approved: boolean, reason?: string, executionId?: string): void {
    this.approvalManager.respond(approved, reason, executionId)
  }

  /**
   * 是否有等待中的审批。
   */
  hasPendingApproval(): boolean {
    return this.approvalManager.hasPendingApproval()
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /** 收集所有已注册工具的定义 */
  private collectToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = []
    for (const tool of this.config.tools.values()) {
      defs.push(tool.definition)
    }
    return defs
  }

  /** 获取工具声明的风险等级 */
  private getToolDeclaredRisk(toolName: string): ToolRiskLevel | undefined {
    const tool = this.config.tools.get(toolName)
    return tool?.definition.riskLevel
  }

  /** 执行工具 */
  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const tool = this.config.tools.get(toolName)
    if (!tool) {
      return {
        isError: true,
        content: `Tool "${toolName}" not found.`,
      }
    }

    return tool.execute(args)
  }
}
