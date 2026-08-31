// AgentForge 视频尾帧抽取工具（M8 多镜头连续性）
// 使用 ffmpeg-static 提供的二进制抽取视频最后一帧为 JPEG，作为下一个镜头的图生视频首帧。
// exec 可注入以便在单元测试中校验参数、避免依赖真实 ffmpeg。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError, ErrorCodes } from './error'

const execFileAsync = promisify(execFile)

/**
 * 解析 ffmpeg 可执行文件路径。
 * 优先使用 ffmpeg-static 内嵌二进制；其次 FFMPEG_PATH 环境变量；最后回退到 PATH 中的 ffmpeg。
 */
export function resolveFfmpegPath(): string {
  let bundled: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('ffmpeg-static') as unknown
    bundled = typeof raw === 'string' ? raw : ''
  } catch {
    bundled = ''
  }
  return bundled || process.env.FFMPEG_PATH || 'ffmpeg'
}

/** 可注入的子进程执行函数（便于单测） */
export type FfmpegExecFn = (videoAbsPath: string, outputAbsPath: string) => Promise<void>

/** 默认执行：调用 ffmpeg 用 -sseof 定位末帧并截取为 JPEG */
const defaultExec: FfmpegExecFn = async (videoAbsPath, outputAbsPath) => {
  try {
    await execFileAsync(resolveFfmpegPath(), [
      '-sseof',
      '-0.1',
      '-i',
      videoAbsPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '-y',
      outputAbsPath,
    ])
  } catch (error) {
    throw new AppError(
      ErrorCodes.VIDEO_FRAME_EXTRACT_ERROR,
      `Failed to extract last frame: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 抽取视频最后一帧为 JPEG，返回输出文件绝对路径。
 *
 * @param videoAbsPath - 源视频绝对路径
 * @param outDir - 输出目录（不存在会自动创建）
 * @param index - 当前镜头序号（用于输出文件命名）
 * @param exec - 可注入执行函数（缺省用 ffmpeg）
 */
export async function extractLastFrame(
  videoAbsPath: string,
  outDir: string,
  index: number,
  exec: FfmpegExecFn = defaultExec,
): Promise<string> {
  await mkdir(outDir, { recursive: true })
  const outputAbsPath = join(outDir, `chain-${index}-${Date.now()}.jpg`)
  await exec(videoAbsPath, outputAbsPath)
  return outputAbsPath
}