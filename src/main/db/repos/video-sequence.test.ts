// 多镜头序列仓储单元测试
// 验证 video_sequences 的 CRUD 与基于子任务状态的聚合逻辑。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase } from '../index'
import { createVideoTask, createQueuedVideoTask, updateVideoTask, listVideoTasksBySequence } from './video-task'
import {
  createVideoSequence,
  getVideoSequenceById,
  listVideoSequences,
  updateVideoSequence,
  reconcileVideoSequence,
} from './video-sequence'

describe('video-sequence repository', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-seq-test-'))
    dbPath = join(tempDir, 'test.db')
    closeDatabase()
    initDatabase(dbPath)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create and retrieve a sequence', () => {
    const seq = createVideoSequence({ title: 'My story', totalCount: 3 })
    expect(seq.id).toBeTruthy()
    expect(seq.title).toBe('My story')
    expect(seq.totalCount).toBe(3)
    expect(seq.status).toBe('submitted')
    expect(seq.succeededCount).toBe(0)

    const fetched = getVideoSequenceById(seq.id)
    expect(fetched).toEqual(seq)
  })

  it('should list sequences newest first', () => {
    const a = createVideoSequence({ title: 'A', totalCount: 2 })
    const b = createVideoSequence({ title: 'B', totalCount: 2 })
    const all = listVideoSequences()
    expect(all[0].id).toBe(b.id)
    expect(all.map((s) => s.id)).toContain(a.id)
  })

  it('should update a sequence', () => {
    const seq = createVideoSequence({ title: 'A', totalCount: 2 })
    const updated = updateVideoSequence(seq.id, { status: 'succeeded', succeededCount: 2 })
    expect(updated?.status).toBe('succeeded')
    expect(updated?.succeededCount).toBe(2)
  })

  it('should persist a sequence with the continuity flag (M8)', () => {
    const seq = createVideoSequence({ title: 'Cinematic', totalCount: 2, continuity: true })
    expect(seq.continuity).toBe(true)
    expect(getVideoSequenceById(seq.id)?.continuity).toBe(true)

    const plain = createVideoSequence({ title: 'Batch', totalCount: 2 })
    expect(plain.continuity).toBe(false)
  })

  it('should create a queued placeholder task with the chained flag (M8)', () => {
    const seq = createVideoSequence({ title: 'Cinematic', totalCount: 2, continuity: true })
    const first = createQueuedVideoTask({
      provider: 'seedance',
      prompt: 'anchor',
      model: 'm',
      duration: 5,
      resolution: '720P',
      aspect: '16:9',
      sequenceId: seq.id,
      shotIndex: 0,
      isChained: false,
    })
    const second = createQueuedVideoTask({
      provider: 'seedance',
      prompt: 'chained',
      model: 'm',
      duration: 5,
      resolution: '720P',
      aspect: '16:9',
      sequenceId: seq.id,
      shotIndex: 1,
      isChained: true,
    })
    expect(first.status).toBe('queued')
    expect(first.isChained).toBe(false)
    expect(second.status).toBe('queued')
    expect(second.isChained).toBe(true)
    expect(second.providerTaskId).toBeNull()
  })

  it('should reconcile succeeded when all shots succeed', () => {
    const seq = createVideoSequence({ title: 'A', totalCount: 2 })
    const t1 = createVideoTask({ prompt: 'a', model: 'm', sequenceId: seq.id, shotIndex: 0 })
    const t2 = createVideoTask({ prompt: 'b', model: 'm', sequenceId: seq.id, shotIndex: 1 })
    updateVideoTask(t1.id, { status: 'succeeded', progress: 100 })
    updateVideoTask(t2.id, { status: 'succeeded', progress: 100 })

    const reconciled = reconcileVideoSequence(seq.id)
    expect(reconciled?.status).toBe('succeeded')
    expect(reconciled?.succeededCount).toBe(2)
    expect(reconciled?.failedCount).toBe(0)
  })

  it('should reconcile failed when any shot fails', () => {
    const seq = createVideoSequence({ title: 'B', totalCount: 1 })
    const t = createVideoTask({ prompt: 'x', model: 'm', sequenceId: seq.id, shotIndex: 0 })
    updateVideoTask(t.id, { status: 'failed', progress: 100 })

    const reconciled = reconcileVideoSequence(seq.id)
    expect(reconciled?.status).toBe('failed')
    expect(reconciled?.failedCount).toBe(1)
  })

  it('should reconcile running while shots are in flight', () => {
    const seq = createVideoSequence({ title: 'C', totalCount: 2 })
    const t1 = createVideoTask({ prompt: 'a', model: 'm', sequenceId: seq.id, shotIndex: 0 })
    createVideoTask({ prompt: 'b', model: 'm', sequenceId: seq.id, shotIndex: 1 })
    updateVideoTask(t1.id, { status: 'succeeded', progress: 100 })

    const reconciled = reconcileVideoSequence(seq.id)
    expect(reconciled?.status).toBe('running')
    expect(reconciled?.succeededCount).toBe(1)
    expect(reconciled?.failedCount).toBe(0)
  })

  it('should list child tasks of a sequence by shot index', () => {
    const seq = createVideoSequence({ title: 'A', totalCount: 2 })
    createVideoTask({ prompt: 'first', model: 'm', sequenceId: seq.id, shotIndex: 0 })
    createVideoTask({ prompt: 'second', model: 'm', sequenceId: seq.id, shotIndex: 1 })
    // 无关任务不应被列出
    createVideoTask({ prompt: 'standalone', model: 'm' })

    const children = listVideoTasksBySequence(seq.id)
    expect(children).toHaveLength(2)
    expect(children[0].prompt).toBe('first')
    expect(children[1].prompt).toBe('second')
    expect(children[0].sequenceId).toBe(seq.id)
    expect(children[0].shotIndex).toBe(0)
  })
})