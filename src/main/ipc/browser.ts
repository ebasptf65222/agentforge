// AgentForge P2-01: Browser IPC Handlers
// 通道命名: browser:navigate, browser:screenshot, browser:get-text,
//           browser:get-dom, browser:click, browser:fill, browser:close,
//           browser:get-page-info

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type {
  BrowserPageInfo,
  BrowserScreenshotResult,
  BrowserScreenshotFormat,
  BrowserElementInfo,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import {
  navigateToUrl,
  captureScreenshot,
  getPageText,
  getDomStructure,
  clickElement,
  fillInput,
  closeSession,
  closeAllSessions,
  getCurrentPageInfo,
} from '../browser'

// ─── 参数校验辅助函数 ─────────────────────────────────────────────

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string.`,
      { field, value },
    )
  }
}

function getOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value
  }
  if (value !== undefined) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Field "${field}" must be a non-empty string if provided.`,
      { field, value },
    )
  }
  return undefined
}

// ─── IPC Handlers ────────────────────────────────────────────────

/**
 * 导航到指定 URL。
 * 参数: { url, timeout?, waitUntil?, sessionId? }
 */
async function handleNavigate(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<BrowserPageInfo> {
  assertNonEmptyString(params['url'], 'url')

  const options: Parameters<typeof navigateToUrl>[1] = {}

  if (params['timeout'] !== undefined) {
    const timeout = Number(params['timeout'])
    if (Number.isNaN(timeout) || timeout < 1000 || timeout > 60000) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'timeout must be between 1000 and 60000.',
        { timeout: params['timeout'] },
      )
    }
    options.timeout = Math.floor(timeout)
  }

  if (typeof params['waitUntil'] === 'string') {
    if (params['waitUntil'] !== 'load' && params['waitUntil'] !== 'domcontentloaded') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'waitUntil must be "load" or "domcontentloaded".',
        { waitUntil: params['waitUntil'] },
      )
    }
    options.waitUntil = params['waitUntil']
  }

  const sessionId = getOptionalString(params['sessionId'], 'sessionId')
  if (sessionId) options.sessionId = sessionId

  return await navigateToUrl(params['url'], options)
}

/**
 * 截取当前页面截图。
 * 参数: { format?, fullPage?, width?, height?, sessionId? }
 */
async function handleScreenshot(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<BrowserScreenshotResult> {
  const options: Parameters<typeof captureScreenshot>[0] = {}

  if (params['format'] !== undefined) {
    if (params['format'] !== 'png' && params['format'] !== 'jpeg') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'format must be "png" or "jpeg".',
        { format: params['format'] },
      )
    }
    options.format = params['format'] as BrowserScreenshotFormat
  }

  if (params['fullPage'] === true) options.fullPage = true

  if (params['width'] !== undefined) {
    const width = Number(params['width'])
    if (Number.isNaN(width) || width < 320 || width > 3840) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'width must be between 320 and 3840.',
        { width: params['width'] },
      )
    }
    options.width = Math.floor(width)
  }

  if (params['height'] !== undefined) {
    const height = Number(params['height'])
    if (Number.isNaN(height) || height < 240 || height > 2160) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'height must be between 240 and 2160.',
        { height: params['height'] },
      )
    }
    options.height = Math.floor(height)
  }

  const sessionId = getOptionalString(params['sessionId'], 'sessionId')
  if (sessionId) options.sessionId = sessionId

  return await captureScreenshot(options)
}

/**
 * 提取页面文本内容。
 * 参数: { selector?, maxLength?, sessionId? }
 */
async function handleGetText(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ text: string; url: string; title: string; selector: string; length: number }> {
  const options: Parameters<typeof getPageText>[0] = {}

  const selector = getOptionalString(params['selector'], 'selector')
  if (selector) options.selector = selector

  if (params['maxLength'] !== undefined) {
    const maxLength = Number(params['maxLength'])
    if (Number.isNaN(maxLength) || maxLength < 100 || maxLength > 100000) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'maxLength must be between 100 and 100000.',
        { maxLength: params['maxLength'] },
      )
    }
    options.maxLength = Math.floor(maxLength)
  }

  const sessionId = getOptionalString(params['sessionId'], 'sessionId')
  if (sessionId) options.sessionId = sessionId

  const text = await getPageText(options)
  const pageInfo = getCurrentPageInfo(sessionId)

  return {
    text,
    url: pageInfo.url,
    title: pageInfo.title,
    selector: options.selector ?? 'body',
    length: text.length,
  }
}

