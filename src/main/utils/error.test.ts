import { describe, it, expect } from 'vitest'
import { AppError, ErrorCodes, isAppError, createError, wrapError, serializeError } from './error'

describe('AppError', () => {
  it('should create an error with code and message', () => {
    const error = new AppError('TEST_CODE', 'test message')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('TEST_CODE')
    expect(error.message).toBe('test message')
    expect(error.name).toBe('AppError')
    expect(error.details).toBeUndefined()
  })

  it('should create an error with details', () => {
    const details = { field: 'name', value: 123 }
    const error = new AppError('VALIDATION_ERROR', 'invalid field', details)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toBe('invalid field')
    expect(error.details).toEqual(details)
  })

  it('should serialize to JSON correctly', () => {
    const error = new AppError('MODEL_NOT_FOUND', 'model missing', { id: 'abc' })
    const json = error.toJSON()
    expect(json).toEqual({
      code: 'MODEL_NOT_FOUND',
      message: 'model missing',
      details: { id: 'abc' },
    })
  })

  it('should serialize to JSON without details when not provided', () => {
    const error = new AppError('DB_ERROR', 'db failed')
    const json = error.toJSON()
    expect(json).toEqual({
      code: 'DB_ERROR',
      message: 'db failed',
    })
    expect(json.details).toBeUndefined()
  })
})

