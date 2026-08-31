# M15：跨厂商智能路由 — 实施方案

> 依赖：M4 多厂商（Seedance / Kling / Custom）。路线图定位：梯队 B · 中期。

## 目标

当前视频生成任务只能使用用户在设置中选定的单一厂商。M15 引入智能路由层：

1. **多厂商配置**：支持为每个厂商配置启用状态、价格模型、最大并发数等参数。
2. **路由策略**：提供三种路由策略——「固定厂商」（兼容当前行为）、「成本优先」（选最低价厂商）、「质量优先」（选指定厂商优先级）。
3. **路由决策**：任务提交时根据策略自动选择最优厂商，用户也可手动覆盖。
4. **路由日志**：记录每次路由决策的依据（策略、选中厂商、原因），便于审计和优化。

## 范围（MVP）

* **做**：
  * 厂商启用配置（哪些厂商可用）
  * 价格模型配置（每秒视频成本，用于成本优先策略）
  * 质量优先级配置（用户自定义厂商优先级顺序）
  * 路由策略选择（固定/成本优先/质量优先）
  * 任务提交时自动路由
  * 手动覆盖路由（生成时可指定厂商）
  * 路由决策日志（存储在内存，可查询最近 N 条）
* **不做**：
  * 不做动态价格抓取（价格需用户手动配置）
  * 不做基于历史数据的自动价格学习
  * 不做负载均衡（轮询/最少连接）
  * 不做故障自动切换（厂商失败后不自动重试其他厂商）

## 变更清单

### 1. 共享类型（shared/types/video.ts）

新增路由相关类型：

```typescript
/** 路由策略 */
export type VideoRoutingStrategy = 'fixed' | 'cost-optimized' | 'quality-first'

/** 厂商价格配置（每秒视频成本，单位：元） */
export interface VideoProviderPricing {
  provider: VideoProvider
  /** 每秒视频成本（元），用于成本优先策略 */
  costPerSecond: number
  /** 质量优先级（1=最高，数字越大优先级越低） */
  qualityRank: number
  /** 是否启用（未启用的厂商不参与路由） */
  enabled: boolean
}

/** 智能路由配置 */
export interface VideoRoutingConfig {
  /** 路由策略 */
  strategy: VideoRoutingStrategy
  /** 各厂商价格与优先级配置 */
  providers: VideoProviderPricing[]
}

/** 路由决策日志条目 */
export interface VideoRoutingLogEntry {
  /** 决策时间戳 */
  timestamp: number
  /** 任务提示词（截取前 50 字符） */
  promptPreview: string
  /** 选中的厂商 */
  selectedProvider: VideoProvider
  /** 路由策略 */
  strategy: VideoRoutingStrategy
  /** 决策原因 */
  reason: string
  /** 候选厂商列表（含价格/优先级） */
  candidates: Array<{
    provider: VideoProvider
    costPerSecond?: number
    qualityRank?: number
    reason: string
  }>
}

/** 视频生成参数扩展（支持手动覆盖厂商） */
export interface CreateVideoTaskParams {
  // ...existing fields...
  /** 手动指定厂商（覆盖路由策略） */
  providerOverride?: VideoProvider
}
```

### 2. 路由引擎（新文件 src/main/services/video-router.ts）

核心逻辑：

```typescript
import type {
  VideoProvider,
  VideoRoutingConfig,
  VideoRoutingLogEntry,
  VideoRoutingStrategy,
  VideoProviderPricing,
} from '@shared/types'

/** 路由决策结果 */
export interface RoutingDecision {
  provider: VideoProvider
  reason: string
  candidates: VideoRoutingLogEntry['candidates']
}

/** 智能路由器 */
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

  /** 路由决策 */
  route(prompt: string, duration: number): RoutingDecision {
    const enabledProviders = this.config.providers.filter(p => p.enabled)
    if (enabledProviders.length === 0) {
      throw new Error('No enabled video providers')
    }

    let decision: RoutingDecision

    switch (this.config.strategy) {
      case 'fixed':
        decision = this.routeFixed(enabledProviders)
        break
      case 'cost-optimized':
        decision = this.routeCostOptimized(enabledProviders, duration)
        break
      case 'quality-first':
        decision = this.routeQualityFirst(enabledProviders)
        break
      default:
        decision = this.routeFixed(enabledProviders)
    }

    this.logDecision(prompt, decision)
    return decision
  }

  /** 固定策略：使用默认厂商（配置中的第一个） */
  private routeFixed(providers: VideoProviderPricing[]): RoutingDecision {
    const primary = providers[0]
    return {
      provider: primary.provider,
      reason: '固定厂商策略',
      candidates: providers.map(p => ({
        provider: p.provider,
        qualityRank: p.qualityRank,
        reason: p.provider === primary.provider ? '默认厂商' : '未选中',
      })),
    }
  }

  /** 成本优先策略：选最便宜的厂商 */
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
      candidates: sorted.map(p => ({
        provider: p.provider,
        costPerSecond: p.costPerSecond,
        reason: `${(p.costPerSecond * duration).toFixed(2)} 元`,
      })),
    }
  }

  /** 质量优先策略：按 qualityRank 排序，选排名最高的 */
  private routeQualityFirst(providers: VideoProviderPricing[]): RoutingDecision {
    const sorted = [...providers].sort((a, b) => a.qualityRank - b.qualityRank)
    const best = sorted[0]

    return {
      provider: best.provider,
      reason: `质量优先：排名第 ${best.qualityRank}`,
      candidates: sorted.map(p => ({
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

  /** 获取路由日志 */
  getLogs(limit?: number): VideoRoutingLogEntry[] {
    return this.logs.slice(0, limit ?? 50)
  }

  /** 清空日志 */
  clearLogs(): void {
    this.logs = []
  }
}
```

