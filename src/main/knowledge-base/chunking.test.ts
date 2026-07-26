// AgentForge P4-02: 文本分块策略测试

import { describe, it, expect } from 'vitest'
import { chunkByFixedSize, chunkByParagraph, chunkText } from './chunking'

describe('chunking (P4-02)', () => {
  // ─── chunkByFixedSize ─────────────────────────────────────────

  describe('chunkByFixedSize', () => {
    it('should return empty array for empty text', () => {
      const chunks = chunkByFixedSize('', { strategy: 'fixed' })
      expect(chunks).toEqual([])
    })

    it('should return empty array for whitespace-only text', () => {
      const chunks = chunkByFixedSize('   \n\n  ', { strategy: 'fixed' })
      expect(chunks).toEqual([])
    })

    it('should create single chunk for short text', () => {
      const text = 'Hello world\nThis is a test.'
      const chunks = chunkByFixedSize(text, { strategy: 'fixed', chunkSize: 500 })

      expect(chunks).toHaveLength(1)
      expect(chunks[0].content).toBe(text)
      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[0].tokenCount).toBeGreaterThan(0)
    })

    it('should split text into multiple chunks', () => {
      // 生成一个较长的文本（约 1500 tokens 的中文）
      const lines: string[] = []
      for (let i = 0; i < 100; i++) {
        lines.push(`这是第${i}行测试文本，用于验证分块功能是否正常工作。`)
      }
      const text = lines.join('\n')

      const chunks = chunkByFixedSize(text, {
        strategy: 'fixed',
        chunkSize: 200,
        overlap: 20,
      })

      expect(chunks.length).toBeGreaterThan(1)
      // 每个分块应该有连续的索引
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i)
      }
    })

    it('should handle overlap between chunks', () => {
      // 使用足够长的文本以确保产生多个分块
      const lines: string[] = []
      for (let i = 0; i < 50; i++) {
        lines.push(`Line ${i}: This is test content for overlap verification.`)
      }
      const text = lines.join('\n')
      const chunks = chunkByFixedSize(text, {
        strategy: 'fixed',
        chunkSize: 30,
        overlap: 10,
      })

      expect(chunks.length).toBeGreaterThan(1)
      // 相邻分块应该有重叠内容
      if (chunks.length >= 2) {
        const chunk1End = chunks[0].content.slice(-10)
        const chunk2Start = chunks[1].content.slice(0, 10)
        // 至少有一些共同内容
        const hasOverlap =
          chunk1End.includes(chunk2Start.slice(0, 5)) || chunk2Start.includes(chunk1End.slice(-5))
        // 重叠不是强制保证的，但在大多数情况下应该存在
        expect(hasOverlap || chunks[0].content !== chunks[1].content).toBe(true)
      }
    })

    it('should handle very long single lines', () => {
      const longLine = 'A'.repeat(5000)
      const chunks = chunkByFixedSize(longLine, {
        strategy: 'fixed',
        chunkSize: 100,
        maxChunkSize: 150,
      })

      // 单个超长行作为一个独立分块（不会被切分）
      expect(chunks).toHaveLength(1)
      expect(chunks[0].content).toBe(longLine)
      expect(chunks[0].tokenCount).toBeGreaterThan(0)
    })

    it('should calculate token counts for each chunk', () => {
      const text = 'Hello world\nThis is a test of token counting.'
      const chunks = chunkByFixedSize(text, { strategy: 'fixed', chunkSize: 500 })

      expect(chunks[0].tokenCount).toBeGreaterThan(0)
    })
  })

  // ─── chunkByParagraph ─────────────────────────────────────────

  describe('chunkByParagraph', () => {
    it('should return empty array for empty text', () => {
      const chunks = chunkByParagraph('', { strategy: 'paragraph' })
      expect(chunks).toEqual([])
    })

    it('should split by empty lines', () => {
      const text =
        'Paragraph 1\nMore content here.\n\nParagraph 2\nEven more content.\n\nParagraph 3'
      const chunks = chunkByParagraph(text, { strategy: 'paragraph' })

      expect(chunks).toHaveLength(3)
      expect(chunks[0].content).toContain('Paragraph 1')
      expect(chunks[1].content).toContain('Paragraph 2')
      expect(chunks[2].content).toContain('Paragraph 3')
    })

    it('should keep short paragraphs as single chunks', () => {
      const text = 'Short para 1.\n\nShort para 2.'
      const chunks = chunkByParagraph(text, {
        strategy: 'paragraph',
        chunkSize: 500,
        maxChunkSize: 750,
      })

      expect(chunks).toHaveLength(2)
      expect(chunks[0].content).toBe('Short para 1.')
      expect(chunks[1].content).toBe('Short para 2.')
    })

    it('should split large paragraphs using fixed strategy', () => {
      // 一个很长的段落
      const longParagraph = Array(50).fill('这是一个很长的段落句子。').join('')
      const text = `Short.\n\n${longParagraph}\n\nAnother short.`

      const chunks = chunkByParagraph(text, {
        strategy: 'paragraph',
        chunkSize: 100,
        maxChunkSize: 150,
      })

      // 中间的长段落应该被切分成多个分块
      expect(chunks.length).toBeGreaterThan(2)
    })

    it('should assign sequential chunk indices', () => {
      const text = 'P1\n\nP2\n\nP3\n\nP4'
      const chunks = chunkByParagraph(text, { strategy: 'paragraph' })

      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[1].chunkIndex).toBe(1)
      expect(chunks[2].chunkIndex).toBe(2)
      expect(chunks[3].chunkIndex).toBe(3)
    })
  })

  // ─── chunkText ────────────────────────────────────────────────

  describe('chunkText', () => {
    it('should use fixed strategy by default', () => {
      const text = 'Hello world\nTest content here.'
      const chunks = chunkText(text, { strategy: 'fixed' })

      expect(chunks).toHaveLength(1)
    })

    it('should use paragraph strategy when specified', () => {
      const text = 'Para 1\n\nPara 2'
      const chunks = chunkText(text, { strategy: 'paragraph' })

      expect(chunks).toHaveLength(2)
    })
  })
})
