// AgentForge: Copilot SDK 持久化会话管理器
// 每个对话复用同一 session，启用 SDK 原生上下文压缩

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk'
import type { ActiveSessionInfo } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

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

    // 创建新 client（BYOK 模式下禁用 useLoggedInUser）
    const client = buildCopilotClient({ hasCustomProvider: !!sessionConfig['provider'] })
    await startClientWithRetry(client)

    // 构建 session 配置，启用 infiniteSessions
    // 如果 sessionConfig 中包含 infiniteSessionThreshold 或 largeOutputMaxSize，使用自定义值
    const compactionThreshold = sessionConfig['infiniteSessionThreshold'] ?? 0.80
    const largeOutputMaxSize = sessionConfig['largeOutputMaxSize']

    const fullConfig: Record<string, unknown> = {
      ...sessionConfig,
      // 启用无限会话：SDK 自动管理上下文窗口，通过后台压缩处理长对话
      infiniteSessions: {
        enabled: true,
        // 上下文使用达指定阈值时开始后台压缩（默认 80%）
        backgroundCompactionThreshold: compactionThreshold,
        // 上下文使用达 95% 时阻塞等待压缩完成
        bufferExhaustionThreshold: 0.95,
      },
      // 启用大输出处理
      largeOutput: largeOutputMaxSize
        ? { enabled: true, maxSizeBytes: largeOutputMaxSize }
        : { enabled: true },
    }

    // 清理自定义字段，不传递到 SDK
    delete fullConfig['infiniteSessionThreshold']
    delete fullConfig['largeOutputMaxSize']

    let session: SdkSession
    try {
      session = await client.createSession(fullConfig)
    } catch (error) {
      // createSession 失败时清理 client（停止 CLI 子进程）
      try { await client.stop() } catch { /* ignore */ }
      throw error
    }
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
        // 创建 client（BYOK 模式下禁用 useLoggedInUser）
        const client = buildCopilotClient({ hasCustomProvider: !!sessionConfig['provider'] })
        await startClientWithRetry(client)

        // 构建 resume 配置（BYOK provider 必须重新提供，密钥不持久化）
        const resumeCompactionThreshold = sessionConfig['infiniteSessionThreshold'] ?? 0.80
        const resumeLargeOutputMaxSize = sessionConfig['largeOutputMaxSize']

        const resumeConfig: Record<string, unknown> = {
          ...sessionConfig,
          infiniteSessions: {
            enabled: true,
            backgroundCompactionThreshold: resumeCompactionThreshold,
            bufferExhaustionThreshold: 0.95,
          },
          largeOutput: resumeLargeOutputMaxSize
            ? { enabled: true, maxSizeBytes: resumeLargeOutputMaxSize }
            : { enabled: true },
        }

        // 清理自定义字段
        delete resumeConfig['infiniteSessionThreshold']
        delete resumeConfig['largeOutputMaxSize']

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
        // client 变量在 catch 块外，但 resume 失败时 CLI 进程可能已退出
        // 无需显式 stop，Fall through 到 getOrCreateSession 创建新 client
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
 * Electron 环境下 process.execPath 指向 Electron 二进制而非 Node.js，
 * 导致 SDK 以 Electron 模式启动 CLI 子进程后立即退出（code 0）。
 * 设置 ELECTRON_RUN_AS_NODE=1 使 Electron 二进制以 Node.js 模式运行。
 */
function getElectronFixEnv(): Record<string, string> {
  if (process.versions?.electron) {
    return { ELECTRON_RUN_AS_NODE: '1' }
  }
  return {}
}

/**
 * 获取系统 Node.js 可执行文件路径（非 Electron）。
 * Electron 环境下 process.execPath 指向 electron.exe，
 * Copilot CLI 检测到 process.versions.electron 后会用 commander 的
 * `from: "electron"` 模式解析 argv，导致参数解析错误。
 * 通过找到系统真正的 Node.js 来 spawn CLI 子进程可避免此问题。
 */
function getSystemNodePath(): string {
  // 1. 优先使用环境变量 NODE_PATH 指定的 Node.js
  if (process.env.COPilot_NODE_PATH) {
    return process.env.COPilot_NODE_PATH
  }

  // 2. Electron 环境下，从 execPath 向上查找 Node.js
  if (process.versions?.electron) {
    // Electron 的 execPath 类似：
    //   Windows: .../electron/dist/electron.exe
    //   macOS:   .../electron/dist/Electron.app/Contents/MacOS/Electron
    //   Linux:   .../electron/dist/electron
    // 通过 nvm 或 which 找到系统 Node.js
    try {
      const { execFileSync } = require('node:child_process')
      // Windows 上用 where，Unix 上用 which
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      const nodePath = execFileSync(cmd, ['node'], { encoding: 'utf-8', timeout: 5000 }).trim()
      // Windows 的 where 可能返回多行，取第一行
      const firstLine = nodePath.split(/\r?\n/)[0].trim()
      if (firstLine) {
        console.log(`[SessionManager] Found system Node.js: ${firstLine}`)
        return firstLine
      }
    } catch {
      // Fallback: 尝试常见的 Node.js 路径
    }

    // 3. 尝试从 nvm 目录查找
    const { join, dirname } = require('node:path')
    const { existsSync } = require('node:fs')

    if (process.platform === 'win32') {
      // Windows: 从 electron.exe 路径向上查找 node.exe
      // 通常 nvm 安装的 Node.js 在类似 D:\nvm\nodejs\node.exe
      const envNode = process.env.ProgramFiles
        ? join(process.env.ProgramFiles, 'nodejs', 'node.exe')
        : undefined
      if (envNode && existsSync(envNode)) return envNode

      // 尝试 NVM_HOME
      if (process.env.NVM_HOME) {
        const nvmNode = join(process.env.NVM_HOME, 'node.exe')
        if (existsSync(nvmNode)) return nvmNode
      }
    }
  }

  // 4. 非 Electron 环境或找不到时，使用 process.execPath
  return process.execPath
}

