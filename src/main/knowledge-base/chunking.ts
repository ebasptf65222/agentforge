// AgentForge P4-02: 文本分块策略
// 支持固定大小分块和段落分块两种策略

import { estimateTokens } from '../agent/tokenizer'

/** 分块结果 */
export interface Chunk {
  content: string
  tokenCount: number
  chunkIndex: number
}

/** 分块策略选项 */
export interface ChunkingOptions {
  /** 分块策略 */
  strategy: 'fixed' | 'paragraph'
  /** 目标分块大小（token 数），默认 500 */
  chunkSize?: number
  /** 分块重叠大小（token 数），默认 50 */
  overlap?: number
  /** 最大分块大小（硬限制），默认 chunkSize * 1.5 */
  maxChunkSize?: number
}

/** 默认分块配置 */
const DEFAULT_OPTIONS: Required<Omit<ChunkingOptions, 'strategy'>> = {
  chunkSize: 500,
  overlap: 50,
  maxChunkSize: 750,
}

/**
 * 将文本按固定大小分块。
 * - 按 chunkSize 切分文本
 * - 相邻分块之间有 overlap 重叠
 * - 不会切断单词（尽可能在空格/标点处切割）
 *
 * @param text - 原始文本
 * @param options - 分块选项
 * @returns 分块数组
 */
export function chunkByFixedSize(text: string, options: ChunkingOptions): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const chunks: Chunk[] = []

  if (!text || text.trim().length === 0) {
    return chunks
  }

  // 先按行分割，方便后续处理
  const lines = text.split('\n')
  let currentChunk = ''
  let currentTokens = 0
  let chunkIndex = 0

  for (const line of lines) {
    const lineText = line + '\n'
    const lineTokens = estimateTokens(lineText)

    // 如果单行就超过 maxChunkSize，直接作为一个分块
    if (lineTokens > opts.maxChunkSize) {
      // 先保存当前累积的内容
      if (currentChunk.trim().length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          tokenCount: currentTokens,
          chunkIndex: chunkIndex++,
        })
        currentChunk = ''
        currentTokens = 0
      }

      // 长行直接作为一个分块
      chunks.push({
        content: line.trim(),
        tokenCount: lineTokens,
        chunkIndex: chunkIndex++,
      })
      continue
    }

    // 如果加入当前行会超过 chunkSize，保存当前分块并开始新分块
    if (currentTokens + lineTokens > opts.chunkSize && currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        tokenCount: currentTokens,
        chunkIndex: chunkIndex++,
      })

      // 重叠：保留最后一部分内容到下一个分块
      if (opts.overlap > 0 && currentChunk.length > 0) {
        const overlapText = getOverlapText(currentChunk, opts.overlap)
        currentChunk = overlapText + lineText
        currentTokens = estimateTokens(currentChunk)
      } else {
        currentChunk = lineText
        currentTokens = lineTokens
      }
    } else {
      currentChunk += lineText
      currentTokens += lineTokens
    }
  }

  // 保存最后一个分块
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      tokenCount: currentTokens,
      chunkIndex: chunkIndex++,
    })
  }

  return chunks
}

/**
 * 将文本按段落分块。
 * - 以空行作为段落分隔符
 * - 每个段落作为一个分块（如果段落过大则进一步切分）
 * - 保留段落结构完整性
 *
 * @param text - 原始文本
 * @param options - 分块选项
 * @returns 分块数组
 */
export function chunkByParagraph(text: string, options: ChunkingOptions): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const chunks: Chunk[] = []

  if (!text || text.trim().length === 0) {
    return chunks
  }

  // 按空行分割段落
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    const paraTokens = estimateTokens(paragraph)

    // 如果段落大小合适，直接作为一个分块
    if (paraTokens <= opts.maxChunkSize) {
      chunks.push({
        content: paragraph,
        tokenCount: paraTokens,
        chunkIndex: chunkIndex++,
      })
      continue
    }

    // 段落过大，使用固定大小策略进一步切分
    const subChunks = chunkByFixedSize(paragraph, {
      strategy: 'fixed',
      chunkSize: opts.chunkSize,
      overlap: opts.overlap,
      maxChunkSize: opts.maxChunkSize,
    })

    for (const subChunk of subChunks) {
      chunks.push({
        content: subChunk.content,
        tokenCount: subChunk.tokenCount,
        chunkIndex: chunkIndex++,
      })
    }
  }

  return chunks
}

/**
 * 获取用于重叠的文本后缀。
 * 尽可能在句子边界或单词边界处切割。
 *
 * @param text - 原始文本
 * @param overlapTokens - 目标重叠 token 数
 * @returns 重叠文本
 */
function getOverlapText(text: string, overlapTokens: number): string {
  if (overlapTokens <= 0 || text.length === 0) return ''

  // 估算每个字符的 token 数（粗略估计）
  const avgTokensPerChar = estimateTokens(text) / text.length
  const targetChars = Math.ceil(overlapTokens / avgTokensPerChar)

  // 从后往前找合适的切割点（优先句子边界，其次单词边界）
  const startPos = Math.max(0, text.length - targetChars * 2)
  const searchText = text.slice(startPos)

  // 尝试在句子边界切割
  const sentenceMatches = [...searchText.matchAll(/[.!?。！？]\s+/g)]
  if (sentenceMatches.length > 0) {
    const lastMatch = sentenceMatches[sentenceMatches.length - 1]
    const candidate = searchText.slice(lastMatch.index! + lastMatch[0].length)
    if (estimateTokens(candidate) >= overlapTokens * 0.5) {
      return candidate
    }
  }

  // 尝试在换行处切割
  const lastNewline = searchText.lastIndexOf('\n')
  if (lastNewline > 0) {
    const candidate = searchText.slice(lastNewline + 1)
    if (estimateTokens(candidate) >= overlapTokens * 0.3) {
      return candidate
    }
  }

  // 回退：直接按字符数切割
  return text.slice(-targetChars)
}

/**
 * 分块入口函数。
 * 根据策略选择对应的分块算法。
 *
 * @param text - 原始文本
 * @param options - 分块选项
 * @returns 分块数组
 */
export function chunkText(text: string, options: ChunkingOptions): Chunk[] {
  switch (options.strategy) {
    case 'paragraph':
      return chunkByParagraph(text, options)
    case 'fixed':
    default:
      return chunkByFixedSize(text, options)
  }
}
