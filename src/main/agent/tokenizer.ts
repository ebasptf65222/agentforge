// AgentForge P2-02: Token 估算工具
// 与 Spec v0.2 §9.4 上下文管理一致：
// - 中文约 1.5 token/字
// - 英文约 0.25 token/word
// - 超过 maxContextLength 时截断最早对话轮次（保留 system prompt + 最近 5 轮）

import type { AgentContextMessage } from './types'

/**
 * 估算文本的 token 数量。
 * 使用近似公式：
 * - 中文字符：约 1.5 token/字
 * - 英文单词：约 0.25 token/word
 * - 标点/数字：约 0.5 token/字符
 *
 * @param text - 要估算的文本
 * @returns 估算的 token 数量
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0

  let tokens = 0
  // 英文单词
  const wordRegex = /[a-zA-Z]+/g
  // 数字
  const numberRegex = /[0-9]+/g

  let remaining = text

  // 统计中文字符
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g)
  if (chineseChars) {
    tokens += Math.ceil(chineseChars.length * 1.5)
    remaining = remaining.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, '')
  }

  // 统计英文单词
  const englishWords = remaining.match(wordRegex)
  if (englishWords) {
    tokens += Math.ceil(englishWords.length * 0.25)
    remaining = remaining.replace(wordRegex, '')
  }

  // 统计数字
  const numbers = remaining.match(numberRegex)
  if (numbers) {
    tokens += Math.ceil(numbers.length * 0.5)
    remaining = remaining.replace(numberRegex, '')
  }

  // 剩余字符（标点、空格等）按 0.3 token/字符估算
  const remainingChars = remaining.trim().length
  if (remainingChars > 0) {
    tokens += Math.ceil(remainingChars * 0.3)
  }

  return tokens
}

/**
 * 估算消息列表的总 token 数量。
 */
export function estimateContextTokens(messages: AgentContextMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
}

/** 最少保留的对话轮次数（system prompt + 最近 5 轮） */
export const MIN_KEEP_ROUNDS = 5

/**
 * 截断上下文消息，保留 system prompt 和最近 N 轮对话。
 * "一轮" = 一组 user + assistant(+tool) 消息。
 *
 * @param messages - 原始消息列表
 * @param maxTokens - 最大 token 数量
 * @returns 截断后的消息列表
 */
export function truncateContext(
  messages: AgentContextMessage[],
  maxTokens: number,
): AgentContextMessage[] {
  const totalTokens = estimateContextTokens(messages)

  // 未超限，直接返回
  if (totalTokens <= maxTokens) {
    return messages
  }

  // 分离 system 消息和对话消息
  const systemMessages: AgentContextMessage[] = []
  const conversationMessages: AgentContextMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg)
    } else {
      conversationMessages.push(msg)
    }
  }

  const systemTokens = estimateContextTokens(systemMessages)
  const availableTokens = maxTokens - systemTokens

  // 从后往前保留消息，直到用完可用 token
  const kept: AgentContextMessage[] = []
  let usedTokens = 0

  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(conversationMessages[i].content)
    if (usedTokens + msgTokens > availableTokens) {
      break
    }
    kept.unshift(conversationMessages[i])
    usedTokens += msgTokens

    // 至少保留最近 MIN_KEEP_ROUNDS*3 条消息（每轮约 3 条）
    if (kept.length >= MIN_KEEP_ROUNDS * 3 && usedTokens >= availableTokens * 0.8) {
      break
    }
  }

  // 确保至少保留最近的消息
  if (kept.length === 0 && conversationMessages.length > 0) {
    kept.push(conversationMessages[conversationMessages.length - 1])
  }

  return [...systemMessages, ...kept]
}
