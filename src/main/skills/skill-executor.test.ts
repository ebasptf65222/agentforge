// AgentForge P3-04: Skill 执行集成 单元测试
// 测试 substituteVariables / filterTools / buildSkillPromptSection /
// resolveSkill / buildSkillExecutionContext

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Skill, SkillVariable, SkillMatchResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import type { RegisteredTool } from '../agent/types'
import type { ToolDefinition } from '@shared/types'

// ─── Mock setup ─────────────────────────────────────────────────

const { mockGetSkillByName, mockMatchSkill, mockListAutoTriggerSkills } = vi.hoisted(() => ({
  mockGetSkillByName: vi.fn(),
  mockMatchSkill: vi.fn(),
  mockListAutoTriggerSkills: vi.fn(),
}))

vi.mock('../db/repos/skill', () => ({
  getSkillByName: (...args: unknown[]) => mockGetSkillByName(...args),
  listAutoTriggerSkills: (...args: unknown[]) => mockListAutoTriggerSkills(...args),
}))

vi.mock('./matcher', () => ({
  matchSkill: (...args: unknown[]) => mockMatchSkill(...args),
}))

// ─── Import after mocks ─────────────────────────────────────────

const {
  substituteVariables,
  filterTools,
  buildSkillPromptSection,
  resolveSkill,
  buildSkillExecutionContext,
} = await import('./skill-executor')

// ─── Helpers ────────────────────────────────────────────────────

function makeVariable(overrides: Partial<SkillVariable> = {}): SkillVariable {
  return {
    name: 'topic',
    description: 'Topic variable',
    required: true,
    ...overrides,
  }
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'research-report',
    displayName: 'Research Report',
    description: 'Generate a research report',
    prompt: 'Write a report about {{topic}}.',
    modelId: undefined,
    allowedTools: [],
    trigger: 'auto',
    variables: [makeVariable()],
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    riskLevel: 'low',
    inputSchema: { type: 'object', properties: {} },
  }
}

function makeRegisteredTool(name: string): RegisteredTool {
  return {
    definition: makeToolDefinition(name),
    execute: vi.fn(),
  }
}

function makeToolsMap(names: string[]): Map<string, RegisteredTool> {
  const map = new Map<string, RegisteredTool>()
  for (const name of names) {
    map.set(name, makeRegisteredTool(name))
  }
  return map
}

// ─── substituteVariables ────────────────────────────────────────

describe('substituteVariables (P3-04)', () => {
  it('should replace a single variable with explicit value', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [makeVariable({ name: 'topic' })]

    const result = substituteVariables(prompt, variables, { topic: 'AI trends' })

    expect(result).toBe('Write about AI trends.')
  })

  it('should replace multiple variables', () => {
    const prompt = 'Topic: {{topic}}, Style: {{style}}'
    const variables = [
      makeVariable({ name: 'topic' }),
      makeVariable({ name: 'style', required: false }),
    ]

    const result = substituteVariables(prompt, variables, {
      topic: 'AI',
      style: 'formal',
    })

    expect(result).toBe('Topic: AI, Style: formal')
  })

  it('should use defaultValue when no explicit value', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [
      makeVariable({ name: 'topic', required: false, defaultValue: 'default-topic' }),
    ]

    const result = substituteVariables(prompt, variables)

    expect(result).toBe('Write about default-topic.')
  })

  it('should prefer explicit value over defaultValue', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [makeVariable({ name: 'topic', defaultValue: 'default' })]

    const result = substituteVariables(prompt, variables, { topic: 'explicit' })

    expect(result).toBe('Write about explicit.')
  })

  it('should replace non-required variable with empty string when no value', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [makeVariable({ name: 'topic', required: false })]

    const result = substituteVariables(prompt, variables)

    expect(result).toBe('Write about .')
  })

  it('should throw SKILL_VARIABLE_MISSING for required variable without value or default', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [makeVariable({ name: 'topic', required: true })]

    try {
      substituteVariables(prompt, variables)
      expect.fail('Expected AppError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe(ErrorCodes.SKILL_VARIABLE_MISSING)
    }
  })

  it('should handle prompt with no variables', () => {
    const prompt = 'No variables here.'
    const result = substituteVariables(prompt, [])
    expect(result).toBe('No variables here.')
  })

  it('should handle empty values object', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [makeVariable({ name: 'topic', required: false, defaultValue: 'fallback' })]

    const result = substituteVariables(prompt, variables, {})

    expect(result).toBe('Write about fallback.')
  })

  it('should handle multiple occurrences of same variable', () => {
    const prompt = '{{topic}} and {{topic}} again.'
    const variables = [makeVariable({ name: 'topic' })]

    const result = substituteVariables(prompt, variables, { topic: 'AI' })

    expect(result).toBe('AI and AI again.')
  })

  it('should treat empty string value as not provided', () => {
    const prompt = 'Write about {{topic}}.'
    const variables = [makeVariable({ name: 'topic', required: false, defaultValue: 'fallback' })]

    const result = substituteVariables(prompt, variables, { topic: '' })

    expect(result).toBe('Write about fallback.')
  })
})

