// P1-11: Toast utility unit tests
// Verifies that showToast() dispatches to the correct naive-ui message method
// for each of the 4 toast types, and passes through duration.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock naive-ui ─────────────────────────────────────────────
// showToast() is bound at module-load time to the `message` returned by
// createDiscreteApi, so we hoist the mock message API before vi.mock().

const mockMessage = vi.hoisted(() => {
  const api = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    create: vi.fn(),
    loading: vi.fn(),
    destroyAll: vi.fn(),
  }
  return api
})

vi.mock('naive-ui', () => ({
  createDiscreteApi: () => ({
    message: mockMessage,
  }),
}))

// ─── Import after mock ─────────────────────────────────────────

const { showToast, DEFAULT_DURATION } = await import('./toast')

// ─── Tests ─────────────────────────────────────────────────────

describe('showToast (P1-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call messageApi.success for type "success"', () => {
    showToast('saved', 'success')
    expect(mockMessage.success).toHaveBeenCalledTimes(1)
    expect(mockMessage.success).toHaveBeenCalledWith('saved', { duration: DEFAULT_DURATION })
    expect(mockMessage.error).not.toHaveBeenCalled()
    expect(mockMessage.warning).not.toHaveBeenCalled()
    expect(mockMessage.info).not.toHaveBeenCalled()
  })

  it('should call messageApi.error for type "error"', () => {
    showToast('boom', 'error')
    expect(mockMessage.error).toHaveBeenCalledTimes(1)
    expect(mockMessage.error).toHaveBeenCalledWith('boom', { duration: DEFAULT_DURATION })
    expect(mockMessage.success).not.toHaveBeenCalled()
  })

  it('should call messageApi.warning for type "warning"', () => {
    showToast('careful', 'warning')
    expect(mockMessage.warning).toHaveBeenCalledTimes(1)
    expect(mockMessage.warning).toHaveBeenCalledWith('careful', { duration: DEFAULT_DURATION })
  })

  it('should call messageApi.info for type "info"', () => {
    showToast('hi', 'info')
    expect(mockMessage.info).toHaveBeenCalledTimes(1)
    expect(mockMessage.info).toHaveBeenCalledWith('hi', { duration: DEFAULT_DURATION })
  })

  it('should default to info when type is omitted', () => {
    showToast('hello')
    expect(mockMessage.info).toHaveBeenCalledTimes(1)
    expect(mockMessage.info).toHaveBeenCalledWith('hello', { duration: DEFAULT_DURATION })
  })

  it('should pass through a custom duration', () => {
    showToast('custom', 'success', 5000)
    expect(mockMessage.success).toHaveBeenCalledWith('custom', { duration: 5000 })
  })

  it('should not call other message API methods for a given type', () => {
    showToast('only-one', 'warning', 1000)
    expect(mockMessage.warning).toHaveBeenCalledTimes(1)
    expect(mockMessage.success).not.toHaveBeenCalled()
    expect(mockMessage.error).not.toHaveBeenCalled()
    expect(mockMessage.info).not.toHaveBeenCalled()
  })
})
