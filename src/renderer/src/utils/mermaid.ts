// AgentForge: Mermaid 图表渲染工具
// 将 mermaid 代码块渲染为 SVG 图表

import mermaid from 'mermaid'

let initialized = false

/** 初始化 mermaid 配置 */
function initMermaid(): void {
  if (initialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      primaryColor: '#4f46e5',
      primaryTextColor: '#e5e7eb',
      primaryBorderColor: '#818cf8',
      lineColor: '#6b7280',
      secondaryColor: '#1f2937',
      tertiaryColor: '#374151',
      background: '#111827',
      mainBkg: '#1f2937',
      secondBkg: '#374151',
      textColor: '#e5e7eb',
      nodeBorder: '#4b5563',
      clusterBkg: '#1f2937',
      clusterBorder: '#4b5563',
      edgeLabelBackground: '#1f2937',
      fontFamily: 'inherit',
    },
    flowchart: {
      curve: 'basis',
      padding: 16,
    },
    sequence: {
      actorMargin: 50,
      boxMargin: 10,
    },
    securityLevel: 'strict',
  })
  initialized = true
}

/** 渲染计数器，用于生成唯一 ID */
let renderCounter = 0

/**
 * 将 mermaid 代码渲染为 SVG 字符串。
 *
 * @param code - mermaid 图表代码
 * @returns SVG 字符串，或渲染失败时的错误信息 HTML
 */
export async function renderMermaid(code: string): Promise<string> {
  initMermaid()

  const id = `mermaid-${++renderCounter}-${Date.now()}`

  try {
    const { svg } = await mermaid.render(id, code)
    return svg
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return `<div class="mermaid-error">图表渲染失败: ${escapeHtmlSafe(msg)}</div>`
  }
}

/**
 * 检查代码语言是否为 mermaid。
 */
export function isMermaidLang(lang: string): boolean {
  return lang.toLowerCase() === 'mermaid'
}

/** 简单 HTML 转义 */
function escapeHtmlSafe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
