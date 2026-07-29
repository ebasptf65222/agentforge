// AgentForge: UserInputManager
// 管理 SDK ask_user / elicitation 的双向 IPC 通信
// 模式与 ApprovalManager 一致：创建 Promise → 推送到前端 → 等待 IPC 响应

import { randomUUID } from 'node:crypto'
import type {
  UserInputRequest,
  ElicitationRequest,
} from '@shared/types'

/** 默认用户输入超时时间（5 分钟） */
const DEFAULT_USER_INPUT_TIMEOUT_MS = 300_000

/**
 * 用户输入等待器。
 * 管理一个 ask_user 请求的 Promise，支持：
 * - 等待用户响应（resolve）
 * - 超时自动返回空
 * - 手动取消
 */
export class UserInputWaiter {
  private responsePromise: Promise<string>
  private resolveFn!: (response: string) => void
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null
  private settled = false

  constructor(
    private request: UserInputRequest,
    timeoutMs: number = DEFAULT_USER_INPUT_TIMEOUT_MS,
  ) {
    this.responsePromise = new Promise((resolve) => {
      this.resolveFn = resolve
    })

    this.timeoutHandle = setTimeout(() => {
      if (!this.settled) {
        this.settled = true
        this.resolveFn('')
      }
    }, timeoutMs)
  }

  waitForResponse(): Promise<string> {
    return this.responsePromise
  }

  respond(response: string): void {
    if (this.settled) return
    this.settled = true
    this.clearTimeout()
    this.resolveFn(response)
  }

  cancel(): void {
    if (this.settled) return
    this.settled = true
    this.clearTimeout()
    this.resolveFn('')
  }

  getRequest(): UserInputRequest {
    return this.request
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }
}

/**
 * Elicitation 等待器。
 * 管理 elicitation 表单请求的 Promise。
 */
export class ElicitationWaiter {
  private responsePromise: Promise<Record<string, unknown>>
  private resolveFn!: (response: Record<string, unknown>) => void
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null
  private settled = false

  constructor(
    private request: ElicitationRequest,
    timeoutMs: number = DEFAULT_USER_INPUT_TIMEOUT_MS,
  ) {
    this.responsePromise = new Promise((resolve) => {
      this.resolveFn = resolve
    })

    this.timeoutHandle = setTimeout(() => {
      if (!this.settled) {
        this.settled = true
        this.resolveFn({})
      }
    }, timeoutMs)
  }

  waitForResponse(): Promise<Record<string, unknown>> {
    return this.responsePromise
  }

  respond(response: Record<string, unknown>): void {
    if (this.settled) return
    this.settled = true
    this.clearTimeout()
    this.resolveFn(response)
  }

  cancel(): void {
    if (this.settled) return
    this.settled = true
    this.clearTimeout()
    this.resolveFn({})
  }

  getRequest(): ElicitationRequest {
    return this.request
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }
}

/**
 * 用户输入管理器。
 * 管理 ask_user 和 elicitation 的当前等待器。
 */
export class UserInputManager {
  private currentInputWaiter: UserInputWaiter | null = null
  private currentElicitationWaiter: ElicitationWaiter | null = null

  /**
   * 发起一个 ask_user 请求，推送问题到前端并等待响应。
   */
  async requestUserInput(
    executionId: string,
    prompt: string,
    onPush: (request: UserInputRequest) => void,
    timeoutMs: number = DEFAULT_USER_INPUT_TIMEOUT_MS,
  ): Promise<string> {
    // 如果已有等待中的请求，先取消
    if (this.currentInputWaiter) {
      this.currentInputWaiter.cancel()
    }

    const request: UserInputRequest = {
      requestId: randomUUID(),
      executionId,
      prompt,
    }

    const waiter = new UserInputWaiter(request, timeoutMs)
    this.currentInputWaiter = waiter

    onPush(request)

    const response = await waiter.waitForResponse()
    if (this.currentInputWaiter === waiter) {
      this.currentInputWaiter = null
    }
    return response
  }

  /**
   * 发起一个 elicitation 请求，推送表单到前端并等待响应。
   */
  async requestElicitation(
    executionId: string,
    message: string,
    form: Record<string, unknown>,
    onPush: (request: ElicitationRequest) => void,
    timeoutMs: number = DEFAULT_USER_INPUT_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (this.currentElicitationWaiter) {
      this.currentElicitationWaiter.cancel()
    }

    const request: ElicitationRequest = {
      requestId: randomUUID(),
      executionId,
      message,
      form,
    }

    const waiter = new ElicitationWaiter(request, timeoutMs)
    this.currentElicitationWaiter = waiter

    onPush(request)

    const response = await waiter.waitForResponse()
    if (this.currentElicitationWaiter === waiter) {
      this.currentElicitationWaiter = null
    }
    return response
  }

  /**
   * 响应当前的 ask_user 请求。
   */
  respondToUserInput(requestId: string, response: string): boolean {
    if (this.currentInputWaiter?.getRequest().requestId === requestId) {
      this.currentInputWaiter.respond(response)
      return true
    }
    return false
  }

  /**
   * 响应当前的 elicitation 请求。
   */
  respondToElicitation(requestId: string, response: Record<string, unknown>): boolean {
    if (this.currentElicitationWaiter?.getRequest().requestId === requestId) {
      this.currentElicitationWaiter.respond(response)
      return true
    }
    return false
  }

  /**
   * 取消所有等待中的请求（用户取消执行时调用）。
   */
  cancel(): void {
    this.currentInputWaiter?.cancel()
    this.currentElicitationWaiter?.cancel()
    this.currentInputWaiter = null
    this.currentElicitationWaiter = null
  }
}
