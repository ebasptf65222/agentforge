// AgentForge 生成历史统计聚合（M12）
//
// 职责：基于 video_tasks 表在指定时间范围内实时聚合生成统计
//（状态计数、成功率/失败率、平均耗时、用量），并生成可导出的 CSV 报表。
//
// 口径：
// - 仅统计任务行（单视频 + 序列镜头子任务），不统计 video_sequences 父记录，避免重复计数
// - 成功率/失败率 = succeeded/failed ÷ 终态数（succeeded+failed+cancelled）× 100，无终态为 0
// - 平均耗时 = 成功任务 createdAt→updatedAt 的平均秒数，无成功任务为 null
// - 用量（videoSeconds）= 成功任务 duration 之和（成功产出的视频总时长）

import type {
  VideoStatsBucket,
  VideoStatsOverview,
  VideoTask,
} from '@shared/types'
import { listVideoTasksSince } from '../db/repos/video-task'

function createEmptyBucket(key: string): VideoStatsBucket {
  return {
    key,
    total: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    active: 0,
    successRate: 0,
    failureRate: 0,
    avgElapsedSeconds: null,
    videoSeconds: 0,
  }
}

/** 将一组任务聚合为一个统计桶 */
function aggregateBucket(key: string, tasks: VideoTask[]): VideoStatsBucket {
  const bucket = createEmptyBucket(key)
  let elapsedSum = 0
  let elapsedCount = 0
  for (const task of tasks) {
    bucket.total += 1
    if (task.status === 'succeeded') {
      bucket.succeeded += 1
      bucket.videoSeconds += task.duration
      elapsedSum += Math.max(0, task.updatedAt - task.createdAt)
      elapsedCount += 1
    } else if (task.status === 'failed') {
      bucket.failed += 1
    } else if (task.status === 'cancelled') {
      bucket.cancelled += 1
    } else {
      bucket.active += 1
    }
  }
  const terminal = bucket.succeeded + bucket.failed + bucket.cancelled
  bucket.successRate = terminal > 0 ? round2((bucket.succeeded / terminal) * 100) : 0
  bucket.failureRate = terminal > 0 ? round2((bucket.failed / terminal) * 100) : 0
  bucket.avgElapsedSeconds = elapsedCount > 0 ? round2(elapsedSum / elapsedCount / 1000) : null
  return bucket
}

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

function sortByTotalDesc(buckets: VideoStatsBucket[]): VideoStatsBucket[] {
  return buckets.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
}

/**
 * 聚合指定起始时间（毫秒）之后的全部视频任务统计。
 */
export function aggregateVideoStats(sinceTs: number): VideoStatsOverview {
  const tasks = listVideoTasksSince(sinceTs)
  const overview = aggregateBucket('ALL', tasks)

  // 按天 / 厂商 / 模型分桶
  const byDayMap = new Map<string, VideoTask[]>()
  const byProviderMap = new Map<string, VideoTask[]>()
  const byModelMap = new Map<string, VideoTask[]>()
  for (const task of tasks) {
    pushTo(byDayMap, dayKey(task.createdAt), task)
    pushTo(byProviderMap, task.provider, task)
    pushTo(byModelMap, task.model, task)
  }
  // 按天按日期升序，厂商/模型按任务量降序
  const byDay = Array.from(byDayMap.entries())
    .map(([key, list]) => aggregateBucket(key, list))
    .sort((a, b) => a.key.localeCompare(b.key))
  const byProvider = sortByTotalDesc(
    Array.from(byProviderMap.entries()).map(([key, list]) => aggregateBucket(key, list)),
  )
  const byModel = sortByTotalDesc(
    Array.from(byModelMap.entries()).map(([key, list]) => aggregateBucket(key, list)),
  )

  return {
    since: sinceTs,
    total: overview.total,
    succeeded: overview.succeeded,
    failed: overview.failed,
    cancelled: overview.cancelled,
    active: overview.active,
    successRate: overview.successRate,
    failureRate: overview.failureRate,
    avgElapsedSeconds: overview.avgElapsedSeconds,
    videoSeconds: overview.videoSeconds,
    byDay,
    byProvider,
    byModel,
  }
}

function pushTo(map: Map<string, VideoTask[]>, key: string, task: VideoTask): void {
  const list = map.get(key)
  if (list) list.push(task)
  else map.set(key, [task])
}

// ─── CSV 导出 ───────────────────────────────────────────────────

const CSV_HEADER =
  'section,key,total,succeeded,failed,cancelled,active,success_rate,failure_rate,avg_elapsed_s,video_seconds'

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function bucketRow(section: string, bucket: VideoStatsBucket): string {
  return [
    section,
    csvEscape(bucket.key),
    bucket.total,
    bucket.succeeded,
    bucket.failed,
    bucket.cancelled,
    bucket.active,
    bucket.successRate,
    bucket.failureRate,
    bucket.avgElapsedSeconds ?? '',
    bucket.videoSeconds,
  ].join(',')
}

/**
 * 将统计总览序列化为 CSV 文本（不含 BOM，调用方写入时自行添加）。
 * 首行表头，summary 行 key=ALL，其后依次 by_day / by_provider / by_model 分段。
 */
export function buildStatsCsv(overview: VideoStatsOverview): string {
  const lines: string[] = [CSV_HEADER, bucketRow('summary', {
    ...createEmptyBucket('ALL'),
    total: overview.total,
    succeeded: overview.succeeded,
    failed: overview.failed,
    cancelled: overview.cancelled,
    active: overview.active,
    successRate: overview.successRate,
    failureRate: overview.failureRate,
    avgElapsedSeconds: overview.avgElapsedSeconds,
    videoSeconds: overview.videoSeconds,
  })]
  for (const bucket of overview.byDay) lines.push(bucketRow('by_day', bucket))
  for (const bucket of overview.byProvider) lines.push(bucketRow('by_provider', bucket))
  for (const bucket of overview.byModel) lines.push(bucketRow('by_model', bucket))
  return `${lines.join('\r\n')}\r\n`
}
