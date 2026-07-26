// P1-16: SettingsStore - Pinia setup store for application settings.
// Wraps the electron.settings IPC API and exposes reactive state.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings } from '@shared/types'

/** Keys of AppSettings that callers are allowed to update (excluding updatedAt). */
export type SettingsKey = keyof Omit<AppSettings, 'updatedAt'>

export const useSettingsStore = defineStore('settings', () => {
  // ─── State ───────────────────────────────────────────────────

  /** Current application settings (null until first load succeeds). */
  const settings = ref<AppSettings | null>(null)

  /** Whether a get request is in flight. */
  const loading = ref(false)

  // ─── Actions ─────────────────────────────────────────────────

  /**
   * Load application settings from the main process.
   */
  async function loadSettings(): Promise<void> {
    loading.value = true
    try {
      const result = await window.electron.settings.get()
      settings.value = result
    } finally {
      loading.value = false
    }
  }

  /**
   * Update a single setting key. Sends only the provided key/value pair
   * and refreshes the local settings snapshot afterwards.
   *
   * The value type is intentionally a union to satisfy the IPC signature;
   * callers pass concrete values that match each key.
   */
  async function updateSetting(key: SettingsKey, value: AppSettings[SettingsKey]): Promise<void> {
    await window.electron.settings.update({ [key]: value } as Partial<
      Omit<AppSettings, 'updatedAt'>
    >)
    await loadSettings()
  }

  return {
    // State
    settings,
    loading,
    // Actions
    loadSettings,
    updateSetting,
  }
})