describe('ErrorCodes', () => {
  it('should contain model-related codes', () => {
    expect(ErrorCodes.MODEL_DUPLICATE).toBe('MODEL_DUPLICATE')
    expect(ErrorCodes.MODEL_NOT_FOUND).toBe('MODEL_NOT_FOUND')
    expect(ErrorCodes.MODEL_DELETE_DEFAULT).toBe('MODEL_DELETE_DEFAULT')
    expect(ErrorCodes.MODEL_TEST_FAILED).toBe('MODEL_TEST_FAILED')
  })

  it('should contain encryption-related codes', () => {
    expect(ErrorCodes.SAFE_STORAGE_UNAVAILABLE).toBe('SAFE_STORAGE_UNAVAILABLE')
  })

  it('should contain generic codes', () => {
    expect(ErrorCodes.DB_ERROR).toBe('DB_ERROR')
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR')
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
  })

  it('should have all values as strings', () => {
    for (const value of Object.values(ErrorCodes)) {
      expect(typeof value).toBe('string')
    }
  })

  it('should contain agent-related codes (P2)', () => {
    expect(ErrorCodes.AGENT_MAX_STEPS).toBe('AGENT_MAX_STEPS')
    expect(ErrorCodes.AGENT_CIRCUIT_BREAK).toBe('AGENT_CIRCUIT_BREAK')
    expect(ErrorCodes.AGENT_CANCELLED).toBe('AGENT_CANCELLED')
    expect(ErrorCodes.AGENT_APPROVAL_TIMEOUT).toBe('AGENT_APPROVAL_TIMEOUT')
  })

  it('should contain tool-related codes (P2)', () => {
    expect(ErrorCodes.TOOL_NOT_FOUND).toBe('TOOL_NOT_FOUND')
    expect(ErrorCodes.TOOL_EXECUTION_ERROR).toBe('TOOL_EXECUTION_ERROR')
  })

  it('should contain MCP-related codes (P2)', () => {
    expect(ErrorCodes.MCP_SPAWN_FAILED).toBe('MCP_SPAWN_FAILED')
    expect(ErrorCodes.MCP_CONNECT_FAILED).toBe('MCP_CONNECT_FAILED')
  })

  it('should contain file-related codes (P2/P3)', () => {
    expect(ErrorCodes.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND')
    expect(ErrorCodes.FILE_ACCESS_ERROR).toBe('FILE_ACCESS_ERROR')
    expect(ErrorCodes.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE')
  })

  it('should contain KB-related codes (P3)', () => {
    expect(ErrorCodes.KB_INDEX_ERROR).toBe('KB_INDEX_ERROR')
  })

  it('should contain Skills-related codes (P3)', () => {
    expect(ErrorCodes.SKILL_DUPLICATE).toBe('SKILL_DUPLICATE')
    expect(ErrorCodes.SKILL_PROMPT_EMPTY).toBe('SKILL_PROMPT_EMPTY')
    expect(ErrorCodes.SKILL_VARIABLE_MISSING).toBe('SKILL_VARIABLE_MISSING')
  })
})

// ─── 错误辅助函数测试 ──────────────────────────────────────────

describe('isAppError', () => {
  it('should return true for AppError instances', () => {
    const err = new AppError('TEST_CODE', 'test')
    expect(isAppError(err)).toBe(true)
  })

  it('should return false for regular Error instances', () => {
    const err = new Error('regular error')
    expect(isAppError(err)).toBe(false)
  })

  it('should return false for non-error values', () => {
    expect(isAppError('string error')).toBe(false)
    expect(isAppError(42)).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError(undefined)).toBe(false)
    expect(isAppError({ message: 'looks like error' })).toBe(false)
  })
})

describe('createError', () => {
  it('should create an AppError with code and message', () => {
    const err = createError(ErrorCodes.TOOL_NOT_FOUND, 'Tool not found')
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('TOOL_NOT_FOUND')
    expect(err.message).toBe('Tool not found')
    expect(err.details).toBeUndefined()
  })

  it('should create an AppError with details', () => {
    const err = createError(ErrorCodes.AGENT_MAX_STEPS, 'Max steps reached', {
      maxSteps: 20,
      currentStep: 20,
    })
    expect(err.code).toBe('AGENT_MAX_STEPS')
    expect(err.details).toEqual({ maxSteps: 20, currentStep: 20 })
  })

  it('should create an AppError with arbitrary code string', () => {
    const err = createError('CUSTOM_CODE', 'custom message')
    expect(err.code).toBe('CUSTOM_CODE')
    expect(err.message).toBe('custom message')
  })
})

describe('wrapError', () => {
  it('should return AppError as-is when already AppError', () => {
    const original = new AppError('TOOL_EXECUTION_ERROR', 'tool failed', { tool: 'web_search' })
    const wrapped = wrapError(original)
    expect(wrapped).toBe(original) // same reference
    expect(wrapped.code).toBe('TOOL_EXECUTION_ERROR')
    expect(wrapped.details).toEqual({ tool: 'web_search' })
  })

  it('should wrap regular Error with default INTERNAL_ERROR code', () => {
    const original = new Error('something went wrong')
    const wrapped = wrapError(original)
    expect(wrapped).toBeInstanceOf(AppError)
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    expect(wrapped.message).toBe('something went wrong')
  })

  it('should wrap regular Error with custom fallback code', () => {
    const original = new Error('db connection failed')
    const wrapped = wrapError(original, ErrorCodes.DB_ERROR)
    expect(wrapped.code).toBe('DB_ERROR')
    expect(wrapped.message).toBe('db connection failed')
  })

  it('should wrap non-Error values', () => {
    const wrapped = wrapError('a string error')
    expect(wrapped).toBeInstanceOf(AppError)
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    expect(wrapped.message).toBe('a string error')
  })

  it('should wrap null and undefined', () => {
    expect(wrapError(null).message).toBe('null')
    expect(wrapError(undefined).message).toBe('undefined')
  })

  it('should wrap objects', () => {
    const wrapped = wrapError({ custom: 'data' })
    expect(wrapped.message).toBe('[object Object]')
  })
})

describe('serializeError', () => {
  it('should serialize AppError correctly', () => {
    const err = new AppError('MCP_SPAWN_FAILED', 'spawn failed', { command: 'npx' })
    const serialized = serializeError(err)
    expect(serialized).toEqual({
      code: 'MCP_SPAWN_FAILED',
      message: 'spawn failed',
      details: { command: 'npx' },
    })
  })

  it('should serialize AppError without details', () => {
    const err = new AppError('AGENT_CANCELLED', 'cancelled by user')
    const serialized = serializeError(err)
    expect(serialized).toEqual({
      code: 'AGENT_CANCELLED',
      message: 'cancelled by user',
    })
    expect(serialized.details).toBeUndefined()
  })

  it('should serialize regular Error as INTERNAL_ERROR', () => {
    const err = new Error('unexpected failure')
    const serialized = serializeError(err)
    expect(serialized).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'unexpected failure',
    })
  })

  it('should serialize non-Error values', () => {
    const serialized = serializeError('plain string')
    expect(serialized).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'plain string',
    })
  })

  it('should produce JSON-safe output for IPC', () => {
    const err = createError('VALIDATION_ERROR', 'bad input', { field: 'name' })
    const serialized = serializeError(err)
    expect(() => JSON.stringify(serialized)).not.toThrow()
    const parsed = JSON.parse(JSON.stringify(serialized))
    expect(parsed.code).toBe('VALIDATION_ERROR')
    expect(parsed.details.field).toBe('name')
  })
})
