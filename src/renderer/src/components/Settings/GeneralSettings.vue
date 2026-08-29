<script setup lang="ts">
// P1-16: GeneralSettings - application-level settings UI.
// Each field change saves immediately via the settings store.

import { computed, onMounted } from 'vue'
import { NSelect, NInputNumber, NRadioGroup, NRadioButton, NSwitch, NDynamicTags } from 'naive-ui'
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
  { value: 'copilot-sdk', label: 'Copilot SDK', desc: 'GitHub Copilot SDK 驱动' },
  { value: 'langgraph', label: 'LangGraph', desc: 'LangChain + LangGraph 编排引擎' },
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

const WIRE_API_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: 'auto', label: '自动（推荐）' },
  { value: 'responses', label: 'Responses API' },
  { value: 'completions', label: 'Completions API' },
]

const CONTEXT_TIER_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: 'default', label: '默认' },
  { value: 'long_context', label: '长上下文' },
]

const REASONING_SUMMARY_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: '', label: '默认' },
  { value: 'none', label: '无摘要' },
  { value: 'auto', label: '自动' },
  { value: 'detailed', label: '详细' },
]

const AGENT_MODE_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: '', label: '交互模式（默认）' },
  { value: 'plan', label: '计划模式' },
  { value: 'autopilot', label: '自动模式' },
  { value: 'shell', label: 'Shell 模式' },
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

