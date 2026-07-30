// AgentForge 共享类型定义 - LLM Wiki (Karpathy 模式)
// 与 Spec v0.2 §5.8 一致

// ─── 5.8 LLM Wiki (Karpathy 模式) ────────────────────────────────

/** Wiki 页面摘要信息 */
export interface WikiPageSummary {
  title: string
  path: string
  summary: string
}

/** Wiki 状态信息（用于渲染进程展示） */
export interface WikiStatus {
  initialized: boolean
  rawCount: number
  pageCount: number
  lastIngest: string | null
  lastLint: string | null
  pages: WikiPageSummary[]
  rawFiles: string[]
  recentLogs: string
}
