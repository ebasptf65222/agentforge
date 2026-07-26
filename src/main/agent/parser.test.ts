import { describe, it, expect } from 'vitest'
import { parseLLMOutput } from './parser'

describe('parseLLMOutput', () => {
  it('should parse Thought + tool Action', () => {
    const output = `Thought: I need to search for information about Vue 3.
Action: {"type": "tool", "tool": "web_search", "arguments": {"query": "Vue 3 latest"}}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('tool')
    expect(result.thought).toContain('Vue 3')
    expect(result.toolName).toBe('web_search')
    expect(result.arguments).toEqual({ query: 'Vue 3 latest' })
  })

  it('should parse Thought + finish Action', () => {
    const output = `Thought: I have found all the information needed.
Action: {"type": "finish", "summary": "Vue 3 is a progressive JavaScript framework."}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('finish')
    expect(result.thought).toContain('found all the information')
    expect(result.summary).toContain('progressive JavaScript framework')
  })

  it('should handle Chinese Thought/Action labels', () => {
    const output = `思考：我需要搜索 Vue 3 相关信息。
行动：{"type": "tool", "tool": "web_search", "arguments": {"query": "Vue 3"}}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('tool')
    expect(result.toolName).toBe('web_search')
  })

  it('should handle JSON in code block', () => {
    const output = `Thought: Let me search.
Action: \`\`\`json
{"type": "tool", "tool": "file_read", "arguments": {"path": "/tmp/test.txt"}}
\`\`\``

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('tool')
    expect(result.toolName).toBe('file_read')
    expect(result.arguments).toEqual({ path: '/tmp/test.txt' })
  })

  it('should handle raw JSON without Thought/Action markers', () => {
    const output = `{"type": "finish", "summary": "Done."}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('finish')
    expect(result.summary).toBe('Done.')
  })

  it('should handle JSON embedded in text', () => {
    const output = `I think we should do this. {"type": "tool", "tool": "web_scrape", "arguments": {"url": "https://example.com"}}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('tool')
    expect(result.toolName).toBe('web_scrape')
  })

  it('should handle unparseable output as finish', () => {
    const output = 'This is just plain text without any JSON.'

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('finish')
    expect(result.summary).toBeTruthy()
  })

  it('should handle empty arguments in tool call', () => {
    const output = `Thought: Let me list the directory.
Action: {"type": "tool", "tool": "directory_list", "arguments": {}}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('tool')
    expect(result.toolName).toBe('directory_list')
    expect(result.arguments).toEqual({})
  })

  it('should handle missing arguments field', () => {
    const output = `Thought: Do something.
Action: {"type": "tool", "tool": "web_search"}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('tool')
    expect(result.toolName).toBe('web_search')
    expect(result.arguments).toEqual({})
  })

  it('should preserve rawOutput', () => {
    const output = `Thought: test\nAction: {"type": "finish", "summary": "done"}`
    const result = parseLLMOutput(output)
    expect(result.rawOutput).toBe(output.trim())
  })

  it('should handle unknown action type as finish', () => {
    const output = `Thought: test
Action: {"type": "unknown_type", "data": "something"}`

    const result = parseLLMOutput(output)

    expect(result.actionType).toBe('finish')
  })
})
