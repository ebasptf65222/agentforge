import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Electron safeStorage before importing encryption module
const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
}))

// Import after mock is set up
const {
  isEncryptionAvailable,
  encryptApiKey,
  decryptApiKey,
  isEncryptedValueValid,
  resetEncryptedApiKey,
  getEncryptionStatus,
} = await import('./encryption')
const { AppError } = await import('./error')

describe('isEncryptionAvailable', () => {
  it('should return true when safeStorage is available', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    expect(isEncryptionAvailable()).toBe(true)
  })

  it('should return false when safeStorage is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(isEncryptionAvailable()).toBe(false)
  })
})

describe('encryptApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should encrypt a plain key and return base64 string', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    const encryptedBuffer = Buffer.from('encrypted-bytes')
    mockSafeStorage.encryptString.mockReturnValue(encryptedBuffer)

    const result = encryptApiKey('my-secret-key')

    expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('my-secret-key')
    expect(result).toBe(encryptedBuffer.toString('base64'))
  })

  it('should throw AppError with SAFE_STORAGE_UNAVAILABLE when safeStorage unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)

    try {
      encryptApiKey('my-secret-key')
      throw new Error('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as InstanceType<typeof AppError>).code).toBe('SAFE_STORAGE_UNAVAILABLE')
    }
  })
})

describe('decryptApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should decrypt a base64-encoded encrypted key', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    const encryptedBuffer = Buffer.from('encrypted-bytes')
    const base64Key = encryptedBuffer.toString('base64')
    mockSafeStorage.decryptString.mockReturnValue('my-secret-key')

    const result = decryptApiKey(base64Key)

    expect(mockSafeStorage.decryptString).toHaveBeenCalledWith(encryptedBuffer)
    expect(result).toBe('my-secret-key')
  })

  it('should throw AppError with SAFE_STORAGE_UNAVAILABLE when safeStorage unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)

    try {
      decryptApiKey('some-base64-key')
      throw new Error('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as InstanceType<typeof AppError>).code).toBe('SAFE_STORAGE_UNAVAILABLE')
    }
  })
})

describe('encrypt/decrypt round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be reversible with mocked safeStorage', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    // Simulate: encrypt returns a buffer, decrypt reverses it
    const plainKey = 'sk-test-12345'
    const fakeEncrypted = Buffer.from(`enc:${plainKey}`)
    mockSafeStorage.encryptString.mockReturnValue(fakeEncrypted)
    mockSafeStorage.decryptString.mockReturnValue(plainKey)

    const encrypted = encryptApiKey(plainKey)
    expect(encrypted).toBe(fakeEncrypted.toString('base64'))

    const decrypted = decryptApiKey(encrypted)
    expect(decrypted).toBe(plainKey)
  })
})

// ─── 密钥恢复机制测试 ──────────────────────────────────────────

describe('decryptApiKey DECRYPTION_FAILED', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw AppError with DECRYPTION_FAILED when safeStorage.decryptString throws', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('Decryption failed: invalid encrypted data')
    })

    try {
      decryptApiKey('aW52YWxpZC1kYXRh')
      throw new Error('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as InstanceType<typeof AppError>).code).toBe('DECRYPTION_FAILED')
      expect((error as InstanceType<typeof AppError>).message).toContain('decrypt')
    }
  })

  it('should still throw SAFE_STORAGE_UNAVAILABLE when safeStorage is not available', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)

    try {
      decryptApiKey('some-key')
      throw new Error('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as InstanceType<typeof AppError>).code).toBe('SAFE_STORAGE_UNAVAILABLE')
    }
  })
})

describe('isEncryptedValueValid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return true when decryption succeeds', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.decryptString.mockReturnValue('plain-key')

    expect(isEncryptedValueValid('valid-base64')).toBe(true)
    expect(mockSafeStorage.decryptString).toHaveBeenCalledTimes(1)
  })

  it('should return false when decryption throws', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('corrupted')
    })

    expect(isEncryptedValueValid('corrupted-base64')).toBe(false)
  })

  it('should return false when safeStorage is not available', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)

    expect(isEncryptedValueValid('some-key')).toBe(false)
    expect(mockSafeStorage.decryptString).not.toHaveBeenCalled()
  })
})

describe('resetEncryptedApiKey', () => {
  it('should return an empty string', () => {
    expect(resetEncryptedApiKey()).toBe('')
  })

  it('should always return empty string (idempotent)', () => {
    expect(resetEncryptedApiKey()).toBe('')
    expect(resetEncryptedApiKey()).toBe('')
  })
})

describe('getEncryptionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return available=true when safeStorage is available', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)

    const status = getEncryptionStatus()
    expect(status.available).toBe(true)
    expect(status.reason).toBeUndefined()
  })

  it('should return available=false with reason when safeStorage is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)

    const status = getEncryptionStatus()
    expect(status.available).toBe(false)
    expect(typeof status.reason).toBe('string')
    expect(status.reason!.length).toBeGreaterThan(0)
  })
})
