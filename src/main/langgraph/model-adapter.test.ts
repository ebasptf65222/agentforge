import { describe, it, expect, vi } from 'vitest'
import { ModelWrapper } from './model-adapter'
import type { ModelAdapter, AdapterMessage } from '../models/adapter'
import type { AgentEventCallbacks } from '../agent/types'
import type { StreamChunk } from '@shared/types'

// ─── Fake Adapter 工厂 ──────────────────────────────────────────

function createFakeAdapter(chunks: StreamChunk[]): {
  adapter: ModelAdapter
  streamChatFn: ReturnType<typeof vi.fn>
} {
  const streamChatFn = vi.fn(async function* (): AsyncGenerator<StreamChunk, void, unknown> {
    for (const chunk of chunks) {
      yield chunk
    }
  })
  const adapter = { streamChat: streamChatFn } as unknown as ModelAdapter
  return { adapter, streamChatFn }
}

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

// ─── 测试数据 ───────────────────────────────────────────────────

const textChunks: StreamChunk[] = [
  { type: 'text', content: 'Hello' },
  { type: 'text', content: ' World' },
  { type: 'text', content: '!' },
]

const mixedChunks: StreamChunk[] = [
  { type: 'thinking', content: 'Let me think...' },
  { type: 'text', content: 'Hello' },
  { type: 'text', content: '' },
  { type: 'text', content: ' World' },
]

const defaultMessages: AdapterMessage[] = [{ role: 'user', content: '你好' }]

// ─── Tests ──────────────────────────────────────────────────────

describe('ModelWrapper', () => {
  describe('invoke 方法', () => {
    it('应正确调用 adapter.streamChat 并返回累积文本', async () => {
      const { adapter, streamChatFn } = createFakeAdapter(textChunks)
      const wrapper = new ModelWrapper(adapter)

      const result = await wrapper.invoke(defaultMessages)

      expect(streamChatFn).toHaveBeenCalledTimes(1)
      expect(streamChatFn).toHaveBeenCalledWith(defaultMessages, undefined)
      expect(result).toBe('Hello World!')
    })

    it('空 chunk 列表应返回空字符串', async () => {
      const { adapter } = createFakeAdapter([])
      const wrapper = new ModelWrapper(adapter)

      const result = await wrapper.invoke(defaultMessages)

      expect(result).toBe('')
    })
  })

  describe('流式 chunk 推送', () => {
    it('应将流式 chunk 通过 callbacks.onStreamChunk 推送', async () => {
      const { adapter } = createFakeAdapter(textChunks)
      const callbacks = createMockCallbacks()
      const wrapper = new ModelWrapper(adapter, callbacks)

      await wrapper.invoke(defaultMessages)

      expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(3)
      expect(callbacks.onStreamChunk).toHaveBeenNthCalledWith(1, { type: 'text', content: 'Hello' })
      expect(callbacks.onStreamChunk).toHaveBeenNthCalledWith(2, {
        type: 'text',
        content: ' World',
      })
      expect(callbacks.onStreamChunk).toHaveBeenNthCalledWith(3, { type: 'text', content: '!' })
    })

    it('无 callbacks 时不应报错', async () => {
      const { adapter } = createFakeAdapter(textChunks)
      const wrapper = new ModelWrapper(adapter)

      const result = await wrapper.invoke(defaultMessages)

      expect(result).toBe('Hello World!')
    })

    it('非 text 类型的 chunk 不应推送或累积', async () => {
      const { adapter } = createFakeAdapter(mixedChunks)
      const callbacks = createMockCallbacks()
      const wrapper = new ModelWrapper(adapter, callbacks)

      const result = await wrapper.invoke(defaultMessages)

      // thinking chunk 不推送，但空 content 的 text chunk 会推送
      // mixedChunks: thinking(不推送) + text(推送) + text空(推送) + text(推送) = 3次
      expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(3)
      // 累积结果不包含 thinking 内容和空字符串
      expect(result).toBe('Hello World')
    })
  })

  describe('abortSignal 传递', () => {
    it('应将 abortSignal 传递给 adapter.streamChat', async () => {
      const { adapter, streamChatFn } = createFakeAdapter(textChunks)
      const wrapper = new ModelWrapper(adapter)
      const controller = new AbortController()

      await wrapper.invoke(defaultMessages, controller.signal)

      expect(streamChatFn).toHaveBeenCalledWith(defaultMessages, controller.signal)
    })

    it('不传 abortSignal 时应传递 undefined', async () => {
      const { adapter, streamChatFn } = createFakeAdapter(textChunks)
      const wrapper = new ModelWrapper(adapter)

      await wrapper.invoke(defaultMessages)

      expect(streamChatFn).toHaveBeenCalledWith(defaultMessages, undefined)
    })
  })
})
