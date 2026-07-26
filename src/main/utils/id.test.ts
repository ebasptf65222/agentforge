import { describe, it, expect } from 'vitest'
import { generateId } from './id'

describe('generateId', () => {
  it('should return a string', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
  })

  it('should return a UUID v4 format (36 chars with dashes)', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('should have version 4 in the third group', () => {
    const id = generateId()
    const groups = id.split('-')
    expect(groups[2]).toMatch(/^4/i)
  })

  it('should generate unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateId())
    }
    expect(ids.size).toBe(100)
  })
})
