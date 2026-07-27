/**
 * AgentForge 主题令牌系统
 *
 * 统一管理深色/浅色主题的 naive-ui themeOverrides 和 CSS 自定义属性。
 * 所有颜色仅在此文件定义，组件层通过 CSS 变量或 naive-ui 主题消费。
 */
import type { GlobalThemeOverrides } from 'naive-ui'

// ─── 品牌色板 ──────────────────────────────────────────────────

/** 主品牌色 (indigo) */
export const BRAND_COLOR = '#6366f1'
export const BRAND_COLOR_DARK = '#818cf8'

/** 各状态色 */
export const SUCCESS_COLOR = '#10b981'
export const WARNING_COLOR = '#f59e0b'
export const ERROR_COLOR = '#ef4444'
export const INFO_COLOR = '#0ea5e9'

// ─── 深色主题 ──────────────────────────────────────────────────

/** 深色主题的 CSS 自定义属性 (注入到 :root) */
export const darkCssVars: Record<string, string> = {
  '--af-bg': '#0f172a',
  '--af-bg-surface': '#1e293b',
  '--af-bg-elevated': '#1e293b',
  '--af-bg-input': '#1f2937',
  '--af-bg-hover': '#334155',
  '--af-border': '#334155',
  '--af-border-light': '#1f2937',
  '--af-text-primary': '#f1f5f9',
  '--af-text-secondary': '#cbd5e1',
  '--af-text-tertiary': '#94a3b8',
  '--af-text-muted': '#64748b',
  '--af-brand': BRAND_COLOR_DARK,
  '--af-brand-hover': '#6366f1',
  '--af-success': SUCCESS_COLOR,
  '--af-warning': WARNING_COLOR,
  '--af-error': ERROR_COLOR,
  '--af-info': INFO_COLOR,
  // Markdown 渲染专用
  '--af-code-bg': '#1f2937',
  '--af-code-border': '#334155',
  '--af-code-header-bg': '#1a1a2e',
  '--af-code-text': '#d1d5db',
  '--af-blockquote-border': '#4b5563',
  '--af-blockquote-text': '#9ca3af',
  '--af-link': '#60a5fa',
  '--af-hr': '#374151',
  '--af-radius': '8px',
  '--af-radius-sm': '6px',
  '--af-radius-lg': '12px',
  '--af-radius-full': '999px',
}

/** 深色主题 naive-ui 覆盖 */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    bodyColor: '#0f172a',
    popoverColor: '#1e293b',
    cardColor: '#1e293b',
    modalColor: '#1e293b',
    borderColor: '#334155',
    dividerColor: '#1f2937',
    inputColor: '#1f2937',
    tableColor: '#1e293b',
    tableHeaderColor: '#1e293b',
    hoverColor: '#334155',
    primaryColor: BRAND_COLOR_DARK,
    primaryColorHover: '#6366f1',
    primaryColorPressed: '#4f46e5',
    primaryColorSuppl: BRAND_COLOR_DARK,
    infoColor: INFO_COLOR,
    successColor: SUCCESS_COLOR,
    warningColor: WARNING_COLOR,
    errorColor: ERROR_COLOR,
    textColorBase: '#f1f5f9',
    textColor1: '#f1f5f9',
    textColor2: '#cbd5e1',
    textColor3: '#94a3b8',
    placeholderColor: '#64748b',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  Button: {
    textColorPrimary: '#ffffff',
    textColorHoverPrimary: '#ffffff',
    textColorPressedPrimary: '#ffffff',
    textColorFocusPrimary: '#ffffff',
  },
  Tag: {
    colorPrimary: 'rgba(99, 102, 241, 0.15)',
    textColorPrimary: '#a5b4fc',
    colorSuccess: 'rgba(16, 185, 129, 0.15)',
    textColorSuccess: '#6ee7b7',
    colorWarning: 'rgba(245, 158, 11, 0.15)',
    textColorWarning: '#fcd34d',
    colorError: 'rgba(239, 68, 68, 0.15)',
    textColorError: '#fca5a5',
  },
  DataTable: {
    thColor: '#1e293b',
    thTextColor: '#cbd5e1',
    tdColor: '#1e293b',
    tdColorHover: '#334155',
    borderColor: '#1f2937',
  },
  Input: {
    color: '#1f2937',
    colorFocus: '#1f2937',
    borderHover: '1px solid #4f46e5',
    borderFocus: '1px solid #6366f1',
  },
  Card: {
    color: '#1e293b',
  },
}

