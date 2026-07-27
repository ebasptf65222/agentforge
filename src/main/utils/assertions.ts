// OPT-14: 公共参数校验函数
// 提取自 agent.ts / chat.ts / mcp.ts / model.ts / skill.ts / knowledge-base.ts

import { AppError, ErrorCodes } from './error'

/**
 * 断言值是非空字符串。
 * @throws {AppError} VALIDATION_ERROR - 当值为空或非字符串时
 */
export function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}
