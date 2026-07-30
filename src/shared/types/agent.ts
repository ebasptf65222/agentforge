// AgentForge 共享类型定义 - Agent 执行类型
// 与 Spec v0.2 §5.4 一致

import type { ApprovalMode, ExecutionStatus, ToolRiskLevel } from './enums'

// ─── 5.4 Agent 执行类型 ────────────────────────────────────────────

/** Agent 执行请求 */
export interface AgentExecutionRequest {
  conversationId: string
  userInput: string
  modelId: string
  skillName?: string
  approvalMode: ApprovalMode
  maxSteps: number
  /** 图片附件（dataUrl 格式），传给 SDK session.send */
  attachments?: Array<{ dataUrl: string; name: string; size: number }>
  /** 自定义代理配置（per-conversation，传给 SDK customAgents） */
  customAgents?: Array<{
    name: string
    displayName?: string
    description?: string
    tools?: string[] | null
    prompt: string
    infer?: boolean
    model?: string
    reasoningEffort?: string
    skills?: string[]
  }>
  /** 预选激活的代理名称 */
  activeAgent?: string
  /** 自定义斜杠命令 */
  commands?: Array<{ name: string; description?: string }>
  /** 系统提示词模式 */
  systemMessageMode?: 'append' | 'replace' | 'customize'
  /** 系统提示词分区配置 */
  systemMessageSections?: Record<
    string,
    {
      action: 'replace' | 'remove' | 'append' | 'prepend' | 'transform'
      content?: string
      transformDescription?: string
    }
  >
}

/** Agent 执行结果 */
export interface ExecutionResult {
  executionId: string
  status: ExecutionStatus
  summary: string
  trajectories: TAOTrajectory[]
  totalSteps: number
  duration: number
  tokensUsed: number
}

/** TAO 轨迹（单步） */
export interface TAOTrajectory {
  step: number
  thought: string
  action: ToolAction | null
  observation: string
  timestamp: number
  status: 'success' | 'error' | 'pending-approval' | 'approved' | 'rejected'
}

/** 工具动作 */
export interface ToolAction {
  toolName: string
  arguments: Record<string, unknown>
  riskLevel: ToolRiskLevel
  requiresApproval: boolean
}

/** 审批请求事件 */
export interface ApprovalRequest {
  executionId: string
  step: number
  toolAction: ToolAction
  reason: string
}

/** 审批响应 */
export interface ApprovalResponse {
  executionId: string
  step: number
  approved: boolean
  reason?: string
}

/** AI 主动提问请求（ask_user） */
export interface UserInputRequest {
  /** 唯一请求 ID */
  requestId: string
  /** 关联的执行 ID */
  executionId: string
  /** AI 提出的问题 */
  prompt: string
}

/** AI 主动提问响应 */
export interface UserInputResponse {
  /** 对应的请求 ID */
  requestId: string
  /** 用户的回答 */
  response: string
}

/** Elicitation 表单请求 */
export interface ElicitationRequest {
  /** 唯一请求 ID */
  requestId: string
  /** 关联的执行 ID */
  executionId: string
  /** 表单提示消息 */
  message: string
  /** 表单字段定义 */
  form: Record<string, unknown>
}

/** Elicitation 表单响应 */
export interface ElicitationResponse {
  /** 对应的请求 ID */
  requestId: string
  /** 用户填写的表单数据 */
  response: Record<string, unknown>
}
