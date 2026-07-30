// AgentForge IPC 统一校验中间件
// 提供 createValidatedHandler 高阶函数和通用校验工具函数，
// 供后续 IPC handler 统一使用，避免每个 handler 各自实现验证逻辑。
// 与 ErrorCodes.VALIDATION_ERROR / INVALID_URL 一致。

import type { IpcMainInvokeEvent } from 'electron'
import { AppError, ErrorCodes } from './error'

/**
 * IPC invoke handler 函数类型。
 * 与 Electron `ipcMain.handle` 的 listener 签名一致
 * （`(event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any`）。
 * Electron 类型定义未直接导出此名称，这里显式声明。
 */
export type IpcMainInvokeHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown

/**
 * 创建带参数校验的 IPC handler。
 *
 * 高阶函数：先通过 validate 校验原始参数（抛出 AppError 表示校验失败），
 * 再将校验后的值传递给 handler 执行业务逻辑。
 * 自动拦截非对象参数（null / 基本类型 / 数组）。
 *
 * @typeParam T - 校验后的参数类型
 * @param validate - 校验函数，接收原始参数对象，返回校验后的值
 * @param handler - 业务处理函数，接收校验后的值
 * @returns 可直接注册到 ipcMain.handle 的 IpcMainInvokeHandler
 *
 * @example
 * ```ts
 * const handler = createValidatedHandler(
 *   (params) => ({
 *     url: validateUrl(params['url'], 'url', ['https:', 'http:']),
 *   }),
 *   async ({ url }) => { ... },
 * )
 * ipcMain.handle('my:channel', handler)
 * ```
 */
export function createValidatedHandler<T>(
  validate: (params: Record<string, unknown>) => T,
  handler: (validated: T) => Promise<unknown> | unknown,
): IpcMainInvokeHandler {
  return (_event, ...args) => {
    const raw = args[0]
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'IPC handler params must be a non-null object.',
      )
    }
    const validated = validate(raw as Record<string, unknown>)
    return handler(validated)
  }
}

/**
 * 校验字符串字段。
 *
 * @param value - 字段值
 * @param field - 字段名（用于错误信息）
 * @returns 校验后的字符串
 * @throws {AppError} VALIDATION_ERROR - 值不是字符串时
 */
export function validateString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a string, got ${typeof value}.`,
      { field, receivedType: typeof value },
    )
  }
  return value
}

/**
 * 校验枚举字段。
 * 值必须是字符串且在允许列表中。
 *
 * @typeParam T - 枚举类型
 * @param value - 字段值
 * @param field - 字段名
 * @param allowed - 允许的枚举值列表
 * @returns 校验后的枚举值
 * @throws {AppError} VALIDATION_ERROR - 值不在允许列表中时
 */
export function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be one of [${allowed.join(', ')}], got ${JSON.stringify(value)}.`,
      { field, allowed: [...allowed], received: value },
    )
  }
  return value as T
}

/**
 * 校验可选数字字段。
 * 值为 undefined/null 时返回 undefined；否则校验为有限数字并检查范围。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @param min - 最小值（含，可选）
 * @param max - 最大值（含，可选）
 * @returns 校验后的数字或 undefined
 * @throws {AppError} VALIDATION_ERROR - 值非有限数字或超出范围时
 */
export function validateOptionalNumber(
  value: unknown,
  field: string,
  min?: number,
  max?: number,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a finite number, got ${typeof value}.`,
      { field, receivedType: typeof value },
    )
  }
  if (min !== undefined && value < min) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be >= ${min}, got ${value}.`,
      { field, min, received: value },
    )
  }
  if (max !== undefined && value > max) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be <= ${max}, got ${value}.`,
      { field, max, received: value },
    )
  }
  return value
}

/**
 * 校验 URL 字段并检查协议白名单。
 * 自动 trim 首尾空白。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @param allowedProtocols - 允许的协议列表（如 `['https:', 'http:']`）
 * @returns 校验并 trim 后的 URL 字符串
 * @throws {AppError} VALIDATION_ERROR - 值不是非空字符串、不是合法 URL 或协议不在白名单时
 */
export function validateUrl(
  value: unknown,
  field: string,
  allowedProtocols: readonly string[],
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string URL.`,
      { field },
    )
  }

  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" is not a valid URL: ${JSON.stringify(value)}.`,
      { field, value },
    )
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" protocol must be one of [${allowedProtocols.join(', ')}], got "${parsed.protocol}".`,
      { field, protocol: parsed.protocol, allowedProtocols: [...allowedProtocols] },
    )
  }

  return trimmed
}

