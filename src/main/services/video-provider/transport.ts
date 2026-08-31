// AgentForge 视频生成 HTTP 传输层
// 将全局 fetch 封装为注入点，便于单测时用 mock transport 替换真实网络请求。
// 策略：若显式传入 request 则用之，否则回退到 Node >= 20 的原生 fetch。

export interface HttpResponse {
  status: number
  data: unknown
}

/**
 * 可注入的 HTTP 请求函数。
 * 返回规范化响应；对非 2xx 应抛出错误（由调用方捕获并映射为 AppError）。
 */
export type HttpRequestFn = (input: {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
}) => Promise<HttpResponse>

/** 默认请求超时（毫秒）：防止厂商网关挂起连接导致轮询永久阻塞 */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000

/** 默认实现：基于原生 fetch */
export const fetchTransport: HttpRequestFn = async ({ url, method, headers, body }) => {
  const res = await fetch(url, {
    method,
    headers: { ...headers, Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
  })

  // 解析响应体（可能为空）
  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const fallback = `HTTP ${res.status} ${res.statusText}`
    const message = extractErrorMessage(data, fallback)
    const err = new Error(message || fallback) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return { status: res.status, data }
}

/**
 * 从错误响应体中提取可读信息。
 * 兼容 OpenAI 风格 error.message、顶层 message 字段以及字符串型 error
 * （如 Agnes 的 400 响应 `{"message": "size must be 720P"}`）。
 */
function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>
    if (typeof obj['error'] === 'string' && obj['error']) return obj['error']
    if (typeof obj['error'] === 'object' && obj['error'] !== null) {
      const msg = (obj['error'] as Record<string, unknown>)['message']
      if (typeof msg === 'string' && msg) return msg
    }
    if (typeof obj['message'] === 'string' && obj['message']) return obj['message']
  }
  return fallback
}