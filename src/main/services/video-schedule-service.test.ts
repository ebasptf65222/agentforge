// 视频批量调度服务单元测试
// 覆盖：批次校验（rows/sequences/templateIds 至少一者非空、序列镜头数下限）、
// 连续性序列与模板的执行编排（continuity=true、失败继续、统计口径）。
// video-engine / video-template / electron-helpers 均为 mock，db 用临时文件内存库。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  generateRows: vi.fn(),
  generateSequence: vi.fn(),
  generateFromTemplate: vi.fn(),
}))

vi.mock('../utils/electron-helpers', () => ({
  getMainWindowWebContents: () => null,
}))

vi.mock('./video-engine', () => ({
  getVideoEngine: () => ({
    generateRows: mocks.generateRows,
    generateSequence: mocks.generateSequence,
  }),
}))

vi.mock('./video-template', () => ({
  generateFromTemplate: mocks.generateFromTemplate,
}))

import { initDatabase, closeDatabase } from '../db/index'
import {
  createScheduleTask,
  executeSchedule,
  shutdownVideoScheduler,
} from './video-schedule-service'
import { AppError, ErrorCodes } from '../utils/error'
import type { VideoTask } from '@shared/types'

function fakeTask(id: string): VideoTask {
  return { id } as unknown as VideoTask
}

describe('video-schedule-service', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-vsched-test-'))
    dbPath = join(tempDir, 'test.db')
    closeDatabase()
    initDatabase(dbPath)
    mocks.generateRows.mockReset()
    mocks.generateSequence.mockReset()
    mocks.generateFromTemplate.mockReset()
  })

  afterEach(() => {
    shutdownVideoScheduler()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── 批次校验 ────────────────────────────────────────────────

  it('rejects a batch with no rows, sequences, or templates', () => {
    expect(
      () =>
        createScheduleTask({
          name: '空调度',
          trigger: 'manual',
          batch: { rows: [] },
        }),
    ).toThrowError(AppError)
  })

  it('rejects a sequence row with fewer than 2 shots', () => {
    expect(
      () =>
        createScheduleTask({
          name: '镜头不足',
          trigger: 'manual',
          batch: { rows: [], sequences: [{ shots: ['只有一个镜头'] }] },
        }),
    ).toThrowError(AppError)
  })

  it('persists a valid sequence batch', () => {
    const schedule = createScheduleTask({
      name: '长视频',
      trigger: 'manual',
      batch: {
        rows: [],
        sequences: [{ title: '故事', shots: ['镜头一', '镜头二'], duration: 6 }],
      },
    })
    expect(schedule.batch.sequences).toHaveLength(1)
    expect(schedule.batch.sequences?.[0].shots).toEqual(['镜头一', '镜头二'])
    expect(schedule.batch.sequences?.[0].duration).toBe(6)
  })

  // ─── 执行编排 ────────────────────────────────────────────────

  it('executes a sequence row with continuity=true and records shot count', async () => {
    const schedule = createScheduleTask({
      name: '序列调度',
      trigger: 'manual',
      batch: {
        rows: [],
        sequences: [{ shots: ['镜头一', '镜头二', '镜头三'], duration: 5 }],
      },
    })
    mocks.generateSequence.mockResolvedValue({
      sequence: { id: 'seq-1' },
      tasks: [fakeTask('t1'), fakeTask('t2'), fakeTask('t3')],
    })

    const run = await executeSchedule(schedule.id, 'manual')

    expect(mocks.generateSequence).toHaveBeenCalledTimes(1)
    const params = mocks.generateSequence.mock.calls[0][0]
    expect(params.continuity).toBe(true)
    expect(params.shots).toEqual([
      { prompt: '镜头一', duration: 5 },
      { prompt: '镜头二', duration: 5 },
      { prompt: '镜头三', duration: 5 },
    ])
    expect(run?.status).toBe('ok')
    expect(run?.taskCount).toBe(3)
    expect(run?.failedCount).toBe(0)
    expect(run?.summary).toContain('1 个连续性序列（共 3 镜头）')
  })

  it('continues to the next row when a sequence fails and marks the run error', async () => {
    const schedule = createScheduleTask({
      name: '序列失败继续',
      trigger: 'manual',
      batch: {
        rows: [],
        sequences: [{ shots: ['坏镜头一', '坏镜头二'] }, { shots: ['好镜头一', '好镜头二'] }],
      },
    })
    mocks.generateSequence
      .mockRejectedValueOnce(new AppError(ErrorCodes.VALIDATION_ERROR, 'boom'))
      .mockResolvedValueOnce({
        sequence: { id: 'seq-2' },
        tasks: [fakeTask('t1'), fakeTask('t2')],
      })

    const run = await executeSchedule(schedule.id, 'manual')

    expect(mocks.generateSequence).toHaveBeenCalledTimes(2)
    expect(run?.status).toBe('error')
    expect(run?.failedCount).toBe(1)
    expect(run?.taskCount).toBe(2)
  })

  it('runs template ids via generateFromTemplate and counts outputs', async () => {
    const schedule = createScheduleTask({
      name: '模板调度',
      trigger: 'manual',
      batch: { rows: [], templateIds: ['tpl-seq', 'tpl-shot'] },
    })
    // sequence 模板：返回序列 + 2 镜头；shot 模板：返回单任务数组
    mocks.generateFromTemplate
      .mockResolvedValueOnce({
        sequence: { id: 'seq-9' },
        tasks: [fakeTask('a'), fakeTask('b')],
      })
      .mockResolvedValueOnce([fakeTask('c')])

    const run = await executeSchedule(schedule.id, 'manual')

    expect(mocks.generateFromTemplate).toHaveBeenCalledWith('tpl-seq')
    expect(mocks.generateFromTemplate).toHaveBeenCalledWith('tpl-shot')
    expect(run?.status).toBe('ok')
    expect(run?.taskCount).toBe(3)
    expect(run?.summary).toContain('模板产物 3 项')
  })

  it('still executes plain task rows through generateRows (regression)', async () => {
    const schedule = createScheduleTask({
      name: '单视频调度',
      trigger: 'manual',
      batch: { rows: [{ prompt: '任务一' }, { prompt: '任务二' }] },
    })
    mocks.generateRows.mockResolvedValue({ succeeded: [fakeTask('x'), fakeTask('y')], failed: [] })

    const run = await executeSchedule(schedule.id, 'manual')

    expect(mocks.generateRows).toHaveBeenCalledTimes(1)
    expect(mocks.generateSequence).not.toHaveBeenCalled()
    expect(run?.status).toBe('ok')
    expect(run?.taskCount).toBe(2)
    expect(run?.summary).toContain('提交 2 个任务')
  })
})
