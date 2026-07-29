// AgentForge: context-manager 单元测试
// 验证上下文窗口管理策略的正确性

import { describe, it, expect } from 'vitest'
import {
  manageContext,
  getContextWindowSize,
  chatMessagesToContext,
} from './context-manager'
import type { AgentContextMessage } from './types'
import type { ChatMessage } from '@shared/types'

describe('context-manager', () => {
  // ─── manageContext ──────────────────────────────────────────

  describe('manageContext', () => {
    it('空消息列表应返回空结果且不截断', () => {
      const result = manageContext([], { maxContextTokens: 8000 })
      expect(result.messages).toEqual([])
      expect(result.truncated).toBe(false)
      expect(result.originalCount).toBe(0)
      expect(result.retainedCount).toBe(0)
    })

    it('消息未超限时应全部保留且不截断', () => {
      const messages: AgentContextMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]
      const result = manageContext(messages, { maxContextTokens: 100_000 })
      expect(result.truncated).toBe(false)
      expect(result.retainedCount).toBe(3)
      expect(result.originalCount).toBe(3)
    })

    it('超时应截断旧消息并保留系统消息和最近消息', () => {
      // 构建超长消息列表
      const messages: AgentContextMessage[] = [
        { role: 'system', content: 'System prompt' },
      ]
      // 添加大量历史消息（每条约 100 token）
      for (let i = 0; i < 50; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}: ${'x'.repeat(300)}`,
        })
      }

      const result = manageContext(messages, {
        maxContextTokens: 2000,
        minRecentMessages: 4,
      })

      expect(result.truncated).toBe(true)
      expect(result.originalCount).toBe(51)
      // 系统消息 + 截断提示 + 保留的最近消息
      expect(result.retainedCount).toBeLessThan(51)
      expect(result.retainedCount).toBeGreaterThan(0)
      // 第一条应是系统消息
      expect(result.messages[0].role).toBe('system')
      // 第二条应是截断提示
      expect(result.messages[1].content).toContain('截断')
    })

    it('应保留系统消息在开头', () => {
      const messages: AgentContextMessage[] = [
        { role: 'system', content: 'Important system prompt' },
        { role: 'user', content: 'Old message' },
        { role: 'assistant', content: 'Old reply' },
        { role: 'user', content: 'Recent message' },
      ]

      const result = manageContext(messages, { maxContextTokens: 100_000 })
      expect(result.messages[0].role).toBe('system')
      expect(result.messages[0].content).toBe('Important system prompt')
    })

    it('截断时应插入截断提示消息', () => {
      const messages: AgentContextMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'x'.repeat(500) },
        { role: 'assistant', content: 'y'.repeat(500) },
        { role: 'user', content: 'Recent' },
      ]

      const result = manageContext(messages, {
        maxContextTokens: 200,
        minRecentMessages: 1,
      })

      if (result.truncated) {
        const noticeMsg = result.messages.find(
          (m) => m.role === 'system' && m.content.includes('截断'),
        )
        expect(noticeMsg).toBeDefined()
      }
    })

    it('应至少保留 minRecentMessages 条对话消息', () => {
      const messages: AgentContextMessage[] = [
        { role: 'system', content: 'System' },
      ]
      for (let i = 0; i < 30; i++) {
        messages.push({
          role: 'user',
          content: `msg${i}:${'a'.repeat(200)}`,
        })
      }

      const minRecent = 8
      const result = manageContext(messages, {
        maxContextTokens: 500,
        minRecentMessages: minRecent,
      })

      // 对话消息数（排除 system 消息和截断提示）
      const conversationCount = result.messages.filter(
        (m) => m.role !== 'system' || !m.content.includes('截断'),
      ).length - 1 // 减去 system prompt

      expect(conversationCount).toBeGreaterThanOrEqual(minRecent)
    })

    it('预算为负时应返回系统消息和最近消息', () => {
      const hugeSystem = 's'.repeat(10000)
      const messages: AgentContextMessage[] = [
        { role: 'system', content: hugeSystem },
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
      ]

      const result = manageContext(messages, {
        maxContextTokens: 1000,
        minRecentMessages: 2,
      })

      // 应返回系统消息 + 至少 2 条最近消息
      expect(result.messages.length).toBeGreaterThanOrEqual(3)
      expect(result.messages[0].content).toBe(hugeSystem)
    })
  })

  // ─── getContextWindowSize ───────────────────────────────────

  describe('getContextWindowSize', () => {
    it('GPT-4o 应返回 128000', () => {
      expect(getContextWindowSize('gpt-4o')).toBe(128_000)
      expect(getContextWindowSize('gpt-4o-mini')).toBe(128_000)
    })

    it('GPT-4 Turbo 应返回 128000', () => {
      expect(getContextWindowSize('gpt-4-turbo')).toBe(128_000)
    })

    it('GPT-4 应返回 8192', () => {
      expect(getContextWindowSize('gpt-4')).toBe(8_192)
    })

    it('GPT-3.5 应返回 16385', () => {
      expect(getContextWindowSize('gpt-3.5-turbo')).toBe(16_385)
    })

    it('Claude 3.5 Sonnet 应返回 200000', () => {
      expect(getContextWindowSize('claude-3.5-sonnet')).toBe(200_000)
      expect(getContextWindowSize('claude-3-5-sonnet')).toBe(200_000)
    })

    it('Claude 3 Opus 应返回 200000', () => {
      expect(getContextWindowSize('claude-3-opus')).toBe(200_000)
    })

    it('Claude 通用应返回 200000', () => {
      expect(getContextWindowSize('claude-something')).toBe(200_000)
    })

    it('DeepSeek 应返回 64000', () => {
      expect(getContextWindowSize('deepseek-chat')).toBe(64_000)
      expect(getContextWindowSize('deepseek-r1')).toBe(64_000)
    })

    it('Qwen 应返回正确的窗口大小', () => {
      expect(getContextWindowSize('qwen-max')).toBe(32_000)
      expect(getContextWindowSize('qwen-plus')).toBe(128_000)
    })

    it('未知模型应返回默认值 128000', () => {
      expect(getContextWindowSize('unknown-model')).toBe(128_000)
    })

    it('空字符串应返回默认值', () => {
      expect(getContextWindowSize('')).toBe(128_000)
    })

    it('应不区分大小写', () => {
      expect(getContextWindowSize('GPT-4O')).toBe(128_000)
      expect(getContextWindowSize('CLAUDE-3.5-SONNET')).toBe(200_000)
    })
  })

  // ─── chatMessagesToContext ──────────────────────────────────

  describe('chatMessagesToContext', () => {
    it('应正确转换 ChatMessage 到 AgentContextMessage', () => {
      const chatMessages: ChatMessage[] = [
        {
          id: '1',
          conversationId: 'conv1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          conversationId: 'conv1',
          role: 'assistant',
          content: 'Hi!',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]

      const result = chatMessagesToContext(chatMessages)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi!' })
    })

    it('空数组应返回空数组', () => {
      expect(chatMessagesToContext([])).toEqual([])
    })
  })
})