// ─── filterTools ────────────────────────────────────────────────

describe('filterTools (P3-04)', () => {
  it('should return all tools when allowedTools is empty', () => {
    const tools = makeToolsMap(['tool-a', 'tool-b', 'tool-c'])

    const result = filterTools(tools, [])

    expect(result.size).toBe(3)
    expect(result.has('tool-a')).toBe(true)
    expect(result.has('tool-b')).toBe(true)
    expect(result.has('tool-c')).toBe(true)
  })

  it('should return only allowed tools', () => {
    const tools = makeToolsMap(['tool-a', 'tool-b', 'tool-c'])

    const result = filterTools(tools, ['tool-a', 'tool-c'])

    expect(result.size).toBe(2)
    expect(result.has('tool-a')).toBe(true)
    expect(result.has('tool-b')).toBe(false)
    expect(result.has('tool-c')).toBe(true)
  })

  it('should return empty map when no allowed tools match', () => {
    const tools = makeToolsMap(['tool-a', 'tool-b'])

    const result = filterTools(tools, ['tool-x'])

    expect(result.size).toBe(0)
  })

  it('should return a new map instance (not mutate original)', () => {
    const tools = makeToolsMap(['tool-a'])

    const result = filterTools(tools, [])

    expect(result).not.toBe(tools)
    expect(tools.size).toBe(1)
  })

  it('should handle single allowed tool', () => {
    const tools = makeToolsMap(['tool-a', 'tool-b', 'tool-c'])

    const result = filterTools(tools, ['tool-b'])

    expect(result.size).toBe(1)
    expect(result.has('tool-b')).toBe(true)
  })
})

// ─── buildSkillPromptSection ────────────────────────────────────

describe('buildSkillPromptSection (P3-04)', () => {
  it('should format skill prompt with display name and content', () => {
    const skill = makeSkill({ displayName: 'Research Report' })
    const prompt = 'Write a detailed report.'

    const result = buildSkillPromptSection(skill, prompt)

    expect(result).toContain('## Skill: Research Report')
    expect(result).toContain('Write a detailed report.')
    expect(result).toContain('---')
  })

  it('should include the prompt after the header', () => {
    const skill = makeSkill({ displayName: 'Summarize Docs' })
    const prompt = 'Summarize the following content.'

    const result = buildSkillPromptSection(skill, prompt)

    expect(result).toBe(`---

## Skill: Summarize Docs

Summarize the following content.`)
  })
})

// ─── resolveSkill ───────────────────────────────────────────────

describe('resolveSkill (P3-04)', () => {
  const mockAdapter = {
    streamChat: vi.fn(),
  } as unknown

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should resolve manually specified skill', async () => {
    const skill = makeSkill({ name: 'research-report' })
    mockGetSkillByName.mockReturnValue(skill)

    const result = await resolveSkill(
      'help me write a report',
      'research-report',
      mockAdapter as never,
    )

    expect(result.source).toBe('manual')
    expect(result.skill).toBe(skill)
    expect(mockGetSkillByName).toHaveBeenCalledWith('research-report')
    expect(mockMatchSkill).not.toHaveBeenCalled()
  })

  it('should throw SKILL_NOT_FOUND when manual skill does not exist', async () => {
    mockGetSkillByName.mockReturnValue(undefined)

    try {
      await resolveSkill('help', 'nonexistent-skill', mockAdapter as never)
      expect.fail('Expected AppError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe(ErrorCodes.SKILL_NOT_FOUND)
    }
  })

  it('should resolve via auto-matching when no skillName provided', async () => {
    const skill = makeSkill({ name: 'research-report' })
    mockMatchSkill.mockResolvedValue({
      matched: true,
      skillName: 'research-report',
      confidence: 0.9,
      reason: 'High confidence match',
    } satisfies SkillMatchResult)
    mockGetSkillByName.mockReturnValue(skill)

    const result = await resolveSkill(
      'help me write a research report',
      undefined,
      mockAdapter as never,
    )

    expect(result.source).toBe('auto')
    expect(result.skill).toBe(skill)
    expect(result.confidence).toBe(0.9)
    expect(mockMatchSkill).toHaveBeenCalledTimes(1)
  })

  it('should return none when auto-match fails', async () => {
    mockMatchSkill.mockResolvedValue({
      matched: false,
      skillName: null,
      confidence: 0,
      reason: 'No matching skill',
    } satisfies SkillMatchResult)

    const result = await resolveSkill('random message', undefined, mockAdapter as never)

    expect(result.source).toBe('none')
    expect(result.skill).toBeNull()
    expect(result.reason).toBe('No matching skill')
  })

  it('should return none when matched skill not found in DB', async () => {
    mockMatchSkill.mockResolvedValue({
      matched: true,
      skillName: 'ghost-skill',
      confidence: 0.9,
      reason: 'Matched',
    } satisfies SkillMatchResult)
    mockGetSkillByName.mockReturnValue(undefined)

    const result = await resolveSkill('help', undefined, mockAdapter as never)

    expect(result.source).toBe('none')
    expect(result.skill).toBeNull()
    expect(result.reason).toContain('not found in database')
  })

  it('should treat empty string skillName as undefined', async () => {
    mockMatchSkill.mockResolvedValue({
      matched: false,
      skillName: null,
      confidence: 0,
      reason: 'No match',
    } satisfies SkillMatchResult)

    await resolveSkill('help', '', mockAdapter as never)

    expect(mockGetSkillByName).not.toHaveBeenCalled()
    expect(mockMatchSkill).toHaveBeenCalledTimes(1)
  })

  it('should treat whitespace-only skillName as undefined', async () => {
    mockMatchSkill.mockResolvedValue({
      matched: false,
      skillName: null,
      confidence: 0,
      reason: 'No match',
    } satisfies SkillMatchResult)

    await resolveSkill('help', '   ', mockAdapter as never)

    expect(mockGetSkillByName).not.toHaveBeenCalled()
    expect(mockMatchSkill).toHaveBeenCalledTimes(1)
  })

  it('should pass abortSignal to matchSkill', async () => {
    mockMatchSkill.mockResolvedValue({
      matched: false,
      skillName: null,
      confidence: 0,
      reason: 'No match',
    } satisfies SkillMatchResult)

    const abortSignal = new AbortController().signal

    await resolveSkill('help', undefined, mockAdapter as never, abortSignal)

    expect(mockMatchSkill).toHaveBeenCalledWith(
      'help',
      expect.objectContaining({ adapter: mockAdapter, abortSignal }),
    )
  })
})

