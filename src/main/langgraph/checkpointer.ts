// AgentForge LangGraph 引擎: Checkpointer 初始化
// Phase 3: 使用 SQLite Checkpointer（持久化，崩溃恢复）
//
// 使用 @langchain/langgraph-checkpoint-sqlite 的 SqliteSaver，
// 将图状态持久化到 SQLite 数据库文件，支持：
// - 应用重启后恢复中断的对话
// - interrupt() 暂停的图可在下次启动时恢复
// - 多个 thread 独立管理检查点

import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { app } from 'electron'

// ─── 类型 ─────────────────────────────────────────────────────────

/** Checkpointer 类型（SqliteSaver 或 MemorySaver 的联合类型） */
type CheckpointerType = SqliteSaver | MemorySaver

// ─── 常量 ─────────────────────────────────────────────────────────

/** Checkpoint 清理间隔（默认 24 小时） */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Checkpoint 保留时长（默认 7 天） */
const CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ─── 单例管理 ─────────────────────────────────────────────────────

/** 全局 Checkpointer 单例 */
let checkpointer: CheckpointerType | null = null

/** 清理定时器 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null

/**
 * 解析 SQLite 数据库文件路径。
 *
 * - 生产环境: 用户数据目录下的 agentforge/langgraph_checkpoints.db
 * - 开发环境/测试: 当前工作目录下的 langgraph_checkpoints.db
 *
 * @returns SQLite 数据库文件路径
 */
function resolveDbPath(): string {
  // 生产环境：使用 Electron 的 userData 目录
  try {
    if (app?.getPath) {
      const userDataPath = app.getPath('userData')
      const dbDir = join(userDataPath, 'agentforge')
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }
      return join(dbDir, 'langgraph_checkpoints.db')
    }
  } catch {
    // Electron 不可用时回退
  }

  // 开发环境/测试：使用当前工作目录
  return join(process.cwd(), 'langgraph_checkpoints.db')
}

/**
 * 获取 LangGraph Checkpointer。
 *
 * Phase 3: 使用 SqliteSaver 持久化图状态到 SQLite 文件。
 * - 支持应用重启后恢复中断的对话
 * - 支持 interrupt() 暂停后恢复
 * - 测试环境回退到 MemorySaver（避免产生临时文件）
 *
 * @returns Checkpointer 实例（单例）
 */
export function getCheckpointer(): BaseCheckpointSaver {
  if (!checkpointer) {
    // 测试环境使用 MemorySaver（避免文件 IO）
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      checkpointer = new MemorySaver()
      return checkpointer
    }

    try {
      const dbPath = resolveDbPath()
      checkpointer = SqliteSaver.fromConnString(dbPath)
      console.log(`[LangGraph Checkpointer] Using SQLite at: ${dbPath}`)
      // 启动定期清理
      startCleanupTimer()
    } catch (err) {
      console.warn('[LangGraph Checkpointer] Failed to init SqliteSaver, falling back to MemorySaver:', err)
      checkpointer = new MemorySaver()
    }
  }
  return checkpointer
}

/**
 * 清理过期的 LangGraph checkpoint 数据。
 *
 * LangGraph SqliteSaver 的表结构：
 * - checkpoints(thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
 * - writes(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
 *
 * 这两张表没有 `created_at` 时间戳列，因此采用以下清理策略：
 * 1. 如果 `created_at` 列存在（未来版本可能添加），使用 TTL 清理
 * 2. 否则，按 thread 保留最近 N 条 checkpoint（默认 20 条），删除更旧的
 */
export function cleanupOldCheckpoints(): void {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return

  try {
    const dbPath = resolveDbPath()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('better-sqlite3')
    const cpDb = new Database(dbPath)

    try {
      // 检查 checkpoints 表是否存在 created_at 列
      const columns = cpDb.pragma('table_info(checkpoints)') as Array<{ name: string }>
      const hasCreatedAt = columns.some((c) => c.name === 'created_at')

      let totalDeleted = 0

      if (hasCreatedAt) {
        // 策略 1: 基于 TTL 清理（如果列存在）
        const cutoff = Math.floor((Date.now() - CHECKPOINT_TTL_MS) / 1000)
        const delCp = cpDb.prepare('DELETE FROM checkpoints WHERE created_at < ?').run(cutoff)
        const delWr = cpDb.prepare('DELETE FROM writes WHERE created_at < ?').run(cutoff)
        totalDeleted = delCp.changes + delWr.changes
      } else {
        // 策略 2: 按 thread 保留最近 N 条 checkpoint
        const MAX_CHECKPOINTS_PER_THREAD = 20
        const threads = cpDb.prepare(
          'SELECT DISTINCT thread_id FROM checkpoints',
        ).all() as Array<{ thread_id: string }>

        for (const { thread_id } of threads) {
          // 获取该 thread 的所有 checkpoint_id，按 checkpoint_id 降序（最新的在前）
          const rows = cpDb.prepare(
            'SELECT checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC',
          ).all(thread_id) as Array<{ checkpoint_id: string }>

          if (rows.length <= MAX_CHECKPOINTS_PER_THREAD) continue

          // 需要删除的 checkpoint_id 列表
          const toDelete = rows.slice(MAX_CHECKPOINTS_PER_THREAD).map((r) => r.checkpoint_id)
          const placeholders = toDelete.map(() => '?').join(',')

          const delCp = cpDb.prepare(
            `DELETE FROM checkpoints WHERE thread_id = ? AND checkpoint_id IN (${placeholders})`,
          ).run(thread_id, ...toDelete)
          const delWr = cpDb.prepare(
            `DELETE FROM writes WHERE thread_id = ? AND checkpoint_id IN (${placeholders})`,
          ).run(thread_id, ...toDelete)
          totalDeleted += delCp.changes + delWr.changes
        }
      }

      if (totalDeleted > 0) {
        console.info(
          `[LangGraph Checkpointer] Cleaned up ${totalDeleted} expired checkpoint records` +
          (hasCreatedAt ? ' (TTL-based)' : ' (count-based, max 20 per thread)'),
        )
        // VACUUM 回收空间
        cpDb.exec('VACUUM')
      }
    } finally {
      cpDb.close()
    }
  } catch (err) {
    console.warn('[LangGraph Checkpointer] Cleanup failed:', err)
  }
}

/**
 * 启动定期清理定时器。
 */
function startCleanupTimer(): void {
  if (cleanupTimer) return

  // 首次延迟 5 分钟执行，之后每 24 小时执行一次
  setTimeout(() => {
    cleanupOldCheckpoints()
    cleanupTimer = setInterval(cleanupOldCheckpoints, CLEANUP_INTERVAL_MS)
  }, 5 * 60 * 1000)
}

/**
 * 停止清理定时器（应用退出时调用）。
 */
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/** 重置 Checkpointer（仅供测试） */
export function resetCheckpointer(): void {
  stopCleanupTimer()
  checkpointer = null
}