async function updateWireApi(value: string): Promise<void> {
  // 'auto' maps to null (SDK auto-detects based on model type)
  const wireApi = value === 'auto' ? null : value
  try {
    await settingsStore.updateSetting('copilotWireApi', wireApi)
    showToast('Wire API 模式已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateSkillDirectories(dirs: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotSkillDirectories', dirs.length > 0 ? dirs : null)
    showToast('技能目录已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateConfigDiscovery(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotEnableConfigDiscovery', value)
    showToast('配置自动发现已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateContextTier(value: string): Promise<void> {
  const tier = value === 'default' ? null : value
  try {
    await settingsStore.updateSetting('copilotContextTier', tier)
    showToast('上下文层级已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateReasoningSummary(value: string): Promise<void> {
  const summary = value === '' ? null : value
  try {
    await settingsStore.updateSetting('copilotReasoningSummary', summary)
    showToast('推理摘要已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateExcludedTools(tools: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotExcludedTools', tools.length > 0 ? tools : null)
    showToast('排除工具已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateEnableHostGitOperations(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotEnableHostGitOperations', value)
    showToast('Git 操作支持已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateToolSearchDeferThreshold(value: string): Promise<void> {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return
  const clamped = Math.min(200, Math.max(0, parsed))
  try {
    await settingsStore.updateSetting('copilotToolSearchDeferThreshold', clamped > 0 ? clamped : null)
    showToast('工具搜索延迟阈值已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateDefaultAgentExcludedTools(tools: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotDefaultAgentExcludedTools', tools.length > 0 ? tools : null)
    showToast('默认代理排除工具已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updatePluginDirectories(dirs: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotPluginDirectories', dirs.length > 0 ? dirs : null)
    showToast('Plugin 目录已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateInstructionDirectories(dirs: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotInstructionDirectories', dirs.length > 0 ? dirs : null)
    showToast('指令目录已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateEnableMemory(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotEnableMemory', value)
    showToast('记忆功能已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateSkipCustomInstructions(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotSkipCustomInstructions', value)
    showToast('自定义指令跳过设置已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateEnableAskUser(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotEnableAskUser', value)
    showToast('ask_user 交互已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateEnableElicitation(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotEnableElicitation', value)
    showToast('表单交互已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateAgentMode(value: string): Promise<void> {
  const mode = value === '' ? null : value
  try {
    await settingsStore.updateSetting('copilotAgentMode', mode)
    showToast('Agent 模式已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateMaxPromptTokens(value: string): Promise<void> {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return
  const clamped = Math.min(1000000, Math.max(0, parsed))
  try {
    await settingsStore.updateSetting('copilotMaxPromptTokens', clamped > 0 ? clamped : null)
    showToast('压缩阈值已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateExcludedBuiltinAgents(agents: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotExcludedBuiltinAgents', agents.length > 0 ? agents : null)
    showToast('排除内置代理已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateEnableSkills(value: boolean): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotEnableSkills', value)
    showToast('技能加载已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateDisabledSkills(skills: string[]): Promise<void> {
  try {
    await settingsStore.updateSetting('copilotDisabledSkills', skills.length > 0 ? skills : null)
    showToast('禁用技能已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateInfiniteSessionThreshold(value: string): Promise<void> {
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) return
  const clamped = Math.min(0.99, Math.max(0.1, parsed))
  try {
    await settingsStore.updateSetting('copilotInfiniteSessionThreshold', clamped)
    showToast('压缩阈值已更新，新对话生效', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

async function updateLargeOutputMaxSize(value: string): Promise<void> {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return
  const clamped = Math.min(1048576, Math.max(1024, parsed))
  try {
    await settingsStore.updateSetting('copilotLargeOutputMaxSize', clamped > 0 ? clamped : null)
    showToast('大输出限制已更新，新对话生效', 'success')
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

/** Wire API mode options for NSelect. */
const wireApiOptions = computed<SelectOption[]>(() =>
  WIRE_API_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)

/** Context tier options for NSelect. */
const contextTierOptions = computed<SelectOption[]>(() =>
  CONTEXT_TIER_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)

/** Reasoning summary options for NSelect. */
const reasoningSummaryOptions = computed<SelectOption[]>(() =>
  REASONING_SUMMARY_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
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

const toolSearchDeferThresholdValue = computed<number | null>({
  get: () => settings.value?.copilotToolSearchDeferThreshold ?? null,
  set: (v: number | null) => {
    updateToolSearchDeferThreshold(String(v ?? 0))
  },
})

const maxPromptTokensValue = computed<number | null>({
  get: () => settings.value?.copilotMaxPromptTokens ?? null,
  set: (v: number | null) => {
    updateMaxPromptTokens(String(v ?? 0))
  },
})

const infiniteSessionThresholdValue = computed<number | null>({
  get: () => settings.value?.copilotInfiniteSessionThreshold ?? null,
  set: (v: number | null) => {
    updateInfiniteSessionThreshold(String(v ?? 0.8))
  },
})

const largeOutputMaxSizeValue = computed<number | null>({
  get: () => settings.value?.copilotLargeOutputMaxSize ?? null,
  set: (v: number | null) => {
    updateLargeOutputMaxSize(String(v ?? 51200))
  },
})

const agentModeOptions = computed<SelectOption[]>(() =>
  AGENT_MODE_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
)
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
            :value="settings?.engineType ?? 'copilot-sdk'"
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

      <!-- Wire API 模式（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">Wire API 模式</span>
          <span class="setting-row__desc">控制 SDK 使用哪种 OpenAI API 格式，影响多轮状态和推理支持</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.copilotWireApi ?? 'auto'"
            :options="wireApiOptions"
            @update:value="(v) => updateWireApi(v as string)"
          />
        </div>
      </div>

      <!-- 技能目录（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">技能目录</span>
          <span class="setting-row__desc">SDK 从这些目录加载 .md 技能文件，为 AI 提供额外技能定义</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotSkillDirectories ?? []"
            type="info"
            :max="20"
            round
            @update:value="(v: Array<string | number>) => updateSkillDirectories(v.map(String))"
          />
        </div>
      </div>

      <!-- 配置自动发现（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">配置自动发现</span>
          <span class="setting-row__desc">自动从工作目录发现 .mcp.json 和技能目录，与显式配置合并</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotEnableConfigDiscovery ?? false"
            @update:value="(v: boolean) => updateConfigDiscovery(v)"
          />
        </div>
      </div>

      <!-- 上下文层级（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">上下文层级</span>
          <span class="setting-row__desc">长上下文模式可支持更长的对话历史（需模型支持）</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.copilotContextTier ?? 'default'"
            :options="contextTierOptions"
            @update:value="(v) => updateContextTier(v as string)"
          />
        </div>
      </div>

      <!-- 推理摘要（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">推理摘要</span>
          <span class="setting-row__desc">控制推理过程的摘要输出模式</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.copilotReasoningSummary ?? ''"
            :options="reasoningSummaryOptions"
            @update:value="(v) => updateReasoningSummary(v as string)"
          />
        </div>
      </div>

      <!-- 排除工具（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">排除工具</span>
          <span class="setting-row__desc">禁止 AI 使用这些工具（与允许列表互补）</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotExcludedTools ?? []"
            type="error"
            :max="50"
            round
            @update:value="(v: Array<string | number>) => updateExcludedTools(v.map(String))"
          />
        </div>
      </div>

      <!-- Git 操作支持（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">Git 上下文</span>
          <span class="setting-row__desc">向 AI 提供分支、文件状态等 Git 信息</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotEnableHostGitOperations ?? true"
            @update:value="(v: boolean) => updateEnableHostGitOperations(v)"
          />
        </div>
      </div>

      <!-- 工具搜索延迟阈值（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">工具搜索延迟阈值</span>
          <span class="setting-row__desc">超过此数量的工具将延迟加载（0 = SDK 默认，最大 200）</span>
        </div>
        <div class="setting-row__control">
          <NInputNumber v-model:value="toolSearchDeferThresholdValue" :min="0" :max="200" />
        </div>
      </div>

      <!-- 默认代理排除工具（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">默认代理排除工具</span>
          <span class="setting-row__desc">默认代理禁止使用这些工具（与全局排除列表不同）</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotDefaultAgentExcludedTools ?? []"
            type="warning"
            :max="50"
            round
            @update:value="(v: Array<string | number>) => updateDefaultAgentExcludedTools(v.map(String))"
          />
        </div>
      </div>

      <!-- Open Plugins 目录（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">Open Plugins 目录</span>
          <span class="setting-row__desc">SDK 从这些目录加载 Open Plugins 格式的插件</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotPluginDirectories ?? []"
            type="success"
            :max="20"
            round
            @update:value="(v: Array<string | number>) => updatePluginDirectories(v.map(String))"
          />
        </div>
      </div>

      <!-- 自定义指令目录（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">自定义指令目录</span>
          <span class="setting-row__desc">SDK 从这些目录加载 .github/copilot-instructions.md 等指令文件</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotInstructionDirectories ?? []"
            type="info"
            :max="20"
            round
            @update:value="(v: Array<string | number>) => updateInstructionDirectories(v.map(String))"
          />
        </div>
      </div>

      <!-- 记忆功能（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">记忆功能</span>
          <span class="setting-row__desc">启用 SDK 记忆功能，AI 可跨对话记住重要信息</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotEnableMemory ?? false"
            @update:value="(v: boolean) => updateEnableMemory(v)"
          />
        </div>
      </div>

      <!-- 跳过自定义指令（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">跳过自定义指令</span>
          <span class="setting-row__desc">忽略 .github/copilot-instructions.md 等自动发现的指令文件</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotSkipCustomInstructions ?? false"
            @update:value="(v: boolean) => updateSkipCustomInstructions(v)"
          />
        </div>
      </div>

      <!-- ask_user 双向交互（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">AI 主动提问</span>
          <span class="setting-row__desc">允许 AI 在需要时主动向用户提问（ask_user）</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotEnableAskUser ?? false"
            @update:value="(v: boolean) => updateEnableAskUser(v)"
          />
        </div>
      </div>

      <!-- Elicitation 表单交互（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">表单交互</span>
          <span class="setting-row__desc">允许 AI 通过表单收集结构化输入（elicitation）</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotEnableElicitation ?? false"
            @update:value="(v: boolean) => updateEnableElicitation(v)"
          />
        </div>
      </div>

      <!-- Agent 执行模式（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">Agent 模式</span>
          <span class="setting-row__desc">控制 Agent 的执行策略（计划模式先规划再执行，自动模式全自动）</span>
        </div>
        <div class="setting-row__control">
          <NSelect
            :value="settings?.copilotAgentMode ?? ''"
            :options="agentModeOptions"
            @update:value="(v) => updateAgentMode(v as string)"
          />
        </div>
      </div>

      <!-- 最大提示词 token 数（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">压缩阈值（Token）</span>
          <span class="setting-row__desc">超过此 token 数时触发上下文压缩（0 = SDK 默认）</span>
        </div>
        <div class="setting-row__control">
          <NInputNumber v-model:value="maxPromptTokensValue" :min="0" :max="1000000" />
        </div>
      </div>

      <!-- 排除的内置代理（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">排除内置代理</span>
          <span class="setting-row__desc">禁止使用 SDK 内置代理（如 code、debug 等）</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotExcludedBuiltinAgents ?? []"
            type="error"
            :max="20"
            round
            @update:value="(v: Array<string | number>) => updateExcludedBuiltinAgents(v.map(String))"
          />
        </div>
      </div>

      <!-- 技能加载开关（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">SDK 技能加载</span>
          <span class="setting-row__desc">启用 SDK 内置技能和目录发现（关闭后仅使用项目内置 Skill）</span>
        </div>
        <div class="setting-row__control">
          <NSwitch
            :value="settings?.copilotEnableSkills ?? true"
            @update:value="(v: boolean) => updateEnableSkills(v)"
          />
        </div>
      </div>

      <!-- 禁用的技能（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">禁用的技能</span>
          <span class="setting-row__desc">按名称禁用特定 SDK 技能</span>
        </div>
        <div class="setting-row__control">
          <NDynamicTags
            :value="settings?.copilotDisabledSkills ?? []"
            type="warning"
            :max="50"
            round
            @update:value="(v: Array<string | number>) => updateDisabledSkills(v.map(String))"
          />
        </div>
      </div>

      <!-- 上下文压缩阈值（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">上下文压缩阈值</span>
          <span class="setting-row__desc">上下文使用率达到此比例时开始后台压缩（0.1-0.99，默认 0.80）</span>
        </div>
        <div class="setting-row__control">
          <NInputNumber v-model:value="infiniteSessionThresholdValue" :min="0.1" :max="0.99" :step="0.05" />
        </div>
      </div>

      <!-- 大输出最大字节数（仅 Copilot SDK 引擎） -->
      <div v-if="isCopilotEngine" class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__title">大输出限制（字节）</span>
          <span class="setting-row__desc">工具输出超过此大小时自动截断存储（默认 51200 = 50KB）</span>
        </div>
        <div class="setting-row__control">
          <NInputNumber v-model:value="largeOutputMaxSizeValue" :min="1024" :max="1048576" :step="1024" />
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
