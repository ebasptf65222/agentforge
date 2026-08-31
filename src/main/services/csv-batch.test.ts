// M11：CSV 批量造片解析器单测
// 覆盖 BOM、引号转义、内嵌换行、非法枚举/数值、缺 prompt 列、空行、缺行空白等。

import { describe, it, expect } from 'vitest'
import { parseCsvRows, tokenizeCsv } from './csv-batch'

describe('tokenizeCsv (RFC 4180)', () => {
  it('parses simple comma-separated rows', () => {
    expect(tokenizeCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles quoted field with embedded comma', () => {
    const rows = tokenizeCsv('a,"b,c"\n')
    expect(rows[0]).toEqual(['a', 'b,c'])
  })

  it('handles quoted field with embedded newline', () => {
    const rows = tokenizeCsv('a,"b\nc",d')
    expect(rows[0]).toEqual(['a', 'b\nc', 'd'])
  })

  it('handles doubled-quote escape', () => {
    const rows = tokenizeCsv('a,"say ""hi""",b')
    expect(rows[0]).toEqual(['a', 'say "hi"', 'b'])
  })

  it('handles CRLF line endings', () => {
    expect(tokenizeCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps trailing empty field', () => {
    expect(tokenizeCsv('a,b,\n1,2,')).toEqual([
      ['a', 'b', ''],
      ['1', '2', ''],
    ])
  })
})

describe('parseCsvRows', () => {
  it('strips UTF-8 BOM', () => {
    const text = `\uFEFFprompt,duration\ncat,5\n`
    const result = parseCsvRows(text)
    expect(result.headerMissingPrompt).toBe(false)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].prompt).toBe('cat')
  })

  it('maps optional columns to params with defaults', () => {
    const text = 'prompt,duration,resolution,aspect\n"a cat",5,720P,16:9\n'
    const result = parseCsvRows(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({
      prompt: 'a cat',
      duration: 5,
      resolution: '720P',
      aspect: '16:9',
    })
    expect(result.skipped).toHaveLength(0)
  })

  it('ignores blank lines', () => {
    const text = 'prompt\ncat\n\ndog\n'
    const result = parseCsvRows(text)
    expect(result.rows.map((r) => r.prompt)).toEqual(['cat', 'dog'])
  })

  it('reports headerMissingPrompt when prompt column absent', () => {
    const result = parseCsvRows('title,note\nx,y\n')
    expect(result.headerMissingPrompt).toBe(true)
    expect(result.rows).toHaveLength(0)
  })

  it('skips row with empty prompt', () => {
    const text = 'prompt,duration\ncat,5\n,6\n'
    const result = parseCsvRows(text)
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ line: 3, reason: 'prompt is empty' })
  })

  it('skips row with non-positive duration', () => {
    const text = 'prompt,duration\ncat,abc\n'
    const result = parseCsvRows(text)
    expect(result.rows).toHaveLength(0)
    expect(result.skipped[0].reason).toMatch(/duration must be a positive number/)
  })

  it('skips row with unsupported resolution', () => {
    const text = 'prompt,resolution\ncat,4K\n'
    const result = parseCsvRows(text)
    expect(result.rows).toHaveLength(0)
    expect(result.skipped[0].reason).toMatch(/unsupported resolution/)
  })

  it('skips row with unsupported aspect', () => {
    const text = 'prompt,aspect\ncat,2:1\n'
    const result = parseCsvRows(text)
    expect(result.rows).toHaveLength(0)
    expect(result.skipped[0].reason).toMatch(/unsupported aspect/)
  })

  it('skips invalid resolution but keeps other valid rows', () => {
    const text = 'prompt,resolution\nbad,4K\nok,720P\n'
    const result = parseCsvRows(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].prompt).toBe('ok')
    expect(result.skipped).toHaveLength(1)
  })

  it('handles empty content', () => {
    const result = parseCsvRows('')
    expect(result.rows).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
    expect(result.headerMissingPrompt).toBe(false)
  })
})