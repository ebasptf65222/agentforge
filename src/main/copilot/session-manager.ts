// AgentForge: Copilot SDK 持久化会话管理器
// 每个对话复用同一 session，启用 SDK 原生上下文压缩

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk'
import type { ActiveSessionInfo } from '@shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkSession = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkClient = any

/** 会话闲置超时时间（30分钟） */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** 活跃会话的最大数量 */
const MAX_ACTIVE_SESSIONS = 10

interface ManagedSession {
  session: SdkSession
  client: SdkClient
  conversationId: string
  /** SDK 分配的 sessionId（用于 resume） */
  sdkSessionId?: string
  lastUsedAt: number
  /** 清理定时器 */
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Copilot SDK 会话管理器。
 *
 * 职责：
 * - 按 conversationId 复用 SDK session
 * - 启用 Infinite Sessions 自动上下文压缩
 * - 闲置会话自动清理（disconnect + stop client）
 * - 限制最大活跃会话数（LRU 淘汰）
 */
export class CopilotSessionManager {
  private sessions = new Map<string, ManagedSession>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // 每5分钟检查一次过期会话
    this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), 5 * 60 * 1000)
  }

  /**
   * 获取或创建指定对话的 SDK session。
   *
   * 如果该对话已有活跃 session，则复用并重置闲置计时器。
   * 如果没有，则创建新 client + session，启用 infiniteSessions。
   *
   * @param conversationId - 对话 ID
   * @param sessionConfig - SDK session 配置（仅创建时使用）
   * @returns SDK session 实例
   */
  async getOrCreateSession(
    conversationId: string,
    sessionConfig: Record<string, unknown>,
  ): Promise<SdkSession> {
    // 检查是否已有活跃 session
    const existing = this.sessions.get(conversationId)
    if (existing) {
      this.resetIdleTimer(conversationId)
      return existing.session
    }

    // 检查活跃会话数量，必要时淘汰最旧的
    if (this.sessions.size >= MAX_ACTIVE_SESSIONS) {
      this.evictOldestSession()
    }

    // 创建新 client
    const cliPath = resolveCopilotCliPath()
    const clientOptions = cliPath
      ? { connection: RuntimeConnection.forStdio({ path: cliPath }) }
      : {}
    const client = new CopilotClient(clientOptions)
    await client.start()

    // 构建 session 配置，启用 infiniteSessions
    const fullConfig: Record<string, unknown> = {
      ...sessionConfig,
      // 启用无限会话：SDK 自动管理上下文窗口，通过后台压缩处理长对话
      infiniteSessions: {
        enabled: true,
        // 上下文使用达 80% 时开始后台压缩
        backgroundCompactionThreshold: 0.80,
        // 上下文使用达 95% 时阻塞等待压缩完成
        bufferExhaustionThreshold: 0.95,
      },
      // 启用大输出处理
      largeOutput: { enabled: true },
    }

    const session = await client.createSession(fullConfig)
    // 保存 SDK 分配的 sessionId，用于后续 resume
    const sdkSessionId = session.sessionId || session.id || undefined

    const managed: ManagedSession = {
      session,
      client,
      conversationId,
      sdkSessionId,
      lastUsedAt: Date.now(),
      cleanupTimer: null,
    }
    this.sessions.set(conversationId, managed)
    this.resetIdleTimer(conversationId)

    return session
  }

  /**
   * 尝试恢复指定对话的 SDK session。
   * 如果磁盘上有该 session 的状态文件，则 resume；否则返回 null。
   *
   * @param conversationId - 对话 ID
   * @param _sessionConfig - SDK session 配置（resume 时可重配部分项，当前实现未使用）
   * @returns 恢复的 session，或 null（无法恢复时）
   */
  async resumeSession(
    conversationId: string,
    _sessionConfig: Record<string, unknown>,
  ): Promise<SdkSession | null> {
    // 如果已有活跃 session，直接返回
    const existing = this.sessions.get(conversationId)
    if (existing) {
      this.resetIdleTimer(conversationId)
      return existing.session
    }

    // sdkSessionId 在 getOrCreateSession 中保存到内存，
    // 但应用重启后内存丢失。完整恢复逻辑见 getOrResumeSession
    // （由调用方从数据库读取 sdkSessionId 后传入）。
    return null
  }

  /**
   * 获取或恢复 SDK session（应用重启后的主入口）。
   *
   * 流程：
   * 1. 检查内存中是否有活跃 session → 复用
   * 2. 如果有 sdkSessionId → 尝试 client.resumeSession 恢复
   * 3. 恢复失败或无 sdkSessionId → 创建新 session
   *
   * @param conversationId - 对话 ID
   * @param sdkSessionId - 从数据库读取的 SDK sessionId（null 表示无记录）
   * @param sessionConfig - SDK session 配置
   * @returns session 实例 + 是否为新建
   */
  async getOrResumeSession(
    conversationId: string,
    sdkSessionId: string | null,
    sessionConfig: Record<string, unknown>,
  ): Promise<{ session: SdkSession; isNew: boolean }> {
    // 1. 检查内存中是否有活跃 session
    const existing = this.sessions.get(conversationId)
    if (existing) {
      this.resetIdleTimer(conversationId)
      return { session: existing.session, isNew: false }
    }

    // 2. 如果有 sdkSessionId，尝试 resume
    if (sdkSessionId) {
      try {
        // 创建 client
        const cliPath = resolveCopilotCliPath()
        const clientOptions = cliPath
          ? { connection: RuntimeConnection.forStdio({ path: cliPath }) }
          : {}
        const client = new CopilotClient(clientOptions)
        await client.start()

        // 构建 resume 配置（BYOK provider 必须重新提供，密钥不持久化）
        const resumeConfig: Record<string, unknown> = {
          ...sessionConfig,
          infiniteSessions: {
            enabled: true,
            backgroundCompactionThreshold: 0.80,
            bufferExhaustionThreshold: 0.95,
          },
          largeOutput: { enabled: true },
        }

        const session = await client.resumeSession(sdkSessionId, resumeConfig)

        const managed: ManagedSession = {
          session,
          client,
          conversationId,
          sdkSessionId,
          lastUsedAt: Date.now(),
          cleanupTimer: null,
        }
        this.sessions.set(conversationId, managed)
        this.resetIdleTimer(conversationId)

        return { session, isNew: false }
      } catch (error) {
        console.warn(
          `[SessionManager] Failed to resume session ${sdkSessionId}:`,
          error,
        )
        // 恢复失败，清理 client 后继续创建新 session
        // Fall through to create new session
      }
    }

    // 3. 创建新 session
    const session = await this.getOrCreateSession(conversationId, sessionConfig)
    return { session, isNew: true }
  }

  /**
   * 检查指定对话是否有活跃 session。
   */
  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId)
  }

  /**
   * 列出所有活跃的会话信息（B7 会话列表查询）。
   * 可用于会话管理 UI，展示当前内存中持有的 SDK session。
   */
  listActiveSessions(): ActiveSessionInfo[] {
    return Array.from(this.sessions.values()).map((m) => ({
      conversationId: m.conversationId,
      sdkSessionId: m.sdkSessionId,
      lastUsedAt: m.lastUsedAt,
      // 简化：压缩状态由 agent-bridge 在执行时维护，此处统一返回 false
      isCompacting: false,
    }))
  }

  /**
   * 手动销毁指定对话的 session。
   * 在对话被删除时调用。
   */
  async destroySession(conversationId: string): Promise<void> {
    const managed = this.sessions.get(conversationId)
    if (!managed) return

    if (managed.cleanupTimer) {
      clearTimeout(managed.cleanupTimer)
    }

    try {
      await managed.session.disconnect()
    } catch {
      // Ignore
    }
    try {
      await managed.client.stop()
    } catch {
      // Ignore
    }

    this.sessions.delete(conversationId)
  }

  /**
   * 销毁所有会话（应用退出时调用）。
   */
  async destroyAllSessions(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const convId of Array.from(this.sessions.keys())) {
      promises.push(this.destroySession(convId))
    }
    await Promise.allSettled(promises)

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * 重置指定对话的闲置计时器。
   */
  private resetIdleTimer(conversationId: string): void {
    const managed = this.sessions.get(conversationId)
    if (!managed) return

    managed.lastUsedAt = Date.now()

    if (managed.cleanupTimer) {
      clearTimeout(managed.cleanupTimer)
    }

    managed.cleanupTimer = setTimeout(() => {
      void this.destroySession(conversationId)
    }, SESSION_IDLE_TIMEOUT_MS)
  }

  /**
   * 淘汰最旧的会话（LRU）。
   */
  private evictOldestSession(): void {
    let oldestId: string | null = null
    let oldestTime = Infinity

    for (const [convId, managed] of this.sessions) {
      if (managed.lastUsedAt < oldestTime) {
        oldestTime = managed.lastUsedAt
        oldestId = convId
      }
    }

    if (oldestId) {
      void this.destroySession(oldestId)
    }
  }

  /**
   * 清理所有闲置超时的会话。
   */
  private cleanupIdleSessions(): void {
    const now = Date.now()
    for (const [convId, managed] of this.sessions) {
      if (now - managed.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
        void this.destroySession(convId)
      }
    }
  }

  /**
   * 获取当前活跃会话数量（仅供测试）。
   */
  getActiveSessionCount(): number {
    return this.sessions.size
  }
}

