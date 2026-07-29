import { describe, it, expect, vi } from 'vitest'
import {
  getToolRiskLevel,
  shouldRequireApproval,
  ApprovalWaiter,
  ApprovalManager,
  buildToolAction,
  DEFAULT_APPROVAL_TIMEOUT_MS,
} from './approval'
import type { ToolAction } from './types'

describe('getToolRiskLevel', () => {
  it('should return declared risk level if provided', () => {
    expect(getToolRiskLevel('custom_tool', 'low')).toBe('low')
    expect(getToolRiskLevel('custom_tool', 'medium')).toBe('medium')
    expect(getToolRiskLevel('custom_tool', 'high')).toBe('high')
  })

  it('should return low for known low-risk tools', () => {
    expect(getToolRiskLevel('web_search')).toBe('low')
    expect(getToolRiskLevel('web_scrape')).toBe('low')
    expect(getToolRiskLevel('file_read')).toBe('low')
    expect(getToolRiskLevel('directory_list')).toBe('low')
    expect(getToolRiskLevel('kb_search')).toBe('low')
  })

  it('should return medium for known medium-risk tools', () => {
    expect(getToolRiskLevel('file_write')).toBe('medium')
    expect(getToolRiskLevel('image_generate')).toBe('medium')
    expect(getToolRiskLevel('screenshot_ocr')).toBe('medium')
    expect(getToolRiskLevel('kb_index')).toBe('medium')
  })

  it('should default to high for unknown tools', () => {
    expect(getToolRiskLevel('unknown_tool')).toBe('high')
    expect(getToolRiskLevel('random_mcp_tool')).toBe('high')
  })
})

describe('shouldRequireApproval', () => {
  const lowAction: ToolAction = {
    toolName: 'web_search',
    arguments: {},
    riskLevel: 'low',
    requiresApproval: false,
  }
  const mediumAction: ToolAction = {
    toolName: 'file_write',
    arguments: {},
    riskLevel: 'medium',
    requiresApproval: false,
  }
  const highAction: ToolAction = {
    toolName: 'mcp_tool',
    arguments: {},
    riskLevel: 'high',
    requiresApproval: false,
  }

  it('should require approval for all tools in suggest mode', () => {
    expect(shouldRequireApproval(lowAction, 'suggest')).toBe(true)
    expect(shouldRequireApproval(mediumAction, 'suggest')).toBe(true)
    expect(shouldRequireApproval(highAction, 'suggest')).toBe(true)
  })

  it('should auto-approve low risk in auto-edit mode', () => {
    expect(shouldRequireApproval(lowAction, 'auto-edit')).toBe(false)
    expect(shouldRequireApproval(mediumAction, 'auto-edit')).toBe(true)
    expect(shouldRequireApproval(highAction, 'auto-edit')).toBe(true)
  })

  it('should auto-approve low and medium risk in full-auto mode', () => {
    expect(shouldRequireApproval(lowAction, 'full-auto')).toBe(false)
    expect(shouldRequireApproval(mediumAction, 'full-auto')).toBe(false)
    expect(shouldRequireApproval(highAction, 'full-auto')).toBe(true)
  })
})

describe('buildToolAction', () => {
  it('should build tool action with correct risk level', () => {
    const action = buildToolAction('web_search', { query: 'test' })
    expect(action.toolName).toBe('web_search')
    expect(action.arguments).toEqual({ query: 'test' })
    expect(action.riskLevel).toBe('low')
  })

  it('should use declared risk level when provided', () => {
    const action = buildToolAction('custom', {}, 'medium')
    expect(action.riskLevel).toBe('medium')
  })

  it('should default to high for unknown tools', () => {
    const action = buildToolAction('unknown_tool', {})
    expect(action.riskLevel).toBe('high')
  })
})