/**
 * 提取页面 DOM 结构。
 * 参数: { selector?, maxElements?, sessionId? }
 */
async function handleGetDom(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ elements: BrowserElementInfo[]; url: string; selector: string; count: number }> {
  const options: Parameters<typeof getDomStructure>[0] = {}

  const selector = getOptionalString(params['selector'], 'selector')
  if (selector) options.selector = selector

  if (params['maxElements'] !== undefined) {
    const maxElements = Number(params['maxElements'])
    if (Number.isNaN(maxElements) || maxElements < 1 || maxElements > 500) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'maxElements must be between 1 and 500.',
        { maxElements: params['maxElements'] },
      )
    }
    options.maxElements = Math.floor(maxElements)
  }

  const sessionId = getOptionalString(params['sessionId'], 'sessionId')
  if (sessionId) options.sessionId = sessionId

  const elements = await getDomStructure(options)
  const pageInfo = getCurrentPageInfo(sessionId)

  return {
    elements,
    url: pageInfo.url,
    selector: options.selector ?? 'body',
    count: elements.length,
  }
}

/**
 * 点击页面元素。
 * 参数: { selector, sessionId? }
 */
async function handleClick(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ clicked: boolean; selector: string; text: string }> {
  assertNonEmptyString(params['selector'], 'selector')

  const options: Parameters<typeof clickElement>[1] = {}
  const sessionId = getOptionalString(params['sessionId'], 'sessionId')
  if (sessionId) options.sessionId = sessionId

  return await clickElement(params['selector'], options)
}

/**
 * 在输入框中填写内容。
 * 参数: { selector, value, clearFirst?, sessionId? }
 */
async function handleFill(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ filled: boolean; selector: string; value: string }> {
  assertNonEmptyString(params['selector'], 'selector')

  if (typeof params['value'] !== 'string') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Field "value" must be a string.',
      { value: params['value'] },
    )
  }

  const options: Parameters<typeof fillInput>[2] = {}
  if (params['clearFirst'] === false) options.clearFirst = false

  const sessionId = getOptionalString(params['sessionId'], 'sessionId')
  if (sessionId) options.sessionId = sessionId

  return await fillInput(params['selector'], params['value'], options)
}

/**
 * 关闭浏览器会话。
 * 参数: { sessionId? }
 */
async function handleClose(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ closed: boolean; sessionId: string }> {
  const sessionId = getOptionalString(params['sessionId'], 'sessionId') ?? 'default'
  closeSession(sessionId)
  return { closed: true, sessionId }
}

/**
 * 获取当前页面信息。
 * 参数: { sessionId? }
 */
async function handleGetPageInfo(
  _event: unknown,
  params: Record<string, unknown>,
): Promise<{ url: string; title: string }> {
  const sessionId = getOptionalString(params['sessionId'], 'sessionId') ?? 'default'
  return getCurrentPageInfo(sessionId)
}

// ─── 注册函数 ────────────────────────────────────────────────────

const handlers: Array<{ channel: string; handler: IpcMainInvokeHandler }> = [
  { channel: 'browser:navigate', handler: handleNavigate },
  { channel: 'browser:screenshot', handler: handleScreenshot },
  { channel: 'browser:get-text', handler: handleGetText },
  { channel: 'browser:get-dom', handler: handleGetDom },
  { channel: 'browser:click', handler: handleClick },
  { channel: 'browser:fill', handler: handleFill },
  { channel: 'browser:close', handler: handleClose },
  { channel: 'browser:get-page-info', handler: handleGetPageInfo },
]

/**
 * 注册 Browser IPC handlers。
 * 幂等：重复调用安全。
 */
export function registerBrowserHandlers(): void {
  for (const { channel, handler } of handlers) {
    const wrappedHandler: IpcMainInvokeHandler = async (event, ...args) => {
      try {
        return await handler(event, ...args)
      } catch (error) {
        if (error instanceof AppError) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new AppError(ErrorCodes.INTERNAL_ERROR, message, { channel })
      }
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, wrappedHandler)
  }
}

export { closeAllSessions }