### 3. 数据访问扩展

#### app_settings 表新增列

```sql
ALTER TABLE app_settings ADD COLUMN video_routing_config TEXT;
```

该列存储 `VideoRoutingConfig` 的 JSON 字符串。

#### db/repos/app-settings.ts

* `rowToSettings` 映射新列：解析 JSON 为 `VideoRoutingConfig`，缺省值为固定策略 + 全部厂商启用。
* `updateSetting` 支持更新 `video_routing_config`。

### 4. 视频引擎集成（video-engine.ts）

* 构造函数注入 `VideoRouter` 实例。
* `generate()` 和 `generateSequence()` 中：
  * 如果 `params.providerOverride` 存在，直接使用指定厂商。
  * 否则调用 `router.route(prompt, duration)` 获取路由决策。
  * 用决策结果替换 `config.provider`。
* 路由决策随任务持久化（新增 `routingLog` 字段到 VideoTask）。

### 5. IPC（src/main/ipc/video.ts）

新增通道：

* `video:get-routing-config`：返回当前路由配置。
* `video:set-routing-config`：更新路由配置。
* `video:get-routing-logs`：获取路由决策日志（最近 N 条）。
* `video:clear-routing-logs`：清空路由日志。

### 6. Preload + 渲染层类型

* `src/preload/index.ts`：新增 `video.getRoutingConfig()`、`video.setRoutingConfig(config)`、`video.getRoutingLogs(limit?)`、`video.clearRoutingLogs()`。
* `src/renderer/src/types/electron-api.ts`：新增路由相关类型和 API 方法声明。

### 7. Store（stores/video.ts）

新增状态和 Actions：

* State：`routingConfig`、`routingLogs`、`routingLoading`。
* Actions：`fetchRoutingConfig()`、`updateRoutingConfig(config)`、`fetchRoutingLogs(limit?)`、`clearRoutingLogs()`。

### 8. UI（VideoConfig.vue + VideoLibraryView）

#### VideoConfig.vue

新增「智能路由」标签页（与现有「厂商配置」并列）：

* 路由策略选择（下拉：固定/成本优先/质量优先）
* 厂商启用开关
* 成本配置（每秒价格输入框）
* 质量优先级（拖拽排序或数字输入）

#### VideoLibraryView

任务卡片新增路由信息展示（小字）：

* 显示「路由决策：{策略} → {厂商}」
* 可点击查看完整路由日志

### 9. 测试与验证

* `video-router.test.ts`：路由策略逻辑测试（固定/成本/质量）、日志记录、配置更新。
* `video-engine.test.ts`：集成路由决策、手动覆盖、路由日志持久化。
* `ipc/video.test.ts`：新通道注册与参数校验。
* `stores/video.test.ts`：新 actions 测试。
* `db/repos/app-settings.test.ts`：新列读写测试。

门槛：`typecheck / lint / test / build` 全绿。

## 验收标准

1. 用户可在设置中选择路由策略（固定/成本优先/质量优先）。
2. 用户可为每个厂商配置启用状态、每秒成本、质量优先级。
3. 成本优先策略自动选择最便宜的厂商（基于用户配置的价格）。
4. 质量优先策略按用户定义的优先级顺序选择厂商。
5. 固定策略使用默认厂商（兼容当前行为）。
6. 生成任务时可手动指定厂商（覆盖路由策略）。
7. 路由决策日志可查询，记录策略、选中厂商、决策原因。
8. 路由配置重启后持久化。
9. 所有既有功能（单生成/序列生成/批量生成/CSV 批量）不受影响。
10. 主进程、IPC、Preload、Store、UI 类型贯通；typecheck / lint / test / build 全绿。

## 实施顺序

1. **阶段 1：核心路由逻辑**（video-router.ts + 类型定义）
2. **阶段 2：数据持久化**（DB 迁移 + app-settings 读写）
3. **阶段 3：引擎集成**（video-engine.ts 路由决策注入）
4. **阶段 4：IPC + Preload**（通道暴露）
5. **阶段 5：Store + UI**（配置界面 + 日志展示）
6. **阶段 6：测试验证**（单元测试 + 全量验证）

预估工时：4-6 小时（不含方案评审时间）
