<script setup lang="ts">
// ChatView - main chat experience with Sidebar + ChatPanel + Agent ExecutionPanel

import { onMounted, onUnmounted, computed } from 'vue'
import { NIcon } from 'naive-ui'
import { MenuOutlined } from '@vicons/material'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { useChat } from '@/composables/use-chat'
import { useAgent } from '@/composables/use-agent'
import SidebarHeader from '@/components/Sidebar/SidebarHeader.vue'
import ConversationList from '@/components/Sidebar/ConversationList.vue'
import MessageList from '@/components/ChatPanel/MessageList.vue'
import ChatInput from '@/components/ChatPanel/ChatInput.vue'
import ExecutionPanel from '@/components/Agent/ExecutionPanel.vue'

const chatStore = useChatStore()
const uiStore = useUiStore()

// Set up stream event listeners
useChat()
useAgent()

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  await chatStore.loadConversations()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

/**
 * Global keyboard shortcuts.
 * Cmd/Ctrl+B toggles the sidebar (P1-12).
 */
function handleKeydown(event: KeyboardEvent): void {
  // Cmd/Ctrl + B -> toggle sidebar
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    uiStore.toggleSidebar()
  }
}

async function handleNewChat(): Promise<void> {
  // Default model ID - in production this would come from settings/model store
  await chatStore.newConversation('default')
}

function handleOpenSettings(): void {
  uiStore.setCurrentView('settings')
}

function handleOpenKb(): void {
  uiStore.setCurrentView('kb')
}

async function handleSelectConversation(id: string): Promise<void> {
  await chatStore.selectConversation(id)
}

async function handleDeleteConversation(id: string): Promise<void> {
  await chatStore.deleteConversation(id)
}

async function handleSend(content: string, _skillName?: string): Promise<void> {
  // skillName 参数由 ChatInput 传入，后续可通过 Agent 执行路径使用
  await chatStore.sendMessage(content)
}

async function handleStop(): Promise<void> {
  await chatStore.stopGeneration()
}

const hasConversation = computed(() => chatStore.currentConversationId !== null)

/** Sidebar width based on collapsed state (P1-12) */
const sidebarWidth = computed(() => (uiStore.sidebarCollapsed ? '0px' : '260px'))
</script>

<template>
  <div class="chat-view">
    <!-- Sidebar -->
    <aside
      class="chat-view__sidebar"
      :class="{ 'chat-view__sidebar--collapsed': uiStore.sidebarCollapsed }"
    >
      <SidebarHeader
        :collapsed="uiStore.sidebarCollapsed"
        @new-chat="handleNewChat"
        @settings="handleOpenSettings"
        @open-kb="handleOpenKb"
      />
      <ConversationList
        :conversations="chatStore.conversations"
        :current-id="chatStore.currentConversationId"
        :loading="chatStore.loading"
        @select="handleSelectConversation"
        @new-chat="handleNewChat"
        @delete="handleDeleteConversation"
      />
    </aside>

    <!-- Edge toggle button shown when sidebar is collapsed (P1-12) -->
    <button
      v-if="uiStore.sidebarCollapsed"
      class="chat-view__sidebar-toggle"
      title="展开侧边栏 (Cmd/Ctrl+B)"
      @click="uiStore.toggleSidebar()"
    >
      <NIcon :size="18" class="chat-view__sidebar-toggle-icon">
        <MenuOutlined />
      </NIcon>
    </button>

    <!-- Main chat panel -->
    <main class="chat-view__main">
      <MessageList
        :messages="chatStore.messages"
        :streaming-content="chatStore.streamingContent"
        :is-generating="chatStore.isGenerating"
      />
      <ExecutionPanel />
      <ChatInput
        :disabled="!hasConversation"
        :is-generating="chatStore.isGenerating"
        @send="handleSend"
        @stop="handleStop"
      />
    </main>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.chat-view__sidebar {
  width: v-bind(sidebarWidth);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--af-bg-surface, #111827);
  border-right: 1px solid var(--af-border, #374151);
  overflow: hidden;
  transition: width 0.2s ease;
}

.chat-view__sidebar--collapsed {
  border-right: none;
}

/* Edge toggle button (P1-12): shown when sidebar is collapsed */
.chat-view__sidebar-toggle {
  position: absolute;
  top: 12px;
  left: 8px;
  z-index: 20;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  color: var(--af-text-primary, #e5e7eb);
  cursor: pointer;
  font-size: 16px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.chat-view__sidebar-toggle:hover {
  background-color: var(--af-bg-hover, #374151);
  border-color: var(--af-border, #4b5563);
}

.chat-view__sidebar-toggle-icon {
  line-height: 1;
}

.chat-view__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background-color: var(--af-bg, #0f172a);
}
</style>
