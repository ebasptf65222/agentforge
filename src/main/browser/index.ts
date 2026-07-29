// AgentForge P2-01: 浏览器自动化核心模块
// 使用 Electron 隐藏 BrowserWindow 实现无头浏览器
// 支持：导航、截图、提取文本、提取 DOM、点击元素、填写表单

import { BrowserWindow } from 'electron'
import type {
  BrowserPageInfo,
  BrowserElementInfo,
  BrowserScreenshotResult,
  BrowserScreenshotFormat,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 常量 ─────────────────────────────────────────────────────

/** 默认导航超时（毫秒） */
const DEFAULT_NAVIGATION_TIMEOUT = 30_000

/** 默认操作超时（毫秒） */
const DEFAULT_OPERATION_TIMEOUT = 10_000

/** 隐藏窗口默认宽度 */
const DEFAULT_WIDTH = 1280

/** 隐藏窗口默认高度 */
const DEFAULT_HEIGHT = 800

/** 文本截断长度 */
const MAX_TEXT_LENGTH = 10_000

/** DOM 提取最大元素数 */
const MAX_ELEMENTS = 100

/** 截图 JPEG 质量 */
const JPEG_QUALITY = 80

// ─── 浏览器会话管理 ───────────────────────────────────────────

/** 活跃的浏览器会话 */
interface BrowserSession {
  window: BrowserWindow
  createdAt: number
  lastActivity: number
}

/** 全局会话映射（单例，主进程生命周期内有效） */
const sessions = new Map<string, BrowserSession>()

/** 默认会话 ID */
const DEFAULT_SESSION_ID = 'default'

/**
 * 获取或创建浏览器会话。
 * 使用隐藏的 BrowserWindow 作为无头浏览器。
 *
 * @param sessionId - 会话 ID（默认 'default'）
 * @param width - 窗口宽度
 * @param height - 窗口高度
 * @returns 浏览器会话
 */
function getOrCreateSession(
  sessionId: string = DEFAULT_SESSION_ID,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT,
): BrowserSession {
  let session = sessions.get(sessionId)

  if (session && !session.window.isDestroyed()) {
    session.lastActivity = Date.now()
    return session
  }

  // 创建隐藏窗口
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // 不加载 preload，纯浏览页面
      preload: undefined,
    },
  })

  session = {
    window: win,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  sessions.set(sessionId, session)
  return session
}

/**
 * 关闭指定会话。
 *
 * @param sessionId - 会话 ID
 */
export function closeSession(sessionId: string = DEFAULT_SESSION_ID): void {
  const session = sessions.get(sessionId)
  if (session) {
    if (!session.window.isDestroyed()) {
      session.window.destroy()
    }
    sessions.delete(sessionId)
  }
}

/**
 * 关闭所有浏览器会话。
 * 在应用退出时调用。
 */
export function closeAllSessions(): void {
  for (const [id] of sessions) {
    closeSession(id)
  }
}

// ─── SSRF 防护（复用 web-scrape 的逻辑） ─────────────────────

/**
 * 校验 URL 的 hostname 是否为内网/回环地址。
 * 阻止访问 localhost、127.x、10.x、172.16-31.x、192.168.x 等。
 */
function assertNotPrivateNetwork(hostname: string, originalUrl: string): void {
  const cleaned = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname

  if (cleaned === '::1' || cleaned === '::' || cleaned === '0:0:0:0:0:0:0:1') {
    throw new AppError(
      ErrorCodes.TOOL_EXECUTION_ERROR,
      `URL points to a loopback address: ${originalUrl}`,
      { url: originalUrl, hostname },
    )
  }

  const v4MappedMatch = cleaned.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  const ipToCheck = v4MappedMatch ? v4MappedMatch[1] : cleaned

  const ipv4Parts = ipToCheck.split('.').map(Number)
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = ipv4Parts
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) {
      throw new AppError(
        ErrorCodes.TOOL_EXECUTION_ERROR,
        `URL points to a private/loopback address: ${originalUrl}`,
        { url: originalUrl, hostname },
      )
    }
  }

  const lowerHostname = cleaned.toLowerCase()
  if (lowerHostname === 'localhost' || lowerHostname.endsWith('.localhost')) {
    throw new AppError(
      ErrorCodes.TOOL_EXECUTION_ERROR,
      `URL points to a loopback address: ${originalUrl}`,
      { url: originalUrl, hostname },
    )
  }
}

/**
 * 校验 URL 有效性并执行 SSRF 检查。
 */
