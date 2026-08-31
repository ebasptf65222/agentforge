// AgentForge: 上下文窗口管理策略
// 当对话历史超出模型上下文窗口时，自动截断旧消息，
// 保留系统提示词和最近的对话轮次。
//
// 使用场景：
// - 内置 ReAct 引擎：在 executor.ts 的 ReAct 循环中截断上下文
// - Copilot SDK 引擎：在 IPC handler 中加载历史消息后截断
// - 通用对话：提供 manageContext() 供任何需要上下文管理的模块使用

import type { ChatMessage } from '@shared/types'
import type { AgentContextMessage } from './types'
import { estimateTokens, MIN_KEEP_ROUNDS } from './tokenizer'

// ─── 常量 ────────────────────────────────────────────────────────

/** 默认上下文窗口大小（tokens） */
const DEFAULT_CONTEXT_WINDOW = 128_000

/** 工具定义预留 token 数 */
const TOOL_DEFS_RESERVE = 2_000

/** 输出预留 token 数（为模型回复预留空间） */
const OUTPUT_RESERVE = 4_000

/** 最少保留的最近消息数 */
const MIN_RECENT_MESSAGES = MIN_KEEP_ROUNDS * 2 // 与 tokenizer.ts 保持一致（约 10 条）

/** 截断提示词（当截断时插入到上下文开头） */
const TRUNCATION_NOTICE =
  '[... 早期对话已自动截断以节省上下文空间 ...]'

// ─── 导出类型 ────────────────────────────────────────────────────

export interface ContextManagementConfig {
  /** 模型最大上下文窗口（tokens） */
  maxContextTokens: number
  /** 系统提示词 token 预留 */
  systemPromptReserve?: number
  /** 工具定义 token 预留 */
  toolDefsReserve?: number
  /** 输出 token 预留 */
  outputReserve?: number
  /** 最少保留的最近消息数 */
  minRecentMessages?: number
}

export interface ContextManagementResult {
  /** 截断后的消息列表 */
  messages: AgentContextMessage[]
  /** 是否发生了截断 */
  truncated: boolean
  /** 截断前的消息数 */
  originalCount: number
  /** 截断后的消息数 */
  retainedCount: number
  /** 估算的总 token 数 */
  estimatedTokens: number
}

// ─── 核心函数 ────────────────────────────────────────────────────

/**
 * 管理对话上下文，在超出模型上下文窗口时截断旧消息。
 *
 * 策略：
 * 1. 计算预留 token（系统提示词 + 工具定义 + 输出）
 * 2. 分离系统消息和对话消息
 * 3. 从最新对话消息向前累加，直到达到 token 预算
 * 4. 确保至少保留 minRecentMessages 条对话消息
 * 5. 如果发生截断，在系统消息后插入截断提示
 *
 * @param messages - 原始消息列表（按时间顺序，旧→新）
 * @param config - 上下文管理配置
 * @returns 截断后的消息列表和元信息
 */
export function manageContext(
  messages: AgentContextMessage[],
  config: ContextManagementConfig,
): ContextManagementResult {
  const maxTokens = config.maxContextTokens || DEFAULT_CONTEXT_WINDOW
  const toolReserve = config.toolDefsReserve ?? TOOL_DEFS_RESERVE
  const outputReserve = config.outputReserve ?? OUTPUT_RESERVE
  const minRecent = config.minRecentMessages ?? MIN_RECENT_MESSAGES

  const originalCount = messages.length

  // 空消息直接返回
  if (messages.length === 0) {
    return {
      messages: [],
      truncated: false,
      originalCount: 0,
      retainedCount: 0,
      estimatedTokens: 0,
    }
  }

  // 分离系统消息和对话消息
  const systemMessages: AgentContextMessage[] = []
  const conversationMessages: AgentContextMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg)
    } else {
      conversationMessages.push(msg)
    }
  }

  // 计算 system 消息的 token 占用
  const systemTokens = systemMessages.reduce(
    (sum, msg) => sum + estimateTokens(msg.content),
    0,
  )

  // 可用 token 预算（总窗口 - 系统提示词实际占用 - 工具定义预留 - 输出预留）
  const budget = maxTokens - systemTokens - toolReserve - outputReserve

  if (budget <= 0) {
    // 预算为负，只返回系统消息 + 截断提示 + 最近的几条对话消息
    const recent = conversationMessages.slice(-minRecent)
    const result: AgentContextMessage[] = [...systemMessages]
    const wasTruncated = conversationMessages.length > recent.length
    if (wasTruncated) {
      result.push({ role: 'system', content: TRUNCATION_NOTICE })
    }
    result.push(...recent)
    return {
      messages: result,
      truncated: wasTruncated,
      originalCount,
      retainedCount: result.length,
      estimatedTokens: estimateMessageListTokens(result),
    }
  }

  // 从最新消息向前累加
  const retained: AgentContextMessage[] = []
  let usedTokens = 0
  let truncated = false

  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const msg = conversationMessages[i]
    const msgTokens = estimateTokens(msg.content)

    if (usedTokens + msgTokens > budget && retained.length >= minRecent) {
      // 超出预算且已达到最少保留数 → 停止添加
      truncated = true
      break
    }

    retained.unshift(msg)
    usedTokens += msgTokens
  }

  // 组合最终结果：系统消息 + 截断提示（如果需要） + 保留的对话消息
  const result: AgentContextMessage[] = [...systemMessages]

  if (truncated) {
    result.push({
      role: 'system',
      content: TRUNCATION_NOTICE,
    })
    usedTokens += estimateTokens(TRUNCATION_NOTICE)
  }

  result.push(...retained)

  return {
    messages: result,
    truncated,
    originalCount,
    retainedCount: result.length,
    estimatedTokens: usedTokens + systemTokens,
  }
}

