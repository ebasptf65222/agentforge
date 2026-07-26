// AgentForge 主进程统一错误类型
// 与 Spec v0.2 §5.8 + §14.1 一致：AppError 已在 @shared/types 定义
// 此文件为主进程提供可导入的 AppError、错误码常量和辅助函数

import { AppError } from '@shared/types'

export { AppError }

/**
 * 应用统一错误码常量。
 * 与 Spec v0.2 §14.1 错误码表一致：DOMAIN_REASON 格式。
 */
export const ErrorCodes = {
  // ─── 模型相关（P1） ──────────────────────────────────────────
  /** provider + modelId 重复 */
  MODEL_DUPLICATE: 'MODEL_DUPLICATE',
  /** 模型不存在 */
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  /** 不允许删除默认模型 */
  MODEL_DELETE_DEFAULT: 'MODEL_DELETE_DEFAULT',
  /** 模型连接测试失败 */
  MODEL_TEST_FAILED: 'MODEL_TEST_FAILED',
  /** 模型 API 调用错误（认证、超时、网络等） */
  MODEL_API_ERROR: 'MODEL_API_ERROR',
  /** API 限流 */
  MODEL_RATE_LIMIT: 'MODEL_RATE_LIMIT',

  // ─── 加密相关（P1） ──────────────────────────────────────────
  /** safeStorage 不可用 */
  SAFE_STORAGE_UNAVAILABLE: 'SAFE_STORAGE_UNAVAILABLE',

  // ─── 会话相关（P1） ──────────────────────────────────────────
  /** 会话不存在 */
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  /** 已有生成任务在运行 */
  CHAT_ALREADY_RUNNING: 'CHAT_ALREADY_RUNNING',

  // ─── 设置/系统相关（P1） ─────────────────────────────────────
  /** app_settings 行不存在（id != 1） */
  SETTINGS_NOT_FOUND: 'SETTINGS_NOT_FOUND',
  /** URL 不合法（非 http/https） */
  INVALID_URL: 'INVALID_URL',

  // ─── Agent 执行相关（P2） ────────────────────────────────────
  /** 执行步数达到上限 */
  AGENT_MAX_STEPS: 'AGENT_MAX_STEPS',
  /** 连续多次工具调用失败，已熔断 */
  AGENT_CIRCUIT_BREAK: 'AGENT_CIRCUIT_BREAK',
  /** 用户取消执行 */
  AGENT_CANCELLED: 'AGENT_CANCELLED',
  /** 审批超时，执行已终止 */
  AGENT_APPROVAL_TIMEOUT: 'AGENT_APPROVAL_TIMEOUT',

  // ─── 工具相关（P2） ──────────────────────────────────────────
  /** 工具不存在 */
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  /** 工具执行失败 */
  TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',

  // ─── MCP 相关（P2） ─────────────────────────────────────────
  /** MCP Server 启动失败 */
  MCP_SPAWN_FAILED: 'MCP_SPAWN_FAILED',
  /** MCP 连接失败 */
  MCP_CONNECT_FAILED: 'MCP_CONNECT_FAILED',

  // ─── 文件相关（P2/P3） ──────────────────────────────────────
  /** 文件不存在 */
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  /** 文件访问被拒绝 */
  FILE_ACCESS_ERROR: 'FILE_ACCESS_ERROR',
  /** 文件超过大小限制 */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // ─── 知识库相关（P3） ────────────────────────────────────────
  /** 文档索引失败 */
  KB_INDEX_ERROR: 'KB_INDEX_ERROR',

  // ─── Skills 相关（P3） ──────────────────────────────────────
  /** Skill 名称重复 */
  SKILL_DUPLICATE: 'SKILL_DUPLICATE',
  /** Skill prompt 为空 */
  SKILL_PROMPT_EMPTY: 'SKILL_PROMPT_EMPTY',
  /** Skill 变量缺失 */
  SKILL_VARIABLE_MISSING: 'SKILL_VARIABLE_MISSING',

  // ─── 通用 ────────────────────────────────────────────────────
  /** 数据库错误 */
  DB_ERROR: 'DB_ERROR',
  /** 参数校验错误 */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** 内部错误 */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

/** 错误码类型 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// ─── 错误辅助函数 ──────────────────────────────────────────────

/**
 * 判断一个错误是否为 AppError 实例。
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * 快速创建 AppError。
 * @param code - 错误码（建议使用 ErrorCodes 常量）
 * @param message - 用户可读的错误消息
 * @param details - 可选的附加详情
 */
export function createError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code, message, details)
}

/**
 * 将任意错误包装为 AppError。
 * 如果已经是 AppError 则原样返回；否则包装为 INTERNAL_ERROR。
 * @param error - 原始错误
 * @param fallbackCode - 非 AppError 时使用的错误码，默认 INTERNAL_ERROR
 */
export function wrapError(
  error: unknown,
  fallbackCode: string = ErrorCodes.INTERNAL_ERROR,
): AppError {
  if (isAppError(error)) return error
  if (error instanceof Error) {
    return new AppError(fallbackCode, error.message)
  }
  return new AppError(fallbackCode, String(error))
}

/**
 * 将 AppError 转换为可安全序列化的 plain object。
 * 用于 IPC 传输和日志记录。
 */
export function serializeError(error: unknown): {
  code: string
  message: string
  details?: Record<string, unknown>
} {
  if (isAppError(error)) {
    return error.toJSON()
  }
  if (error instanceof Error) {
    return { code: ErrorCodes.INTERNAL_ERROR, message: error.message }
  }
  return { code: ErrorCodes.INTERNAL_ERROR, message: String(error) }
}
