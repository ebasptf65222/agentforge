// AgentForge LangGraph 引擎: Checkpointer 初始化
// Phase 1: 使用内存 Checkpointer（简单，不持久化）
// Phase 2: 迁移到 SQLite Checkpointer（持久化，崩溃恢复）

import { MemorySaver } from '@langchain/langgraph'

let checkpointer: MemorySaver | null = null

/**
 * 获取 LangGraph Checkpointer。
 *
 * Phase 1: 使用内存 Checkpointer（简单，不持久化）
 * Phase 2: 迁移到 SQLite Checkpointer
 *
 * @returns MemorySaver 实例（单例）
 */
export function getCheckpointer(): MemorySaver {
  if (!checkpointer) {
    checkpointer = new MemorySaver()
  }
  return checkpointer
}

/** 重置 Checkpointer（仅供测试） */
export function resetCheckpointer(): void {
  checkpointer = null
}
