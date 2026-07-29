// AgentForge: 流式 chunk 微批次器
// 将高频 IPC 流式推送（每 token 一次）合并为低频批量推送（50ms 窗口），
// 减少 IPC 序列化开销和渲染进程响应式更新频率。
//
// 架构问题：LLM 流式输出每秒产生 50-100 个 chunk，每个 chunk 触发一次
// wc.send() + V8 结构化克隆 + Vue 响应式更新 + MarkdownRenderer 重新解析。
// 长回复时 streamingContent 字符串拼接导致 O(n²) 复杂度。
//
// 解决方案：在主进程端累积 chunk，每 50ms 批量发送一次合并后的文本。

/** 默认刷新间隔（毫秒） */
const DEFAULT_FLUSH_INTERVAL_MS = 50

/** 最大累积长度（防止极端情况下的内存膨胀） */
const MAX_BUFFER_LENGTH = 50_000

/**
 * 流式 chunk 微批次器。
 *
 * 使用：
 * ```typescript
 * const batcher = new StreamBatcher((combined) => {
 *   wc.send('chat:stream-chunk', { type: 'text', content: combined })
 * })
 *
 * for await (const chunk of stream) {
 *   batcher.push(chunk.content)
 * }
 * batcher.flush() // 确保最后一批被发送
 * ```
 */
export class StreamBatcher {
  private buffer = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly flushIntervalMs: number

  /**
   * @param onFlush - 每次刷新时调用的回调，接收累积的文本
   */
  constructor(
    private onFlush: (combined: string) => void,
    flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS,
  ) {
    this.flushIntervalMs = flushIntervalMs
  }

  /**
   * 推送一个 chunk 到缓冲区。
   * 如果定时器未启动，则启动定时器。
   */
  push(text: string): void {
    this.buffer += text

    // 超过最大长度时立即刷新
    if (this.buffer.length >= MAX_BUFFER_LENGTH) {
      this.flush()
      return
    }

    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), this.flushIntervalMs)
    }
  }

  /**
   * 立即刷新缓冲区，发送所有累积的文本。
   */
  flush(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (this.buffer.length > 0) {
      this.onFlush(this.buffer)
      this.buffer = ''
    }
  }

  /**
   * 销毁批次器，清理定时器。
   * 不会触发最后的 flush，调用者需在销毁前手动 flush。
   */
  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.buffer = ''
  }
}
