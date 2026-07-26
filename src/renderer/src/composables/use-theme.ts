/**
 * useTheme — unified theme management composable
 *
 * Uses VueUse useDark for dark/light/system theme management.
 * Also injects CSS custom properties and provides naive-ui theme objects.
 * P1-16 spec: "使用 VueUse useDark 实现主题切换"
 */

import { computed, watch, type Ref } from 'vue'
import { useDark, usePreferredDark } from '@vueuse/core'
import { darkTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import { useSettingsStore } from '@/stores/settings'
import { darkCssVars, lightCssVars, darkThemeOverrides, lightThemeOverrides } from '@/theme/tokens'

export type EffectiveTheme = 'dark' | 'light'

/** Apply CSS variable set to :root */
function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

/** Clear a CSS variable set from :root */
function clearCssVars(vars: Record<string, string>): void {
  const root = document.documentElement
  for (const key of Object.keys(vars)) {
    root.style.removeProperty(key)
  }
}

export interface UseThemeReturn {
  /** Actually effective theme (dark or light) */
  effectiveTheme: Ref<EffectiveTheme>
  /** naive-ui theme object (darkTheme or null for light) */
  naiveTheme: Ref<GlobalTheme | null>
  /** naive-ui theme overrides */
  naiveThemeOverrides: Ref<GlobalThemeOverrides>
}

/**
 * Theme management composable.
 * Uses VueUse useDark internally, but also manages CSS custom properties
 * and naive-ui theme objects beyond what useDark provides.
 */
export function useTheme(): UseThemeReturn {
  const settingsStore = useSettingsStore()

  /** System dark preference via VueUse */
  const prefersDark = usePreferredDark()

  /** User preference from settings store */
  const preferredTheme = computed<'dark' | 'light' | 'system'>(() => {
    return settingsStore.settings?.theme ?? 'dark'
  })

  /**
   * Determine if effective theme should be dark.
   * - 'dark' -> always dark
   * - 'light' -> always light
   * - 'system' -> follow prefersDark
   */
  const shouldUseDark = computed(() => {
    if (preferredTheme.value === 'system') return prefersDark.value
    return preferredTheme.value === 'dark'
  })

  /** VueUse useDark - manages document class and localStorage */
  const isDark = useDark({
    selector: 'html',
    attribute: 'class',
    valueDark: 'dark',
    valueLight: 'light',
    initialValue: shouldUseDark.value ? 'dark' : 'light',
  })

  /** Keep VueUse in sync with our computed preference */
  watch(shouldUseDark, (val) => {
    isDark.value = val
  })

  /** Effective theme derived from VueUse */
  const effectiveTheme = computed<EffectiveTheme>(() =>
    isDark.value ? 'dark' : 'light',
  )

  /** naive-ui theme object */
  const naiveTheme = computed<GlobalTheme | null>(() =>
    effectiveTheme.value === 'dark' ? darkTheme : null,
  )

  /** naive-ui theme overrides */
  const naiveThemeOverrides = computed<GlobalThemeOverrides>(() =>
    effectiveTheme.value === 'dark' ? darkThemeOverrides : lightThemeOverrides,
  )

  /** Apply CSS custom properties based on effective theme */
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

  watch(effectiveTheme, applyTheme, { immediate: true })

  return {
    effectiveTheme,
    naiveTheme,
    naiveThemeOverrides,
  }
}
