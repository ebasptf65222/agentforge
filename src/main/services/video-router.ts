// M15：跨厂商智能路由引擎
// 提供固定 / 成本优先 / 质量优先三种路由策略，任务提交时自动选择最优厂商，
// 并记录每次路由决策日志（内存态，最近 N 条可查询）。不落库、不做动态价格抓取。

import type {
  VideoProvider,
  VideoProviderPricing,
  VideoRoutingCandidate,
  VideoRoutingConfig,
  VideoRoutingLogEntry,
  VideoRoutingStrategy,
} from '@shared/types'

/** 路由决策结果（供引擎替换厂商并用） */
export interface RoutingDecision {
  provider: VideoProvider
  reason: string
  candidates: VideoRoutingCandidate[]
}

/** 智能路由器（内存态，可更新配置与读取日志） */
export class VideoRouter {
  private config: VideoRoutingConfig
  private logs: VideoRoutingLogEntry[] = []
  private readonly maxLogs = 100

  constructor(config: VideoRoutingConfig) {
    this.config = config
  }

  /** 更新路由配置 */
  updateConfig(config: VideoRoutingConfig): void {
    this.config = config
  }

  /** 当前配置（副本，供 UI 回显） */
  getConfig(): VideoRoutingConfig {
    return this.config
  }

  /** 路由决策 */
  route(prompt: string, duration: number): RoutingDecision {
    const enabledProviders = this.config.providers.filter((p) => p.enabled)
    if (enabledProviders.length === 0) {
      throw new Error('No enabled video providers to route to')
    }

    let decision: RoutingDecision
    switch (this.config.strategy) {
      case 'cost-optimized':
        decision = this.routeCostOptimized(enabledProviders, duration)
        break
      case 'quality-first':
        decision = this.routeQualityFirst(enabledProviders)
        break
      case 'fixed':
      default:
        decision = this.routeFixed(enabledProviders)
    }

    this.logDecision(prompt, decision)
    return decision
  }

  /** 固定策略：使用默认厂商（配置中启用的第一个） */
  private routeFixed(providers: VideoProviderPricing[]): RoutingDecision {
    const primary = providers[0]
    return {
      provider: primary.provider,
      reason: '固定厂商策略',
      candidates: providers.map((p) => ({
        provider: p.provider,
        qualityRank: p.qualityRank,
        reason: p.provider === primary.provider ? '默认厂商' : '未选中',
      })),
    }
  }

  /** 成本优先策略：选每秒成本最低的厂商 */
  private routeCostOptimized(
    providers: VideoProviderPricing[],
    duration: number,
  ): RoutingDecision {
    const sorted = [...providers].sort((a, b) => a.costPerSecond - b.costPerSecond)
    const cheapest = sorted[0]
    const totalCost = cheapest.costPerSecond * duration

    return {
      provider: cheapest.provider,
      reason: `成本最优：${cheapest.costPerSecond} 元/秒 × ${duration}s = ${totalCost.toFixed(2)} 元`,
      candidates: sorted.map((p) => ({
        provider: p.provider,
        costPerSecond: p.costPerSecond,
        reason: `${(p.costPerSecond * duration).toFixed(2)} 元`,
      })),
    }
  }

  /** 质量优先策略：按 qualityRank 升序选排名最高的厂商 */
  private routeQualityFirst(providers: VideoProviderPricing[]): RoutingDecision {
    const sorted = [...providers].sort((a, b) => a.qualityRank - b.qualityRank)
    const best = sorted[0]

    return {
      provider: best.provider,
      reason: `质量优先：排名第 ${best.qualityRank}`,
      candidates: sorted.map((p) => ({
        provider: p.provider,
        qualityRank: p.qualityRank,
        reason: `排名第 ${p.qualityRank}`,
      })),
    }
  }

  /** 记录路由决策日志 */
  private logDecision(prompt: string, decision: RoutingDecision): void {
    const entry: VideoRoutingLogEntry = {
      timestamp: Date.now(),
      promptPreview: prompt.slice(0, 50),
      selectedProvider: decision.provider,
      strategy: this.config.strategy,
      reason: decision.reason,
      candidates: decision.candidates,
    }
    this.logs.unshift(entry)
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }
  }

  /** 获取路由决策日志（缺省最近 50 条） */
  getLogs(limit?: number): VideoRoutingLogEntry[] {
    return limit === undefined
      ? this.logs.slice(0, 50)
      : this.logs.slice(0, Math.max(0, Math.min(Math.round(limit), this.maxLogs)))
  }

  /** 清空路由日志 */
  clearLogs(): void {
    this.logs = []
  }
}

/** 全部视频厂商（路由候选名单顺序） */
export const ROUTE_PROVIDER_ORDER: VideoProvider[] = ['seedance', 'kling', 'custom']

/** 构造默认路由配置：固定策略 + 全部厂商启用 + 默认价格/优先级 */
export function defaultRoutingConfig(): VideoRoutingConfig {
  return {
    strategy: 'fixed',
    providers: [
      { provider: 'seedance', costPerSecond: 0.5, qualityRank: 1, enabled: true },
      { provider: 'kling', costPerSecond: 1.0, qualityRank: 2, enabled: true },
      { provider: 'custom', costPerSecond: 0.8, qualityRank: 3, enabled: true },
    ],
  }
}

const ROUTE_STRATEGIES: VideoRoutingStrategy[] = ['fixed', 'cost-optimized', 'quality-first']

/**
 * 安全解析并规整外部传入的路由配置。
 * - 结构非法时回退默认配置
 * - 厂商缺失时补齐默认行；字段缺失/越界时填默认值
 */
export function normalizeRoutingConfig(raw: unknown): VideoRoutingConfig {
  const def = defaultRoutingConfig()
  if (raw === null || typeof raw !== 'object') return def

  const obj = raw as Record<string, unknown>
  const strategy = ROUTE_STRATEGIES.includes(obj.strategy as VideoRoutingStrategy)
    ? (obj.strategy as VideoRoutingStrategy)
    : def.strategy

  const rawProviders = Array.isArray(obj.providers) ? obj.providers : []
  const byProvider = new Map<VideoProvider, VideoProviderPricing>()
  for (const defP of def.providers) byProvider.set(defP.provider, defP)

  for (const item of rawProviders) {
    if (item === null || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const provider = ROUTE_PROVIDER_ORDER.find((v) => v === p.provider)
    if (!provider) continue
    const base = byProvider.get(provider)!
    byProvider.set(provider, {
      provider,
      enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
      costPerSecond:
        typeof p.costPerSecond === 'number' && Number.isFinite(p.costPerSecond) && p.costPerSecond >= 0
          ? p.costPerSecond
          : base.costPerSecond,
      qualityRank:
        typeof p.qualityRank === 'number' && Number.isFinite(p.qualityRank) && p.qualityRank >= 1
          ? Math.round(p.qualityRank)
          : base.qualityRank,
    })
  }

  return { strategy, providers: ROUTE_PROVIDER_ORDER.map((v) => byProvider.get(v)!) }
}