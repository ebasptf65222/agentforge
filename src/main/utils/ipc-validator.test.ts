// AgentForge IPC 统一校验中间件单元测试

import { describe, it, expect, vi } from 'vitest'
import { AppError } from './error'
import {
  createValidatedHandler,
  validateString,
  validateEnum,
  validateOptionalNumber,
  validateUrl,
} from './ipc-validator'

// ─── createValidatedHandler ─────────────────────────────────────

describe('createValidatedHandler', () => {
  it('should call validate and handler with correct params', async () => {
    const validate = vi.fn((params: Record<string, unknown>) => ({
      name: params['name'] as string,
    }))
    const handler = vi.fn(async (validated: { name: string }) => `hello ${validated.name}`)

    const wrapped = createValidatedHandler(validate, handler)

    const result = await wrapped({} as never, { name: 'world' })

    expect(validate).toHaveBeenCalledWith({ name: 'world' })
    expect(handler).toHaveBeenCalledWith({ name: 'world' })
    expect(result).toBe('hello world')
  })

  it('should support synchronous handler', () => {
    const validate = (params: Record<string, unknown>): { id: number } => ({ id: params['id'] as number })
    const handler = (validated: { id: number }): number => validated.id * 2

    const wrapped = createValidatedHandler(validate, handler)

    const result = wrapped({} as never, { id: 21 })

    expect(result).toBe(42)
  })

  it('should throw VALIDATION_ERROR when params is null', () => {
    const wrapped = createValidatedHandler(
      () => ({}),
      () => undefined,
    )

    expect(() => wrapped({} as never, null)).toThrow(AppError)
    try {
      wrapped({} as never, null)
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION_ERROR')
    }
  })

  it('should throw VALIDATION_ERROR when params is undefined', () => {
    const wrapped = createValidatedHandler(
      () => ({}),
      () => undefined,
    )

    expect(() => wrapped({} as never, undefined)).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR when params is a string', () => {
    const wrapped = createValidatedHandler(
      () => ({}),
      () => undefined,
    )

    expect(() => wrapped({} as never, 'not-an-object')).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR when params is an array', () => {
    const wrapped = createValidatedHandler(
      () => ({}),
      () => undefined,
    )

    expect(() => wrapped({} as never, [1, 2, 3])).toThrow(AppError)
    try {
      wrapped({} as never, [1, 2, 3])
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION_ERROR')
    }
  })

  it('should propagate errors from validate', () => {
    const wrapped = createValidatedHandler(
      () => {
        throw new AppError('CUSTOM_ERROR', 'validation failed')
      },
      () => undefined,
    )

    expect(() => wrapped({} as never, { x: 1 })).toThrow('validation failed')
  })

  it('should propagate synchronous errors from handler', () => {
    const wrapped = createValidatedHandler(
      (params) => ({ v: params['v'] as number }),
      () => {
        throw new Error('handler boom')
      },
    )

    expect(() => wrapped({} as never, { v: 1 })).toThrow('handler boom')
  })

  it('should propagate async errors from handler', async () => {
    const wrapped = createValidatedHandler(
      (params) => ({ v: params['v'] as number }),
      async () => {
        throw new Error('async handler boom')
      },
    )

    await expect(wrapped({} as never, { v: 1 })).rejects.toThrow('async handler boom')
  })
})

// ─── validateString ────────────────────────────────────────────

describe('validateString', () => {
  it('should return the string when valid', () => {
    expect(validateString('hello', 'name')).toBe('hello')
    expect(validateString('', 'name')).toBe('')
  })

  it('should throw VALIDATION_ERROR for non-string values', () => {
    expect(() => validateString(123, 'name')).toThrow(AppError)
    expect(() => validateString(null, 'name')).toThrow(AppError)
    expect(() => validateString(undefined, 'name')).toThrow(AppError)
    expect(() => validateString({}, 'name')).toThrow(AppError)
    expect(() => validateString(true, 'name')).toThrow(AppError)
  })

  it('should include field name in error message', () => {
    try {
      validateString(42, 'myField')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).message).toContain('myField')
    }
  })
})

// ─── validateEnum ──────────────────────────────────────────────

