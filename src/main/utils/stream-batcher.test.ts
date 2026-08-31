import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StreamBatcher } from './stream-batcher'

describe('StreamBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应在 push 后启动定时器', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    batcher.push('hello')

    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('hello')

    batcher.destroy()
  })

  it('应累积多个 push 到一个批次', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    batcher.push('hello')
    batcher.push(' ')
    batcher.push('world')

    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('hello world')

    batcher.destroy()
  })

  it('flush 应立即发送缓冲区内容', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    batcher.push('data1')
    batcher.push('data2')
    batcher.flush()

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('data1data2')

    batcher.destroy()
  })

  it('空缓冲区 flush 不应调用回调', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    batcher.flush()
    expect(onFlush).not.toHaveBeenCalled()

    batcher.destroy()
  })

  it('destroy 应清理定时器和缓冲区', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    batcher.push('data')
    batcher.destroy()

    vi.advanceTimersByTime(100)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('超过 MAX_BUFFER_LENGTH 时应立即 flush', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    // 推送大量数据（超过 50000 字符）
    const largeText = 'x'.repeat(51_000)
    batcher.push(largeText)

    // 应立即触发 flush，无需等待定时器
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(largeText)

    batcher.destroy()
  })

  it('多次刷新周期应分别发送', () => {
    const onFlush = vi.fn()
    const batcher = new StreamBatcher(onFlush, 50)

    batcher.push('batch1')
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(1)

    batcher.push('batch2')
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(2)

    batcher.destroy()
  })
})