function validateUrl(url: string): URL {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'URL must be a non-empty string.', { url })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url.trim())
  } catch {
    throw new AppError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`, { url })
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new AppError(ErrorCodes.INVALID_URL, `URL must be http or https: ${url}`, {
      url,
      protocol: parsedUrl.protocol,
    })
  }

  assertNotPrivateNetwork(parsedUrl.hostname, parsedUrl.toString())
  return parsedUrl
}

// ─── 超时辅助 ─────────────────────────────────────────────────

/**
 * 创建带超时的 Promise。
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError(ErrorCodes.BROWSER_TIMEOUT, errorMessage, { timeout: timeoutMs }))
    }, timeoutMs)

    promise
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

// ─── 浏览器操作 ───────────────────────────────────────────────

/**
 * 导航到指定 URL。
 *
 * @param url - 目标 URL
 * @param options - 导航选项
 * @returns 页面信息
 */
export async function navigateToUrl(
  url: string,
  options: { sessionId?: string; timeout?: number; waitUntil?: 'load' | 'domcontentloaded' } = {},
): Promise<BrowserPageInfo> {
  const parsedUrl = validateUrl(url)
  const timeout = options.timeout ?? DEFAULT_NAVIGATION_TIMEOUT
  const waitUntil = options.waitUntil ?? 'load'
  const session = getOrCreateSession(options.sessionId)
  const wc = session.window.webContents

  const startTime = Date.now()

  try {
    await withTimeout(
      wc.loadURL(parsedUrl.toString()),
      timeout,
      `Navigation timed out after ${timeout}ms: ${parsedUrl.toString()}`,
    )

    // 等待页面加载完成
    if (waitUntil === 'load') {
      await withTimeout(
        new Promise<void>((resolve) => {
          if (wc.isLoading()) {
            wc.once('did-finish-load', () => resolve())
          } else {
            resolve()
          }
        }),
        timeout,
        `Page load wait timed out after ${timeout}ms`,
      )
    }

    const loadTime = Date.now() - startTime

    // 获取页面标题
    const title = await wc.executeJavaScript('document.title').catch(() => '') as string

    return {
      url: wc.getURL(),
      title: title || '',
      statusCode: 200, // Electron 不直接暴露 HTTP 状态码
      loadTime,
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.BROWSER_NAVIGATION_ERROR,
      `Navigation failed: ${error instanceof Error ? error.message : String(error)}`,
      { url: parsedUrl.toString(), timeout },
    )
  }
}

/**
 * 截取当前页面截图。
 *
 * @param options - 截图选项
 * @returns 截图结果
 */
export async function captureScreenshot(
  options: {
    sessionId?: string
    format?: BrowserScreenshotFormat
    fullPage?: boolean
    width?: number
    height?: number
  } = {},
): Promise<BrowserScreenshotResult> {
  const format = options.format ?? 'png'
  const fullPage = options.fullPage ?? false
  const session = getOrCreateSession(options.sessionId)

  // 调整窗口大小
  if (options.width && options.height) {
    session.window.setSize(options.width, options.height)
  }

  const wc = session.window.webContents

  try {
    let image: Electron.NativeImage

    if (fullPage) {
      // 全页面截图：先获取页面尺寸，再截取
      const dimensions = await wc.executeJavaScript(`
        JSON.stringify({
          width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
          height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        })
      `).catch(() => JSON.stringify({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })) as string

      const { width, height } = JSON.parse(dimensions) as { width: number; height: number }
      const maxSize = 16384 // Chrome 最大截图尺寸
      const clampedWidth = Math.min(width, maxSize)
      const clampedHeight = Math.min(height, maxSize)

      // 调整窗口大小以容纳完整页面
      session.window.setSize(clampedWidth, clampedHeight)

      // 等待重排
      await new Promise((resolve) => setTimeout(resolve, 500))

      image = await wc.capturePage()
    } else {
      image = await wc.capturePage()
    }

    // 转换为指定格式
    const base64 = format === 'jpeg'
      ? image.toJPEG(JPEG_QUALITY).toString('base64')
      : image.toPNG().toString('base64')

    const size = image.getSize()

    return {
      base64,
      format,
      width: size.width,
      height: size.height,
      fullPage,
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.BROWSER_SCREENSHOT_ERROR,
      `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
      { format, fullPage },
    )
  }
}

/**
 * 提取页面文本内容。
 *
 * @param options - 选项
 * @returns 页面文本
 */
