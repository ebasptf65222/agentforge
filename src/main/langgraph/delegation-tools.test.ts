// LangGraph 委托工具单元测试
// 测试 ask_user / elicitation / skills / commands 委托工具的创建和执行

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAskUserTool } from './ask-user-tool'
import { createElicitationTool } from './elicitation-tool'
import { createSkillsTool } from './skills-tool'
import { createCommandsTool } from './commands-tool'
import { EventConverter } from './event-converter'
import { UserInputManager } from '../agent/user-input'
import type { DelegationToolContext } from './types'
import type { AgentEventCallbacks } from '../agent/types'

// ─── 测试辅助 ─────────────────────────────────────────────────

function createMockCallbacks(): AgentEventCallbacks {
  return {
    onTrajectory: vi.fn(),
    onApprovalRequest: vi.fn(),
    onStreamChunk: vi.fn(),
  }
}

function createDelegationCtx(callbacks: AgentEventCallbacks): DelegationToolContext {
  return {
    executionId: 'test-exec-123',
    callbacks,
    approvalTimeoutMs: 5000,
  }
}

// ─── ask_user 工具测试 ────────────────────────────────────────

describe('createAskUserTool', () => {
  let callbacks: AgentEventCallbacks
  let userInputManager: UserInputManager
  let ctx: DelegationToolContext

  beforeEach(() => {
    callbacks = createMockCallbacks()
    userInputManager = new UserInputManager()
    ctx = createDelegationCtx(callbacks)
  })

  afterEach(() => {
    userInputManager.cancel()
  })

  it('should create a valid WrappedTool', () => {
    const tool = createAskUserTool(ctx, userInputManager)
    expect(tool.name).toBe('copilot_ask_user')
    expect(tool.description).toContain('question')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.execute).toBeTypeOf('function')
  })

  it('should push ask-user chunk to frontend', async () => {
    const tool = createAskUserTool(ctx, userInputManager)

    // 在 execute 调用后模拟 IPC 响应
    const executePromise = tool.execute({ question: 'What is your name?' })

    // 等待一小段时间让 UserInputManager 创建等待器
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 验证 onStreamChunk 被调用，type 为 ask-user
    expect(callbacks.onStreamChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ask-user',
        content: expect.stringContaining('What is your name?'),
      }),
    )

    // 提取 requestId 并响应
    const call = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const request = JSON.parse(call.content)
    userInputManager.respondToUserInput(request.requestId, 'John Doe')

    const result = await executePromise
    expect(result).toBe('John Doe')
  })

  it('should return error message when no question provided', async () => {
    const tool = createAskUserTool(ctx, userInputManager)
    const result = await tool.execute({})
    expect(result).toContain('Error')
  })

  it('should return timeout message when no response received', async () => {
    const shortTimeoutCtx: DelegationToolContext = {
      ...ctx,
      approvalTimeoutMs: 100, // 100ms 超时
    }
    const tool = createAskUserTool(shortTimeoutCtx, userInputManager)
    const result = await tool.execute({ question: 'test?' })
    expect(result).toContain('timeout')
  })
})

// ─── elicitation 工具测试 ──────────────────────────────────────

