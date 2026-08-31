// AgentForge 视频尾帧抽取工具（M8 多镜头连续性）
// 使用 ffmpeg-static 提供的二进制抽取视频最后一帧为 JPEG，作为下一个镜头的图生视频首帧。
// exec 可注入以便在单元测试中校验参数、避免依赖真实 ffmpeg。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
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

// ─── M18：成片后处理（字幕/水印/拼接） ─────────────────────────

/** 可注入的通用 ffmpeg 命令执行函数（便于单测校验参数） */
export type FfmpegArgsExecFn = (args: string[]) => Promise<void>

/** 默认执行：按参数数组调用 ffmpeg */
const defaultArgsExec: FfmpegArgsExecFn = async (args) => {
  try {
    await execFileAsync(resolveFfmpegPath(), args)
  } catch (error) {
    throw new AppError(
      ErrorCodes.VIDEO_POSTPROCESS_ERROR,
      `ffmpeg failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** 水印位置 -> ffmpeg overlay 定位表达式 */
const WATERMARK_POSITIONS: Record<
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center',
  string
> = {
  'top-left': '10:10',
  'top-right': 'W-w-10:10',
  'bottom-left': '10:H-h-10',
  'bottom-right': 'W-w-10:H-h-10',
  center: '(W-w)/2:(H-h)/2',
}

/**
 * 把 SRT 字幕烧录进画面（新建输出文件，源文件保持不变）。
 *
 * @param videoAbsPath - 源视频绝对路径
 * @param outputAbsPath - 输出视频绝对路径
 * @param srtContent - SRT 字幕文本
 * @param exec - 可注入执行函数（缺省用 ffmpeg）
 */
export async function burnSubtitle(
  videoAbsPath: string,
  outputAbsPath: string,
  srtContent: string,
  exec: FfmpegArgsExecFn = defaultArgsExec,
): Promise<void> {
  await mkdir(join(outputAbsPath, '..'), { recursive: true })
  // 写入临时 SRT（UTF-8 BOM 保证 ass 滤镜正确识别中文）
  const srtPath = `${outputAbsPath}.srt`
  await writeFile(srtPath, `\uFEFF${srtContent.replace(/^\uFEFF/, '')}`, 'utf8')
  try {
    await exec([
      '-i',
      videoAbsPath,
      '-vf',
      `subtitles=${escapeFilterPath(srtPath)}`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '22',
      '-c:a',
      'copy',
      '-y',
      outputAbsPath,
    ])
  } finally {
    await unlink(srtPath).catch(() => undefined)
  }
}

/**
 * 在视频上叠加水印图片（新建输出文件）。
 *
 * @param videoAbsPath - 源视频绝对路径
 * @param imageAbsPath - 水印图片绝对路径
 * @param outputAbsPath - 输出视频绝对路径
 * @param position - 水印位置
 * @param exec - 可注入执行函数（缺省用 ffmpeg）
 */
export async function overlayWatermark(
  videoAbsPath: string,
  imageAbsPath: string,
  outputAbsPath: string,
  position: keyof typeof WATERMARK_POSITIONS,
  exec: FfmpegArgsExecFn = defaultArgsExec,
): Promise<void> {
  await mkdir(join(outputAbsPath, '..'), { recursive: true })
  await exec([
    '-i',
    videoAbsPath,
    '-i',
    imageAbsPath,
    '-filter_complex',
    `[1:v]scale=iw/6:-1[wm];[0:v][wm]overlay=${WATERMARK_POSITIONS[position]}[out]`,
    '-map',
    '[out]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '22',
    '-c:a',
    'copy',
    '-y',
    outputAbsPath,
  ])
}

/**
 * 顺序拼接多个视频片段（新建输出文件）。
 * 使用 concat demuxer（要求各片段编码一致；失败时回退到 concat 滤镜）。
 *
 * @param inputAbsPaths - 按顺序排列的输入视频绝对路径
 * @param outputAbsPath - 输出视频绝对路径
 * @param exec - 可注入执行函数（缺省用 ffmpeg）
 */
export async function concatVideos(
  inputAbsPaths: string[],
  outputAbsPath: string,
  exec: FfmpegArgsExecFn = defaultArgsExec,
): Promise<void> {
  if (inputAbsPaths.length < 2) {
    throw new AppError(
      ErrorCodes.VIDEO_POSTPROCESS_ERROR,
      'Concatenation requires at least 2 input videos.',
    )
  }
  await mkdir(join(outputAbsPath, '..'), { recursive: true })
  const listPath = `${outputAbsPath}.txt`
  const listContent = inputAbsPaths
    .map((p) => `file '${String(p).replace(/'/g, "'\\''")}'`)
    .join('\n')
  await writeFile(listPath, listContent, 'utf8')
  try {
    await exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      '-y',
      outputAbsPath,
    ])
  } catch (error) {
    // concat demuxer 因编码不一致失败时，回退到 concat 滤镜（重新编码）
    await exec([
      '-i',
      listPath,
      '-filter_complex',
      'concat=n=' + inputAbsPaths.length + ':v=1:a=0',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '22',
      '-y',
      outputAbsPath,
    ])
    throw error
  } finally {
    await unlink(listPath).catch(() => undefined)
  }
}

/** 转义 ffmpeg 滤镜中的路径特殊字符（冒号/反斜杠） */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}