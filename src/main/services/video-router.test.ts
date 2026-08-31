// M15：跨厂商智能路由引擎单元测试
// 覆盖固定/成本优先/质量优先三种策略的决策与日志记录、配置更新与默认配置构造。

import { describe, it, expect, beforeEach } from 'vitest'
import {
  VideoRouter,
  defaultRoutingConfig,
  normalizeRoutingConfig,
  ROUTE_PROVIDER_ORDER,
} from './video-router'
import type { VideoRoutingConfig } from '@shared/types'

function makeConfig(partial?: Partial<VideoRoutingConfig>): VideoRoutingConfig {
  const base = {
    strategy: 'fixed' as const,
    providers: [
      { provider: 'seedance' as const, costPerSecond: 0.5, qualityRank: 1, enabled: true },
      { provider: 'kling' as const, costPerSecond: 1.0, qualityRank: 2, enabled: true },
      { provider: 'custom' as const, costPerSecond: 0.2, qualityRank: 3, enabled: true },
    ],
  }
  return { ...base, ...partial }
}

describe('VideoRouter', () => {
  let router: VideoRouter

  beforeEach(() => {
    router = new VideoRouter(makeConfig())
  })

  it('defaultRoutingConfig 返回固定策略且全部厂商启用', () => {
    const def = defaultRoutingConfig()
    expect(def.strategy).toBe('fixed')
    expect(def.providers).toHaveLength(3)
    for (const p of def.providers) {
      expect(p.enabled).toBe(true)
      expect(p.qualityRank).toBeGreaterThanOrEqual(1)
      expect(p.costPerSecond).toBeGreaterThanOrEqual(0)
    }
  })

  it('固定策略选择启用列表中的第一个厂商', () => {
    const decision = router.route('一只猫在窗台上晒太阳', 5)
    expect(decision.provider).toBe('seedance')
    expect(decision.reason).toContain('固定')
    expect(decision.candidates).toHaveLength(3)
  })

  it('固定策略跳过未启用厂商', () => {
    const cfg = makeConfig({
      providers: [
        { provider: 'seedance' as const, costPerSecond: 0.5, qualityRank: 1, enabled: false },
        { provider: 'kling' as const, costPerSecond: 1.0, qualityRank: 2, enabled: true },
      ],
    })
    router.updateConfig(cfg)
    const decision = router.route('测试', 5)
    expect(decision.provider).toBe('kling')
  })

  it('成本优先策略选择每秒成本最低的厂商', () => {
    router.updateConfig(makeConfig({ strategy: 'cost-optimized' }))
    const decision = router.route('海浪拍打沙滩', 10)
    expect(decision.provider).toBe('custom') // 0.2 元/秒最低
    expect(decision.reason).toContain('0.2')
    expect(decision.reason).toContain('10s')
  })

  it('成本优先策略按时长计算总成本', () => {
    router.updateConfig(makeConfig({ strategy: 'cost-optimized' }))
    const cfg = makeConfig({
      strategy: 'cost-optimized',
      providers: [
        { provider: 'seedance' as const, costPerSecond: 1.0, qualityRank: 1, enabled: true },
        { provider: 'kling' as const, costPerSecond: 0.5, qualityRank: 2, enabled: true },
      ],
    })
    router.updateConfig(cfg)
    const decision = router.route('城市夜景', 20)
    expect(decision.provider).toBe('kling') // 0.5*20=10 < 1.0*20=20
  })

  it('质量优先策略选择 qualityRank 最小（优先级最高）的厂商', () => {
    router.updateConfig(makeConfig({ strategy: 'quality-first' }))
    const decision = router.route('古风庭院', 5)
    expect(decision.provider).toBe('seedance') // rank 1
    expect(decision.reason).toContain('第 1')
  })

  it('没有启用厂商时抛出明确错误', () => {
    const cfg = makeConfig({
      providers: [
        { provider: 'seedance' as const, costPerSecond: 0.5, qualityRank: 1, enabled: false },
      ],
    })
    router.updateConfig(cfg)
    expect(() => router.route('测试', 5)).toThrow('No enabled video providers')
  })

  it('记录路由决策日志（截取提示词前 50 字符）', () => {
    const longPrompt = 'x'.repeat(100)
    router.route(longPrompt, 5)
    const logs = router.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].promptPreview).toHaveLength(50)
    expect(logs[0].strategy).toBe('fixed')
    expect(logs[0].selectedProvider).toBe('seedance')
  })

  it('日志数量受上限约束（maxLogs=100）', () => {
    for (let i = 0; i < 120; i++) {
      router.route(`任务 ${i}`, 5)
    }
    const logs = router.getLogs(200)
    expect(logs).toHaveLength(100)
  })

  it('getLogs 缺省返回最近 50 条，limit 可用', () => {
    for (let i = 0; i < 60; i++) {
      router.route(`任务 ${i}`, 5)
    }
    expect(router.getLogs()).toHaveLength(50)
    expect(router.getLogs(10)).toHaveLength(10)
  })

  it('clearLogs 清空全部日志', () => {
    router.route('测试', 5)
    router.clearLogs()
    expect(router.getLogs()).toHaveLength(0)
  })

  it('updateConfig 改变后续路由决策', () => {
    const cfg = makeConfig({ strategy: 'cost-optimized' })
    router.updateConfig(cfg)
    const decision = router.route('测试', 5)
    expect(decision.provider).toBe('custom')
    expect(router.getConfig().strategy).toBe('cost-optimized')
  })
})

describe('normalizeRoutingConfig', () => {
  it('null / 非对象回退默认配置', () => {
    expect(normalizeRoutingConfig(null)).toEqual(defaultRoutingConfig())
    expect(normalizeRoutingConfig('bad')).toEqual(defaultRoutingConfig())
    expect(normalizeRoutingConfig(undefined)).toEqual(defaultRoutingConfig())
  })

  it('非法策略回退 fixed', () => {
    const cfg = normalizeRoutingConfig({ strategy: 'unknown', providers: [] })
    expect(cfg.strategy).toBe('fixed')
    expect(cfg.providers).toHaveLength(ROUTE_PROVIDER_ORDER.length)
  })

  it('补齐缺失厂商并规整字段', () => {
    const cfg = normalizeRoutingConfig({
      strategy: 'quality-first',
      providers: [
        { provider: 'seedance', enabled: true, costPerSecond: -1, qualityRank: 'x' },
        { provider: 'kling', enabled: false, costPerSecond: 3, qualityRank: 1 },
      ],
    })
    expect(cfg.strategy).toBe('quality-first')
    const seedance = cfg.providers.find((p) => p.provider === 'seedance')
    const kling = cfg.providers.find((p) => p.provider === 'kling')
    const custom = cfg.providers.find((p) => p.provider === 'custom')
    // 非法数值回退默认
    expect(seedance!.costPerSecond).toBeGreaterThanOrEqual(0)
    expect(seedance!.qualityRank).toBeGreaterThanOrEqual(1)
    // 合法值保留
    expect(kling!.enabled).toBe(false)
    expect(kling!.costPerSecond).toBe(3)
    expect(kling!.qualityRank).toBe(1)
    // 缺失厂商补齐
    expect(custom).toBeDefined()
  })
})