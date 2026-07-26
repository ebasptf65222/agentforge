// AgentForge ID 生成工具
// 使用 Node.js crypto.randomUUID() 生成 UUID v4

import { randomUUID } from 'node:crypto'

/**
 * 生成一个新的 UUID v4 字符串。
 *
 * @returns 36 字符的 UUID 字符串（如 "550e8400-e29b-41d4-a716-446655440000"）
 */
export function generateId(): string {
  return randomUUID()
}
