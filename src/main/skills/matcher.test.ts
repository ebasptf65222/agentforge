// AgentForge P3-03: Skill 意图匹配引擎单元测试
// 测试 buildMatchPrompt / extractJson / parseMatchResult / matchSkill

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Skill, StreamChunk } from '@shared/types'
import type { AdapterMessage } from '../models/adapter'

// ─── Mock DB ────────────────────────────────────────────────────

const { mockListAutoTriggerSkills } = vi.hoisted(() => ({
  mockListAutoTriggerSkills: vi.fn(),
}))

vi.mock('../db/repos/skill', () => ({
  listAutoTriggerSkills: (...args: unknown[]) => mockListAutoTriggerSkills(...args),
}))

// ─── Import after mocks ─────────────────────────────────────────

const {
  matchSkill,
  buildMatchPrompt,
  extractJson,
  parseMatchResult,
  CONFIDENCE_THRESHOLD,
} = await import('./matcher')

// ─── Mock ModelAdapter ──────────────────────────────────────────

class MockModelAdapter {
  private responses: string[]
  private callIndex = 0
  public shouldThrow = false

  constructor(responses: string[]) {
    this.responses = responses
  }

  async *streamChat(
    _messages: AdapterMessage[],
    _abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    if (this.shouldThrow) {
      throw new Error('LLM call failed')
    }
    const response = this.responses[this.callIndex] ?? ''
    this.callIndex++
    yield { type: 'text', content: response }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'research-report',
    displayName: 'Research Report',
    description: 'Generate a detailed research report on a given topic',
    prompt: 'You are a research assistant.',
    allowedTools: ['web_search', 'web_scrape', 'file_write'],
    trigger: 'auto',
    variables: [],
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('Skill 意图匹配引擎', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── buildMatchPrompt ──────────────────────────────────────────

  describe('buildMatchPrompt', () => {
    it('should build prompt with user message and skill list', () => {
      const skills = [
        makeSkill({ name: 'research-report', description: 'Generate research report' }),
        makeSkill({ name: 'summarize-docs', description: 'Summarize documents' }),
      ]

      const prompt = buildMatchPrompt('帮我写一篇关于AI的研究报告', skills)

      expect(prompt).toContain('帮我写一篇关于AI的研究报告')
      expect(prompt).toContain('research-report: Generate research report')
      expect(prompt).toContain('summarize-docs: Summarize documents')
      expect(prompt).toContain('请判断用户意图匹配哪个 Skill')
      expect(prompt).toContain('返回 JSON')
    })

    it('should handle empty skill list', () => {
      const prompt = buildMatchPrompt('hello', [])

      expect(prompt).toContain('hello')
      expect(prompt).toContain('可选 Skill:')
    })

    it('should include skill name and description for each skill', () => {
      const skills = [
        makeSkill({ name: 'skill-a', description: 'Description A' }),
        makeSkill({ name: 'skill-b', description: 'Description B' }),
      ]

      const prompt = buildMatchPrompt('test', skills)

      expect(prompt).toContain('- skill-a: Description A')
      expect(prompt).toContain('- skill-b: Description B')
    })
  })

  // ─── extractJson ───────────────────────────────────────────────

  describe('extractJson', () => {
    it('should parse direct JSON', () => {
      const result = extractJson('{"matched": true, "skillName": "test"}')

      expect(result).toEqual({ matched: true, skillName: 'test' })
    })

    it('should parse JSON from code block', () => {
      const result = extractJson('```json\n{"matched": false, "confidence": 0.3}\n```')

      expect(result).toEqual({ matched: false, confidence: 0.3 })
    })

    it('should parse JSON from code block without language tag', () => {
      const result = extractJson('```\n{"matched": true}\n```')

      expect(result).toEqual({ matched: true })
    })

    it('should extract JSON from text with surrounding content', () => {
      const result = extractJson('Here is the result: {"matched": true, "skillName": "test"} done.')

      expect(result).toEqual({ matched: true, skillName: 'test' })
    })

    it('should return null for invalid JSON', () => {
      expect(extractJson('not json at all')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(extractJson('')).toBeNull()
    })

    it('should return null for partial JSON', () => {
      expect(extractJson('{"matched":')).toBeNull()
    })

    it('should handle JSON with extra whitespace', () => {
      const result = extractJson('  {"matched": true}  ')

      expect(result).toEqual({ matched: true })
    })
  })

  // ─── parseMatchResult ──────────────────────────────────────────

  describe('parseMatchResult', () => {
    const skills = [
      makeSkill({ name: 'research-report' }),
      makeSkill({ name: 'summarize-docs' }),
    ]

    it('should parse a successful match', () => {
      const result = parseMatchResult(
        '{"matched": true, "skillName": "research-report", "confidence": 0.9, "reason": "User wants research"}',
        skills,
      )

      expect(result).toEqual({
        matched: true,
        skillName: 'research-report',
        confidence: 0.9,
        reason: 'User wants research',
      })
    })

    it('should parse a non-match', () => {
      const result = parseMatchResult(
        '{"matched": false, "skillName": null, "confidence": 0.2, "reason": "No clear intent"}',
        skills,
      )

      expect(result).toEqual({
        matched: false,
        skillName: null,
        confidence: 0.2,
        reason: 'No clear intent',
      })
    })

    it('should return null for invalid JSON', () => {
      const result = parseMatchResult('this is not json', skills)

      expect(result).toBeNull()
    })

    it('should return null when matched is not boolean', () => {
      const result = parseMatchResult('{"matched": "yes", "confidence": 0.9}', skills)

      expect(result).toBeNull()
    })

    it('should return null when confidence is not number', () => {
      const result = parseMatchResult('{"matched": true, "confidence": "high"}', skills)

      expect(result).toBeNull()
    })

    it('should return no-match when matched=true but skillName is empty', () => {
      const result = parseMatchResult(
        '{"matched": true, "skillName": "", "confidence": 0.9}',
        skills,
      )

      expect(result).not.toBeNull()
      expect(result?.matched).toBe(false)
      expect(result?.skillName).toBeNull()
    })

    it('should return no-match when matched=true but skillName is not a string', () => {
      const result = parseMatchResult(
        '{"matched": true, "skillName": 123, "confidence": 0.9}',
        skills,
      )

      expect(result).not.toBeNull()
      expect(result?.matched).toBe(false)
    })

    it('should return no-match when skillName does not exist in skills list', () => {
      const result = parseMatchResult(
        '{"matched": true, "skillName": "nonexistent-skill", "confidence": 0.9}',
        skills,
      )

      expect(result).not.toBeNull()
      expect(result?.matched).toBe(false)
      expect(result?.reason).toContain('not found')
    })

    it('should handle missing reason field gracefully', () => {
      const result = parseMatchResult(
        '{"matched": true, "skillName": "research-report", "confidence": 0.9}',
        skills,
      )

      expect(result).not.toBeNull()
      expect(result?.reason).toBe('')
    })
  })

  // ─── matchSkill ───────────────────────────────────────────────

  describe('matchSkill', () => {
    it('should return no-match when no auto-trigger skills exist', async () => {
      mockListAutoTriggerSkills.mockReturnValue([])

      const adapter = new MockModelAdapter([])

      const result = await matchSkill('hello', { adapter })

      expect(result.matched).toBe(false)
      expect(result.skillName).toBeNull()
      expect(result.reason).toContain('No auto-trigger skills')
    })

    it('should return a match when confidence is above threshold', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        '{"matched": true, "skillName": "research-report", "confidence": 0.9, "reason": "Research intent"}',
      ])

      const result = await matchSkill('帮我写一篇AI研究报告', { adapter })

      expect(result.matched).toBe(true)
      expect(result.skillName).toBe('research-report')
      expect(result.confidence).toBe(0.9)
      expect(result.reason).toBe('Research intent')
    })

    it('should return no-match when confidence is below threshold', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        `{"matched": true, "skillName": "research-report", "confidence": ${CONFIDENCE_THRESHOLD - 0.1}, "reason": "Low confidence"}`,
      ])

      const result = await matchSkill('maybe research', { adapter })

      expect(result.matched).toBe(false)
      expect(result.skillName).toBeNull()
      expect(result.confidence).toBe(CONFIDENCE_THRESHOLD - 0.1)
      expect(result.reason).toContain('below threshold')
    })

    it('should return match when confidence equals threshold', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        `{"matched": true, "skillName": "research-report", "confidence": ${CONFIDENCE_THRESHOLD}, "reason": "Exact threshold"}`,
      ])

      const result = await matchSkill('research', { adapter })

      expect(result.matched).toBe(true)
      expect(result.skillName).toBe('research-report')
    })

    it('should return no-match when LLM returns invalid JSON', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter(['This is not JSON at all.'])

      const result = await matchSkill('hello', { adapter })

      expect(result.matched).toBe(false)
      expect(result.reason).toContain('Failed to parse')
    })

    it('should return no-match when LLM returns matched=false', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        '{"matched": false, "skillName": null, "confidence": 0.3, "reason": "No match"}',
      ])

      const result = await matchSkill('hello', { adapter })

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe(0.3)
    })

    it('should return no-match when LLM call throws', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([])
      adapter.shouldThrow = true

      const result = await matchSkill('hello', { adapter })

      expect(result.matched).toBe(false)
      expect(result.reason).toContain('LLM call failed')
    })

    it('should use provided skills instead of querying DB', async () => {
      const skills = [
        makeSkill({ name: 'summarize-docs', description: 'Summarize documents' }),
      ]

      const adapter = new MockModelAdapter([
        '{"matched": true, "skillName": "summarize-docs", "confidence": 0.85, "reason": "Doc summary"}',
      ])

      const result = await matchSkill('总结这个PDF', { adapter, skills })

      expect(result.matched).toBe(true)
      expect(result.skillName).toBe('summarize-docs')
      // DB 不应被调用
      expect(mockListAutoTriggerSkills).not.toHaveBeenCalled()
    })

    it('should return no-match when matched skill is not in skills list', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        '{"matched": true, "skillName": "nonexistent", "confidence": 0.9, "reason": "test"}',
      ])

      const result = await matchSkill('hello', { adapter })

      expect(result.matched).toBe(false)
      expect(result.reason).toContain('not found')
    })

    it('should handle LLM response wrapped in code block', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        '```json\n{"matched": true, "skillName": "research-report", "confidence": 0.88, "reason": "Research"}\n```',
      ])

      const result = await matchSkill('帮我研究一下', { adapter })

      expect(result.matched).toBe(true)
      expect(result.skillName).toBe('research-report')
    })

    it('should handle LLM response with surrounding text', async () => {
      const skills = [makeSkill({ name: 'research-report' })]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        'Based on my analysis:\n{"matched": true, "skillName": "research-report", "confidence": 0.92, "reason": "Clear research intent"}\nThat is my conclusion.',
      ])

      const result = await matchSkill('研究', { adapter })

      expect(result.matched).toBe(true)
      expect(result.skillName).toBe('research-report')
    })

    it('should handle multiple skills and match the correct one', async () => {
      const skills = [
        makeSkill({ name: 'research-report', description: 'Generate research report' }),
        makeSkill({ name: 'summarize-docs', description: 'Summarize documents', id: 'skill-2' }),
      ]
      mockListAutoTriggerSkills.mockReturnValue(skills)

      const adapter = new MockModelAdapter([
        '{"matched": true, "skillName": "summarize-docs", "confidence": 0.95, "reason": "User wants to summarize"}',
      ])

      const result = await matchSkill('帮我总结这个PDF文档', { adapter })

      expect(result.matched).toBe(true)
      expect(result.skillName).toBe('summarize-docs')
    })
  })
})
