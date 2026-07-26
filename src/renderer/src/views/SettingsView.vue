<script setup lang="ts">
// P1-10 / P1-15 / P1-16: SettingsView - tabbed settings page.
// Simple tab buttons (not naive-ui tabs) switch between ModelConfig
// and GeneralSettings. A back button returns to the chat view.

import { ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import ModelConfig from '@/components/Settings/ModelConfig.vue'
import GeneralSettings from '@/components/Settings/GeneralSettings.vue'

type SettingsTab = 'models' | 'general'

const uiStore = useUiStore()
const activeTab = ref<SettingsTab>('models')

const tabs: ReadonlyArray<{ value: SettingsTab; label: string }> = [
  { value: 'models', label: '模型配置' },
  { value: 'general', label: '通用设置' },
]

function backToChat(): void {
  uiStore.setCurrentView('chat')
}
</script>

<template>
  <div class="settings-view">
    <!-- Top bar: back button + tab navigation -->
    <header class="settings-view__header">
      <button class="settings-view__back" type="button" title="返回对话" @click="backToChat">
        <span aria-hidden="true">&larr;</span>
      </button>
      <nav class="settings-view__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          class="settings-view__tab"
          :class="{ 'settings-view__tab--active': activeTab === tab.value }"
          @click="activeTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <!-- Tab content -->
    <div class="settings-view__content">
      <ModelConfig v-if="activeTab === 'models'" />
      <GeneralSettings v-else />
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: #0f172a;
}

.settings-view__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid #374151;
  background-color: #111827;
  flex-shrink: 0;
}

.settings-view__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #1f2937;
  color: #e5e7eb;
  font-size: 16px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.settings-view__back:hover {
  background-color: #374151;
  border-color: #4b5563;
}

.settings-view__tabs {
  display: flex;
  gap: 4px;
}

.settings-view__tab {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  color: #9ca3af;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.settings-view__tab:hover {
  background-color: #1f2937;
  color: #e5e7eb;
}

.settings-view__tab--active {
  background-color: #4f46e5;
  color: #fff;
}

.settings-view__tab--active:hover {
  background-color: #4338ca;
  color: #fff;
}

.settings-view__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}
</style>
