<script setup lang="ts">
// P1-16: GeneralSettings - application-level settings UI.
// Each field change saves immediately via the settings store.

import { computed, onMounted } from 'vue'
import { NSelect, NInputNumber, NRadioGroup, NRadioButton } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import type { AppSettings, ApprovalMode, EngineType } from '@shared/types'
import { useSettingsStore } from '@/stores/settings'
import { useModelStore } from '@/stores/model'
import { showToast } from '@/utils/toast'

const settingsStore = useSettingsStore()
const modelStore = useModelStore()

onMounted(async () => {
  await settingsStore.loadSettings()
  // Ensure the default-model select has options.
  if (modelStore.models.length === 0) {
    await modelStore.loadModels()
  }
})

// ─── Reactive snapshot ────────────────────────────────────────

const settings = computed<AppSettings | null>(() => settingsStore.settings)
const isLoading = computed(() => settingsStore.loading || settings.value === null)

// ─── Theme handling ───────────────────────────────────────────
// OPT2-10: 删除独立的 applyTheme 逻辑和 matchMedia 监听器。
// 主题切换统一由 useTheme composable（在 App.vue 中）管理，
// 此组件仅负责更新 settings store 的值。

const APPROVAL_OPTIONS: ReadonlyArray<{ value: ApprovalMode; label: string }> = [
  { value: 'suggest', label: '建议模式' },
  { value: 'auto-edit', label: '自动编辑' },
  { value: 'full-auto', label: '全自动' },
]

const ENGINE_OPTIONS: ReadonlyArray<{ value: EngineType; label: string; desc: string }> = [
  { value: 'builtin', label: '内置引擎', desc: 'AgentForge 原生 ReAct 循环' },
  { value: 'copilot-sdk', label: 'Copilot SDK', desc: 'GitHub Copilot SDK 驱动' },
]

const REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: '', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

// OPT2-10: 移除独立的 applyTheme 函数和 watch/matchMedia 监听器，
// 避免 'theme-dark'/'theme-light' 类名与 useTheme 的 'dark'/'light' 冲突，
// 同时修复 matchMedia 监听器在组件卸载后未移除的泄漏问题。

// ─── Field change handlers (immediate save) ───────────────────

