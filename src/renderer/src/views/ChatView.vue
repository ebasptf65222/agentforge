<script setup lang="ts">
// ChatView - main chat experience with Sidebar + ChatPanel + Agent ExecutionPanel

import { onMounted, onUnmounted, computed } from 'vue'
import { NIcon } from 'naive-ui'
import { MenuOutlined } from '@vicons/material'
import { useChatStore } from '@/stores/chat'
import { useAgentStore } from '@/stores/agent'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useChat } from '@/composables/use-chat'
import { useAgent } from '@/composables/use-agent'
import SidebarHeader from '@/components/Sidebar/SidebarHeader.vue'
import ConversationList from '@/components/Sidebar/ConversationList.vue'
import FileTreePanel from '@/components/Sidebar/FileTreePanel.vue'
import FilePreview from '@/components/Sidebar/FilePreview.vue'
import MessageList from '@/components/ChatPanel/MessageList.vue'
import ChatInput from '@/components/ChatPanel/ChatInput.vue'
import ExecutionPanel from '@/components/Agent/ExecutionPanel.vue'
import VoiceControlPanel from '@/components/VoiceControlPanel.vue'

const chatStore = useChatStore()
const agentStore = useAgentStore()
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

function handleOpenFiles(): void {
  uiStore.toggleFilePanel()
}

async function handleSelectConversation(id: string): Promise<void> {
  await chatStore.selectConversation(id)
}

async function handleDeleteConversation(id: string): Promise<void> {
  await chatStore.deleteConversation(id)
}

async function handleRenameConversation(id: string, newTitle: string): Promise<void> {
  await chatStore.renameConversation(id, newTitle)
}

async function handleSend(content: string, skillName?: string): Promise<void> {
  const conv = chatStore.currentConversation
  if (!conv) return

  if (skillName) {
    // Agent 执行路径（Skill 模式）
    await agentStore.execute({
      conversationId: conv.id,
      userInput: content,
      modelId: conv.modelId,
      approvalMode: conv.approvalMode,
      maxSteps: 20,
      skillName,
    })
  } else {
    // 普通对话路径
    await chatStore.sendMessage(content)
  }
}

async function handleStop(): Promise<void> {
  await chatStore.stopGeneration()
}

const hasConversation = computed(() => chatStore.currentConversationId !== null)

// OPT2-11: Agent 模式下流式内容在 agentStore 中累积，
// 但 MessageList 接收的是 chatStore.streamingContent，导致 Agent 流式文本不显示。
// 统一计算属性，根据当前是否在 Agent 执行模式选择正确来源。
const activeStreamingContent = computed(() => {
  if (agentStore.isRunning || agentStore.status === 'running') {
    return agentStore.streamingContent
  }
  return chatStore.streamingContent
})

/** Whether any generation (chat or agent) is in progress */
const isGenerating = computed(() => chatStore.isGenerating || agentStore.isRunning)

/** Sidebar width based on collapsed state (P1-12) */
const sidebarWidth = computed(() => (uiStore.sidebarCollapsed ? '0px' : '240px'))
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
        @open-files="handleOpenFiles"
      />
      <ConversationList
        :conversations="chatStore.conversations"
        :current-id="chatStore.currentConversationId"
        :loading="chatStore.loading"
        @select="handleSelectConversation"
        @new-chat="handleNewChat"
        @delete="handleDeleteConversation"
        @rename="handleRenameConversation"
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

    <!-- File Panel (WS-05) -->
    <aside
      v-if="uiStore.filePanelVisible"
      class="chat-view__file-panel"
    >
      <FileTreePanel />
      <FilePreview />
    </aside>

    <!-- Main chat panel -->
    <main class="chat-view__main">
      <MessageList
        :messages="chatStore.messages"
        :streaming-content="activeStreamingContent"
        :is-generating="isGenerating"
      />
      <ExecutionPanel />
      <ChatInput
        :disabled="!hasConversation"
        :is-generating="isGenerating"
        @send="handleSend"
        @stop="handleStop"
      />
      <!-- Voice control panel (V1-08) - fixed position global player -->
      <VoiceControlPanel />
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

.chat-view__file-panel {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--af-border, #374151);
  overflow: hidden;
}
</style>
