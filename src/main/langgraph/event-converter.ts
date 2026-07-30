// LangGraph 引擎: 事件转换器
// 将 ReAct 循环内部产生的事件映射为 AgentEventCallbacks

import type { AgentEventCallbacks } from '../agent/types'
import type { TAOTrajectory } from '../../shared/types'

/**
 * 事件转换器：将 LangGraph 执行事件映射为 AgentEventCallbacks
 */
export class EventConverter {
  private stepCounter = 0
  private startTime: number

  constructor(private callbacks: AgentEventCallbacks) {
    this.startTime = Date.now()
  }

  /** 推送流式文本 */
  pushText(content: string): void {
    if (content) {
      this.callbacks.onStreamChunk({ type: 'text', content })
    }
  }

  /** 推送工具开始事件 */
  pushToolStart(toolName: string, _args: unknown): void {
    this.callbacks.onStreamChunk({ type: 'tool-start', content: toolName })
  }

  /** 推送工具完成事件 */
  pushToolComplete(_toolName: string, result: string): void {
    this.callbacks.onStreamChunk({ type: 'tool-complete', content: result })
  }

  /**
   * 推送 ask-user 事件。
   *
   * 当 copilot_ask_user 委托工具触发时，将用户提问请求推送到前端。
   * 前端通过 IPC agent:respond-user-input 回复。
   *
   * @param requestJson - 序列化的 UserInputRequest
   */
  pushAskUser(requestJson: string): void {
    this.callbacks.onStreamChunk({ type: 'ask-user', content: requestJson })
  }

  /**
   * 推送 elicitation-request 事件。
   *
   * 当 copilot_elicitation 委托工具触发时，将表单请求推送到前端。
   * 前端通过 IPC agent:respond-elicitation 回复。
   *
   * @param requestJson - 序列化的 ElicitationRequest
   */
  pushElicitationRequest(requestJson: string): void {
    this.callbacks.onStreamChunk({ type: 'elicitation-request', content: requestJson })
  }

  /**
   * 推送节点级更新事件（P3-03: stream() 实时事件流）。
   *
   * 当 StateGraph 使用 stream() 执行时，每个节点完成后会通过
   * 'updates' streamMode 推送节点级更新。此方法将这些更新
   * 转发为 AgentEventCallbacks 中的 onStreamChunk 事件。
   *
   * @param nodeName - 图节点名称（如 'agent'、'tools'）
   * @param update - 节点返回的状态更新
   */
  pushNodeUpdate(nodeName: string, update: Record<string, unknown>): void {
    this.callbacks.onStreamChunk({
      type: 'node-update',
      content: JSON.stringify({ node: nodeName, update }),
    })
  }

  /** 构建并推送轨迹 */
  pushTrajectory(params: {
    thought: string
    action: TAOTrajectory['action']
    observation: string
    status: TAOTrajectory['status']
  }): TAOTrajectory {
    const trajectory: TAOTrajectory = {
      step: ++this.stepCounter,
      thought: params.thought,
      action: params.action,
      observation: params.observation,
      timestamp: Date.now(),
      status: params.status,
    }
    this.callbacks.onTrajectory(trajectory)
    return trajectory
  }

  /** 获取执行耗时 */
  getDuration(): number {
    return Date.now() - this.startTime
  }

  /** 重置 */
  reset(): void {
    this.stepCounter = 0
    this.startTime = Date.now()
  }
}