describe('ApprovalWaiter', () => {
  it('should resolve when responded with approved=true', async () => {
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', { query: 'test' }),
      reason: 'test',
    }
    const waiter = new ApprovalWaiter(request, DEFAULT_APPROVAL_TIMEOUT_MS)

    // Simulate user approval after a short delay
    setTimeout(() => waiter.respond(true, 'approved'), 10)

    const response = await waiter.waitForResponse()
    expect(response.approved).toBe(true)
    expect(response.reason).toBe('approved')
  })

  it('should resolve when responded with approved=false', async () => {
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('file_write', { path: '/test' }),
      reason: 'test',
    }
    const waiter = new ApprovalWaiter(request, DEFAULT_APPROVAL_TIMEOUT_MS)

    setTimeout(() => waiter.respond(false, 'rejected by user'), 10)

    const response = await waiter.waitForResponse()
    expect(response.approved).toBe(false)
    expect(response.reason).toBe('rejected by user')
  })

  it('should auto-reject on timeout', async () => {
    vi.useFakeTimers()

    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'test',
    }
    const waiter = new ApprovalWaiter(request, 5000)

    const responsePromise = waiter.waitForResponse()

    // Fast-forward time past timeout
    vi.advanceTimersByTime(60000)

    const response = await responsePromise
    expect(response.approved).toBe(false)
    expect(response.reason).toBe('TIMEOUT')

    vi.useRealTimers()
  })

  it('should resolve with CANCELLED when cancelled', async () => {
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'test',
    }
    const waiter = new ApprovalWaiter(request, DEFAULT_APPROVAL_TIMEOUT_MS)

    setTimeout(() => waiter.cancel(), 10)

    const response = await waiter.waitForResponse()
    expect(response.approved).toBe(false)
    expect(response.reason).toBe('CANCELLED')
  })

  it('should ignore subsequent responses after settled', async () => {
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'test',
    }
    const waiter = new ApprovalWaiter(request, DEFAULT_APPROVAL_TIMEOUT_MS)

    waiter.respond(true, 'first')
    waiter.respond(false, 'second') // should be ignored

    const response = await waiter.waitForResponse()
    expect(response.approved).toBe(true)
    expect(response.reason).toBe('first')
  })

  it('should return the associated request', () => {
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'test',
    }
    const waiter = new ApprovalWaiter(request, DEFAULT_APPROVAL_TIMEOUT_MS)
    expect(waiter.getRequest()).toBe(request)
  })
})

describe('ApprovalManager', () => {
  it('should request and receive approval', async () => {
    const manager = new ApprovalManager()
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'test',
    }
    const onReq = vi.fn()

    // Simulate user responding
    setTimeout(() => manager.respond(true, 'ok'), 10)

    const response = await manager.requestApproval(request, DEFAULT_APPROVAL_TIMEOUT_MS, onReq)

    expect(response.approved).toBe(true)
    expect(onReq).toHaveBeenCalledWith(request)
    expect(manager.hasPendingApproval()).toBe(false)
  })

  it('should cancel pending approval', () => {
    const manager = new ApprovalManager()
    const request = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'test',
    }

    // Start a request but don't resolve it
    const onReq = vi.fn()
    manager.requestApproval(request, DEFAULT_APPROVAL_TIMEOUT_MS, onReq)

    expect(manager.hasPendingApproval()).toBe(true)

    manager.cancel()

    expect(manager.hasPendingApproval()).toBe(false)
  })

  it('should cancel previous waiter when new request comes in', async () => {
    const manager = new ApprovalManager()
    const request1 = {
      executionId: 'exec-1',
      step: 1,
      toolAction: buildToolAction('web_search', {}),
      reason: 'first',
    }
    const request2 = {
      executionId: 'exec-1',
      step: 2,
      toolAction: buildToolAction('file_read', {}),
      reason: 'second',
    }
    const onReq = vi.fn()

    // Start first request
    const promise1 = manager.requestApproval(request1, DEFAULT_APPROVAL_TIMEOUT_MS, onReq)

    // Start second request (should cancel first)
    const promise2 = manager.requestApproval(request2, DEFAULT_APPROVAL_TIMEOUT_MS, onReq)

    // Respond to second
    setTimeout(() => manager.respond(true, 'ok'), 10)

    const [response1, response2] = await Promise.all([promise1, promise2])

    // First should be cancelled
    expect(response1.approved).toBe(false)
    expect(response1.reason).toBe('CANCELLED')

    // Second should be approved
    expect(response2.approved).toBe(true)
  })
})