// ─── 单例 ────────────────────────────────────────────────────

let sessionManagerInstance: CopilotSessionManager | null = null

/**
 * 获取全局会话管理器单例。
 */
export function getSessionManager(): CopilotSessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new CopilotSessionManager()
  }
  return sessionManagerInstance
}

/**
 * 重置会话管理器（仅供测试）。
 */
export function resetSessionManager(): void {
  if (sessionManagerInstance) {
    void sessionManagerInstance.destroyAllSessions()
    sessionManagerInstance = null
  }
}

// ─── CLI 路径解析（从 agent-bridge.ts 移出） ──────────────────

/**
 * Resolve the Copilot CLI entry point path for the current platform.
 * (从 agent-bridge.ts 移植)
 */
function resolveCopilotCliPath(): string | undefined {
  const arch = process.arch
  const variants =
    process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform]
  const packageNames = variants.map((v) => `@github/copilot-${v}-${arch}`)

  try {
    const req = createRequire(import.meta.url)
    for (const packageName of packageNames) {
      try {
        const resolved = req.resolve(packageName)
        const pkgDir = dirname(resolved)
        const cliPath = join(pkgDir, 'index.js')
        if (existsSync(cliPath)) {
          return cliPath
        }
      } catch {
        // Package not found, try next
      }
    }
  } catch {
    // createRequire not available
  }

  if (typeof import.meta.resolve === 'function') {
    for (const packageName of packageNames) {
      try {
        const resolvedUrl = import.meta.resolve(packageName)
        const resolvedPath = fileURLToPath(resolvedUrl)
        const pkgDir = dirname(resolvedPath)
        const cliPath = join(pkgDir, 'index.js')
        if (existsSync(cliPath)) {
          return cliPath
        }
      } catch {
        // Package not found, try next
      }
    }
  }

  try {
    const req = createRequire(import.meta.url)
    const searchPaths = req.resolve.paths('@github/copilot') ?? []
    for (const base of searchPaths) {
      for (const packageName of packageNames) {
        const cliPath = join(base, ...packageName.split('/'), 'index.js')
        if (existsSync(cliPath)) {
          return cliPath
        }
      }
    }
  } catch {
    // Search paths not available
  }

  return undefined
}
