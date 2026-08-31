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
  /** 解密失败（密钥损坏或 OS 密钥变更） */
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',

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
  /** MCP 目录条目不存在 */
  MCP_NOT_IN_CATALOG: 'MCP_NOT_IN_CATALOG',
  /** MCP 服务器已安装 */
  MCP_ALREADY_INSTALLED: 'MCP_ALREADY_INSTALLED',

  // ─── Copilot CLI 相关 ────────────────────────────────────────
  /** CLI 服务器启动失败 */
  CLI_START_ERROR: 'CLI_START_ERROR',

  // ─── 文件相关（P2/P3） ──────────────────────────────────────
  /** 文件不存在 */
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  /** 文件访问被拒绝 */
  FILE_ACCESS_ERROR: 'FILE_ACCESS_ERROR',
  /** 文件超过大小限制 */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // ─── 知识库相关（P3/P4） ──────────────────────────────────────
  /** 文档索引失败 */
  KB_INDEX_ERROR: 'KB_INDEX_ERROR',
  /** 文档不存在 */
  KB_DOCUMENT_NOT_FOUND: 'KB_DOCUMENT_NOT_FOUND',
  /** 文档已存在（同路径） */
  KB_DOCUMENT_DUPLICATE: 'KB_DOCUMENT_DUPLICATE',
  /** 分块不存在 */
  KB_CHUNK_NOT_FOUND: 'KB_CHUNK_NOT_FOUND',
  /** 不支持的文件类型 */
  KB_INVALID_FILE_TYPE: 'KB_INVALID_FILE_TYPE',
  /** 嵌入生成失败 */
  KB_EMBEDDING_ERROR: 'KB_EMBEDDING_ERROR',
  /** 搜索失败 */
  KB_SEARCH_ERROR: 'KB_SEARCH_ERROR',

  // ─── 代码库索引相关（CB） ─────────────────────────────────────
  /** 代码库文件不存在 */
  CB_FILE_NOT_FOUND: 'CB_FILE_NOT_FOUND',
  /** 代码解析失败 */
  CB_PARSE_ERROR: 'CB_PARSE_ERROR',
  /** 代码库搜索失败 */
  CB_SEARCH_ERROR: 'CB_SEARCH_ERROR',
  /** 代码库未初始化（未扫描） */
  CB_NOT_INITIALIZED: 'CB_NOT_INITIALIZED',
  /** 不支持的文件类型 */
  CB_UNSUPPORTED_FILE: 'CB_UNSUPPORTED_FILE',

  // ─── Git 相关（P1-03） ────────────────────────────────────────
  /** 不是 Git 仓库 */
  GIT_NOT_A_REPO: 'GIT_NOT_A_REPO',
  /** Git 命令执行失败 */
  GIT_COMMAND_FAILED: 'GIT_COMMAND_FAILED',
  /** Git 分支已存在 */
  GIT_BRANCH_EXISTS: 'GIT_BRANCH_EXISTS',
  /** Git 没有变更可提交 */
  GIT_NOTHING_TO_COMMIT: 'GIT_NOTHING_TO_COMMIT',
  /** PR 创建失败 */
  GIT_PR_CREATE_FAILED: 'GIT_PR_CREATE_FAILED',

  // ─── 浏览器相关（P2-01） ────────────────────────────────────────
  /** 浏览器导航失败 */
  BROWSER_NAVIGATION_ERROR: 'BROWSER_NAVIGATION_ERROR',
  /** 浏览器操作超时 */
  BROWSER_TIMEOUT: 'BROWSER_TIMEOUT',
  /** 页面元素未找到 */
  BROWSER_ELEMENT_NOT_FOUND: 'BROWSER_ELEMENT_NOT_FOUND',
  /** 浏览器操作失败 */
  BROWSER_OPERATION_ERROR: 'BROWSER_OPERATION_ERROR',
  /** 截图失败 */
  BROWSER_SCREENSHOT_ERROR: 'BROWSER_SCREENSHOT_ERROR',

  // ─── Checkpoint 相关（P2-02） ──────────────────────────────
  /** 快照不存在 */
  CHECKPOINT_NOT_FOUND: 'CHECKPOINT_NOT_FOUND',
  /** 快照无内容（超大文件或读取失败） */
  CHECKPOINT_NO_CONTENT: 'CHECKPOINT_NO_CONTENT',
  /** 快照回滚失败 */
  CHECKPOINT_ROLLBACK_FAILED: 'CHECKPOINT_ROLLBACK_FAILED',

  // ─── Skills 相关（P3） ──────────────────────────────────────
  /** Skill 名称重复 */
  SKILL_DUPLICATE: 'SKILL_DUPLICATE',
  /** Skill prompt 为空 */
  SKILL_PROMPT_EMPTY: 'SKILL_PROMPT_EMPTY',
  /** Skill 变量缺失 */
  SKILL_VARIABLE_MISSING: 'SKILL_VARIABLE_MISSING',
  /** Skill 不存在 */
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  /** 不允许删除内置 Skill */
  SKILL_DELETE_BUILTIN: 'SKILL_DELETE_BUILTIN',
  /** Skill 意图匹配失败 */
  SKILL_MATCH_FAILED: 'SKILL_MATCH_FAILED',

  // ─── 语音相关（V1） ──────────────────────────────────────────
  /** TTS 语音合成错误 */
  VOICE_TTS_ERROR: 'VOICE_TTS_ERROR',
  /** STT 语音识别错误 */
  VOICE_STT_ERROR: 'VOICE_STT_ERROR',
  /** 麦克风权限不足 */
  VOICE_MIC_PERMISSION: 'VOICE_MIC_PERMISSION',

  // ─── 知识图谱相关（KG） ───────────────────────────────────────
  /** 实体已存在 */
  KG_ENTITY_DUPLICATE: 'KG_ENTITY_DUPLICATE',
  /** 实体不存在 */
  KG_ENTITY_NOT_FOUND: 'KG_ENTITY_NOT_FOUND',
  /** 关系不存在 */
  KG_RELATION_NOT_FOUND: 'KG_RELATION_NOT_FOUND',

  // ─── 工作区相关（WS） ────────────────────────────────────────
  /** 未设置工作区 */
  WORKSPACE_NOT_SET: 'WORKSPACE_NOT_SET',
  /** 工作区路径无效 */
  WORKSPACE_PATH_INVALID: 'WORKSPACE_PATH_INVALID',
  /** 路径逃逸 */
  WORKSPACE_PATH_ESCAPE: 'WORKSPACE_PATH_ESCAPE',
  /** 目录非空 */
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',

  // ─── Prompt 模板相关（PT） ────────────────────────────────────
  /** Prompt 模板不存在 */
  PROMPT_TEMPLATE_NOT_FOUND: 'PROMPT_TEMPLATE_NOT_FOUND',

  // ─── AI 视频生成相关（VIDEO） ─────────────────────────────────
  /** 视频生成配置缺失（未设置 API Key / 模型） */
  VIDEO_INVALID_CONFIG: 'VIDEO_INVALID_CONFIG',
  /** 视频任务不存在 */
  VIDEO_TASK_NOT_FOUND: 'VIDEO_TASK_NOT_FOUND',
  /** 视频任务状态不可重试（仅 failed / cancelled 可重试） */
  VIDEO_TASK_NOT_RETRYABLE: 'VIDEO_TASK_NOT_RETRYABLE',
  /** 视频序列不存在 */
  VIDEO_SEQUENCE_NOT_FOUND: 'VIDEO_SEQUENCE_NOT_FOUND',
  /** 视频生成 API 调用错误（认证、网络、服务端等） */
  VIDEO_API_ERROR: 'VIDEO_API_ERROR',
  /** 视频生成 API 限流 */
  VIDEO_RATE_LIMIT: 'VIDEO_RATE_LIMIT',
  /** 视频任务生成失败 */
  VIDEO_GENERATION_FAILED: 'VIDEO_GENERATION_FAILED',
  /** 视频文件下载/落盘失败 */
  VIDEO_DOWNLOAD_ERROR: 'VIDEO_DOWNLOAD_ERROR',
  /** 视频尾帧抽取失败（M8 连续性衔接所需 ffmpeg 截帧） */
  VIDEO_FRAME_EXTRACT_ERROR: 'VIDEO_FRAME_EXTRACT_ERROR',
  /** 视频成片后处理失败（M18：字幕/水印/拼接 ffmpeg 调用失败） */
  VIDEO_POSTPROCESS_ERROR: 'VIDEO_POSTPROCESS_ERROR',

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
