<script setup lang="ts">
// P1-16: Sidebar header with app title, new conversation button, and settings button.

import { computed } from 'vue'
import AppButton from '@/components/common/AppButton.vue'

const props = defineProps<{
  /** When true (sidebar collapsed), hide the title text and shrink the button label */
  collapsed?: boolean
}>()

const emit = defineEmits<{
  'new-chat': []
  settings: []
}>()

const newChatLabel = computed(() => (props.collapsed ? '+' : '+ 新建对话'))
</script>

<template>
  <div class="sidebar-header" :class="{ 'sidebar-header--collapsed': collapsed }">
    <div v-if="!collapsed" class="sidebar-header__row">
      <h1 class="sidebar-header__title">AgentForge</h1>
      <button
        class="sidebar-header__settings"
        type="button"
        title="设置"
        aria-label="设置"
        @click="emit('settings')"
      >
        <span class="sidebar-header__gear" aria-hidden="true">&#9881;</span>
      </button>
    </div>
    <AppButton
      size="sm"
      variant="secondary"
      :title="collapsed ? '新建对话 (Cmd/Ctrl+N)' : undefined"
      @click="emit('new-chat')"
    >
      {{ newChatLabel }}
    </AppButton>
    <button
      v-if="collapsed"
      class="sidebar-header__settings"
      type="button"
      title="设置"
      aria-label="设置"
      @click="emit('settings')"
    >
      <span class="sidebar-header__gear" aria-hidden="true">&#9881;</span>
    </button>
  </div>
</template>

<style scoped>
.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #374151;
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
  color: #f9fafb;
  margin: 0;
  white-space: nowrap;
}

.sidebar-header__settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background-color: transparent;
  color: #9ca3af;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.sidebar-header__settings:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

.sidebar-header__gear {
  font-size: 16px;
  line-height: 1;
}
</style>
