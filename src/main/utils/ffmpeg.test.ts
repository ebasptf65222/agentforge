// M8: ffmpeg 尾帧抽取工具单测
// 通过注入 exec 校验参数传递与输出路径，不依赖真实 ffmpeg 二进制。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractLastFrame, resolveFfmpegPath, type FfmpegExecFn } from './ffmpeg'

describe('ffmpeg frame extraction (M8)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-ffmpeg-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should resolve a non-empty ffmpeg binary path (bundled/FFMPEG_PATH/PATH fallback)', () => {
    expect(resolveFfmpegPath()).toBeTruthy()
  })

  it('should call the injected exec with source and output paths and return the frame path', async () => {
    const outDir = join(tempDir, 'frames')
    const sourcePath = join(tempDir, 'in.mp4')
    const exec: FfmpegExecFn = async (src, out) => {
      expect(src).toBe(sourcePath)
      expect(out).toMatch(/^.*chain-2-\d+\.jpg$/)
    }

    const framePath = await extractLastFrame(sourcePath, outDir, 2, exec)

    // 输出目录被自动创建
    expect(existsSync(outDir)).toBe(true)
    expect(framePath.startsWith(outDir)).toBe(true)
    expect(framePath).toMatch(/chain-2-\d+\.jpg$/)
  })

  it('should propagate errors from the injected exec', async () => {
    const failingExec: FfmpegExecFn = async () => {
      throw new Error('ffmpeg crashed')
    }
    await expect(
      extractLastFrame(join(tempDir, 'in.mp4'), join(tempDir, 'frames'), 0, failingExec),
    ).rejects.toThrow('ffmpeg crashed')
  })

  it('should create a distinct output path per index', async () => {
    const outDir = join(tempDir, 'frames')
    const seen = new Set<string>()
    const exec: FfmpegExecFn = async (_src, out) => {
      seen.add(out)
    }
    await extractLastFrame(join(tempDir, 'a.mp4'), outDir, 1, exec)
    await extractLastFrame(join(tempDir, 'b.mp4'), outDir, 2, exec)
    expect(seen.size).toBe(2)
  })
})