// ─── buildSkillExecutionContext ──────────────────────────────────

describe('buildSkillExecutionContext (P3-04)', () => {
  it('should build context with substituted variables', () => {
    const skill = makeSkill({
      prompt: 'Write about {{topic}} with {{style}}.',
      variables: [
        makeVariable({ name: 'topic', required: true }),
        makeVariable({ name: 'style', required: false, defaultValue: 'formal' }),
      ],
    })
    const tools = makeToolsMap(['tool-a', 'tool-b'])

    const ctx = buildSkillExecutionContext(skill, tools, { topic: 'AI' })

    expect(ctx.skillPrompt).toContain('Write about AI with formal.')
    expect(ctx.skillDisplayName).toBe('Research Report')
  })

  it('should filter tools based on allowedTools', () => {
    const skill = makeSkill({
      allowedTools: ['tool-a'],
      variables: [makeVariable({ name: 'topic', required: false })],
    })
    const tools = makeToolsMap(['tool-a', 'tool-b', 'tool-c'])

    const ctx = buildSkillExecutionContext(skill, tools)

    expect(ctx.filteredTools).toHaveLength(1)
    expect(ctx.filteredTools[0]?.name).toBe('tool-a')
  })

  it('should return all tools when allowedTools is empty', () => {
    const skill = makeSkill({
      allowedTools: [],
      variables: [makeVariable({ name: 'topic', required: false })],
    })
    const tools = makeToolsMap(['tool-a', 'tool-b'])

    const ctx = buildSkillExecutionContext(skill, tools)

    expect(ctx.filteredTools).toHaveLength(2)
  })

  it('should expose skill modelId', () => {
    const skill = makeSkill({
      modelId: 'custom-model-1',
      variables: [makeVariable({ name: 'topic', required: false })],
    })
    const tools = makeToolsMap([])

    const ctx = buildSkillExecutionContext(skill, tools)

    expect(ctx.modelId).toBe('custom-model-1')
  })

  it('should have modelId undefined when skill has no modelId', () => {
    const skill = makeSkill({
      modelId: undefined,
      variables: [makeVariable({ name: 'topic', required: false })],
    })
    const tools = makeToolsMap([])

    const ctx = buildSkillExecutionContext(skill, tools)

    expect(ctx.modelId).toBeUndefined()
  })

  it('should throw SKILL_VARIABLE_MISSING for required variable without value', () => {
    const skill = makeSkill({
      prompt: 'Write about {{topic}}.',
      variables: [makeVariable({ name: 'topic', required: true })],
    })
    const tools = makeToolsMap([])

    try {
      buildSkillExecutionContext(skill, tools)
      expect.fail('Expected AppError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe(ErrorCodes.SKILL_VARIABLE_MISSING)
    }
  })

  it('should include skill prompt section in the built prompt', () => {
    const skill = makeSkill({
      displayName: 'My Skill',
      prompt: 'Do something with {{topic}}.',
      variables: [makeVariable({ name: 'topic', required: false })],
    })
    const tools = makeToolsMap([])

    const ctx = buildSkillExecutionContext(skill, tools)

    expect(ctx.skillPrompt).toContain('## Skill: My Skill')
    expect(ctx.skillPrompt).toContain('Do something with .')
  })
})
