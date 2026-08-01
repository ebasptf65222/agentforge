<script setup lang="ts">
// EngineConfigPopover - Quick engine configuration panel.
// Shows high-frequency settings for the current engine type.
// Embedded inside EngineSwitcher's NPopover.

import { NSelect, NInputNumber, NDivider } from 'naive-ui'
import type { ApprovalMode } from '@shared/types'
import { useEngineConfig, ENGINE_OPTIONS } from '@/composables/use-engine-config'
import { useUiStore } from '@/stores/ui'

const emit = defineEmits<{
  close: []
}>()

const {
  settings,
  currentEngine,
  isCopilotEngine,
  updateReasoningEffort,
  updateWireApi,
  updateAgentMode,
  updateApprovalMode,
  updateMaxSteps,
  reasoningEffortSelectOptions,
  wireApiSelectOptions,
  approvalSelectOptions,
  agentModeSelectOptions,
} = useEngineConfig()

const uiStore = useUiStore()

/** Current engine display label */
const engineLabel = ENGINE_OPTIONS.find((o) => o.value === currentEngine.value)?.label ?? '内置引擎'

/** Open full settings page */
function handleOpenFullSettings(): void {
  emit('close')
  uiStore.setCurrentView('settings')
}
</script>

<template>
  <div class="engine-config">
    <div class="engine-config__header">
      <span class="engine-config__title">{{ engineLabel }} 配置</span>
    </div>

    <div class="engine-config__body">
      <!-- ─── Copilot SDK options ─────────────────────────── -->
      <template v-if="isCopilotEngine">
        <div class="config-field">
          <span class="config-field__label">推理强度</span>
          <NSelect
            :value="settings?.copilotReasoningEffort ?? ''"
            :options="reasoningEffortSelectOptions"
            size="small"
            @update:value="(v) => updateReasoningEffort(v as string)"
          />
        </div>

        <div class="config-field">
          <span class="config-field__label">Agent 模式</span>
          <NSelect
            :value="settings?.copilotAgentMode ?? ''"
            :options="agentModeSelectOptions"
            size="small"
            @update:value="(v) => updateAgentMode(v as string)"
          />
        </div>

        <div class="config-field">
          <span class="config-field__label">Wire API</span>
          <NSelect
            :value="settings?.copilotWireApi ?? 'auto'"
            :options="wireApiSelectOptions"
            size="small"
            @update:value="(v) => updateWireApi(v as string)"
          />
        </div>
      </template>

      <!-- ─── Common options (all engines) ────────────────── -->
      <div class="config-field">
        <span class="config-field__label">审批模式</span>
        <NSelect
          :value="settings?.defaultApprovalMode ?? 'suggest'"
          :options="approvalSelectOptions"
          size="small"
          @update:value="(v) => updateApprovalMode(v as ApprovalMode)"
        />
      </div>

      <div class="config-field">
        <span class="config-field__label">最大执行步数</span>
        <NInputNumber
          :value="settings?.maxExecutionSteps ?? 20"
          :min="1"
          :max="100"
          size="small"
          @update:value="(v) => { if (v !== null) updateMaxSteps(v) }"
        />
      </div>
    </div>

    <NDivider class="engine-config__divider" />

    <button class="engine-config__footer" @click="handleOpenFullSettings">
      完整配置...
    </button>
  </div>
</template>

<style scoped>
.engine-config {
  display: flex;
  flex-direction: column;
}

.engine-config__header {
  padding: 2px 0 8px;
}

.engine-config__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-secondary, #d1d5db);
}

.engine-config__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-field__label {
  font-size: 11px;
  color: var(--af-text-muted, #9ca3af);
  font-weight: 500;
}

.engine-config__divider {
  margin: 10px 0 6px !important;
}

.engine-config__footer {
  display: block;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--af-brand, #818cf8);
  text-align: left;
  transition: background-color 0.12s ease;
}

.engine-config__footer:hover {
  background-color: var(--af-bg-hover, #374151);
}
</style>
