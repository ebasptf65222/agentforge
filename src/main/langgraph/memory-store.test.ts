// AgentForge LangGraph 引擎: Memory Store 测试 (P2-04)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryStore, resetMemoryStore } from './memory-store'

// ─── Mock 数据库 ─────────────────────────────────────────────────

vi.mock('../db/index', () => {
  const db = {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
    })),
  }
  return {
    getDatabase: vi.fn(() => db),
  }
})

import { getDatabase } from '../db/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDb: any

describe('Memory Store (P2-04)', () => {
  let store: MemoryStore

  beforeEach(() => {
    vi.clearAllMocks()
    // 先获取 mock db（vi.clearAllMocks 不清除实现，但需要重新引用）
    mockDb = getDatabase()
    // 重置 prepare mock 的返回值（避免上一个测试的 mockReturnValue 泄漏）
    mockDb.prepare.mockImplementation(() => ({
      run: vi.fn(() => ({ changes: 0 })),
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
    }))
    resetMemoryStore()
    store = new MemoryStore()
  })

  afterEach(() => {
    resetMemoryStore()
  })

  describe('initialize', () => {
    it('应创建 langgraph_memory 表', () => {
      store.initialize()
      expect(mockDb.exec).toHaveBeenCalled()
      const sql = (mockDb.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS langgraph_memory')
    })

    it('多次调用应只初始化一次', () => {
      store.initialize()
      store.initialize()
      store.initialize()
      expect(mockDb.exec).toHaveBeenCalledTimes(1)
    })
  })

  describe('set', () => {
    it('应调用 prepare 和 run 存储数据', () => {
      store.set('conv-1', 'key1', 'value1')

      const prepareCall = (mockDb.prepare as ReturnType<typeof vi.fn>).mock.calls[0]
      const sql = prepareCall[0] as string
      expect(sql).toContain('INSERT INTO langgraph_memory')
    })

    it('应支持对象值（JSON 序列化）', () => {
      store.set('conv-1', 'key1', { data: 'test' })
      expect(mockDb.prepare).toHaveBeenCalled()
    })
  })

  describe('get', () => {
    it('不存在时应返回 null', () => {
      const result = store.get('conv-1', 'nonexistent')
      expect(result).toBeNull()
    })

    it('存在时应返回值', () => {
      // Mock get 返回值
      const mockGet = vi.fn(() => ({ value: 'test-value' }))
      vi.mocked(mockDb.prepare).mockReturnValue({
        run: vi.fn(),
        get: mockGet,
        all: vi.fn(() => []),
      } as never)

      const result = store.get('conv-1', 'key1')
      expect(result).toBe('test-value')
    })
  })

  describe('getAll', () => {
    it('无数据时应返回空数组', () => {
      const result = store.getAll('conv-1')
      expect(result).toEqual([])
    })
  })

  describe('delete', () => {
    it('应调用 DELETE 语句', () => {
      store.delete('conv-1', 'key1')

      const prepareCall = (mockDb.prepare as ReturnType<typeof vi.fn>).mock.calls[0]
      const sql = prepareCall[0] as string
      expect(sql).toContain('DELETE FROM langgraph_memory')
    })
  })

  describe('clear', () => {
    it('应清除指定会话的所有记忆', () => {
      store.clear('conv-1')

      const prepareCall = (mockDb.prepare as ReturnType<typeof vi.fn>).mock.calls[0]
      const sql = prepareCall[0] as string
      expect(sql).toContain('DELETE FROM langgraph_memory')
      expect(sql).toContain('conversation_id')
    })
  })

  describe('saveConversationSummary', () => {
    it('应调用 set 保存摘要', () => {
      const setSpy = vi.spyOn(store, 'set')
      store.saveConversationSummary('conv-1', 'Test summary', { steps: 5 })

      expect(setSpy).toHaveBeenCalledWith('conv-1', 'summary', 'Test summary')
      expect(setSpy).toHaveBeenCalledWith('conv-1', 'metadata', { steps: 5 })
    })

    it('无 metadata 时只保存 summary', () => {
      const setSpy = vi.spyOn(store, 'set')
      store.saveConversationSummary('conv-1', 'Test summary')

      expect(setSpy).toHaveBeenCalledTimes(1)
      expect(setSpy).toHaveBeenCalledWith('conv-1', 'summary', 'Test summary')
    })
  })

  describe('loadConversationSummary', () => {
    it('无摘要时应返回 null', () => {
      const result = store.loadConversationSummary('conv-1')
      expect(result).toBeNull()
    })
  })

  describe('buildContextPrompt', () => {
    it('无摘要时应返回空字符串', () => {
      const result = store.buildContextPrompt('conv-1')
      expect(result).toBe('')
    })

    it('有摘要时应返回包含摘要的提示词', () => {
      vi.spyOn(store, 'loadConversationSummary').mockReturnValue('Previous conversation summary.')

      const result = store.buildContextPrompt('conv-1')
      expect(result).toContain('Previous Conversation Summary')
      expect(result).toContain('Previous conversation summary.')
    })
  })

  describe('count', () => {
    it('应返回条目数量', () => {
      // Mock count query
      const mockGet = vi.fn(() => ({ count: 5 }))
      vi.mocked(mockDb.prepare).mockReturnValue({
        run: vi.fn(),
        get: mockGet,
        all: vi.fn(() => []),
      } as never)

      const result = store.count('conv-1')
      expect(result).toBe(5)
    })
  })
})
