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

/** 默认实现：基于原生 fetch */
export const fetchTransport: HttpRequestFn = async ({ url, method, headers, body }) => {
  const res = await fetch(url, {
    method,
    headers: { ...headers, Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const message =
      typeof data === 'object' && data !== null && 'error' in (data as Record<string, unknown>)
        ? String((data as Record<string, { message?: string }>).error?.message ?? '')
        : `HTTP ${res.status} ${res.statusText}`
    const err = new Error(message || `HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return { status: res.status, data }
}