export async function getPageText(
  options: { sessionId?: string; selector?: string; maxLength?: number } = {},
): Promise<string> {
  const session = getOrCreateSession(options.sessionId)
  const wc = session.window.webContents
  const maxLength = options.maxLength ?? MAX_TEXT_LENGTH
  const selector = options.selector ?? 'body'

  try {
    const text = await wc.executeJavaScript(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        return el.innerText || el.textContent || '';
      })()
    `)

    if (text === null) {
      throw new AppError(
        ErrorCodes.BROWSER_ELEMENT_NOT_FOUND,
        `Element not found for selector: ${selector}`,
        { selector },
      )
    }

    const truncated = text.length > maxLength
    const result = truncated ? text.slice(0, maxLength) + '\n... (truncated)' : text

    return result
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.BROWSER_OPERATION_ERROR,
      `Failed to get page text: ${error instanceof Error ? error.message : String(error)}`,
      { selector },
    )
  }
}

/**
 * 提取页面 DOM 结构。
 * 返回元素的序列化信息（不包含完整 HTML，只包含结构化信息）。
 *
 * @param options - 选项
 * @returns DOM 元素信息数组
 */
export async function getDomStructure(
  options: { sessionId?: string; selector?: string; maxElements?: number } = {},
): Promise<BrowserElementInfo[]> {
  const session = getOrCreateSession(options.sessionId)
  const wc = session.window.webContents
  const maxElements = options.maxElements ?? MAX_ELEMENTS
  const selector = options.selector ?? 'body'

  try {
    const rawElements = await wc.executeJavaScript(`
      (function() {
        const root = document.querySelector(${JSON.stringify(selector)});
        if (!root) return null;

        const elements = [];
        const allEls = root.querySelectorAll('*');
        const limit = Math.min(allEls.length, ${maxElements});

        for (let i = 0; i < limit; i++) {
          const el = allEls[i];
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          // 收集属性
          const attrs = {};
          for (const attr of el.attributes) {
            attrs[attr.name] = attr.value;
          }

          elements.push({
            tagName: el.tagName.toLowerCase(),
            id: el.id || '',
            className: el.className || '',
            text: (el.innerText || el.textContent || '').slice(0, 200),
            attributes: attrs,
            isVisible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            isClickable: style.cursor === 'pointer' || el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT',
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          });
        }
        return elements;
      })()
    `)

    if (rawElements === null) {
      throw new AppError(
        ErrorCodes.BROWSER_ELEMENT_NOT_FOUND,
        `Element not found for selector: ${selector}`,
        { selector },
      )
    }

    return rawElements as BrowserElementInfo[]
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.BROWSER_OPERATION_ERROR,
      `Failed to get DOM structure: ${error instanceof Error ? error.message : String(error)}`,
      { selector },
    )
  }
}

/**
 * 点击页面元素。
 *
 * @param selector - CSS 选择器
 * @param options - 选项
 * @returns 点击结果
 */
export async function clickElement(
  selector: string,
  options: { sessionId?: string; timeout?: number } = {},
): Promise<{ clicked: boolean; selector: string; text: string }> {
  if (typeof selector !== 'string' || selector.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Selector must be a non-empty string.', { selector })
  }

  const session = getOrCreateSession(options.sessionId)
  const wc = session.window.webContents

  try {
    const result = await wc.executeJavaScript(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;

        el.click();
        return {
          clicked: true,
          text: (el.innerText || el.textContent || '').slice(0, 200)
        };
      })()
    `)

    if (result === null) {
      throw new AppError(
        ErrorCodes.BROWSER_ELEMENT_NOT_FOUND,
        `Element not found for selector: ${selector}`,
        { selector },
      )
    }

    return { clicked: true, selector, text: result.text ?? '' }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.BROWSER_OPERATION_ERROR,
      `Click failed: ${error instanceof Error ? error.message : String(error)}`,
      { selector },
    )
  }
}

/**
 * 在输入框中填写内容。
 *
 * @param selector - CSS 选择器（目标 input/textarea）
 * @param value - 要填写的值
 * @param options - 选项
 * @returns 填写结果
 */
export async function fillInput(
  selector: string,
  value: string,
  options: { sessionId?: string; clearFirst?: boolean } = {},
): Promise<{ filled: boolean; selector: string; value: string }> {
  if (typeof selector !== 'string' || selector.trim() === '') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Selector must be a non-empty string.', { selector })
  }

  if (typeof value !== 'string') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Value must be a string.', { value })
  }

  const clearFirst = options.clearFirst ?? true
  const session = getOrCreateSession(options.sessionId)
  const wc = session.window.webContents

  try {
    const result = await wc.executeJavaScript(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;

        // 聚焦元素
        el.focus();

        // 清空已有内容
        ${clearFirst ? 'el.value = "";' : ''}

        // 设置新值
        el.value = ${JSON.stringify(value)};

        // 触发 input 和 change 事件以模拟用户输入
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return { filled: true };
      })()
    `)

    if (result === null) {
      throw new AppError(
        ErrorCodes.BROWSER_ELEMENT_NOT_FOUND,
        `Element not found for selector: ${selector}`,
        { selector },
      )
    }

    return { filled: true, selector, value }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.BROWSER_OPERATION_ERROR,
      `Fill failed: ${error instanceof Error ? error.message : String(error)}`,
      { selector, value },
    )
  }
}

/**
 * 获取当前页面 URL 和标题。
 *
 * @param sessionId - 会话 ID
 * @returns 页面信息
 */
export function getCurrentPageInfo(sessionId: string = DEFAULT_SESSION_ID): { url: string; title: string } {
  const session = sessions.get(sessionId)
  if (!session || session.window.isDestroyed()) {
    return { url: 'about:blank', title: '' }
  }
  const wc = session.window.webContents
  return {
    url: wc.getURL(),
    title: session.window.getTitle(),
  }
}
