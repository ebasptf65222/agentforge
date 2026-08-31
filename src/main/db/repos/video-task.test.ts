// 视频任务仓储单元测试（M14：收藏 / 标签 / 软删 / 回收站）
// 验证 video_tasks 新增列迁移、favorite/tags 更新、软删过滤与回收站查询。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase, getDatabase } from '../index'
import {
  createVideoTask,
  getVideoTaskById,
  listVideoTasks,
  listQueuedVideoTasks,
  listInFlightVideoTasks,
  listTrashedVideoTasks,
  updateVideoTask,
  deleteVideoTask,
  softDeleteVideoTasksBySequence,
  restoreVideoTasksBySequence,
} from './video-task'

describe('video-task repository (M14 asset management)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-vtask-test-'))
    closeDatabase()
    initDatabase(join(tempDir, 'test.db'))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should migrate favorite / tags / deleted_at columns (M14)', () => {
    const rows = getDatabase().prepare('PRAGMA table_info(video_tasks)').all() as Array<{
      name: string
    }>
    const columns = rows.map((r) => r.name)
    expect(columns).toContain('favorite')
    expect(columns).toContain('tags')
    expect(columns).toContain('deleted_at')
    // M16
    expect(columns).toContain('image_refs')
  })

  it('should persist image_refs with style role and read back (M16)', () => {
    const t = createVideoTask({
      prompt: 'p',
      model: 'm',
      imageRefs: [
        { path: '/tmp/a.png', role: 'first_frame' },
        { path: '/tmp/b.png', role: 'style' },
      ],
    })
    expect(t.imageRefs).toEqual([
      { path: '/tmp/a.png', role: 'first_frame' },
      { path: '/tmp/b.png', role: 'style' },
    ])
    // 持久化校验
    const fetched = getVideoTaskById(t.id)
    expect(fetched?.imageRefs).toEqual([
      { path: '/tmp/a.png', role: 'first_frame' },
      { path: '/tmp/b.png', role: 'style' },
    ])
  })

  it('should default imageRefs to [] and tolerate empty / use updateVideoTask (M16)', () => {
    const t = createVideoTask({ prompt: 'p', model: 'm' })
    expect(t.imageRefs).toEqual([])

    const updated = updateVideoTask(t.id, { imageRefs: [{ path: '/tmp/s.png', role: 'style' }] })
    expect(updated?.imageRefs).toEqual([{ path: '/tmp/s.png', role: 'style' }])

    // 覆盖写回空数组
    const cleared = updateVideoTask(t.id, { imageRefs: [] })
    expect(cleared?.imageRefs).toEqual([])
  })

  it('should tolerate corrupted image_refs json (M16)', () => {
    const t = createVideoTask({ prompt: 'p', model: 'm' })
    getDatabase().prepare('UPDATE video_tasks SET image_refs = ? WHERE id = ?').run('{bad json', t.id)
    expect(getVideoTaskById(t.id)?.imageRefs).toEqual([])
  })

  it('should default favorite=false tags=[] deletedAt=null and update them (M14)', () => {
    const t = createVideoTask({ prompt: 'p', model: 'm' })
    expect(t.favorite).toBe(false)
    expect(t.tags).toEqual([])
    expect(t.deletedAt).toBeNull()

    const updated = updateVideoTask(t.id, { favorite: true, tags: ['风景', 'a'] })
    expect(updated?.favorite).toBe(true)
    expect(updated?.tags).toEqual(['风景', 'a'])

    // 持久化校验：重新读取
    const fetched = getVideoTaskById(t.id)
    expect(fetched?.favorite).toBe(true)
    expect(fetched?.tags).toEqual(['风景', 'a'])

    // 取消收藏 + 清空标签
    const cleared = updateVideoTask(t.id, { favorite: false, tags: [] })
    expect(cleared?.favorite).toBe(false)
    expect(cleared?.tags).toEqual([])
  })

  it('should tolerate corrupted tags json (M14)', () => {
    const t = createVideoTask({ prompt: 'p', model: 'm' })
    getDatabase().prepare('UPDATE video_tasks SET tags = ? WHERE id = ?').run('{bad json', t.id)
    expect(getVideoTaskById(t.id)?.tags).toEqual([])
  })

  it('should hide soft-deleted tasks from list/queued/inflight queries (M14)', () => {
    const live = createVideoTask({ prompt: 'live', model: 'm' })
    const queuedTask = createVideoTask({ prompt: 'queued', model: 'm' })
    const inflight = createVideoTask({ prompt: 'inflight', model: 'm' })
    updateVideoTask(inflight.id, { status: 'submitted', providerTaskId: 'prov-1' })

    expect(listQueuedVideoTasks().map((t) => t.id)).toEqual(
      expect.arrayContaining([live.id, queuedTask.id]),
    )

    updateVideoTask(live.id, { deletedAt: Date.now() })
    expect(listVideoTasks().map((t) => t.id)).not.toContain(live.id)
    expect(listQueuedVideoTasks().map((t) => t.id)).not.toContain(live.id)
    expect(listInFlightVideoTasks().map((t) => t.id)).toContain(inflight.id)

    // 软删在途任务后，重启恢复查询也不再返回
    updateVideoTask(inflight.id, { deletedAt: Date.now() })
    expect(listInFlightVideoTasks().map((t) => t.id)).not.toContain(inflight.id)

    // 回收站可见
    expect(listTrashedVideoTasks().map((t) => t.id)).toEqual(
      expect.arrayContaining([live.id, inflight.id]),
    )

    // 恢复后回到主列表与排队查询
    updateVideoTask(live.id, { deletedAt: null })
    expect(listVideoTasks().map((t) => t.id)).toContain(live.id)
    expect(listQueuedVideoTasks().map((t) => t.id)).toContain(live.id)
    expect(listTrashedVideoTasks()).toHaveLength(1)
  })

  it('should soft-delete and restore tasks of a sequence in bulk (M14)', () => {
    const a = createVideoTask({ prompt: 'a', model: 'm', sequenceId: 'seq-1', shotIndex: 0 })
    const b = createVideoTask({ prompt: 'b', model: 'm', sequenceId: 'seq-1', shotIndex: 1 })
    const other = createVideoTask({ prompt: 'other', model: 'm' })

    softDeleteVideoTasksBySequence('seq-1', Date.now())
    expect(getVideoTaskById(a.id)?.deletedAt).not.toBeNull()
    expect(getVideoTaskById(b.id)?.deletedAt).not.toBeNull()
    expect(getVideoTaskById(other.id)?.deletedAt).toBeNull()
    expect(listVideoTasks().map((t) => t.id)).toEqual([other.id])

    restoreVideoTasksBySequence('seq-1')
    expect(getVideoTaskById(a.id)?.deletedAt).toBeNull()
    expect(getVideoTaskById(b.id)?.deletedAt).toBeNull()
    expect(listVideoTasks()).toHaveLength(3)
  })

  it('should hard delete a task record (purge path, M14)', () => {
    const t = createVideoTask({ prompt: 'p', model: 'm' })
    deleteVideoTask(t.id)
    expect(getVideoTaskById(t.id)).toBeNull()
  })
})
