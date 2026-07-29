import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventConverter } from './event-converter'
import type { AgentEventCallbacks } from '../agent/types'
import type { TAOTrajectory } from '@shared/types'

// ─── Fake 工厂 ──────────────────────────────────────────────────

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('EventConverter', () => {
  let callbacks: AgentEventCallbacks
  let converter: EventConverter

  beforeEach(() => {
    callbacks = createMockCallbacks()
    converter = new EventConverter(callbacks)
    vi.clearAllMocks()
  })

  describe('pushText', () => {
    it('应正确调用 onStreamChunk 推送文本', () => {
      converter.pushText('Hello World')

      expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(1)
      expect(callbacks.onStreamChunk).toHaveBeenCalledWith({
        type: 'text',
        content: 'Hello World',
      })
    })

    it('空字符串不应推送', () => {
      converter.pushText('')

      expect(callbacks.onStreamChunk).not.toHaveBeenCalled()
    })

    it('多次调用应推送多次', () => {
      converter.pushText('Hello')
      converter.pushText(' ')
      converter.pushText('World')

      expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(3)
    })
  })

  describe('pushToolStart', () => {
    it('应推送 tool-start 事件', () => {
      converter.pushToolStart('file_read', { path: '/test.txt' })

      expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(1)
      expect(callbacks.onStreamChunk).toHaveBeenCalledWith({
        type: 'tool-start',
        content: 'file_read',
      })
    })

    it('不同工具名应推送正确的工具名', () => {
      converter.pushToolStart('web_search', { query: 'test' })

      const call = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(call.content).toBe('web_search')
      expect(call.type).toBe('tool-start')
    })
  })

  describe('pushToolComplete', () => {
    it('应推送 tool-complete 事件', () => {
      converter.pushToolComplete('file_read', 'file content')

      expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(1)
      expect(callbacks.onStreamChunk).toHaveBeenCalledWith({
        type: 'tool-complete',
        content: 'file content',
      })
    })

    it('应推送工具执行结果作为 content', () => {
      converter.pushToolComplete('web_search', 'search results found')

      const call = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(call.content).toBe('search results found')
      expect(call.type).toBe('tool-complete')
    })
  })

  describe('pushTrajectory', () => {
    it('应递增 step 计数', () => {
      const t1 = converter.pushTrajectory({
        thought: 'step 1',
        action: null,
        observation: 'obs 1',
        status: 'success',
      })
      const t2 = converter.pushTrajectory({
        thought: 'step 2',
        action: null,
        observation: 'obs 2',
        status: 'success',
      })
      const t3 = converter.pushTrajectory({
        thought: 'step 3',
        action: null,
        observation: 'obs 3',
        status: 'success',
      })

      expect(t1.step).toBe(1)
      expect(t2.step).toBe(2)
      expect(t3.step).toBe(3)
    })

    it('应通过 onTrajectory 回调推送轨迹', () => {
      converter.pushTrajectory({
        thought: 'thinking',
        action: {
          toolName: 'file_read',
          arguments: { path: '/test' },
          riskLevel: 'low',
          requiresApproval: false,
        },
        observation: 'file content',
        status: 'success',
      })

      expect(callbacks.onTrajectory).toHaveBeenCalledTimes(1)
      const trajectory = (callbacks.onTrajectory as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(trajectory.thought).toBe('thinking')
      expect(trajectory.action?.toolName).toBe('file_read')
      expect(trajectory.observation).toBe('file content')
      expect(trajectory.status).toBe('success')
      expect(trajectory.step).toBe(1)
    })

    it('应正确传递 action 为 null 的轨迹', () => {
      const trajectory = converter.pushTrajectory({
        thought: 'final answer',
        action: null,
        observation: 'done',
        status: 'success',
      })

      expect(trajectory.action).toBeNull()
    })

    it('应包含 timestamp 字段', () => {
      const before = Date.now()
      const trajectory = converter.pushTrajectory({
        thought: 'test',
        action: null,
        observation: 'obs',
        status: 'success',
      })
      const after = Date.now()

      expect(trajectory.timestamp).toBeGreaterThanOrEqual(before)
      expect(trajectory.timestamp).toBeLessThanOrEqual(after)
    })

    it('应正确传递各种 status', () => {
      const statuses: TAOTrajectory['status'][] = [
        'success',
        'error',
        'pending-approval',
        'approved',
        'rejected',
      ]
      for (const status of statuses) {
        converter.pushTrajectory({
          thought: 'test',
          action: null,
          observation: 'obs',
          status,
        })
      }

      expect(callbacks.onTrajectory).toHaveBeenCalledTimes(5)
      const calls = (callbacks.onTrajectory as ReturnType<typeof vi.fn>).mock.calls
      expect(calls[0][0].status).toBe('success')
      expect(calls[1][0].status).toBe('error')
      expect(calls[2][0].status).toBe('pending-approval')
      expect(calls[3][0].status).toBe('approved')
      expect(calls[4][0].status).toBe('rejected')
    })
  })

  describe('getDuration', () => {
    it('应返回正确耗时', async () => {
      const conv = new EventConverter(callbacks)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const duration = conv.getDuration()

      expect(duration).toBeGreaterThanOrEqual(40)
      expect(duration).toBeLessThan(500)
    })

    it('刚创建时耗时接近 0', () => {
      const conv = new EventConverter(callbacks)

      const duration = conv.getDuration()

      expect(duration).toBeGreaterThanOrEqual(0)
      expect(duration).toBeLessThan(20)
    })
  })

  describe('reset', () => {
    it('应重置 step 计数器', () => {
      converter.pushTrajectory({
        thought: 'step 1',
        action: null,
        observation: 'obs 1',
        status: 'success',
      })
      converter.pushTrajectory({
        thought: 'step 2',
        action: null,
        observation: 'obs 2',
        status: 'success',
      })

      converter.reset()

      const trajectory = converter.pushTrajectory({
        thought: 'new step',
        action: null,
        observation: 'new obs',
        status: 'success',
      })

      expect(trajectory.step).toBe(1)
    })

    it('应重置 startTime', async () => {
      const conv = new EventConverter(callbacks)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const durationBefore = conv.getDuration()

      conv.reset()
      const durationAfter = conv.getDuration()

      expect(durationAfter).toBeLessThan(durationBefore)
      expect(durationAfter).toBeLessThan(20)
    })
  })
})
