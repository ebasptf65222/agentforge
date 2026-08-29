// AgentForge P2-02: Agent 内部类型定义

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

// ─── 上下文管理类型 ─────────────────────────────────────────────

/** Agent 上下文消息 */
export interface AgentContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

// ─── 工具执行器接口 ─────────────────────────────────────────────

/** 工具执行函数类型 */
export type ToolExecuteFn = (args: Record<string, unknown>) => Promise<ToolExecutionResult>

/** 注册的工具条目（基础类型，tools/types.ts 中扩展此类型添加 source 等字段） */
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