// ─── 浅色主题 ──────────────────────────────────────────────────

/** 浅色主题的 CSS 自定义属性 */
export const lightCssVars: Record<string, string> = {
  '--af-bg': '#f8fafc',
  '--af-bg-surface': '#ffffff',
  '--af-bg-elevated': '#ffffff',
  '--af-bg-input': '#f1f5f9',
  '--af-bg-hover': '#f1f5f9',
  '--af-border': '#e2e8f0',
  '--af-border-light': '#f1f5f9',
  '--af-text-primary': '#0f172a',
  '--af-text-secondary': '#334155',
  '--af-text-tertiary': '#64748b',
  '--af-text-muted': '#94a3b8',
  '--af-brand': BRAND_COLOR,
  '--af-brand-hover': '#4338ca',
  '--af-success': SUCCESS_COLOR,
  '--af-warning': WARNING_COLOR,
  '--af-error': ERROR_COLOR,
  '--af-info': INFO_COLOR,
  // Markdown 渲染专用
  '--af-code-bg': '#f1f5f9',
  '--af-code-border': '#e2e8f0',
  '--af-code-header-bg': '#e8edf3',
  '--af-code-text': '#334155',
  '--af-blockquote-border': '#cbd5e1',
  '--af-blockquote-text': '#64748b',
  '--af-link': '#2563eb',
  '--af-hr': '#e2e8f0',
  '--af-radius': '8px',
  '--af-radius-sm': '6px',
  '--af-radius-lg': '12px',
  '--af-radius-full': '999px',
}

/** 浅色主题 naive-ui 覆盖 */
export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    bodyColor: '#f8fafc',
    popoverColor: '#ffffff',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    borderColor: '#e2e8f0',
    dividerColor: '#f1f5f9',
    inputColor: '#f1f5f9',
    tableColor: '#ffffff',
    tableHeaderColor: '#f8fafc',
    hoverColor: '#f1f5f9',
    primaryColor: BRAND_COLOR,
    primaryColorHover: '#4338ca',
    primaryColorPressed: '#4338ca',
    primaryColorSuppl: BRAND_COLOR,
    infoColor: INFO_COLOR,
    successColor: SUCCESS_COLOR,
    warningColor: WARNING_COLOR,
    errorColor: ERROR_COLOR,
    textColorBase: '#0f172a',
    textColor1: '#0f172a',
    textColor2: '#334155',
    textColor3: '#64748b',
    placeholderColor: '#94a3b8',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  Button: {
    textColorPrimary: '#ffffff',
    textColorHoverPrimary: '#ffffff',
    textColorPressedPrimary: '#ffffff',
    textColorFocusPrimary: '#ffffff',
  },
  Tag: {
    colorPrimary: 'rgba(99, 102, 241, 0.1)',
    textColorPrimary: '#4338ca',
    colorSuccess: 'rgba(16, 185, 129, 0.1)',
    textColorSuccess: '#047857',
    colorWarning: 'rgba(245, 158, 11, 0.1)',
    textColorWarning: '#b45309',
    colorError: 'rgba(239, 68, 68, 0.1)',
    textColorError: '#b91c1c',
  },
  DataTable: {
    thColor: '#f8fafc',
    thTextColor: '#334155',
    tdColor: '#ffffff',
    tdColorHover: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  Input: {
    color: '#f1f5f9',
    colorFocus: '#ffffff',
    borderHover: '1px solid #6366f1',
    borderFocus: '1px solid #6366f1',
  },
  Card: {
    color: '#ffffff',
  },
}