describe('createElicitationTool', () => {
  let callbacks: AgentEventCallbacks
  let userInputManager: UserInputManager
  let ctx: DelegationToolContext

  beforeEach(() => {
    callbacks = createMockCallbacks()
    userInputManager = new UserInputManager()
    ctx = createDelegationCtx(callbacks)
  })

  afterEach(() => {
    userInputManager.cancel()
  })

  it('should create a valid WrappedTool', () => {
    const tool = createElicitationTool(ctx, userInputManager)
    expect(tool.name).toBe('copilot_elicitation')
    expect(tool.description).toContain('form')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.execute).toBeTypeOf('function')
  })

  it('should push elicitation-request chunk to frontend', async () => {
    const tool = createElicitationTool(ctx, userInputManager)

    const form = {
      name: { type: 'string', label: 'Your Name' },
      age: { type: 'number', label: 'Your Age' },
    }

    const executePromise = tool.execute({
      message: 'Please fill the form',
      form,
    })

    // 等待 UserInputManager 创建等待器
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 验证 onStreamChunk 被调用
    expect(callbacks.onStreamChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'elicitation-request',
        content: expect.stringContaining('Please fill the form'),
      }),
    )

    // 提取 requestId 并响应
    const call = (callbacks.onStreamChunk as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const request = JSON.parse(call.content)
    userInputManager.respondToElicitation(request.requestId, { name: 'Alice', age: 30 })

    const result = await executePromise
    expect(result).toContain('Alice')
    expect(result).toContain('30')
  })

  it('should return error message when no message provided', async () => {
    const tool = createElicitationTool(ctx, userInputManager)
    const result = await tool.execute({})
    expect(result).toContain('Error')
  })

  it('should return timeout message when no response received', async () => {
    const shortTimeoutCtx: DelegationToolContext = {
      ...ctx,
      approvalTimeoutMs: 100,
    }
    const tool = createElicitationTool(shortTimeoutCtx, userInputManager)
    const result = await tool.execute({ message: 'test', form: {} })
    expect(result).toContain('timeout')
  })
})

// ─── skills 工具测试 ───────────────────────────────────────────

describe('createSkillsTool', () => {
  let callbacks: AgentEventCallbacks
  let ctx: DelegationToolContext

  beforeEach(() => {
    callbacks = createMockCallbacks()
    ctx = createDelegationCtx(callbacks)
  })

  it('should create a valid WrappedTool', () => {
    const tool = createSkillsTool(ctx)
    expect(tool.name).toBe('copilot_skills')
    expect(tool.description).toContain('skill')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.execute).toBeTypeOf('function')
  })

  it('should return error when no task specified', async () => {
    const tool = createSkillsTool(ctx)
    const result = await tool.execute({})
    expect(result).toContain('Error')
  })
})

// ─── commands 工具测试 ────────────────────────────────────────

describe('createCommandsTool', () => {
  let callbacks: AgentEventCallbacks
  let ctx: DelegationToolContext

  beforeEach(() => {
    callbacks = createMockCallbacks()
    ctx = createDelegationCtx(callbacks)
  })

  it('should create a valid WrappedTool', () => {
    const tool = createCommandsTool(ctx)
    expect(tool.name).toBe('copilot_commands')
    expect(tool.description).toContain('command')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.execute).toBeTypeOf('function')
  })

  it('should accept optional commands list', () => {
    const commands = [{ name: 'test', description: 'test cmd' }]
    const tool = createCommandsTool(ctx, commands)
    expect(tool.name).toBe('copilot_commands')
  })

  it('should return error when no command specified', async () => {
    const tool = createCommandsTool(ctx)
    const result = await tool.execute({})
    expect(result).toContain('Error')
  })
})

// ─── EventConverter 委托方法测试 ───────────────────────────────

describe('EventConverter delegation methods', () => {
  it('should push ask-user event', () => {
    const callbacks = createMockCallbacks()
    const converter = new EventConverter(callbacks)

    converter.pushAskUser('{"requestId":"test","prompt":"hello"}')

    expect(callbacks.onStreamChunk).toHaveBeenCalledWith({
      type: 'ask-user',
      content: '{"requestId":"test","prompt":"hello"}',
    })
  })

  it('should push elicitation-request event', () => {
    const callbacks = createMockCallbacks()
    const converter = new EventConverter(callbacks)

    converter.pushElicitationRequest('{"requestId":"test","message":"fill form"}')

    expect(callbacks.onStreamChunk).toHaveBeenCalledWith({
      type: 'elicitation-request',
      content: '{"requestId":"test","message":"fill form"}',
    })
  })
})
