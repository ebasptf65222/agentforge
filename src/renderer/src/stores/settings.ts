// P1-16: SettingsStore - Pinia setup store for application settings.
// Wraps the electron.settings IPC API and exposes reactive state.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings, VoiceConfig, WorkspaceConfig } from '@shared/types'

/** Keys of AppSettings that callers are allowed to update (excluding updatedAt). */
export type SettingsKey = keyof Omit<AppSettings, 'updatedAt'>

export const useSettingsStore = defineStore('settings', () => {
  // ─── State ───────────────────────────────────────────────────

  /** Current application settings (null until first load succeeds). */
  const settings = ref<AppSettings | null>(null)

  /** Whether a get request is in flight. */
  const loading = ref(false)

  // ─── Actions ─────────────────────────────────────────────────

  /** In-flight load promise to deduplicate concurrent calls. */
  let loadPromise: Promise<void> | null = null

  /**
   * Load application settings from the main process.
   *
   * - Deduplicates concurrent calls (multiple tab panes mounting simultaneously).
   * - Skips the loading skeleton when settings are already populated (prevents
   *   a visible flash when re-entering the settings page with NTabs animated).
   */
  async function loadSettings(): Promise<void> {
    // Deduplicate: if a load is already in-flight, piggyback on it
    if (loadPromise) return loadPromise

    // Only show skeleton on the very first load (settings is still null)
    const showSkeleton = settings.value === null
    if (showSkeleton) loading.value = true

    loadPromise = (async () => {
      try {
        const result = await window.electron.settings.get()
        settings.value = result as AppSettings
      } finally {
        if (showSkeleton) loading.value = false
        loadPromise = null
      }
    })()

    return loadPromise
  }

  /**
   * Update a single setting key. Sends only the provided key/value pair
   * and refreshes the local settings snapshot afterwards.
   *
   * Uses `get()` directly instead of `loadSettings()` to avoid toggling
   * `loading` state (which would destroy/recreate the form DOM and reset
   * the scroll position in settings views).
   */
  async function updateSetting(
    key: SettingsKey,
    value: AppSettings[SettingsKey],
  ): Promise<void> {
    await window.electron.settings.update({ [key]: value } as Partial<Omit<AppSettings, 'updatedAt'>>)
    settings.value = (await window.electron.settings.get()) as AppSettings
  }

  /**
   * Update voice configuration with partial patch support.
   * The main process deep-merges the patch with existing voice config.
   *
   * Avoids `loadSettings()` to prevent loading-state scroll reset.
   */
  async function updateVoice(patch: Partial<VoiceConfig>): Promise<void> {
    await window.electron.settings.update({ voice: patch } as Partial<Omit<AppSettings, 'updatedAt'>>)
    settings.value = (await window.electron.settings.get()) as AppSettings
  }

  /**
   * Update workspace configuration with partial patch support.
   * The main process merges the patch with existing workspace config.
   * When `path` changes, the backend auto-manages recentPaths.
   *
   * Avoids `loadSettings()` to prevent loading-state scroll reset.
   */
  async function updateWorkspace(patch: Partial<WorkspaceConfig>): Promise<void> {
    await window.electron.settings.update({ workspace: patch } as Partial<Omit<AppSettings, 'updatedAt'>>)
    settings.value = (await window.electron.settings.get()) as AppSettings
  }

  return {
    // State
    settings,
    loading,
    // Actions
    loadSettings,
    updateSetting,
    updateVoice,
    updateWorkspace,
  }
})