// ─── 扩展校验工具（A1: IPC 校验中间件全量采纳） ──────────────────

/**
 * 校验必填非空字符串字段。
 * 值必须是字符串且 trim 后非空。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的字符串（已 trim）
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
  return value.trim()
}

/**
 * 校验可选字符串字段。
 * 值为 undefined/null 时返回 undefined；否则必须是非空字符串。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的字符串或 undefined
 * @throws {AppError} VALIDATION_ERROR - 值非空字符串时
 */
export function validateOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string if provided.`,
      { field, value },
    )
  }
  return value.trim()
}

/**
 * 校验可选字符串或 null 字段。
 * 与 validateOptionalString 类似，但 null 也返回 null（而非 undefined）。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的字符串、null 或 undefined
 */
export function validateOptionalStringOrNull(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string or null.`,
      { field, value },
    )
  }
  return value.trim()
}

/**
 * 校验可选布尔字段。
 * 值为 undefined/null 时返回 undefined；否则必须是布尔值。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的布尔值或 undefined
 * @throws {AppError} VALIDATION_ERROR - 值非布尔时
 */
export function validateOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a boolean, got ${typeof value}.`,
      { field, receivedType: typeof value },
    )
  }
  return value
}

/**
 * 校验必填字符串数组字段。
 * 值必须是非空数组且所有元素为字符串。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的字符串数组
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty array.`,
      { field, value },
    )
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Field "${field}" must be an array of strings.`,
        { field, value },
      )
    }
  }
  return value as string[]
}

/**
 * 校验可选字符串数组字段。
 * 值为 undefined/null 时返回 undefined；否则必须是字符串数组。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的字符串数组或 undefined
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateOptionalStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || !value.every((v: unknown) => typeof v === 'string')) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be an array of strings.`,
      { field, value },
    )
  }
  return value as string[]
}

/**
 * 校验可选 Record<string, string> 字段。
 * 值为 undefined/null 时返回 undefined；否则必须是对象且所有值为字符串。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的 Record 或 undefined
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateOptionalRecord(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be an object.`,
      { field, value },
    )
  }
  const obj = value as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Field "${field}.${k}" must be a string.`,
        { field: `${field}.${k}`, value: v },
      )
    }
  }
  return obj as Record<string, string>
}

/**
 * 校验必填对象字段。
 * 值必须是非 null、非数组的对象。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的对象
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateObject<T = Record<string, unknown>>(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-null object.`,
      { field, receivedType: typeof value },
    )
  }
  return value as Record<string, unknown>
}

/**
 * 校验可选对象字段。
 * 值为 undefined/null 时返回 undefined；否则必须是非数组对象。
 *
 * @param value - 字段值
 * @param field - 字段名
 * @returns 校验后的对象或 undefined
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateOptionalObject(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-null object if provided.`,
      { field, receivedType: typeof value },
    )
  }
  return value as Record<string, unknown>
}

/**
 * 确保参数是 non-null 对象，否则抛出 VALIDATION_ERROR。
 * 用于 IPC handler 入口的快速守卫。
 *
 * @param params - 原始参数
 * @param handlerName - handler 名称（用于错误信息）
 * @returns 类型安全的 Record
 * @throws {AppError} VALIDATION_ERROR
 */
export function ensureParamsObject(
  params: unknown,
  handlerName: string,
): Record<string, unknown> {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `${handlerName} params must be a non-null object.`,
    )
  }
  return params as Record<string, unknown>
}

/**
 * 校验可选枚举字段。
 * 值为 undefined/null 时返回 undefined；否则必须是字符串且在允许列表中。
 *
 * @typeParam T - 枚举类型
 * @param value - 字段值
 * @param field - 字段名
 * @param allowed - 允许的枚举值列表
 * @returns 校验后的枚举值或 undefined
 * @throws {AppError} VALIDATION_ERROR
 */
export function validateOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be one of [${allowed.join(', ')}], got ${JSON.stringify(value)}.`,
      { field, allowed: [...allowed], received: value },
    )
  }
  return value as T
}
