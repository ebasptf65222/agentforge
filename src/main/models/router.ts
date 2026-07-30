// AgentForge P1-07: 模型路由器
// 根据 modelId 从 DB 获取 ModelConfig，创建并缓存适配器实例
//
// 架构优化批次C-3: 核心逻辑已移至 ModelAdapterRegistry（registry.ts）。
// 本文件保留向后兼容的导出函数，委托给 registry 单例。

import type { ModelProvider } from '@shared/types'
import type { ModelAdapter } from './adapter'
import {
  getModelAdapterRegistry,
  type ModelAdapterConfig,
  type AdapterFactory,
} from './registry'

// ─── 向后兼容的重导出 ───────────────────────────────────────────

export type { ModelAdapterConfig, AdapterFactory }

/**
 * 注册（或覆盖）一个 provider 的适配器工厂。
 *
 * @param provider - 提供商名称（与 ModelConfig.provider 对应）
 * @param factory - 适配器工厂函数
 */
export function registerAdapter(provider: string, factory: AdapterFactory): void {
  getModelAdapterRegistry().registerAdapter(provider, factory)
}

/**
 * 获取当前已注册的所有 provider 名称。
 *
 * @returns 已注册 provider 名称数组
 */
export function getRegisteredProviders(): string[] {
  return getModelAdapterRegistry().getRegisteredProviders()
}

/**
 * 获取模型适配器实例。
 * 优先从缓存获取，缓存未命中时从 DB 读取配置并创建。
 *
 * @param configId - model_configs 表中的主键 id
 * @returns 对应的 ModelAdapter 实例
 * @throws {AppError} MODEL_NOT_FOUND - 模型不存在
 * @throws {AppError} MODEL_API_ERROR - 提供商不支持
 */
export function getModelAdapter(configId: string): ModelAdapter {
  return getModelAdapterRegistry().getModelAdapter(configId)
}

/**
 * 清除适配器缓存。
 * P1-06 的 model:update / model:delete 后调用。
 *
 * @param modelId - 变更的模型 ID（不传则清除全部缓存）
 */
export function invalidateModelCache(modelId?: string): void {
  getModelAdapterRegistry().invalidateCache(modelId)
}

/**
 * 获取当前缓存大小（仅供测试使用）。
 */
export function getCacheSize(): number {
  return getModelAdapterRegistry().getCacheSize()
}
