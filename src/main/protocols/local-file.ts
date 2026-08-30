// AgentForge 本地文件预览协议
//
// 注册 `agentfile://` 自定义协议，将工作区内的文件安全暴露给渲染进程。
// 该协议是 File Viewer 在 Electron 渲染进程中运行的桥梁：
// 渲染进程传入 `agentfile:///workspace/<relativePath>` 形式的 URL，
// 主进程解析后校验路径（防目录穿越），再以 file:// 方式返回文件内容。
//
// 约定：
// - URL 结构：`agentfile:///workspace/<relativePath>`
//   host 固定为 `workspace`，pathname 为相对于工作区根的路径
// - 仅允许访问工作区内的文件，阻止对任意本地路径的读取
// - 支持 Range 请求（File Viewer 的 PDF/大文件分块加载依赖它）

import { protocol } from 'electron'
import { resolve, normalize, sep } from 'node:path'
import { createReadStream } from 'node:fs'
import { statSync } from 'node:fs'
import { getWorkspaceService } from '../services/workspace-service'

/** 协议 scheme 名称 */
export const LOCAL_FILE_SCHEME = 'agentfile'

/**
 * 在 app ready 前注册自定义协议为特权协议。
 * 必须在 app.whenReady() 之前调用，否则 protocol.handle 无法生效。
 */
export function registerLocalFileSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * 从 agentfile:// URL 解析出工作区内的绝对路径。
 * @param url - 形如 agentfile:///workspace/sub/dir/file.pdf
 * @returns 校验通过后的绝对路径
 * @throws {Error} - URL 非法、非 workspace host、或路径逃逸
 */
export function resolveLocalFilePath(url: string): string {
  const parsed = new URL(url)

  // 仅允许 workspace host
  if (parsed.host !== 'workspace') {
    throw new Error(`[LocalFile] Unsupported host: ${parsed.host}`)
  }

  // pathname 形如 "/sub/dir/file.pdf"，去掉前导斜杠即相对路径
  const relativePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))

  if (relativePath.length === 0) {
    throw new Error('[LocalFile] Empty relative path')
  }

  const service = getWorkspaceService()
  const workspaceRoot = normalize(service.getPath())

  const absolutePath = normalize(resolve(workspaceRoot, relativePath))

  // 路径逃逸校验：解析后的绝对路径必须位于工作区内
  const prefix = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(prefix)) {
    throw new Error(`[LocalFile] Path escapes workspace: ${absolutePath}`)
  }

  // 读取时的存在性校验（statSync，确保是文件而非目录）
  const stat = statSync(absolutePath, { throwIfNoEntry: false })
  if (!stat || !stat.isFile()) {
    throw new Error(`[LocalFile] Not a file or does not exist: ${relativePath}`)
  }

  return absolutePath
}

/**
 * 从请求中解析 Range 头（File Viewer 分块加载时使用）。
 */
function parseRange(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
  if (!match) return null
  const start = Number.parseInt(match[1], 10)
  const rawEnd = match[2]
  const end = rawEnd === '' ? size - 1 : Math.min(Number.parseInt(rawEnd, 10), size - 1)
  if (start > end || start >= size || end < 0) return null
  return { start, end }
}

/**
 * 常见扩展名 → MIME 类型映射。
 * webview / <img> / <video> 等按 URL 导航加载资源时依赖正确的 Content-Type，
 * 否则 Chromium 会将未知类型当作二进制流触发下载。
 * 未命中的扩展名回退 application/octet-stream（FileViewer 走 fetch 加载，不依赖此值）。
 */
const MIME_TYPES: Record<string, string> = {
  // 文本 / 网页
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  md: 'text/plain',
  // 图片
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  // 音频
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  // 视频
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // 文档
  pdf: 'application/pdf',
}

/** 根据文件扩展名返回 MIME 类型，未知类型回退 application/octet-stream。 */
export function getMimeType(absolutePath: string): string {
  const ext = absolutePath.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

/**
 * 创建文件流响应（支持 Range 请求）。
 * 适用于 PDF、Office 等需要随机访问的大文件。
 */
function createFileStreamResponse(
  absolutePath: string,
  rangeHeader?: string | null,
): Response {
  const stat = statSync(absolutePath)
  const size = stat.size
  const range = parseRange(rangeHeader ?? null, size)

  const headers: Record<string, string> = {
    'Content-Type': getMimeType(absolutePath),
    'Accept-Ranges': 'bytes',
  }

  if (!range) {
    headers['Content-Length'] = String(size)
    const readable = createReadStream(absolutePath) as unknown as ReadableStream
    return new Response(readable as unknown as BodyInit, { status: 200, headers })
  }

  const { start, end } = range
  headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  headers['Content-Length'] = String(end - start + 1)
  const stream = createReadStream(absolutePath, { start, end }) as unknown as ReadableStream
  return new Response(stream as unknown as BodyInit, { status: 206, headers })
}

/**
 * 注册本地文件协议的 handler。
 * 在 app.whenReady() 后调用。
 */
export function registerLocalFileProtocol(): void {
  protocol.handle(LOCAL_FILE_SCHEME, (request) => {
    try {
      const absolutePath = resolveLocalFilePath(request.url)
      const rangeHeader = request.headers.get('range')
      return createFileStreamResponse(absolutePath, rangeHeader)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[LocalFile] Request failed:', request.url, message)
      return new Response(message, { status: 400 })
    }
  })
}

/**
 * 构建渲染进程可用的工作区文件 URL。
 * @param relativePath - 相对于工作区根的路径
 * @returns agentfile:///workspace/<relativePath>
 */
export function buildWorkspaceFileUrl(relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `${LOCAL_FILE_SCHEME}:///workspace/${encodeURI(clean)}`
}

/** 便捷方法：确保本地文件协议已注册（供测试使用）。 */
export function hasLocalFileSchemeRegistered(): boolean {
  return protocol.isProtocolHandled(LOCAL_FILE_SCHEME)
}