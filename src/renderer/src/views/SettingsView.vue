<script setup lang="ts">
// P1-10 / P1-15 / P1-16: SettingsView - tabbed settings page.
// Uses naive-ui NTabs to switch between ModelConfig, McpConfig, SkillConfig, and GeneralSettings.
// A back button (NButton + NIcon) in the tab bar prefix returns to the chat view.

import { ref, computed, type CSSProperties } from 'vue'
import { NTabs, NTabPane, NButton, NIcon, NInput } from 'naive-ui'
import { ArrowLeftOutlined, SearchOutlined } from '@vicons/material'
import { useUiStore } from '@/stores/ui'
import ModelConfig from '@/components/Settings/ModelConfig.vue'
import McpConfig from '@/components/Settings/McpConfig.vue'
import SkillConfig from '@/components/Settings/SkillConfig.vue'
import VoiceConfig from '@/components/Settings/VoiceConfig.vue'
import WorkspaceConfig from '@/components/Settings/WorkspaceConfig.vue'
import GeneralSettings from '@/components/Settings/GeneralSettings.vue'

type SettingsTab = 'models' | 'mcp' | 'skills' | 'voice' | 'workspace' | 'general'

const uiStore = useUiStore()
const activeTab = ref<SettingsTab>('models')
const searchQuery = ref('')

/** Search keyword to tab mapping (OPT-UI-07) */
const TAB_KEYWORDS: Record<SettingsTab, string[]> = {
  models: ['模型', 'model', 'api', '密钥', 'key', '温度', 'temperature'],
  mcp: ['mcp', '服务器', 'server', '工具', 'tool', '市场', 'marketplace', '安装'],
  skills: ['skill', '技能', 'prompt', '变量'],
  voice: ['语音', 'voice', 'tts', 'stt', '录音', '播报', '语速'],
  workspace: ['工作区', 'workspace', '文件', '目录', 'folder'],
  general: ['通用', 'general', '主题', 'theme', '审批', 'approval', '超时', 'timeout'],
}

const tabOptions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return null

  const matched = (Object.entries(TAB_KEYWORDS) as [SettingsTab, string][]).find(([, keywords]) =>
    keywords.some((k) => k.includes(query) || query.includes(k)),
  )
  return matched ? matched[0] : null
})

function handleSearch(): void {
  if (tabOptions.value) {
    activeTab.value = tabOptions.value
    searchQuery.value = ''
  }
}

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
  overflow: 'auto',
}
</script>

<template>
  <div class="settings-view">
    <!-- Quick search bar (OPT-UI-07) -->
    <div class="settings-view__search">
      <NInput
        v-model:value="searchQuery"
        placeholder="搜索设置...（如：模型、主题、语音）"
        size="small"
        clearable
        @keydown.enter="handleSearch"
      >
        <template #prefix>
          <NIcon :size="16"><SearchOutlined /></NIcon>
        </template>
      </NInput>
    </div>

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
      <NTabPane name="mcp" tab="MCP 服务器">
        <McpConfig />
      </NTabPane>
      <NTabPane name="skills" tab="Skills">
        <SkillConfig />
      </NTabPane>
      <NTabPane name="voice" tab="语音">
        <VoiceConfig />
      </NTabPane>
      <NTabPane name="workspace" tab="工作区">
        <WorkspaceConfig />
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

.settings-view__search {
  padding: 8px 16px 0;
  flex-shrink: 0;
}
</style>
