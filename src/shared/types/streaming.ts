// AgentForge 共享类型定义 - 流式与 IPC 类型
// 与 Spec v0.2 §5.3 一致

import type { StreamChunkType } from './enums'

// ─── 5.3 流式与 IPC 类型 ───────────────────────────────────────────

/** 流式 chunk */
export interface StreamChunk {
  type: StreamChunkType
  content: string
  done?: boolean
}

/** 流式结束元信息 */
export interface StreamEndMetadata {
  messageId: string
  tokensUsed: number
  duration: number
  modelId: string
  stopped: boolean
}

/** 流式错误 */
export interface StreamError {
  code: string
  message: string
  details?: Record<string, unknown>
}
