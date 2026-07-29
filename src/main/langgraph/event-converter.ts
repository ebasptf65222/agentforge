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
