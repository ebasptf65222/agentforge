<script setup lang="ts">
// P1-16: GeneralSettings - application-level settings UI.
// Each field change saves immediately via the settings store.

import { computed, onMounted, watch } from 'vue'
import type { AppSettings, ApprovalMode } from '@shared/types'
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

const THEME_OPTIONS: ReadonlyArray<{ value: AppSettings['theme']; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
]

const APPROVAL_OPTIONS: ReadonlyArray<{ value: ApprovalMode; label: string }> = [
  { value: 'suggest', label: '建议模式' },
  { value: 'auto-edit', label: '自动编辑' },
  { value: 'full-auto', label: '全自动' },
]

// ─── Apply theme to document root ─────────────────────────────

/**
 * Apply the theme to the document root so the change is visible immediately
 * (P1-16 acceptance: theme switches immediately).
 */
function applyTheme(theme: AppSettings['theme']): void {
  const root = document.documentElement
  let effective: 'dark' | 'light'
  if (theme === 'system') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } else {
    effective = theme
  }
  if (effective === 'dark') {
    root.classList.add('theme-dark')
    root.classList.remove('theme-light')
  } else {
    root.classList.add('theme-light')
    root.classList.remove('theme-dark')
  }
}

watch(
  () => settings.value?.theme,
  (theme) => {
    if (theme !== undefined && theme !== null) {
      applyTheme(theme)
    }
  },
)

// React to system theme changes when in 'system' mode.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.value?.theme === 'system') {
      applyTheme('system')
    }
  })
}

// ─── Field change handlers (immediate save) ───────────────────

async function updateTheme(value: AppSettings['theme']): Promise<void> {
  applyTheme(value)
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

// ─── Helpers for template binding ─────────────────────────────

/** Convert the stored approvalTimeoutMs (ms) to seconds for display. */
const approvalTimeoutSeconds = computed(() => {
  const ms = settings.value?.approvalTimeoutMs
  if (ms === undefined || ms === null) return 300
  return Math.round(ms / 1000)
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
      <!-- 主题 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">主题</span>
          <span class="setting-row__desc">选择应用界面颜色主题</span>
        </div>
        <div class="setting-row__control">
          <select
            class="setting-select"
            :value="settings?.theme ?? 'dark'"
            @change="
              updateTheme(($event.target as HTMLSelectElement).value as AppSettings['theme'])
            "
          >
            <option v-for="opt in THEME_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- 默认审批模式 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">默认审批模式</span>
          <span class="setting-row__desc">控制 Agent 执行工具时的审批策略</span>
        </div>
        <div class="setting-row__control">
          <select
            class="setting-select"
            :value="settings?.defaultApprovalMode ?? 'suggest'"
            @change="updateApprovalMode(($event.target as HTMLSelectElement).value as ApprovalMode)"
          >
            <option v-for="opt in APPROVAL_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- 最大执行步数 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">最大执行步数</span>
          <span class="setting-row__desc">单次 Agent 执行的最大步数（1 - 100）</span>
        </div>
        <div class="setting-row__control">
          <input
            type="number"
            class="setting-input"
            :value="settings?.maxExecutionSteps ?? 20"
            min="1"
            max="100"
            @change="updateMaxSteps(($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <!-- 默认模型 -->
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">默认模型</span>
          <span class="setting-row__desc">新建对话时默认使用的模型</span>
        </div>
        <div class="setting-row__control">
          <select
            class="setting-select"
            :value="settings?.defaultModelId ?? ''"
            @change="updateDefaultModel(($event.target as HTMLSelectElement).value)"
          >
            <option value="">未设置</option>
            <option v-for="model in modelStore.models" :key="model.id" :value="model.id">
              {{ model.name }} ({{ model.modelId }})
            </option>
          </select>
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
        <div class="setting-row__control setting-row__control--inline">
          <input
            type="number"
            class="setting-input"
            :value="approvalTimeoutSeconds"
            min="30"
            max="3600"
            @change="updateApprovalTimeout(($event.target as HTMLInputElement).value)"
          />
          <span class="setting-row__unit">秒</span>
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
  border-bottom: 1px solid #374151;
  margin-bottom: 16px;
}

.general-settings__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #f9fafb;
}

.general-settings__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #9ca3af;
}

.general-settings__loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-skeleton {
  height: 56px;
  border-radius: 8px;
  background-color: #1f2937;
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
  display: flex;
  flex-direction: column;
}

/* ─── Setting row ─────────────────────────────────────────── */
.setting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid #1f2937;
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
  color: #e5e7eb;
}

.setting-row__desc {
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.4;
}

.setting-row__hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: #f59e0b;
}

.setting-row__control {
  width: 280px;
  flex-shrink: 0;
}

.setting-row__control--inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setting-row__unit {
  font-size: 13px;
  color: #9ca3af;
  flex-shrink: 0;
}

/* ─── Inputs ──────────────────────────────────────────────── */
.setting-select,
.setting-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #1f2937;
  color: #e5e7eb;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
}

.setting-select:focus,
.setting-input:focus {
  border-color: #4f46e5;
}

.setting-select {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
  cursor: pointer;
}

.setting-input {
  cursor: text;
}
</style>
