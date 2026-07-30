// AgentForge 共享类型定义 - 浏览器工具类型 (P2-01)
// 与 Spec v0.2 §5.7b 一致

import type { BrowserScreenshotFormat } from './enums'

// ─── 5.7b 浏览器工具类型 (P2-01) ────────────────────────────────

/** 浏览器页面信息 */
export interface BrowserPageInfo {
  /** 当前 URL */
  url: string
  /** 页面标题 */
  title: string
  /** HTTP 状态码 */
  statusCode: number
  /** 页面加载耗时（毫秒） */
  loadTime: number
}

/** 浏览器 DOM 元素信息 */
export interface BrowserElementInfo {
  /** 标签名 */
  tagName: string
  /** 元素 ID */
  id: string
  /** CSS 类名 */
  className: string
  /** 元素文本内容（截断） */
  text: string
  /** 属性列表 */
  attributes: Record<string, string>
  /** 是否可见 */
  isVisible: boolean
  /** 是否可点击 */
  isClickable: boolean
  /** 矩形位置 */
  rect: { x: number; y: number; width: number; height: number }
}

/** 浏览器截图结果 */
export interface BrowserScreenshotResult {
  /** Base64 编码的图片数据 */
  base64: string
  /** 图片格式 */
  format: BrowserScreenshotFormat
  /** 图片宽度 */
  width: number
  /** 图片高度 */
  height: number
  /** 是否截取完整页面 */
  fullPage: boolean
}
