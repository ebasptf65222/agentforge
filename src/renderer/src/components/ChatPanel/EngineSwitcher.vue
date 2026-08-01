<script setup lang="ts">
// EngineSwitcher - Compact segmented control for quick engine switching.
// Displays three pills (内置/SDK/LangGraph) in the chat input toolbar.
// When Copilot SDK is selected, a gear icon appears to open EngineConfigPopover.

import { ref, watch } from 'vue'
import { NPopover, NIcon, NTooltip } from 'naive-ui'
import { SettingsOutlined } from '@vicons/material'
import type { EngineType } from '@shared/types'
import { useEngineConfig, ENGINE_OPTIONS } from '@/composables/use-engine-config'
import { useUiStore } from '@/stores/ui'
import EngineConfigPopover from './EngineConfigPopover.vue'

const { currentEngine, switchEngine } = useEngineConfig()
const uiStore = useUiStore()

const showConfigPopover = ref(false)

// Watch for keyboard shortcut trigger (Ctrl+Shift+E)
watch(() => uiStore.engineSwitcherTrigger, () => {
  showConfigPopover.value = true
})

function handleEngineClick(value: EngineType): void {
  if (value !== currentEngine.value) {
    void switchEngine(value)
  }
}
</script>

<template>
  <div class="engine-switcher">
    <div class="engine-switcher__pills">
      <NTooltip
        v-for="opt in ENGINE_OPTIONS"
        :key="opt.value"
        trigger="hover"
        :delay="400"
      >
        <template #trigger>
          <button
            class="engine-pill"
            :class="{ 'engine-pill--active': currentEngine === opt.value }"
            @click="handleEngineClick(opt.value)"
          >
            {{ opt.short }}
          </button>
        </template>
        {{ opt.label }}
      </NTooltip>
    </div>

    <!-- Config gear icon (always visible, opens engine config popover) -->
    <NPopover
      v-model:show="showConfigPopover"
      trigger="click"
      placement="top-start"
      :width="320"
      :show-arrow="false"
    >
      <template #trigger>
        <button
          class="engine-switcher__config"
          title="引擎配置"
        >
          <NIcon :size="13">
            <SettingsOutlined />
          </NIcon>
        </button>
      </template>
      <EngineConfigPopover @close="showConfigPopover = false" />
    </NPopover>
  </div>
</template>

<style scoped>
.engine-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
}

.engine-switcher__pills {
  display: flex;
  align-items: center;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  padding: 1px;
  gap: 1px;
}

.engine-pill {
  padding: 2px 8px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: none;
  font-size: 11px;
  color: var(--af-text-muted, #9ca3af);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  line-height: 1;
}

.engine-pill:hover {
  color: var(--af-text-secondary, #d1d5db);
  background-color: var(--af-bg-hover, #374151);
}

.engine-pill--active {
  background-color: color-mix(in srgb, var(--af-brand, #4f46e5) 18%, transparent);
  color: var(--af-brand, #818cf8);
  font-weight: 600;
}

.engine-pill--active:hover {
  background-color: color-mix(in srgb, var(--af-brand, #4f46e5) 24%, transparent);
  color: var(--af-brand, #818cf8);
}

.engine-switcher__config {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--af-text-muted, #6b7280);
  cursor: pointer;
  transition: all 0.15s ease;
}

.engine-switcher__config:hover {
  color: var(--af-text-secondary, #d1d5db);
  background-color: var(--af-bg-hover, #374151);
}
</style>
