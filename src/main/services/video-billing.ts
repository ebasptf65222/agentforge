// AgentForge 成本与用量计费（M20）
//
// 职责：基于 video_tasks 表在指定时间范围内实时聚合用量与测算成本。
// 口径：
// - 仅统计成功任务（succeeded）的时长作为用量 videoSeconds
// - 成本 = 成功时长 × 厂商每秒单价（取自路由价格配置，缺省用默认配置）
// - 分别按厂商 / 日期 / 模型分桶

import type { VideoBillingBucket, VideoBillingOverview, VideoTask } from '@shared/types'
import { listVideoTasksSince } from '../db/repos/video-task'
import { getSettings } from '../db/repos/app-settings'
import { defaultRoutingConfig } from './video-router'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 本地时区 YYYY-MM-DD（按天分桶的桶标识） */
function dayKey(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 取各厂商每秒单价（元），缺省用默认路由配置 */
function loadCostPerSecond(): Record<string, number> {
  const costByProvider: Record<string, number> = {}
  let config = defaultRoutingConfig()
  try {
    config = getSettings().videoRoutingConfig ?? config
  } catch {
    // 读取失败沿用默认
  }
  for (const p of config.providers) {
    costByProvider[p.provider] = p.costPerSecond
  }
  return costByProvider
}

function aggregateBucket(key: string, tasks: VideoTask[], costPerSecond: Record<string, number>): VideoBillingBucket {
  let videoSeconds = 0
  let count = 0
  for (const task of tasks) {
    if (task.status !== 'succeeded') continue
    videoSeconds += task.duration
    count += 1
  }
  const cost = round2(videoSeconds * (costPerSecond[key] ?? 0))
  return { key, tasks: count, videoSeconds, cost }
}

function sortByCostDesc(buckets: VideoBillingBucket[]): VideoBillingBucket[] {
  return buckets.sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key))
}

/**
 * 聚合指定起始时间（毫秒）之后的成本与用量。
 */
export function aggregateVideoBilling(sinceTs: number): VideoBillingOverview {
  const tasks = listVideoTasksSince(sinceTs)
  const costPerSecond = loadCostPerSecond()

  const byProviderMap = new Map<string, VideoTask[]>()
  const byDayMap = new Map<string, VideoTask[]>()
  const byModelMap = new Map<string, VideoTask[]>()

  let totalVideoSeconds = 0
  let totalTasks = 0
  for (const task of tasks) {
    if (task.status !== 'succeeded') continue
    totalVideoSeconds += task.duration
    totalTasks += 1
    pushTo(byProviderMap, task.provider, task)
    pushTo(byDayMap, dayKey(task.createdAt), task)
    pushTo(byModelMap, task.model, task)
  }

  const byProvider = sortByCostDesc(
    Array.from(byProviderMap.entries()).map(([key, list]) =>
      aggregateBucket(key, list, costPerSecond),
    ),
  )
  const byDay = Array.from(byDayMap.entries())
    .map(([key, list]) => aggregateBucket(key, list, costPerSecond))
    .sort((a, b) => a.key.localeCompare(b.key))
  const byModel = sortByCostDesc(
    Array.from(byModelMap.entries()).map(([key, list]) =>
      aggregateBucket(key, list, costPerSecond),
    ),
  )

  let totalCost = 0
  for (const bucket of byProvider) totalCost += bucket.cost
  totalCost = round2(totalCost)

  return {
    since: sinceTs,
    totalTasks,
    totalVideoSeconds,
    totalCost,
    byProvider,
    byDay,
    byModel,
  }
}

function pushTo(map: Map<string, VideoTask[]>, key: string, task: VideoTask): void {
  const list = map.get(key)
  if (list) list.push(task)
  else map.set(key, [task])
}