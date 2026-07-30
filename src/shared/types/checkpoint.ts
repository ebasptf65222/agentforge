// AgentForge 共享类型定义 - Checkpoint 快照类型 (P2-02)
// 与 Spec v0.2 §5.7c 一致

import type { CheckpointAction } from './enums'

// ─── 5.7c Checkpoint 快照类型 (P2-02) ───────────────────────────

/** 文件快照记录 */
export interface Checkpoint {
  /** 快照 ID */
  id: number
  /** 关联的 Agent 执行 ID */
  executionId?: string
  /** 关联的会话 ID */
  conversationId?: string
  /** 工作区相对路径 */
  relativePath: string
  /** 原始内容（undefined 表示文件不存在或超大文件） */
  originalContent?: string
  /** 变更后的内容 */
  newContent: string
  /** 操作类型 */
  action: CheckpointAction
  /** 创建时间（Unix 毫秒） */
  createdAt: number
}

/** 快照差异信息 */
export interface CheckpointDiff {
  relativePath: string
  checkpointId: number
  /** 当前文件是否存在 */
  currentExists: boolean
  /** 快照时的原始内容 */
  originalContent?: string
  /** 当前文件内容 */
  currentContent?: string
  /** 当前内容是否已再次变更 */
  hasChanged: boolean
}
