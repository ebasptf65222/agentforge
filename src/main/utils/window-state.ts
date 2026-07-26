import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 窗口边界状态。
 * 与 Spec v0.2 §5 AppSettings.windowBounds 类型保持一致。
 * P1-03 完成后将迁移到 SQLite app_settings 表。
 */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

/** 默认窗口尺寸（与 Spec v0.2 §2 一致：1200x800） */
export const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800,
  isMaximized: false,
}

/**
 * 从 JSON 文件加载窗口状态。
 *
 * @param filePath - JSON 文件路径
 * @returns 窗口状态；文件不存在或格式无效时返回 null
 */
export function loadWindowState(filePath: string): WindowBounds | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const data = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(data) as Partial<WindowBounds>

    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return null
    }

    return {
      x: typeof parsed.x === 'number' ? parsed.x : 0,
      y: typeof parsed.y === 'number' ? parsed.y : 0,
      width: parsed.width,
      height: parsed.height,
      isMaximized: typeof parsed.isMaximized === 'boolean' ? parsed.isMaximized : false,
    }
  } catch {
    return null
  }
}

/**
 * 保存窗口状态到 JSON 文件（同步写入）。
 *
 * @param filePath - JSON 文件路径
 * @param bounds - 窗口状态
 */
export function saveWindowState(filePath: string, bounds: WindowBounds): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, JSON.stringify(bounds, null, 2), 'utf-8')
}

/**
 * 创建防抖保存函数。
 * 在连续调用时只保留最后一次，延迟后执行写入。
 *
 * @param filePath - JSON 文件路径
 * @param delay - 防抖延迟（毫秒），默认 500（与 Spec v0.2 §2 一致）
 * @returns 防抖保存函数
 */
export function createDebouncedSaver(
  filePath: string,
  delay = 500,
): (bounds: WindowBounds) => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  return (bounds: WindowBounds): void => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      saveWindowState(filePath, bounds)
      timer = null
    }, delay)
  }
}
