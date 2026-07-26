<script setup lang="ts">
// P1-10 / P1-15 / P1-16: SettingsView - tabbed settings page.
// Uses naive-ui NTabs to switch between ModelConfig and GeneralSettings.
// A back button (NButton + NIcon) in the tab bar prefix returns to the chat view.

import { ref, type CSSProperties } from 'vue'
import { NTabs, NTabPane, NButton, NIcon } from 'naive-ui'
import { ArrowLeftOutlined } from '@vicons/material'
import { useUiStore } from '@/stores/ui'
import ModelConfig from '@/components/Settings/ModelConfig.vue'
import GeneralSettings from '@/components/Settings/GeneralSettings.vue'

type SettingsTab = 'models' | 'general'

const uiStore = useUiStore()
const activeTab = ref<SettingsTab>('models')

function backToChat(): void {
  uiStore.setCurrentView('chat')
}

// Layout styles for the NTabs content area so child views can fill the
// remaining height and manage their own scrolling.
const paneWrapperStyle: CSSProperties = {
  flex: '1',
  minHeight: '0',
}
const paneStyle: CSSProperties = {
  height: '100%',
  padding: '24px',
}
</script>

<template>
  <div class="settings-view">
    <NTabs
      v-model:value="activeTab"
      type="line"
      animated
      :tabs-padding="12"
      class="settings-view__tabs"
      :pane-wrapper-style="paneWrapperStyle"
      :pane-style="paneStyle"
    >
      <template #prefix>
        <NButton
          circle
          quaternary
          title="返回对话"
          class="settings-view__back"
          @click="backToChat"
        >
          <NIcon>
            <ArrowLeftOutlined />
          </NIcon>
        </NButton>
      </template>
      <NTabPane name="models" tab="模型配置">
        <ModelConfig />
      </NTabPane>
      <NTabPane name="general" tab="通用设置">
        <GeneralSettings />
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--af-bg, #0f172a);
}

.settings-view__tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.settings-view__back {
  margin-right: 12px;
}
</style>