describe('validateEnum', () => {
  const ALLOWED = ['low', 'medium', 'high'] as const

  it('should return the value when it is in the allowed list', () => {
    expect(validateEnum('low', 'risk', ALLOWED)).toBe('low')
    expect(validateEnum('high', 'risk', ALLOWED)).toBe('high')
  })

  it('should throw VALIDATION_ERROR when value is not in the allowed list', () => {
    expect(() => validateEnum('extreme', 'risk', ALLOWED)).toThrow(AppError)
    expect(() => validateEnum('', 'risk', ALLOWED)).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR for non-string values', () => {
    expect(() => validateEnum(123, 'risk', ALLOWED)).toThrow(AppError)
    expect(() => validateEnum(null, 'risk', ALLOWED)).toThrow(AppError)
  })

  it('should include allowed values in error message', () => {
    try {
      validateEnum('extreme', 'risk', ALLOWED)
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const msg = (error as AppError).message
      expect(msg).toContain('low')
      expect(msg).toContain('medium')
      expect(msg).toContain('high')
    }
  })
})

// ─── validateOptionalNumber ────────────────────────────────────

describe('validateOptionalNumber', () => {
  it('should return undefined for undefined', () => {
    expect(validateOptionalNumber(undefined, 'temp')).toBeUndefined()
  })

  it('should return undefined for null', () => {
    expect(validateOptionalNumber(null, 'temp')).toBeUndefined()
  })

  it('should return the number when valid', () => {
    expect(validateOptionalNumber(42, 'temp')).toBe(42)
    expect(validateOptionalNumber(0, 'temp')).toBe(0)
    expect(validateOptionalNumber(-1.5, 'temp')).toBe(-1.5)
  })

  it('should respect min constraint', () => {
    expect(validateOptionalNumber(5, 'temp', 0)).toBe(5)
    expect(() => validateOptionalNumber(-1, 'temp', 0)).toThrow(AppError)
  })

  it('should respect max constraint', () => {
    expect(validateOptionalNumber(50, 'temp', undefined, 100)).toBe(50)
    expect(() => validateOptionalNumber(101, 'temp', undefined, 100)).toThrow(AppError)
  })

  it('should respect both min and max constraints', () => {
    expect(validateOptionalNumber(50, 'temp', 0, 100)).toBe(50)
    expect(() => validateOptionalNumber(-1, 'temp', 0, 100)).toThrow(AppError)
    expect(() => validateOptionalNumber(101, 'temp', 0, 100)).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR for non-number values', () => {
    expect(() => validateOptionalNumber('42', 'temp')).toThrow(AppError)
    expect(() => validateOptionalNumber({}, 'temp')).toThrow(AppError)
    expect(() => validateOptionalNumber(true, 'temp')).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR for NaN and Infinity', () => {
    expect(() => validateOptionalNumber(NaN, 'temp')).toThrow(AppError)
    expect(() => validateOptionalNumber(Infinity, 'temp')).toThrow(AppError)
    expect(() => validateOptionalNumber(-Infinity, 'temp')).toThrow(AppError)
  })
})

// ─── validateUrl ───────────────────────────────────────────────

describe('validateUrl', () => {
  const PROTOCOLS = ['https:', 'http:'] as const

  it('should return the trimmed URL when valid https', () => {
    expect(validateUrl('https://example.com', 'url', PROTOCOLS)).toBe('https://example.com')
  })

  it('should return the trimmed URL when valid http', () => {
    expect(validateUrl('http://localhost:3000', 'url', PROTOCOLS)).toBe(
      'http://localhost:3000',
    )
  })

  it('should trim whitespace around the URL', () => {
    expect(validateUrl('  https://example.com  ', 'url', PROTOCOLS)).toBe(
      'https://example.com',
    )
  })

  it('should throw VALIDATION_ERROR for non-string values', () => {
    expect(() => validateUrl(123, 'url', PROTOCOLS)).toThrow(AppError)
    expect(() => validateUrl(null, 'url', PROTOCOLS)).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR for empty string', () => {
    expect(() => validateUrl('', 'url', PROTOCOLS)).toThrow(AppError)
    expect(() => validateUrl('   ', 'url', PROTOCOLS)).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR for invalid URL format', () => {
    expect(() => validateUrl('not-a-url', 'url', PROTOCOLS)).toThrow(AppError)
  })

  it('should throw VALIDATION_ERROR for disallowed protocols', () => {
    expect(() => validateUrl('file:///etc/passwd', 'url', PROTOCOLS)).toThrow(AppError)
    expect(() => validateUrl('javascript:alert(1)', 'url', PROTOCOLS)).toThrow(AppError)
    expect(() => validateUrl('ftp://example.com', 'url', PROTOCOLS)).toThrow(AppError)
  })

  it('should allow only https when whitelist is restricted', () => {
    const HTTPS_ONLY = ['https:'] as const
    expect(validateUrl('https://secure.com', 'url', HTTPS_ONLY)).toBe('https://secure.com')
    expect(() => validateUrl('http://insecure.com', 'url', HTTPS_ONLY)).toThrow(AppError)
  })
})
