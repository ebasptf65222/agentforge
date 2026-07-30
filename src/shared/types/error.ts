// AgentForge 共享类型定义 - 错误类型
// 与 Spec v0.2 §5.10 一致

// ─── 5.10 错误类型 ────────────────────────────────────────────────

/** 应用统一错误 */
export class AppError extends Error {
  public code: string
  public details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details }
  }
}
