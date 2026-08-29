// use-engine-config.ts - Reusable composable for engine configuration updates.
// Extracted from GeneralSettings.vue to allow reuse in ChatInput toolbar popover.

import { computed } from 'vue'
import type { SelectOption } from 'naive-ui'
import type { AppSettings, ApprovalMode, EngineType } from '@shared/types'
import { useSettingsStore } from '@/stores/settings'
import { showToast } from '@/utils/toast'

// ─── Option constants ─────────────────────────────────────────

export const ENGINE_OPTIONS: ReadonlyArray<{ value: EngineType; label: string; short: string }> = [
  { value: 'copilot-sdk', label: 'Copilot SDK', short: 'SDK' },
  { value: 'langgraph', label: 'LangGraph', short: 'LangGraph' },
]

export const REASONING_EFFORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

export const WIRE_API_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auto', label: '自动（推荐）' },
  { value: 'responses', label: 'Responses API' },
  { value: 'completions', label: 'Completions API' },
]

export const APPROVAL_OPTIONS: ReadonlyArray<{ value: ApprovalMode; label: string }> = [
  { value: 'suggest', label: '建议模式' },
  { value: 'auto-edit', label: '自动编辑' },
  { value: 'full-auto', label: '全自动' },
]

export const AGENT_MODE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '交互模式（默认）' },
  { value: 'plan', label: '计划模式' },
  { value: 'autopilot', label: '自动模式' },
  { value: 'shell', label: 'Shell 模式' },
]

// ─── Composable ───────────────────────────────────────────────

export function useEngineConfig() {
  const settingsStore = useSettingsStore()

  const settings = computed<AppSettings | null>(() => settingsStore.settings)
  const currentEngine = computed<EngineType>(() => settings.value?.engineType ?? 'copilot-sdk')
  const isCopilotEngine = computed(() => currentEngine.value === 'copilot-sdk')

  // ─── Engine switch ──────────────────────────────────────────

  async function switchEngine(value: EngineType): Promise<void> {
    try {
      await settingsStore.updateSetting('engineType', value)
      const label = ENGINE_OPTIONS.find((o) => o.value === value)?.label ?? value
      showToast(`执行引擎已切换为「${label}」，新消息生效`, 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`保存失败: ${message}`, 'error')
    }
  }

  // ─── Copilot SDK options ────────────────────────────────────

  async function updateReasoningEffort(value: string): Promise<void> {
    const effort = value === '' ? null : value
    try {
      await settingsStore.updateSetting('copilotReasoningEffort', effort)
      showToast('推理强度已更新，新消息生效', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`保存失败: ${message}`, 'error')
    }
  }

  async function updateWireApi(value: string): Promise<void> {
    const wireApi = value === 'auto' ? null : value
    try {
      await settingsStore.updateSetting('copilotWireApi', wireApi)
      showToast('Wire API 模式已更新，新消息生效', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`保存失败: ${message}`, 'error')
    }
  }

  async function updateAgentMode(value: string): Promise<void> {
    const mode = value === '' ? null : value
    try {
      await settingsStore.updateSetting('copilotAgentMode', mode)
      showToast('Agent 模式已更新，新消息生效', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`保存失败: ${message}`, 'error')
    }
  }

  // ─── Common options ─────────────────────────────────────────

  async function updateApprovalMode(value: ApprovalMode): Promise<void> {
    try {
      await settingsStore.updateSetting('defaultApprovalMode', value)
      showToast('审批模式已更新', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`保存失败: ${message}`, 'error')
    }
  }

  async function updateMaxSteps(value: number): Promise<void> {
    const clamped = Math.min(100, Math.max(1, value))
    try {
      await settingsStore.updateSetting('maxExecutionSteps', clamped)
      showToast('最大执行步数已更新', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`保存失败: ${message}`, 'error')
    }
  }

  // ─── NSelect option adapters ────────────────────────────────

  const reasoningEffortSelectOptions = computed<SelectOption[]>(() =>
    REASONING_EFFORT_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
  )

  const wireApiSelectOptions = computed<SelectOption[]>(() =>
    WIRE_API_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
  )

  const approvalSelectOptions = computed<SelectOption[]>(() =>
    APPROVAL_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
  )

  const agentModeSelectOptions = computed<SelectOption[]>(() =>
    AGENT_MODE_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
  )

  return {
    // State
    settings,
    currentEngine,
    isCopilotEngine,
    // Actions
    switchEngine,
    updateReasoningEffort,
    updateWireApi,
    updateAgentMode,
    updateApprovalMode,
    updateMaxSteps,
    // Select options
    reasoningEffortSelectOptions,
    wireApiSelectOptions,
    approvalSelectOptions,
    agentModeSelectOptions,
  }
}
