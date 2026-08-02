// P1-15: ModelStore - Pinia setup store for model configuration management.
// Wraps the electron.model IPC API and exposes reactive state for the UI.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelConfig, ModelProvider } from '@shared/types'
import type { CreateModelParams, UpdateModelParams, ModelTestResult } from '@/types/electron-api'
import { showToast } from '@/utils/toast'

/** Error code returned by the main process when deleting the default model. */
const MODEL_DELETE_DEFAULT_CODE = 'MODEL_DELETE_DEFAULT'

export const useModelStore = defineStore('model', () => {
  // ─── State ───────────────────────────────────────────────────

  /** All model configurations (apiKey field is masked as '***'). */
  const models = ref<ModelConfig[]>([])

  /** Whether a list request is in flight (used for skeleton loading). */
  const loading = ref(false)

  // ─── Actions ─────────────────────────────────────────────────

  /**
   * Load all model configurations from the main process.
   * Sets loading=true during the request so the UI can render a skeleton.
   */
  async function loadModels(): Promise<void> {
    loading.value = true
    try {
      const result = await window.electron.model.list()
      models.value = result
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a new model configuration and refresh the list.
   */
  async function createModel(params: CreateModelParams): Promise<ModelConfig> {
    const created = await window.electron.model.create(params)
    await loadModels()
    return created
  }

  /**
   * Update an existing model configuration and refresh the list.
   */
  async function updateModel(params: UpdateModelParams): Promise<void> {
    await window.electron.model.update(params)
    await loadModels()
  }

  /**
   * Delete a model configuration.
   * On MODEL_DELETE_DEFAULT error, show a toast and re-throw so callers
   * can also react if needed.
   */
  async function deleteModel(id: string): Promise<void> {
    try {
      await window.electron.model.delete(id)
      await loadModels()
    } catch (error) {
      if (isAppErrorCode(error, MODEL_DELETE_DEFAULT_CODE)) {
        showToast('无法删除默认模型，请先设置其他模型为默认', 'error')
      } else {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`删除失败: ${message}`, 'error')
      }
      throw error
    }
  }

  /**
   * Test the connection to a model. Returns the test result; does not throw
   * on connection failure (the result carries success/error fields instead).
   */
  async function testModel(id: string): Promise<ModelTestResult> {
    const result = await window.electron.model.test(id)
    return result
  }

  return {
    // State
    models,
    loading,
    // Actions
    loadModels,
    createModel,
    updateModel,
    deleteModel,
    testModel,
  }
})

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Determine whether an error thrown by an IPC call carries a specific
 * `code` field (as AppError does). The electron renderer sees the error
 * as a plain object after serialization, so we guard by shape.
 */
function isAppErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const maybe = error as Record<string, unknown>
  return maybe['code'] === code
}

// ─── Provider metadata (shared with components) ─────────────────

export interface ProviderMeta {
  value: ModelProvider
  label: string
  defaultBaseUrl: string
  color: string
}

/**
 * Providers offered in the UI. Anthropic is now included for Copilot SDK mode.
 */
export const PROVIDER_OPTIONS: ProviderMeta[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    color: '#10a37f',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    color: '#4f46e5',
  },
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultBaseUrl: 'https://api.anthropic.com',
    color: '#d97706',
  },
  { value: 'custom', label: 'Custom', defaultBaseUrl: '', color: '#6b7280' },
]

/** Look up the provider metadata by provider value. */
export function getProviderMeta(provider: ModelProvider): ProviderMeta | undefined {
  return PROVIDER_OPTIONS.find((p) => p.value === provider)
}
