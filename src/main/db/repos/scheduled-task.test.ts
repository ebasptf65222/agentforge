import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'

// ─── 静态读取 schema ─────────────────────────────────────────────
const __dirname_test = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(__dirname_test, '../schema.sql'), 'utf-8')

// ─── 测试用 DB 实例 ──────────────────────────────────────────────
let tempDir: string
let testDb: DatabaseType

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/agentforge-test' },
}))

vi.mock('../index', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}))

const {
  createScheduledTask,
  getScheduledTaskById,
  listScheduledTasks,
  listEnabledScheduledTasks,
  updateScheduledTask,
  deleteScheduledTask,
  updateNextRunAt,
  markTaskRunning,
  markTaskFinished,
  resetErrorCount,
  createTaskRun,
  finishTaskRun,
  getTaskRunById,
  getTaskRuns,
  getRecentTaskRuns,
} = await import('./scheduled-task')

describe('scheduled-task repository', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-test-'))
    testDb = new Database(join(tempDir, 'test.db'))
    testDb.pragma('journal_mode = WAL')
    testDb.pragma('foreign_keys = ON')
    testDb.exec(schemaSql)

    // 创建 scheduled_tasks 和 scheduled_task_runs 表
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 1,
        schedule_type   TEXT NOT NULL,
        cron_expr       TEXT,
        at_ms           INTEGER,
        every_ms        INTEGER,
        anchor_ms       INTEGER,
        timezone        TEXT,
        agent_config    TEXT NOT NULL,
        session_target  TEXT NOT NULL DEFAULT 'isolated',
        next_run_at_ms  INTEGER,
        running_at_ms   INTEGER,
        last_run_at_ms  INTEGER,
        last_status     TEXT,
        last_duration_ms INTEGER,
        run_count       INTEGER NOT NULL DEFAULT 0,
        error_count     INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id              TEXT PRIMARY KEY,
        task_id         TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        started_at_ms   INTEGER NOT NULL,
        finished_at_ms  INTEGER,
        status          TEXT NOT NULL DEFAULT 'running',
        conversation_id TEXT,
        summary         TEXT,
        error           TEXT,
        duration_ms     INTEGER
      );
    `)
  })

  afterEach(() => {
    testDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('createScheduledTask', () => {
    it('should create a cron task', () => {
      const task = createScheduledTask({
        name: 'Daily Report',
        scheduleType: 'cron',
        cronExpr: '0 9 * * *',
        agentConfig: { prompt: 'Generate daily report' },
      })

      expect(task.id).toBeDefined()
      expect(task.name).toBe('Daily Report')
      expect(task.enabled).toBe(true)
      expect(task.scheduleType).toBe('cron')
      expect(task.cronExpr).toBe('0 9 * * *')
      expect(task.agentConfig.prompt).toBe('Generate daily report')
      expect(task.runCount).toBe(0)
      expect(task.errorCount).toBe(0)
    })

    it('should create a one-time task', () => {
      const futureMs = Date.now() + 3600_000
      const task = createScheduledTask({
        name: 'One-time task',
        scheduleType: 'at',
        atMs: futureMs,
        agentConfig: { prompt: 'Run once' },
      })

      expect(task.scheduleType).toBe('at')
      expect(task.atMs).toBe(futureMs)
    })

    it('should create a dev task with planTasks', () => {
      const task = createScheduledTask({
        name: 'Dev task',
        scheduleType: 'cron',
        cronExpr: '0 22 * * *',
        agentConfig: {
          prompt: 'Implement features',
          isDevTask: true,
          planTasks: [
            { id: '1', title: 'Task 1', description: 'Do thing 1', status: 'pending' },
            { id: '2', title: 'Task 2', description: 'Do thing 2', status: 'pending' },
          ],
        },
      })

      expect(task.agentConfig.isDevTask).toBe(true)
      expect(task.agentConfig.planTasks).toHaveLength(2)
    })
  })

  describe('getScheduledTaskById', () => {
    it('should return task by id', () => {
      const created = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      const found = getScheduledTaskById(created.id)
      expect(found.name).toBe('Test')
    })

    it('should throw if not found', () => {
      expect(() => getScheduledTaskById('nonexistent')).toThrow()
    })
  })

  describe('listScheduledTasks', () => {
    it('should list all tasks', () => {
      createScheduledTask({
        name: 'Task 1',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test1' },
      })
      createScheduledTask({
        name: 'Task 2',
        scheduleType: 'cron',
        cronExpr: '*/10 * * * *',
        agentConfig: { prompt: 'test2' },
      })

      const tasks = listScheduledTasks()
      expect(tasks).toHaveLength(2)
    })
  })

  describe('listEnabledScheduledTasks', () => {
    it('should only return enabled tasks', () => {
      const t1 = createScheduledTask({
        name: 'Enabled',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
        enabled: true,
      })
      createScheduledTask({
        name: 'Disabled',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
        enabled: false,
      })

      const enabled = listEnabledScheduledTasks()
      expect(enabled).toHaveLength(1)
      expect(enabled[0].id).toBe(t1.id)
    })
  })

  describe('updateScheduledTask', () => {
    it('should update name and enabled', () => {
      const task = createScheduledTask({
        name: 'Original',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      const updated = updateScheduledTask(task.id, {
        name: 'Renamed',
        enabled: false,
      })

      expect(updated.name).toBe('Renamed')
      expect(updated.enabled).toBe(false)
    })
  })

  describe('deleteScheduledTask', () => {
    it('should delete task', () => {
      const task = createScheduledTask({
        name: 'To delete',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      deleteScheduledTask(task.id)
      expect(() => getScheduledTaskById(task.id)).toThrow()
    })
  })

  describe('task execution state', () => {
    it('should mark task as running', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      markTaskRunning(task.id)
      const updated = getScheduledTaskById(task.id)
      expect(updated.runningAtMs).not.toBeNull()
      expect(updated.nextRunAtMs).toBeNull()
    })

    it('should mark task as finished with status', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      markTaskRunning(task.id)
      markTaskFinished(task.id, 'ok', 5000, 'Done')

      const updated = getScheduledTaskById(task.id)
      expect(updated.runningAtMs).toBeNull()
      expect(updated.lastStatus).toBe('ok')
      expect(updated.lastDurationMs).toBe(5000)
      expect(updated.runCount).toBe(1)
    })

    it('should increment error count on error status', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      markTaskFinished(task.id, 'error', 1000)
      const updated = getScheduledTaskById(task.id)
      expect(updated.errorCount).toBe(1)
    })

    it('should reset error count', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      markTaskFinished(task.id, 'error', 1000)
      resetErrorCount(task.id)
      const updated = getScheduledTaskById(task.id)
      expect(updated.errorCount).toBe(0)
    })
  })

  describe('task runs', () => {
    it('should create and finish a run record', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      const run = createTaskRun(task.id)
      expect(run.status).toBe('running')
      expect(run.finishedAtMs).toBeNull()

      finishTaskRun(run.id, 'ok', 'conv-123', 'Success', null)
      const finished = getTaskRunById(run.id) // need to import
      expect(finished.status).toBe('ok')
      expect(finished.conversationId).toBe('conv-123')
      expect(finished.summary).toBe('Success')
    })

    it('should get task history', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      const run1 = createTaskRun(task.id)
      finishTaskRun(run1.id, 'ok', 'c1', 'ok1', null)

      const run2 = createTaskRun(task.id)
      finishTaskRun(run2.id, 'error', null, null, 'failed')

      const history = getTaskRuns(task.id)
      expect(history).toHaveLength(2)
      // Both runs should be present with correct statuses
      const statuses = history.map((h) => h.status).sort()
      expect(statuses).toEqual(['error', 'ok'])
    })

    it('should get recent runs across all tasks', () => {
      const task1 = createScheduledTask({
        name: 'Task 1',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })
      const task2 = createScheduledTask({
        name: 'Task 2',
        scheduleType: 'cron',
        cronExpr: '*/10 * * * *',
        agentConfig: { prompt: 'test' },
      })

      const run1 = createTaskRun(task1.id)
      finishTaskRun(run1.id, 'ok', 'c1', 'ok', null)

      const run2 = createTaskRun(task2.id)
      finishTaskRun(run2.id, 'ok', 'c2', 'ok', null)

      const recent = getRecentTaskRuns(10)
      expect(recent.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('updateNextRunAt', () => {
    it('should update next run time', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      const nextRun = Date.now() + 3600_000
      updateNextRunAt(task.id, nextRun)
      const updated = getScheduledTaskById(task.id)
      expect(updated.nextRunAtMs).toBe(nextRun)
    })

    it('should set next run to null for one-time tasks', () => {
      const task = createScheduledTask({
        name: 'Test',
        scheduleType: 'cron',
        cronExpr: '*/5 * * * *',
        agentConfig: { prompt: 'test' },
      })

      updateNextRunAt(task.id, null)
      const updated = getScheduledTaskById(task.id)
      expect(updated.nextRunAtMs).toBeNull()
    })
  })
})
