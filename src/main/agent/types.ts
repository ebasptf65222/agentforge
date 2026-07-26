// AgentForge P2-02: Agent 内部类型定义
// 与 Spec v0.2 §9 ReAct 执行引擎规格一致

import type {
  AgentExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  TAOTrajectory,
  ToolAction,
  ToolDefinition,
  ToolExecutionResult,
  ToolRiskLevel,
  ApprovalMode,
  ApprovalRequest,
  ApprovalResponse,
} from '@shared/types'
import type { AdapterMessage } from '../models/adapter'

// ─── LLM 输出解析类型 ───────────────────────────────────────────

/** LLM 解析出的 Action 类型 */
export type ParsedActionType = 'tool' | 'finish'

/** 解析后的 LLM 输出 */
export interface ParsedLLMResponse {
  /** Thought（推理过程） */
  thought: string
  /** Action 类型 */
  actionType: ParsedActionType
  /** 工具名（actionType === 'tool' 时） */
  toolName?: string
  /** 工具参数（actionType === 'tool' 时） */
  arguments?: Record<string, unknown>
  /** 完成总结（actionType === 'finish' 时） */
  summary?: string
  /** 原始 LLM 输出 */
  rawOutput: string
}

// ─── 上下文管理类型 ─────────────────────────────────────────────

/** Agent 上下文消息 */
export interface AgentContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

// ─── 工具执行器接口 ─────────────────────────────────────────────

/** 工具执行函数类型 */
export type ToolExecuteFn = (args: Record<string, unknown>) => Promise<ToolExecutionResult>

/** 注册的工具条目 */
export interface RegisteredTool {
  definition: ToolDefinition
  execute: ToolExecuteFn
}

// ─── 事件回调类型 ───────────────────────────────────────────────

/** Agent 事件回调集合 */
export interface AgentEventCallbacks {
  /** 每步执行完成时推送轨迹 */
  onTrajectory: (trajectory: TAOTrajectory) => void
  /** 需要审批时推送请求 */
  onApprovalRequest: (request: ApprovalRequest) => void
  /** 流式文本输出（LLM 回复内容） */
  onStreamChunk: (chunk: { type: string; content: string }) => void
}

// ─── 审批决策类型 ───────────────────────────────────────────────

/** 审批决策结果 */
export interface ApprovalDecision {
  /** 是否需要用户审批 */
  requiresApproval: boolean
  /** 工具动作 */
  toolAction: ToolAction
}

// ─── 重导出共享类型 ─────────────────────────────────────────────

export type {
  AgentExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  TAOTrajectory,
  ToolAction,
  ToolDefinition,
  ToolExecutionResult,
  ToolRiskLevel,
  ApprovalMode,
  ApprovalRequest,
  ApprovalResponse,
  AdapterMessage,
}