/**
 * 获取当前平台的 Copilot CLI 包名。
 */
function getCliPlatformPackageNames(): string[] {
  const arch = process.arch
  const variants =
    process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform]
  return variants.map((v) => `@github/copilot-${v}-${arch}`)
}

/**
 * 解析 Copilot CLI 入口文件路径。
 *
 * 搜索策略（按优先级）：
 * 1. createRequire(import.meta.url) — 开发环境下最可靠
 * 2. import.meta.resolve — ESM 标准方式
 * 3. 遍历 node_modules 搜索路径 — 打包后的 Electron 应用 fallback
 * 4. Electron 打包后 app.asar.unpacked 路径 — 最终 fallback
 *
 * @returns CLI 入口文件路径，或 undefined（未找到）
 */
function resolveCopilotCliPath(): string | undefined {
  const packageNames = getCliPlatformPackageNames()

  // 策略 1: createRequire（开发环境最佳）
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

  // 策略 2: import.meta.resolve（ESM）
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

  // 策略 3: 遍历 node_modules 搜索路径（打包后 fallback）
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

  // 策略 4: Electron 打包后，app.asar.unpacked 路径
  // electron-builder 将 node_modules/@github/copilot-* 解压到 app.asar.unpacked/
  // 路径结构: resources/app.asar/dist/main/xxx.js -> resources/app.asar.unpacked/node_modules/...
  if (process.versions?.electron) {
    try {
      // 从当前文件位置向上找到 resources 目录
      // __dirname = .../resources/app.asar/dist/main (打包后)
      // 或 .../resources/app.asar/dist/main/copilot (开发环境)
      const resourcesDir = dirname(dirname(dirname(__dirname))) // 向上找到 resources
      for (const packageName of packageNames) {
        // 优先检查 app.asar.unpacked（打包后）
        const unpackedPath = join(
          resourcesDir,
          'app.asar.unpacked',
          'node_modules',
          ...packageName.split('/'),
          'index.js',
        )
        if (existsSync(unpackedPath)) {
          return unpackedPath
        }
        // 也检查普通 node_modules（开发环境）
        const devPath = join(
          resourcesDir,
          'app.asar',
          'node_modules',
          ...packageName.split('/'),
          'index.js',
        )
        if (existsSync(devPath)) {
          return devPath
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined
}

/** CLI 可用性检查结果 */
export interface CliAvailabilityResult {
  /** CLI 是否可用 */
  available: boolean
  /** 解析到的 CLI 路径 */
  cliPath?: string
  /** 不可用时的原因描述 */
  reason?: string
}

/**
 * 预检测 Copilot CLI 的可用性。
 *
 * 在创建 SDK client 之前调用，避免 SDK 内部 30 秒超时等待。
 * 检测内容：
 * 1. CLI 入口文件是否存在
 * 2. Node.js 是否可用（CLI 依赖 Node.js 运行）
 *
 * @returns CLI 可用性检查结果
 */
export function checkCopilotCliAvailability(): CliAvailabilityResult {
  const packageNames = getCliPlatformPackageNames()
  const cliPath = resolveCopilotCliPath()

  if (!cliPath) {
    return {
      available: false,
      reason:
        `Copilot CLI binary not found. ` +
        `Searched for package: ${packageNames.join(', ')}. ` +
        `Ensure @github/copilot and the platform package are installed.`,
    }
  }

  // 检查 Node.js 是否可用（CLI 依赖 Node.js 运行）
  if (process.versions?.electron) {
    const nodePath = getSystemNodePath()
    if (!nodePath || nodePath === process.execPath) {
      // 在 Electron 环境下，如果 getSystemNodePath 返回的就是 electron.exe，
      // 则 Node.js 可能不可用，但这不一定是问题（ELECTRON_RUN_AS_NODE=1 可以解决）
      // 所以这里不做严格检查，只记录警告
      console.warn('[SessionManager] System Node.js path not found, relying on ELECTRON_RUN_AS_NODE')
    }
  }

  return {
    available: true,
    cliPath,
  }
}

/**
 * 构建 CopilotClient 实例（统一配置，避免重复代码）。
 * - 注入 ELECTRON_RUN_AS_NODE=1 修复 Electron 环境下 CLI 进程立即退出的问题
 * - CLI 路径解析失败时抛出明确错误
 * - 支持通过 gitHubToken 或 useLoggedInUser 进行认证
 * - BYOK 模式下自动禁用 useLoggedInUser，避免与自定义 provider 冲突
 *
 * 注意：process.execPath 的 Electron 兼容性修补在 startClientWithRetry() 中执行，
 * 因为 SDK 的 getNodeExecPath() 在 client.start() 时才读取 process.execPath，
 * 在构造函数阶段修补没有效果。
 */
function buildCopilotClient(options?: { hasCustomProvider?: boolean }): CopilotClient {
  // 预检测 CLI 可用性，避免 30 秒超时等待
  const cliCheck = checkCopilotCliAvailability()
  if (!cliCheck.available || !cliCheck.cliPath) {
    throw new AppError(
      ErrorCodes.CLI_START_ERROR,
      cliCheck.reason ?? 'Copilot CLI is not available.',
    )
  }
  const cliPath = cliCheck.cliPath

  // 从环境变量或设置中获取 GitHub token
  const gitHubToken = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN || undefined

  const clientOptions: Record<string, unknown> = {
    connection: RuntimeConnection.forStdio({
      path: cliPath,
      env: { ...process.env, ...getElectronFixEnv() } as Record<string, string>,
    }),
  }

  // 认证配置：
  // - 有 GitHub token 时使用 token 认证
  // - BYOK 模式（有自定义 provider）时禁用 useLoggedInUser，避免 CLI 优先使用 GitHub 认证
  // - 否则使用本地登录状态
  if (gitHubToken) {
    clientOptions.gitHubToken = gitHubToken
    clientOptions.useLoggedInUser = false
    console.log('[SessionManager] Using GitHub token for authentication')
  } else if (options?.hasCustomProvider) {
    // BYOK 模式：禁用 GitHub 登录，CLI 将仅使用 session 级别的 provider 配置
    clientOptions.useLoggedInUser = false
    console.log('[SessionManager] BYOK mode: disabled useLoggedInUser to avoid auth conflict with custom provider')
  } else {
    // 默认使用本地登录状态
    clientOptions.useLoggedInUser = true
    console.log('[SessionManager] Using local GitHub login for authentication')
  }

  return new CopilotClient(clientOptions)
}

/** CLI 启动最大重试次数 */
const CLI_START_MAX_RETRIES = 2

/**
 * 带重试的 CLI 启动：首次失败后等待 500ms 再重试。
 * 某些环境下子进程初始化存在竞态，重试通常能解决。
 *
 * Electron 兼容性修复：
 * SDK 的 startCLIServer() 通过 spawn(getNodeExecPath(), ...) 启动 CLI 子进程，
 * 而 getNodeExecPath() 在运行时读取 process.execPath。
 * 在 Electron 环境下 process.execPath 指向 electron.exe，
 * 导致 CLI 子进程以 Electron 模式启动后立即退出（"Connection is closed"）。
 * 修复方式：在 client.start() 调用期间临时将 process.execPath 替换为系统 Node.js，
 * 确保 SDK spawn CLI 时使用真正的 Node.js 可执行文件。
 */
async function startClientWithRetry(client: CopilotClient): Promise<void> {
  let lastError: unknown

  // Electron 兼容性修复：在 start() 期间临时替换 process.execPath
  // SDK 的 getNodeExecPath() 在 startCLIServer() 中读取 process.execPath
  const originalExecPath = process.execPath
  let patched = false
  if (process.versions?.electron) {
    const nodePath = getSystemNodePath()
    if (nodePath !== process.execPath) {
      console.log(`[SessionManager] Electron detected, patching process.execPath for CLI spawn: ${process.execPath} -> ${nodePath}`)
      process.execPath = nodePath
      patched = true
    }
  }

  try {
    for (let attempt = 0; attempt <= CLI_START_MAX_RETRIES; attempt++) {
      try {
        console.log(`[SessionManager] Starting Copilot CLI (attempt ${attempt + 1}/${CLI_START_MAX_RETRIES + 1})...`)
        await client.start()
        console.log(`[SessionManager] Copilot CLI started successfully`)
        return
      } catch (error) {
        lastError = error
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[SessionManager] CLI start attempt ${attempt + 1} failed:`, msg)
        if (error instanceof Error && error.stack) {
          console.error(`[SessionManager] Stack trace:`, error.stack)
        }
        if (attempt < CLI_START_MAX_RETRIES) {
          console.warn(
            `[SessionManager] Retrying in 500ms...`,
          )
          await new Promise((r) => setTimeout(r, 500))
        }
      }
    }
    throw new AppError(
      ErrorCodes.CLI_START_ERROR,
      `Failed to start Copilot CLI after ${CLI_START_MAX_RETRIES + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      { cause: lastError },
    )
  } finally {
    // 恢复原始 process.execPath
    if (patched) {
      process.execPath = originalExecPath
    }
  }
}