async function updateTheme(value: AppSettings['theme']): Promise<void> {
  // OPT2-10: 不再需要手动调用 applyTheme，useTheme composable
  // 通过 watch settingsStore.settings.theme 自动响应变化
  try {
    await settingsStore.updateSetting('theme', value)
    showToast('主题已更新', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateApprovalMode(value: ApprovalMode): Promise<void> {
  try {
    await settingsStore.updateSetting('defaultApprovalMode', value)
    showToast('默认审批模式已更新', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateEngineType(value: EngineType): Promise<void> {
  try {
    await settingsStore.updateSetting('engineType', value)
    const label = ENGINE_OPTIONS.find((o) => o.value === value)?.label ?? value
    showToast(`执行引擎已切换为「${label}」，新对话生效`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateMaxSteps(value: string): Promise<void> {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return
  const clamped = Math.min(100, Math.max(1, parsed))
  try {
    await settingsStore.updateSetting('maxExecutionSteps', clamped)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateDefaultModel(value: string): Promise<void> {
  // Empty string maps to null (no default model).
  const modelId = value === '' ? null : value
  try {
    await settingsStore.updateSetting('defaultModelId', modelId)
    showToast('默认模型已更新，新对话将使用此模型', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateApprovalTimeout(value: string): Promise<void> {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return
  const clamped = Math.min(3600, Math.max(30, parsed))
  try {
    await settingsStore.updateSetting('approvalTimeoutMs', clamped * 1000)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateReasoningEffort(value: string): Promise<void> {
  // Empty string maps to null (use SDK default)
  const effort = value === '' ? null : value
  try {
    await settingsStore.updateSetting('copilotReasoningEffort', effort)
    showToast('推理强度已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

// ─── Helpers for template binding ─────────────────────────────

/** Convert the stored approvalTimeoutMs (ms) to seconds for display. */
const approvalTimeoutSeconds = computed(() => {
  const ms = settings.value?.approvalTimeoutMs
  if (ms === undefined || ms === null) return 300
  return Math.round(ms / 1000)
})

// ─── NSelect option adapters ──────────────────────────────────

/** Approval-mode options reshaped for NSelect. */
const approvalOptions = computed<SelectOption[]>(() =>
  APPROVAL_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)

/** Model options (with an explicit "未设置" entry) for NSelect. */
const modelOptions = computed<SelectOption[]>(() => [
  { label: '未设置', value: '' },
  ...modelStore.models.map((m) => ({ label: `${m.name} (${m.modelId})`, value: m.id })),
])

/** Reasoning effort options for NSelect. */
const reasoningEffortOptions = computed<SelectOption[]>(() =>
  REASONING_EFFORT_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)

/** Whether Copilot SDK engine is selected (controls reasoning effort visibility). */
const isCopilotEngine = computed(() => settings.value?.engineType === 'copilot-sdk')

// ─── NInputNumber writable adapters ───────────────────────────
// NInputNumber uses v-model:value (number | null). These computeds bridge
// the store-backed values with the existing string-based update handlers,
// keeping the original script logic intact.

const maxStepsValue = computed<number | null>({
  get: () => settings.value?.maxExecutionSteps ?? 20,
  set: (v: number | null) => {
    if (v === null) return
    updateMaxSteps(String(v))
  },
})

const approvalTimeoutValue = computed<number | null>({
  get: () => approvalTimeoutSeconds.value,
  set: (v: number | null) => {
    if (v === null) return
    updateApprovalTimeout(String(v))
  },
})
</script>

<template>
  <div class="general-settings">
    <div class="general-settings__header">
      <h2 class="general-settings__title">通用设置</h2>
      <p class="general-settings__subtitle">应用级别的偏好设置，更改后立即保存</p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="general-settings__loading">
      <div class="setting-skeleton" />
      <div class="setting-skeleton" />
      <div class="setting-skeleton" />
      <div class="setting-skeleton" />
    </div>

    <!-- Form -->
    <div v-else class="general-settings__form">
      <!-- 主题 (OPT-UI-13) -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">主题</span>
          <span class="setting-row__desc">选择应用界面颜色主题</span>
        </div>
        <div class="setting-row__control">
          <NRadioGroup
            :value="settings?.theme ?? 'dark'"
            @update:value="(v) => updateTheme(v as AppSettings['theme'])"
          >
            <NRadioButton value="dark" class="theme-option">
              <div class="theme-preview theme-preview--dark" />
              <span>深色</span>
            </NRadioButton>
            <NRadioButton value="light" class="theme-option">
              <div class="theme-preview theme-preview--light" />
              <span>浅色</span>
            </NRadioButton>
            <NRadioButton value="system" class="theme-option">
              <div class="theme-preview theme-preview--system" />
              <span>跟随系统</span>
            </NRadioButton>
          </NRadioGroup>
        </div>
      </div>

      <!-- 执行引擎 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">执行引擎</span>
          <span class="setting-row__desc">选择 Agent 执行引擎，切换后新对话生效</span>
        </div>
        <div class="setting-row__control">
          <NRadioGroup
            :value="settings?.engineType ?? 'builtin'"
            @update:value="(v) => updateEngineType(v as EngineType)"
          >
            <NRadioButton
              v-for="opt in ENGINE_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </NRadioButton>
          </NRadioGroup>
        </div>
      </div>

      <!-- 推理强度（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">推理强度</span>
          <span class="setting-row__desc">控制 Copilot SDK 的推理深度，影响响应速度和质量</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.copilotReasoningEffort ?? ''"
            :options="reasoningEffortOptions"
            @update:value="(v) => updateReasoningEffort(v as string)"
          />
        </div>
      </div>

      <!-- 默认审批模式 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">默认审批模式</span>
          <span class="setting-row__desc">控制 Agent 执行工具时的审批策略</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.defaultApprovalMode ?? 'suggest'"
            :options="approvalOptions"
            @update:value="(v) => updateApprovalMode(v as ApprovalMode)"
          />
        </div>
      </div>

      <!-- 最大执行步数 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">最大执行步数</span>
          <span class="setting-row__desc">单次 Agent 执行的最大步数（1 - 100）</span>
        </div>
        <div class="setting-row__control">
          <NInputNumber v-model:value="maxStepsValue" :min="1" :max="100" />
        </div>
      </div>

      <!-- 默认模型 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">默认模型</span>
          <span class="setting-row__desc">新建对话时默认使用的模型</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.defaultModelId ?? ''"
            :options="modelOptions"
            @update:value="(v) => updateDefaultModel((v ?? '') as string)"
          />
          <p v-if="modelStore.models.length === 0" class="setting-row__hint">
            暂无可用模型，请先在「模型配置」中添加
          </p>
        </div>
      </div>

      <!-- 审批超时 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">审批超时</span>
          <span class="setting-row__desc">等待用户审批的超时时间（30 - 3600 秒）</span>
        </div>
        <div class="setting-row__control">
          <NInputNumber v-model:value="approvalTimeoutValue" :min="30" :max="3600">
            <template #suffix>秒</template>
          </NInputNumber>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.general-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.general-settings__header {
  padding: 4px 0 20px;
  border-bottom: 1px solid var(--af-border, #334155);
  margin-bottom: 16px;
}

.general-settings__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
}

.general-settings__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
}

.general-settings__loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-skeleton {
  height: 56px;
  border-radius: var(--af-radius, 8px);
  background-color: var(--af-bg-input, #1f2937);
  animation: general-skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes general-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.general-settings__form {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

/* ─── Setting row ─────────────────────────────────────────── */
.setting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--af-border-light, #1f2937);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-row__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.setting-row__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--af-text-secondary, #cbd5e1);
}

.setting-row__desc {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  line-height: 1.4;
}

.setting-row__hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--af-warning, #f59e0b);
}

.setting-row__control {
  width: 280px;
  flex-shrink: 0;
}

/* Theme preview cards (OPT-UI-13) */
.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 12px !important;
}

.theme-option :deep(.n-radio-button__content) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.theme-preview {
  width: 48px;
  height: 32px;
  border-radius: 6px;
  border: 2px solid var(--af-border, #374151);
  transition: border-color 0.15s ease;
}

.theme-preview--dark {
  background: linear-gradient(135deg, #0f172a 50%, #1e293b 50%);
}

.theme-preview--light {
  background: linear-gradient(135deg, #f8fafc 50%, #e2e8f0 50%);
}

.theme-preview--system {
  background: linear-gradient(135deg, #0f172a 33%, #64748b 33%, #64748b 66%, #f8fafc 66%);
}

.theme-option.n-radio-button--checked .theme-preview {
  border-color: var(--af-brand, #4f46e5);
}
</style>
