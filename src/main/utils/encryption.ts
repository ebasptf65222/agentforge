// AgentForge API Key 加密/解密工具
// 使用 Electron safeStorage 对 API Key 进行加密存储
// 与 Spec v0.2 §7.4 一致：safeStorage 不可用时抛出 SAFE_STORAGE_UNAVAILABLE
// 解密失败时抛出 DECRYPTION_FAILED，便于上层进行密钥恢复

import { safeStorage } from 'electron'
import { AppError, ErrorCodes } from './error'

/**
 * 检查 safeStorage 是否可用。
 * 在 Linux 上需要 secret service（如 gnome-keyring），在 macOS 上使用 Keychain。
 *
 * @returns safeStorage 是否可用
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * 获取加密状态详情。
 * 比 isEncryptionAvailable 提供更多信息，附带不可用时的原因说明。
 *
 * @returns { available: boolean, reason?: string }
 */
export function getEncryptionStatus(): { available: boolean; reason?: string } {
  if (safeStorage.isEncryptionAvailable()) {
    return { available: true }
  }
  return {
    available: false,
    reason:
      'SafeStorage is not available on this platform. Ensure the OS keychain (macOS) or secret service (Linux, e.g. gnome-keyring) is running and unlocked.',
  }
}

/**
 * 确保 safeStorage 可用，否则抛出 SAFE_STORAGE_UNAVAILABLE。
 */
function assertSafeStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError(
      ErrorCodes.SAFE_STORAGE_UNAVAILABLE,
      'SafeStorage is not available on this platform. API key cannot be encrypted.',
    )
  }
}

/**
 * 加密 API Key。
 * 将明文 API Key 使用 safeStorage 加密，返回 Base64 编码的字符串以便存储在 SQLite TEXT 列中。
 *
 * @param plainKey - 明文 API Key
 * @returns Base64 编码的加密字符串
 * @throws {AppError} SAFE_STORAGE_UNAVAILABLE - safeStorage 不可用时
 */
export function encryptApiKey(plainKey: string): string {
  assertSafeStorageAvailable()
  const encryptedBuffer = safeStorage.encryptString(plainKey)
  return encryptedBuffer.toString('base64')
}

/**
 * 解密 API Key。
 * 将 Base64 编码的加密字符串解密为明文 API Key。
 *
 * @param encryptedKey - Base64 编码的加密字符串
 * @returns 明文 API Key
 * @throws {AppError} SAFE_STORAGE_UNAVAILABLE - safeStorage 不可用时
 * @throws {AppError} DECRYPTION_FAILED - 解密失败时（密钥损坏或 OS 密钥变更）
 */
export function decryptApiKey(encryptedKey: string): string {
  assertSafeStorageAvailable()
  const buffer = Buffer.from(encryptedKey, 'base64')
  try {
    return safeStorage.decryptString(buffer)
  } catch {
    throw new AppError(
      ErrorCodes.DECRYPTION_FAILED,
      'Failed to decrypt API key. The encrypted value may be corrupted, or the OS keychain/secret service has changed since the key was encrypted.',
      { encryptedKeyPreview: encryptedKey.slice(0, 16) },
    )
  }
}

/**
 * 检查加密值是否可以成功解密。
 * 尝试解密指定的 Base64 加密字符串，成功返回 true，失败返回 false。
 * 用于在加载模型配置时检测密钥是否因 OS 密钥变更而不可解密。
 *
 * @param encryptedBase64 - Base64 编码的加密字符串
 * @returns 是否可解密
 */
export function isEncryptedValueValid(encryptedBase64: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    return false
  }
  try {
    const buffer = Buffer.from(encryptedBase64, 'base64')
    safeStorage.decryptString(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * 重置加密的 API Key。
 * 用于解密失败后清除指定加密值。
 * 返回空字符串，调用方应将其持久化到数据库以覆盖已损坏的加密值，
 * 从而允许用户重新输入 API Key。
 *
 * @returns 空字符串（表示已重置）
 */
export function resetEncryptedApiKey(): string {
  return ''
}
