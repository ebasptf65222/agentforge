// SDK event to AgentForge IPC event converter
// Transforms Copilot SDK streaming events to AgentForge's format

import type { StreamChunk, TAOTrajectory, ToolRiskLevel } from '@shared/types'

/**
 * Convert SDK assistant.message_delta event data to AgentForge StreamChunk.
 */
export function convertMessageDelta(deltaContent: string): StreamChunk {
  return {
    type: 'text',
    content: deltaContent,
  }
}

/**
 * Convert SDK assistant.reasoning_delta event data to AgentForge StreamChunk.
 */
export function convertReasoningDelta(deltaContent: string): StreamChunk {
  return {
    type: 'thinking',
    content: deltaContent,
  }
}

/**
 * Convert SDK session.compaction_start event to AgentForge StreamChunk.
 * 前端可显示"正在压缩上下文..."。
 */
export function convertCompactionStart(content: string): StreamChunk {
  return {
    type: 'compaction',
    content,
  }
}

/**
 * Convert SDK session.compaction_complete event to AgentForge StreamChunk.
 * 包含压缩前后 token 数、移除的消息数等信息。
 */
export function convertCompactionComplete(content: string): StreamChunk {
  return {
    type: 'compaction',
    content,
  }
}

/**
 * Convert SDK tool.execution_start event to AgentForge StreamChunk.
 * content 为序列化的 { toolName, toolCallId, arguments } JSON。
 */
export function convertToolStart(content: string): StreamChunk {
  return {
    type: 'tool-start',
    content,
  }
}

/**
 * Convert SDK tool.execution_complete event to AgentForge StreamChunk.
 * content 为序列化的 { toolCallId, success, content } JSON。
 */
export function convertToolComplete(content: string): StreamChunk {
  return {
    type: 'tool-complete',
    content,
  }
}

/**
 * Convert SDK tool.execution_progress event to AgentForge StreamChunk.
 * content 为序列化的 { toolCallId, message } JSON。
 */
export function convertToolProgress(content: string): StreamChunk {
  return {
    type: 'tool-progress',
    content,
  }
}

/**
 * Convert SDK session.title_changed event to AgentForge StreamChunk.
 * content 为自动生成的会话标题。
 */
export function convertTitle(content: string): StreamChunk {
  return {
    type: 'title',
    content,
  }
}

/**
 * Convert SDK session.usage_info event to AgentForge StreamChunk.
 * content 为序列化的 { tokenLimit, currentTokens, messagesLength } JSON。
 * 前端可显示上下文使用进度条。
 */
export function convertUsageInfo(content: string): StreamChunk {
  return {
    type: 'usage-info',
    content,
  }
}

/**
 * Convert SDK session.error event to AgentForge StreamChunk.
 * content 为序列化的 { errorType, message, statusCode? } JSON。
 */
export function convertSessionError(content: string): StreamChunk {
  return {
    type: 'error',
    content,
  }
}

/**
 * Build a TAOTrajectory from SDK tool execution events.
 * Used when a tool starts executing to create a trajectory entry.
 */
export function buildToolStartTrajectory(
  step: number,
  toolName: string,
  toolArgs: Record<string, unknown>,
  riskLevel: ToolRiskLevel,
  requiresApproval: boolean,
  timestamp: number,
): TAOTrajectory {
  return {
    step,
    thought: `Calling tool: ${toolName}`,
    action: {
      toolName,
      arguments: toolArgs,
      riskLevel,
      requiresApproval,
    },
    observation: '',
    timestamp,
    status: requiresApproval ? 'pending-approval' : 'success',
  }
}

/**
 * Update a trajectory entry when tool execution completes.
 */
export function buildToolCompleteTrajectory(
  step: number,
  toolName: string,
  toolArgs: Record<string, unknown>,
  result: string,
  isError: boolean,
  timestamp: number,
): TAOTrajectory {
  return {
    step,
    thought: `Tool ${toolName} ${isError ? 'failed' : 'completed'}`,
    action: {
      toolName,
      arguments: toolArgs,
      riskLevel: 'low',
      requiresApproval: false,
    },
    observation: result,
    timestamp,
    status: isError ? 'error' : 'success',
  }
}

/**
 * Build a TAOTrajectory for the final assistant message.
 */
export function buildFinalTrajectory(step: number, content: string, timestamp: number): TAOTrajectory {
  return {
    step,
    thought: content,
    action: null,
    observation: '',
    timestamp,
    status: 'success',
  }
}
