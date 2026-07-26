import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateContextTokens, truncateContext } from './tokenizer'
import type { AgentContextMessage } from './types'

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should return 0 for whitespace only', () => {
    expect(estimateTokens('   ')).toBe(0)
  })

  it('should estimate Chinese characters at ~1.5 tokens/char', () => {
    const text = '你好世界' // 4 Chinese chars
    const tokens = estimateTokens(text)
    expect(tokens).toBe(6) // 4 * 1.5 = 6
  })

  it('should estimate English words at ~0.25 tokens/word', () => {
    const text = 'hello world foo bar' // 4 words
    const tokens = estimateTokens(text)
    // 4 words * 0.25 = 1 + spaces/punctuation
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
  })

  it('should handle mixed Chinese and English', () => {
    const text = '你好 hello 世界 world'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should estimate numbers', () => {
    const text = '123 456 789'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should handle punctuation', () => {
    const text = '!@#$%^&*()'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('estimateContextTokens', () => {
  it('should sum tokens across messages', () => {
    const messages: AgentContextMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]
    const total = estimateContextTokens(messages)
    expect(total).toBeGreaterThan(0)
  })

  it('should return 0 for empty message list', () => {
    expect(estimateContextTokens([])).toBe(0)
  })
})

describe('truncateContext', () => {
  it('should return as-is when under limit', () => {
    const messages: AgentContextMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    const result = truncateContext(messages, 10000)
    expect(result).toHaveLength(3)
  })

  it('should keep system messages when truncating', () => {
    const messages: AgentContextMessage[] = [
      { role: 'system', content: 'System prompt that is important' },
      { role: 'user', content: 'A'.repeat(100) },
      { role: 'assistant', content: 'B'.repeat(100) },
      { role: 'user', content: 'C'.repeat(100) },
      { role: 'assistant', content: 'D'.repeat(100) },
    ]
    // Very small limit to force truncation
    const result = truncateContext(messages, 50)
    expect(result.some((m) => m.role === 'system')).toBe(true)
  })

  it('should keep recent messages when truncating', () => {
    const messages: AgentContextMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'old message 1' },
      { role: 'assistant', content: 'old reply 1' },
      { role: 'user', content: 'old message 2' },
      { role: 'assistant', content: 'old reply 2' },
      { role: 'user', content: 'recent message' },
      { role: 'assistant', content: 'recent reply' },
    ]
    const result = truncateContext(messages, 50)
    // The last message should always be kept
    expect(result[result.length - 1].content).toContain('recent')
  })

  it('should handle single message', () => {
    const messages: AgentContextMessage[] = [{ role: 'user', content: 'Hello' }]
    const result = truncateContext(messages, 100)
    expect(result).toHaveLength(1)
  })
})
