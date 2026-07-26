// AgentForge API Key 加密/解密工具
// 使用 Electron safeStorage 对 API Key 进行加密存储
// 与 Spec v0.2 §7.4 一致：safeStorage 不可用时抛出 SAFE_STORAGE_UNAVAILABLE

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
 */
export function decryptApiKey(encryptedKey: string): string {
  assertSafeStorageAvailable()
  const buffer = Buffer.from(encryptedKey, 'base64')
  return safeStorage.decryptString(buffer)
}
