// M12: 生成历史统计聚合与 CSV 导出测试
// 使用真实临时数据库，验证聚合口径（状态计数/成功率/失败率/平均耗时/用量）
// 与按天/厂商/模型分桶，以及 buildStatsCsv 的分段结构。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase, getDatabase } from '../db/index'
import { createVideoTask, updateVideoTask } from '../db/repos/video-task'
import { aggregateVideoStats, buildStatsCsv } from './video-stats'

/** 让任务的 createdAt/updatedAt 落在指定时间（绕过 repo 自动时间戳） */
function backdate(id: string, createdAt: number, updatedAt: number): void {
  getDatabase()
    .prepare('UPDATE video_tasks SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(createdAt, updatedAt, id)
}

describe('video-stats (M12)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-video-stats-'))
    dbPath = join(tempDir, 'test.db')
    closeDatabase()
    initDatabase(dbPath)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('空数据时全部指标为 0，平均耗时为 null', () => {
    const stats = aggregateVideoStats(Date.now() - 30 * 24 * 3600 * 1000)
    expect(stats.total).toBe(0)
    expect(stats.succeeded).toBe(0)
    expect(stats.failed).toBe(0)
    expect(stats.cancelled).toBe(0)
    expect(stats.active).toBe(0)
    expect(stats.successRate).toBe(0)
    expect(stats.failureRate).toBe(0)
    expect(stats.avgElapsedSeconds).toBeNull()
    expect(stats.videoSeconds).toBe(0)
    expect(stats.byDay).toEqual([])
    expect(stats.byProvider).toEqual([])
    expect(stats.byModel).toEqual([])
  })

  it('按状态计数并计算成功率/失败率/平均耗时/用量', () => {
    const now = Date.now()
    const base = now - 3600 * 1000

    // 两个成功（耗时 10s、30s → 平均 20s；用量 5+10=15s）
    const s1 = createVideoTask({ prompt: 'a', model: 'm1', provider: 'seedance', duration: 5 })
    updateVideoTask(s1.id, { status: 'succeeded', progress: 100 })
    backdate(s1.id, base, base + 10_000)

    const s2 = createVideoTask({ prompt: 'b', model: 'm1', provider: 'seedance', duration: 10 })
    updateVideoTask(s2.id, { status: 'succeeded', progress: 100 })
    backdate(s2.id, base, base + 30_000)

    // 一个失败、一个取消、一个进行中
    const f = createVideoTask({ prompt: 'c', model: 'm2', provider: 'kling', duration: 5 })
    updateVideoTask(f.id, { status: 'failed' })
    const c = createVideoTask({ prompt: 'd', model: 'm2', provider: 'kling', duration: 5 })
    updateVideoTask(c.id, { status: 'cancelled' })
    createVideoTask({ prompt: 'e', model: 'm2', provider: 'kling', duration: 5 }) // submitted

    const stats = aggregateVideoStats(base - 1000)
    expect(stats.total).toBe(5)
    expect(stats.succeeded).toBe(2)
    expect(stats.failed).toBe(1)
    expect(stats.cancelled).toBe(1)
    expect(stats.active).toBe(1)
    // 终态 4 个：成功 2/4 = 50%，失败 1/4 = 25%
    expect(stats.successRate).toBe(50)
    expect(stats.failureRate).toBe(25)
    expect(stats.avgElapsedSeconds).toBe(20)
    expect(stats.videoSeconds).toBe(15)
  })

  it('时间范围之外的任务不计入', () => {
    const now = Date.now()
    const old = createVideoTask({ prompt: 'old', model: 'm1', duration: 5 })
    backdate(old.id, now - 100 * 24 * 3600 * 1000, now - 100 * 24 * 3600 * 1000)

    const fresh = createVideoTask({ prompt: 'fresh', model: 'm1', duration: 5 })
    updateVideoTask(fresh.id, { status: 'succeeded', progress: 100 })

    const stats = aggregateVideoStats(now - 7 * 24 * 3600 * 1000)
    expect(stats.total).toBe(1)
    expect(stats.succeeded).toBe(1)
  })

  it('按厂商/模型分桶且按任务量降序', () => {
    const now = Date.now()
    // seedance 2 个，kling 1 个
    for (const [i, provider] of ['seedance', 'seedance', 'kling'].entries()) {
      const t = createVideoTask({ prompt: `p${i}`, model: 'm1', provider })
      backdate(t.id, now - 3600 * 1000, now - 3600 * 1000)
    }
    const stats = aggregateVideoStats(now - 24 * 3600 * 1000)
    expect(stats.byProvider.map((b) => b.key)).toEqual(['seedance', 'kling'])
    expect(stats.byProvider[0]?.total).toBe(2)
    expect(stats.byProvider[1]?.total).toBe(1)
    // 单模型
    expect(stats.byModel).toHaveLength(1)
    expect(stats.byModel[0]?.key).toBe('m1')
  })

  it('按天分桶按日期升序且桶键为 YYYY-MM-DD', () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
    const t1 = createVideoTask({ prompt: 'a', model: 'm1', duration: 5 })
    backdate(t1.id, yesterday.getTime(), yesterday.getTime())
    const t2 = createVideoTask({ prompt: 'b', model: 'm1', duration: 5 })
    backdate(t2.id, now.getTime(), now.getTime())

    const stats = aggregateVideoStats(now.getTime() - 7 * 24 * 3600 * 1000)
    expect(stats.byDay).toHaveLength(2)
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(stats.byDay[0]?.key).toBe(fmt(yesterday))
    expect(stats.byDay[1]?.key).toBe(fmt(now))
    expect(stats.byDay[1]?.total).toBe(1)
  })

  it('buildStatsCsv 生成 summary + 分段行', () => {
    const now = Date.now()
    const t = createVideoTask({ prompt: 'a', model: 'm1', provider: 'seedance', duration: 5 })
    updateVideoTask(t.id, { status: 'succeeded', progress: 100 })
    backdate(t.id, now - 3600_000, now)

    const csv = buildStatsCsv(aggregateVideoStats(now - 24 * 3600 * 1000))
    const lines = csv.trim().split(/\r?\n/)
    expect(lines[0]).toBe(
      'section,key,total,succeeded,failed,cancelled,active,success_rate,failure_rate,avg_elapsed_s,video_seconds',
    )
    expect(lines[1]?.startsWith('summary,ALL,')).toBe(true)
    expect(lines.some((l) => l.startsWith('by_day,'))).toBe(true)
    expect(lines.some((l) => l.startsWith('by_provider,seedance,'))).toBe(true)
    expect(lines.some((l) => l.startsWith('by_model,m1,'))).toBe(true)
    // summary 行的量与明细一致
    const summary = (lines[1] as string).split(',')
    expect(summary[2]).toBe('1')
    expect(summary[3]).toBe('1')
  })
})
