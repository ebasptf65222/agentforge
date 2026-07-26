// AgentForge P2-03: Agent 审批机制
// 与 Spec v0.2 §9.3 审批机制 + §9.2 审批超时一致
//
// 审批模式 vs 风险等级：
// | 模式       | low  | medium | high |
// |------------|------|--------|------|
// | suggest    | 需审批 | 需审批  | 需审批 |
// | auto-edit  | 自动  | 需审批  | 需审批 |
// | full-auto  | 自动  | 自动   | 需审批 |
//
// 风险等级映射：
// - low: web_search, web_scrape, kb_search, file_read, directory_list
// - medium: file_write, image_generate, screenshot_ocr, kb_index
// - high: 所有 MCP 第三方工具（默认 high）

import type {
  ToolAction,
  ToolRiskLevel,
  ApprovalMode,
  ApprovalRequest,
  ApprovalResponse,
} from './types'

/** 内置工具的风险等级映射 */
const BUILTIN_TOOL_RISK: Record<string, ToolRiskLevel> = {
  web_search: 'low',
  web_scrape: 'low',
  kb_search: 'low',
  file_read: 'low',
  directory_list: 'low',
  file_write: 'medium',
  image_generate: 'medium',
  screenshot_ocr: 'medium',
  kb_index: 'medium',
}

/**
 * 获取工具的风险等级。
 * 优先使用工具定义中声明的 riskLevel，否则查内置映射表，默认 high。
 *
 * @param toolName - 工具名称
 * @param declaredRisk - 工具定义中声明的风险等级（可选）
 * @returns 风险等级
 */
export function getToolRiskLevel(
  toolName: string,
  declaredRisk?: ToolRiskLevel,
): ToolRiskLevel {
  if (declaredRisk) return declaredRisk
  return BUILTIN_TOOL_RISK[toolName] ?? 'high'
}

/**
 * 审批决策矩阵：根据审批模式和风险等级判断是否需要审批。
 *
 * | 模式       | low  | medium | high |
 * |------------|------|--------|------|
 * | suggest    | 需审批 | 需审批  | 需审批 |
 * | auto-edit  | 自动  | 需审批  | 需审批 |
 * | full-auto  | 自动  | 自动   | 需审批 |
 */
const APPROVAL_MATRIX: Record<ApprovalMode, Record<ToolRiskLevel, boolean>> = {
  suggest: { low: true, medium: true, high: true },
  'auto-edit': { low: false, medium: true, high: true },
  'full-auto': { low: false, medium: false, high: true },
}

/**
 * 判断工具调用是否需要用户审批。
 *
 * @param toolAction - 工具动作信息
 * @param approvalMode - 当前审批模式
 * @returns 是否需要审批
 */
export function shouldRequireApproval(
  toolAction: ToolAction,
  approvalMode: ApprovalMode,
): boolean {
  const riskLevel = toolAction.riskLevel
  return APPROVAL_MATRIX[approvalMode][riskLevel]
}

// ─── 审批等待器 ─────────────────────────────────────────────────

/** 默认审批超时时间（5 分钟） */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000

/**
 * 审批等待器。
 * 管理一个审批请求的 Promise，支持：
 * - 等待用户响应（resolve/reject）
 * - 超时自动拒绝
 * - 手动取消
 */
export class ApprovalWaiter {
  private responsePromise: Promise<ApprovalResponse>
  private resolveFn!: (response: ApprovalResponse) => void
  private rejectFn!: (error: Error) => void
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null
  private settled = false

  constructor(
    private request: ApprovalRequest,
    timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS,
  ) {
    this.responsePromise = new Promise((resolve, reject) => {
      this.resolveFn = resolve
      this.rejectFn = reject
    })

    // 超时自动拒绝
    this.timeoutHandle = setTimeout(() => {
      if (!this.settled) {
        this.settled = true
        this.resolveFn({
          executionId: request.executionId,
          step: request.step,
          approved: false,
          reason: 'TIMEOUT',
        })
      }
    }, timeoutMs)
  }

  /**
   * 等待审批响应。
   */
  waitForResponse(): Promise<ApprovalResponse> {
    return this.responsePromise
  }

  /**
   * 用户响应审批（通过或拒绝）。
   */
  respond(approved: boolean, reason?: string): void {
    if (this.settled) return
    this.settled = true
    this.clearTimeout()

    this.resolveFn({
      executionId: this.request.executionId,
      step: this.request.step,
      approved,
      reason,
    })
  }

  /**
   * 取消审批等待（用户取消了整个执行）。
   */
  cancel(): void {
    if (this.settled) return
    this.settled = true
    this.clearTimeout()

    this.resolveFn({
      executionId: this.request.executionId,
      step: this.request.step,
      approved: false,
      reason: 'CANCELLED',
    })
  }

  /**
   * 获取关联的审批请求。
   */
  getRequest(): ApprovalRequest {
    return this.request
  }

  /** 清理超时定时器 */
  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }
}

/**
 * 审批管理器。
 * 管理当前活跃的审批等待器，供 IPC handler 调用。
 */
export class ApprovalManager {
  private currentWaiter: ApprovalWaiter | null = null

  /**
   * 创建一个新的审批等待并返回。
   * 同时会触发 onApprovalRequest 回调。
   *
   * @param request - 审批请求
   * @param timeoutMs - 超时时间
   * @param onRequest - 请求回调（用于推送事件到渲染进程）
   * @returns 审批响应
   */
  async requestApproval(
    request: ApprovalRequest,
    timeoutMs: number,
    onRequest: (request: ApprovalRequest) => void,
  ): Promise<ApprovalResponse> {
    // 如果已有等待中的审批，先拒绝旧的
    if (this.currentWaiter) {
      this.currentWaiter.cancel()
    }

    const waiter = new ApprovalWaiter(request, timeoutMs)
    this.currentWaiter = waiter

    // 推送审批请求到渲染进程
    onRequest(request)

    const response = await waiter.waitForResponse()
    // 只有当当前 waiter 仍是本实例时才清除（避免竞态条件）
    if (this.currentWaiter === waiter) {
      this.currentWaiter = null
    }
    return response
  }

  /**
   * 响应当前审批。
   * 供 IPC handler 的 agent:approve 调用。
   */
  respond(approved: boolean, reason?: string): void {
    if (this.currentWaiter) {
      this.currentWaiter.respond(approved, reason)
    }
  }

  /**
   * 取消当前审批等待。
   * 供 IPC handler 的 agent:stop 调用。
   */
  cancel(): void {
    if (this.currentWaiter) {
      this.currentWaiter.cancel()
      this.currentWaiter = null
    }
  }

  /**
   * 是否有等待中的审批。
   */
  hasPendingApproval(): boolean {
    return this.currentWaiter !== null
  }

  /**
   * 获取当前等待中的审批请求（仅供测试）。
   */
  getCurrentRequest(): ApprovalRequest | null {
    return this.currentWaiter?.getRequest() ?? null
  }
}

/**
 * 构建 ToolAction 对象。
 */
export function buildToolAction(
  toolName: string,
  args: Record<string, unknown>,
  declaredRisk?: ToolRiskLevel,
): ToolAction {
  const riskLevel = getToolRiskLevel(toolName, declaredRisk)
  return {
    toolName,
    arguments: args,
    riskLevel,
    requiresApproval: false, // 由 shouldRequireApproval 在运行时判断
  }
}
