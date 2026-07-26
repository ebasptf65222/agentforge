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
  'open-kb': []
}>()

const newChatLabel = computed(() => (props.collapsed ? '+' : '+ 新建对话'))
</script>

<template>
  <div class="sidebar-header" :class="{ 'sidebar-header--collapsed': collapsed }">
    <div v-if="!collapsed" class="sidebar-header__row">
      <h1 class="sidebar-header__title">AgentForge</h1>
      <div class="sidebar-header__nav">
        <button
          class="sidebar-header__icon-btn"
          type="button"
          title="知识库"
          aria-label="知识库"
          @click="emit('open-kb')"
        >
          <span aria-hidden="true">&#128218;</span>
        </button>
        <button
          class="sidebar-header__icon-btn"
          type="button"
          title="设置"
          aria-label="设置"
          @click="emit('settings')"
        >
          <span class="sidebar-header__gear" aria-hidden="true">&#9881;</span>
        </button>
      </div>
    </div>
    <AppButton
      size="sm"
      variant="secondary"
      :title="collapsed ? '新建对话 (Cmd/Ctrl+N)' : undefined"
      @click="emit('new-chat')"
    >
      {{ newChatLabel }}
    </AppButton>
    <div v-if="collapsed" class="sidebar-header__nav">
      <button
        class="sidebar-header__icon-btn"
        type="button"
        title="知识库"
        aria-label="知识库"
        @click="emit('open-kb')"
      >
        <span aria-hidden="true">&#128218;</span>
      </button>
      <button
        class="sidebar-header__icon-btn"
        type="button"
        title="设置"
        aria-label="设置"
        @click="emit('settings')"
      >
        <span class="sidebar-header__gear" aria-hidden="true">&#9881;</span>
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
  border-radius: 6px;
  background-color: transparent;
  color: #9ca3af;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.sidebar-header__icon-btn:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
}

.sidebar-header__gear {
  font-size: 16px;
  line-height: 1;
}
</style>
