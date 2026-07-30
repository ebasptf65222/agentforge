// AgentForge 架构优化批次B-1: ExecutionLock
//
// 正式的执行锁，替代 engine-dispatcher.ts 中的三个模块级变量
// （currentExecutor / currentBridge / currentLangGraphBridge）。
//
// 职责：
// 1. 互斥控制：同一时间只允许一个引擎执行
// 2. 持有当前活跃引擎的引用，供 IPC handler 访问
// 3. 提供 acquire/release 语义，确保异常时也能释放锁

import { AppError, ErrorCodes } from '../utils/error'

/**
 * 执行锁。
 *
 * 泛型参数 T 表示锁持有的引擎句柄类型。
 * 典型用法：
 * ```ts
 * const lock = new ExecutionLock<EngineHandle>()
 * lock.acquire(handle)  // 获取锁，若已锁定则抛出 CHAT_ALREADY_RUNNING
 * try {
 *   // ... 执行 agent ...
 * } finally {
 *   lock.release()  // 释放锁
 * }
 * ```
 */
export class ExecutionLock<T> {
  private current: T | null = null

  /**
   * 获取执行锁。
   * 如果锁已被持有，抛出 CHAT_ALREADY_RUNNING 错误。
   *
   * @param value - 锁持有期间存储的引擎句柄
   * @throws {AppError} CHAT_ALREADY_RUNNING - 锁已被持有
   */
  acquire(value: T): void {
    if (this.current !== null) {
      throw new AppError(
        ErrorCodes.CHAT_ALREADY_RUNNING,
        'An agent execution is already running.',
      )
    }
    this.current = value
  }

  /**
   * 释放执行锁。
   * 幂等：重复调用安全。
   */
  release(): void {
    this.current = null
  }

  /**
   * 检查锁是否被持有。
   */
  isLocked(): boolean {
    return this.current !== null
  }

  /**
   * 获取当前锁持有的引擎句柄。
   * @returns 引擎句柄，或 null（未锁定时）
   */
  getCurrent(): T | null {
    return this.current
  }

  /**
   * 强制重置锁状态（仅供测试使用）。
   */
  reset(): void {
    this.current = null
  }
}
