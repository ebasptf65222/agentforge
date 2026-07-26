/**
 * useTheme — 统一的主题管理 composable
 *
 * - 从 settings store 读取主题偏好 (dark / light / system)
 * - 监听系统主题变化 (system 模式时自动跟随)
 * - 将 CSS 自定义属性注入到 :root
 * - 返回 naive-ui 可用的 darkTheme / null 及 themeOverrides
 */

import { computed, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { darkTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import { useSettingsStore } from '@/stores/settings'
import { darkCssVars, lightCssVars, darkThemeOverrides, lightThemeOverrides } from '@/theme/tokens'

export type EffectiveTheme = 'dark' | 'light'

/** 系统主题偏好 (dark/light) */
function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 将 CSS 变量对象注入到 documentElement */
function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

/** 清除另一套主题的变量，避免残留 */
function clearCssVars(vars: Record<string, string>): void {
  const root = document.documentElement
  for (const key of Object.keys(vars)) {
    root.style.removeProperty(key)
  }
}

/** 全局实例缓存，避免多个 composable 实例重复监听 */
let systemMediaQuery: MediaQueryList | null = null
let systemListener: ((e: MediaQueryListEvent) => void) | null = null

export interface UseThemeReturn {
  /** 实际生效的主题 */
  effectiveTheme: Ref<EffectiveTheme>
  /** naive-ui 主题对象 (darkTheme 或 null 表示浅色) */
  naiveTheme: Ref<GlobalTheme | null>
  /** naive-ui 主题覆盖 */
  naiveThemeOverrides: Ref<GlobalThemeOverrides>
}

/**
 * 主题管理 composable。
 * 在 App.vue 顶层调用一次即可，内部自动响应设置变化。
 */
export function useTheme(): UseThemeReturn {
  const settingsStore = useSettingsStore()

  /** 用户偏好主题 (从设置读取，默认深色) */
  const preferredTheme = computed<'dark' | 'light' | 'system'>(() => {
    return settingsStore.settings?.theme ?? 'dark'
  })

  /** 实际生效主题 */
  const effectiveTheme = computed<EffectiveTheme>(() => {
    if (preferredTheme.value === 'system') {
      return getSystemTheme()
    }
    return preferredTheme.value
  })

  /** naive-ui 主题对象 */
  const naiveTheme = computed<GlobalTheme | null>(() => {
    return effectiveTheme.value === 'dark' ? darkTheme : null
  })

  /** naive-ui 主题覆盖 */
  const naiveThemeOverrides = computed<GlobalThemeOverrides>(() => {
    return effectiveTheme.value === 'dark' ? darkThemeOverrides : lightThemeOverrides
  })

  // ─── 应用 CSS 变量 ──────────────────────────────────────

  function applyTheme(): void {
    if (effectiveTheme.value === 'dark') {
      clearCssVars(lightCssVars)
      applyCssVars(darkCssVars)
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      clearCssVars(darkCssVars)
      applyCssVars(lightCssVars)
      document.documentElement.setAttribute('data-theme', 'light')
    }
  }

  // 监听主题变化
  watch(effectiveTheme, applyTheme, { immediate: true })

  // ─── 系统主题变化监听 ────────────────────────────────────

  onMounted(() => {
    if (!systemMediaQuery && typeof window !== 'undefined') {
      systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemListener = () => {
        if (preferredTheme.value === 'system') {
          applyTheme()
        }
      }
      systemMediaQuery.addEventListener('change', systemListener)
    }
  })

  onUnmounted(() => {
    if (systemMediaQuery && systemListener) {
      systemMediaQuery.removeEventListener('change', systemListener)
      systemMediaQuery = null
      systemListener = null
    }
  })

  return {
    effectiveTheme,
    naiveTheme,
    naiveThemeOverrides,
  }
}
