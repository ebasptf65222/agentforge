<script setup lang="ts">
// P1-16: Sidebar header with app title, new conversation button, and settings button.

import { computed } from 'vue'
import { NIcon } from 'naive-ui'
import { AddOutlined, FolderOutlined, HistoryOutlined } from '@vicons/material'
import AppButton from '@/components/common/AppButton.vue'

const props = defineProps<{
  /** When true (sidebar collapsed), hide the title text and shrink the button label */
  collapsed?: boolean
}>()

const emit = defineEmits<{
  'new-chat': []
  settings: []
  'open-kb': []
  'open-files': []
  'open-checkpoints': []
}>()

// UI-REDESIGN v1.0: 知识库/设置入口已移至 AppShell 导航栏，
// 此处仅保留工作区文件/文件快照两个面板开关。settings/open-kb 事件保留以兼容父组件。()

const newChatLabel = computed(() => (props.collapsed ? '' : '新建对话'))
</script>

<template>
  <div class="sidebar-header" :class="{ 'sidebar-header--collapsed': collapsed }">
    <div v-if="!collapsed" class="sidebar-header__row">
      <h1 class="sidebar-header__title">AgentForge</h1>
      <div class="sidebar-header__nav">
        <button
          class="sidebar-header__icon-btn"
          type="button"
          title="工作区文件"
          aria-label="工作区文件"
          @click="emit('open-files')"
        >
          <NIcon :size="16" aria-hidden="true">
            <FolderOutlined />
          </NIcon>
        </button>
        <button
          class="sidebar-header__icon-btn"
          type="button"
          title="文件快照"
          aria-label="文件快照"
          @click="emit('open-checkpoints')"
        >
          <NIcon :size="16" aria-hidden="true">
            <HistoryOutlined />
          </NIcon>
        </button>
      </div>
    </div>
    <AppButton
      size="sm"
      variant="secondary"
      :title="collapsed ? '新建对话 (Cmd/Ctrl+N)' : undefined"
      @click="emit('new-chat')"
    >
      <span class="sidebar-header__new-chat-content">
        <NIcon :size="16"><AddOutlined /></NIcon>
        <span v-if="!collapsed">{{ newChatLabel }}</span>
      </span>
    </AppButton>
    <div v-if="collapsed" class="sidebar-header__nav">
      <button
        class="sidebar-header__icon-btn"
        type="button"
        title="工作区文件"
        aria-label="工作区文件"
        @click="emit('open-files')"
      >
        <NIcon :size="16" aria-hidden="true">
          <FolderOutlined />
        </NIcon>
      </button>
      <button
        class="sidebar-header__icon-btn"
        type="button"
        title="文件快照"
        aria-label="文件快照"
        @click="emit('open-checkpoints')"
      >
        <NIcon :size="16" aria-hidden="true">
          <HistoryOutlined />
        </NIcon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--af-border, #374151);
}

.sidebar-header--collapsed {
  align-items: center;
  padding: 16px 8px;
}

.sidebar-header__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-header__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--af-text-primary, #f9fafb);
  margin: 0;
  white-space: nowrap;
}

.sidebar-header__nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar-header--collapsed .sidebar-header__nav {
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.sidebar-header__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-tertiary, #9ca3af);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.sidebar-header__icon-btn:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.sidebar-header__new-chat-content {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
