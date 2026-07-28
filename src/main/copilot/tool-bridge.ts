// Tool bridge: wraps AgentForge tools as Copilot SDK defineTool entries
// Embeds approval checks within each tool handler
// Step 3: Tool bridging + approval mechanism adaptation

import { defineTool, type Tool, type ToolResultObject } from '@github/copilot-sdk'
import type {
  ApprovalMode,
  ApprovalRequest,
  TAOTrajectory,
  ToolAction,
  ToolRiskLevel,
} from '@shared/types'
import type { AgentEventCallbacks } from '../agent/types'
import { getToolRegistry } from '../tools/registry'
import type { ApprovalManager } from '../agent/approval'
import {
  shouldRequireApproval,
  buildToolAction,
} from '../agent/approval'
import { buildToolStartTrajectory, buildToolCompleteTrajectory } from './event-converter'

/**
 * Context for tool bridging — passed to bridgeAllTools.
 */
export interface ToolBridgeContext {
  /** Unique execution ID for this agent run (used in ApprovalRequest) */
  executionId: string
  /** Current approval mode (from request or settings) */
  approvalMode: ApprovalMode
  /** Approval timeout in milliseconds */
  approvalTimeoutMs: number
  /** Approval manager instance (manages pending approval waiters) */
  approvalManager: ApprovalManager
  /** Event callbacks for pushing trajectories and approval requests to frontend */
  callbacks: AgentEventCallbacks
}

/**
 * Convert AgentForge ToolExecutionResult to SDK ToolResultObject.
 */
function toToolResult(
  content: string,
  isError: boolean,
): string | ToolResultObject {
  if (isError) {
    return {
      textResultForLlm: content,
      resultType: 'failure' as const,
      error: content,
    }
  }
  return content
}

/**
 * Bridge all registered tools (builtin + MCP) to Copilot SDK defineTool format.
 *
 * Each tool handler embeds the approval workflow:
 * 1. Determine risk level via getToolRiskLevel
 * 2. Check shouldRequireApproval(toolAction, approvalMode)
 * 3. If approval needed → push ApprovalRequest to frontend, wait for response
 * 4. If approved or no approval → execute tool
 * 5. Push trajectory events (tool start + complete)
 *
 * @param ctx - Tool bridge context
 * @returns Array of SDK Tool objects
 */
export function bridgeAllTools(ctx: ToolBridgeContext): Tool[] {
  const registry = getToolRegistry()
  const tools: Tool[] = []
  let stepCounter = 0

  for (const registeredTool of registry.list()) {
    const def = registeredTool.definition
    const executeFn = registeredTool.execute

    const tool = defineTool(def.name, {
      description: def.description,
      parameters: def.inputSchema,
      handler: async (args: unknown) => {
        const step = ++stepCounter
        const toolArgs = (args || {}) as Record<string, unknown>
        const timestamp = Date.now()

        // 1. Build tool action and determine risk level
        const declaredRisk: ToolRiskLevel | undefined = def.riskLevel
        const toolAction: ToolAction = buildToolAction(def.name, toolArgs, declaredRisk)

        // 2. Check if approval is needed
        const needsApproval = shouldRequireApproval(toolAction, ctx.approvalMode)

        if (needsApproval) {
          // 3. Push pending-approval trajectory
          const startTrajectory: TAOTrajectory = buildToolStartTrajectory(
            step,
            def.name,
            toolArgs,
            toolAction.riskLevel,
            true,
            timestamp,
          )
          ctx.callbacks.onTrajectory(startTrajectory)

          // 4. Request approval (blocks until user responds or timeout)
          const approvalRequest: ApprovalRequest = {
            executionId: ctx.executionId,
            step,
            toolAction,
            reason: `Tool "${def.name}" requires approval (risk: ${toolAction.riskLevel}).`,
          }

          const response = await ctx.approvalManager.requestApproval(
            approvalRequest,
            ctx.approvalTimeoutMs,
            ctx.callbacks.onApprovalRequest,
          )

          // 5. If not approved, return rejection
          if (!response.approved) {
            const rejectReason = response.reason || 'REJECTED'
            const rejectTrajectory: TAOTrajectory = buildToolCompleteTrajectory(
              step,
              def.name,
              toolArgs,
              `Approval ${rejectReason.toLowerCase()}`,
              true,
              Date.now(),
            )
            ctx.callbacks.onTrajectory(rejectTrajectory)

            return {
              textResultForLlm: `Tool execution rejected: ${rejectReason}`,
              resultType: 'rejected' as const,
              error: rejectReason,
            } satisfies ToolResultObject
          }
        } else {
          // No approval needed — push tool-start trajectory
          const startTrajectory: TAOTrajectory = buildToolStartTrajectory(
            step,
            def.name,
            toolArgs,
            toolAction.riskLevel,
            false,
            timestamp,
          )
          ctx.callbacks.onTrajectory(startTrajectory)
        }

        // 6. Execute the tool
        let result
        try {
          result = await executeFn(toolArgs)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Tool execution failed'
          const errorTrajectory: TAOTrajectory = buildToolCompleteTrajectory(
            step,
            def.name,
            toolArgs,
            errorMsg,
            true,
            Date.now(),
          )
          ctx.callbacks.onTrajectory(errorTrajectory)

          return {
            textResultForLlm: errorMsg,
            resultType: 'failure' as const,
            error: errorMsg,
          } satisfies ToolResultObject
        }

        // 7. Push tool-complete trajectory
        const completeTrajectory: TAOTrajectory = buildToolCompleteTrajectory(
          step,
          def.name,
          toolArgs,
          result.content,
          result.isError,
          Date.now(),
        )
        ctx.callbacks.onTrajectory(completeTrajectory)

        // 8. Return result to SDK
        return toToolResult(result.content, result.isError)
      },
    })

    tools.push(tool)
  }

  return tools
}
