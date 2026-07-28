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
