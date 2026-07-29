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

// ─── 单例管理 ─────────────────────────────────────────────────────

/** 全局 Checkpointer 单例 */
let checkpointer: CheckpointerType | null = null

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
    } catch (err) {
      console.warn('[LangGraph Checkpointer] Failed to init SqliteSaver, falling back to MemorySaver:', err)
      checkpointer = new MemorySaver()
    }
  }
  return checkpointer
}

/** 重置 Checkpointer（仅供测试） */
export function resetCheckpointer(): void {
  checkpointer = null
}
