// AgentForge P4-03: 向量嵌入服务
// 支持 Ollama 和 OpenAI 兼容 API 生成文本嵌入

import { AppError, ErrorCodes } from '../utils/error'

/** 嵌入提供者配置 */
export interface EmbeddingConfig {
  /** 提供者类型 */
  provider: 'ollama' | 'openai'
  /** API 基础 URL */
  baseUrl: string
  /** API 密钥（OpenAI 必需，Ollama 可选） */
  apiKey?: string
  /** 模型名称 */
  model: string
  /** 向量维度（用于校验） */
  dimensions?: number
}

/** 嵌入结果 */
export interface EmbeddingResult {
  /** 原始文本 */
  text: string
  /** 嵌入向量 */
  embedding: number[]
}

/** 默认配置 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'nomic-embed-text',
  dimensions: 768,
}

/** 当前激活的嵌入配置 */
let activeConfig: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG }

/**
 * 校验嵌入向量维度是否与配置一致。
 *
 * @param embedding - 生成的嵌入向量
 * @param config - 嵌入配置（包含期望维度）
 * @throws {AppError} KB_EMBEDDING_ERROR - 维度不匹配
 */
function validateEmbeddingDimension(embedding: number[], config: EmbeddingConfig): void {
  if (config.dimensions !== undefined && embedding.length !== config.dimensions) {
    throw new AppError(
      ErrorCodes.KB_EMBEDDING_ERROR,
      `Embedding dimension mismatch: expected ${config.dimensions} dimensions ` +
        `(from config for model "${config.model}"), but got ${embedding.length}. ` +
        `This may indicate a model change. Please update the embedding config or rebuild the index.`,
      { expected: config.dimensions, actual: embedding.length, model: config.model },
    )
  }
}

/**
 * 设置全局嵌入配置。
 *
 * @param config - 嵌入配置
 */
export function setEmbeddingConfig(config: EmbeddingConfig): void {
  activeConfig = { ...config }
}

/**
 * 获取当前嵌入配置。
 *
 * @returns 当前配置
 */
export function getEmbeddingConfig(): EmbeddingConfig {
  return { ...activeConfig }
}

/**
 * 重置为默认配置。
 */
export function resetEmbeddingConfig(): void {
  activeConfig = { ...DEFAULT_EMBEDDING_CONFIG }
}

/**
 * 生成单条文本的嵌入向量。
 * 自动根据 provider 选择对应的 API 格式。
 *
 * @param text - 输入文本
 * @param config - 可选的自定义配置（覆盖全局配置）
 * @returns 嵌入向量
 * @throws {AppError} KB_EMBEDDING_ERROR - 生成失败
 */
export async function generateEmbedding(text: string, config?: EmbeddingConfig): Promise<number[]> {
  const cfg = config ?? activeConfig

  if (!text || text.trim().length === 0) {
    return []
  }

  try {
    let embedding: number[]
    switch (cfg.provider) {
      case 'ollama':
        embedding = await generateOllamaEmbedding(text, cfg)
        break
      case 'openai':
        embedding = await generateOpenAiEmbedding(text, cfg)
        break
      default:
        throw new AppError(
          ErrorCodes.KB_EMBEDDING_ERROR,
          `Unknown embedding provider "${cfg.provider}"`,
          { provider: cfg.provider },
        )
    }
    // Validate dimension if configured
    validateEmbeddingDimension(embedding, cfg)
    return embedding
  } catch (error) {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError(ErrorCodes.KB_EMBEDDING_ERROR, `Failed to generate embedding: ${message}`, {
      provider: cfg.provider,
      model: cfg.model,
      textLength: text.length,
    })
  }
}

/**
 * 批量生成嵌入向量。
 * - Ollama: 串行请求（Ollama Embedding API 不支持批量）
 * - OpenAI: 使用批量 API（最多 2048 条）
 *
 * @param texts - 文本数组
 * @param config - 可选的自定义配置
 * @returns 嵌入结果数组（与输入顺序一致）
 * @throws {AppError} KB_EMBEDDING_ERROR - 生成失败
 */
export async function generateEmbeddings(
  texts: string[],
  config?: EmbeddingConfig,
): Promise<EmbeddingResult[]> {
  const cfg = config ?? activeConfig

  if (texts.length === 0) {
    return []
  }

  // 过滤空文本
  const validTexts = texts
    .map((t, i) => ({ text: t, index: i }))
    .filter((item) => item.text && item.text.trim().length > 0)

  if (validTexts.length === 0) {
    return texts.map((text) => ({ text, embedding: [] }))
  }

  try {
    if (cfg.provider === 'openai') {
      return await generateOpenAiEmbeddingsBatch(texts, cfg)
    }

    // Ollama：串行生成（避免过载本地服务）
    const results: EmbeddingResult[] = texts.map((text) => ({ text, embedding: [] }))

    for (const item of validTexts) {
      const embedding = await generateOllamaEmbedding(item.text, cfg)
      // Validate dimension on first embedding
      validateEmbeddingDimension(embedding, cfg)
      results[item.index] = { text: item.text, embedding }
    }

    return results
  } catch (error) {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError(
      ErrorCodes.KB_EMBEDDING_ERROR,
      `Failed to generate embeddings batch: ${message}`,
      { provider: cfg.provider, model: cfg.model, count: texts.length },
    )
  }
}

// ─── Ollama 实现 ───────────────────────────────────────────────

interface OllamaEmbedResponse {
  embedding: number[]
}

async function generateOllamaEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
  const url = `${config.baseUrl}/api/embeddings`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        prompt: text,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(
        ErrorCodes.KB_EMBEDDING_ERROR,
        'Embedding API request timed out after 30s',
      )
    }
    throw error
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ollama API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as OllamaEmbedResponse

  if (!Array.isArray(data.embedding)) {
    throw new Error('Invalid Ollama response: embedding is not an array')
  }

  return data.embedding
}

// ─── OpenAI 兼容实现 ───────────────────────────────────────────

interface OpenAiEmbedResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
}

async function generateOpenAiEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
  const url = `${config.baseUrl}/embeddings`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input: text,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(
        ErrorCodes.KB_EMBEDDING_ERROR,
        'Embedding API request timed out after 30s',
      )
    }
    throw error
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as OpenAiEmbedResponse

  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid OpenAI response: missing embedding data')
  }

  return data.data[0].embedding
}

async function generateOpenAiEmbeddingsBatch(
  texts: string[],
  config: EmbeddingConfig,
): Promise<EmbeddingResult[]> {
  const url = `${config.baseUrl}/embeddings`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  // OpenAI 最多支持 2048 条，这里保守处理
  const BATCH_SIZE = 2048
  const results: EmbeddingResult[] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const validInputs = batch.map((t) => t || '')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          input: validInputs,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(
          ErrorCodes.KB_EMBEDDING_ERROR,
          'Embedding API request timed out after 30s',
        )
      }
      throw error
    }
    clearTimeout(timeoutId)

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${body}`)
    }

    const data = (await response.json()) as OpenAiEmbedResponse

    if (!Array.isArray(data.data)) {
      throw new Error('Invalid OpenAI response: data is not an array')
    }

    // 按 index 排序
    const sorted = data.data.sort((a, b) => a.index - b.index)

    for (let j = 0; j < batch.length; j++) {
      const item = sorted[j]
      results.push({
        text: batch[j],
        embedding: item?.embedding ?? [],
      })
    }
  }

  return results
}
