<script setup lang="ts">
// ChatView - main chat experience with Sidebar + ChatPanel + Agent ExecutionPanel

import { onMounted, onUnmounted, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useChat } from '@/composables/use-chat'
import { useAgent } from '@/composables/use-agent'
import SidebarHeader from '@/components/Sidebar/SidebarHeader.vue'
import ConversationList from '@/components/Sidebar/ConversationList.vue'
import MessageList from '@/components/ChatPanel/MessageList.vue'
import ChatInput from '@/components/ChatPanel/ChatInput.vue'
import ExecutionPanel from '@/components/Agent/ExecutionPanel.vue'

const chatStore = useChatStore()
const uiStore = useUiStore()
const modelStore = useModelStore()

// Set up stream event listeners
useChat()
useAgent()

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  await Promise.all([chatStore.loadConversations(), modelStore.loadModels()])
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
  const firstModel = modelStore.models[0]
  if (!firstModel) {
    // No models configured — open settings so user can add one
    uiStore.setCurrentView('settings')
    return
  }
  await chatStore.newConversation(firstModel.id)
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

async function handleSend(content: string): Promise<void> {
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
      <span class="chat-view__sidebar-toggle-icon">☰</span>
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
  background-color: #111827;
  border-right: 1px solid #374151;
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
  background-color: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  color: #e5e7eb;
  cursor: pointer;
  font-size: 16px;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.chat-view__sidebar-toggle:hover {
  background-color: #374151;
  border-color: #4b5563;
}

.chat-view__sidebar-toggle-icon {
  line-height: 1;
}

.chat-view__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background-color: #0f172a;
}
</style>