/**
 * 将 ChatMessage[]（数据库层）转换为 AgentContextMessage[]（agent 层）。
 * 用于在 IPC handler 中将数据库消息传入上下文管理器。
 *
 * @param messages - 数据库中的消息列表
 * @returns agent 层的消息列表
 */
export function chatMessagesToContext(
  messages: ChatMessage[],
): AgentContextMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }))
}

/**
 * 估算消息列表的总 token 数。
 */
function estimateMessageListTokens(
  messages: AgentContextMessage[],
): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
}

/**
 * 根据模型 ID 获取上下文窗口大小。
 * 常见模型的上下文窗口映射表。
 *
 * 优先使用 ModelConfig.maxContextLength（数据库中的配置），
 * 此函数作为没有数据库配置时的后备方案。
 *
 * @param modelId - 模型标识符（如 'gpt-4o', 'claude-3.5-sonnet' 等）
 * @returns 上下文窗口大小（tokens）
 */
export function getContextWindowSize(modelId: string): number {
  const id = (modelId || '').toLowerCase()

  // GPT-4o 系列
  if (id.includes('gpt-4o')) return 128_000
  if (id.includes('gpt-4-turbo')) return 128_000
  if (id.includes('gpt-4')) return 8_192

  // o 系列（推理模型）
  if (id.includes('o1-mini')) return 128_000
  if (id.includes('o1-preview')) return 128_000
  if (id.includes('o3-mini')) return 200_000
  if (id.startsWith('o1') || id.startsWith('o3')) return 200_000

  // GPT-3.5
  if (id.includes('gpt-3.5')) return 16_385

  // Claude 3.5 系列
  if (id.includes('claude-3.5-sonnet')) return 200_000
  if (id.includes('claude-3-5-sonnet')) return 200_000

  // Claude 3 系列
  if (id.includes('claude-3-opus')) return 200_000
  if (id.includes('claude-3-haiku')) return 200_000

  // Claude 4 系列
  if (id.includes('claude-4')) return 200_000

  // Claude 通用匹配
  if (id.includes('claude')) return 200_000

  // DeepSeek
  if (id.includes('deepseek-r1')) return 64_000
  if (id.includes('deepseek')) return 64_000

  // Qwen（通义千问）
  if (id.includes('qwen-max')) return 32_000
  if (id.includes('qwen-plus')) return 128_000
  if (id.includes('qwen-turbo')) return 128_000
  if (id.includes('qwen')) return 32_000

  // GLM（智谱）
  if (id.includes('glm-4')) return 128_000
  if (id.includes('glm')) return 32_000

  // Llama
  if (id.includes('llama-3.1')) return 128_000
  if (id.includes('llama-3')) return 8_192
  if (id.includes('llama')) return 4_096

  // Mistral
  if (id.includes('mistral-large')) return 128_000
  if (id.includes('mistral')) return 32_000

  // 默认
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * 获取模型上下文窗口大小。
 * 优先使用数据库配置的 maxContextLength，否则使用模型 ID 推断。
 *
 * @param modelId - 模型配置 ID
 * @returns 上下文窗口大小（tokens）
 */
export function getModelContextWindow(modelId: string): number {
  // 尝试从模型配置仓库获取（延迟导入避免循环依赖）
  try {
    // 使用动态 require 策略避免循环依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelConfigById } = require('../db/repos/model-config')
    const modelConfig = getModelConfigById(modelId)
    if (modelConfig) {
      return modelConfig.capabilities.maxContextLength
    }
  } catch {
    // 模型配置不存在或仓库不可用，回退到推断
  }

  return getContextWindowSize(modelId)
}
