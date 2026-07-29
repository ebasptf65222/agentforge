<script setup lang="ts">
// ChatView - main chat experience with Sidebar + ChatPanel + Agent ExecutionPanel

import { onMounted, onUnmounted, computed, ref } from 'vue'
import { NIcon, NModal, NInput } from 'naive-ui'
import { MenuOutlined } from '@vicons/material'
import type { ChatMessage } from '@shared/types'
import { useChatStore } from '@/stores/chat'
import { useAgentStore } from '@/stores/agent'
import { useUiStore } from '@/stores/ui'
import { useModelStore } from '@/stores/model'
import { useSettingsStore } from '@/stores/settings'
import { useChat } from '@/composables/use-chat'
import { useAgent } from '@/composables/use-agent'
import SidebarHeader from '@/components/Sidebar/SidebarHeader.vue'
import ConversationList from '@/components/Sidebar/ConversationList.vue'
import FileTreePanel from '@/components/Sidebar/FileTreePanel.vue'
import FilePreview from '@/components/Sidebar/FilePreview.vue'
import MessageList from '@/components/ChatPanel/MessageList.vue'
import ChatInput from '@/components/ChatPanel/ChatInput.vue'
import ExecutionPanel from '@/components/Agent/ExecutionPanel.vue'
import AuditReportPanel from '@/components/Agent/AuditReportPanel.vue'
import VoiceControlPanel from '@/components/VoiceControlPanel.vue'
import { showToast } from '@/utils/toast'

const chatStore = useChatStore()
const agentStore = useAgentStore()
const uiStore = useUiStore()
const modelStore = useModelStore()
const settingsStore = useSettingsStore()

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
 * Global keyboard shortcuts (OPT-UI-12).
 */
function handleKeydown(event: KeyboardEvent): void {
  const isMod = event.metaKey || event.ctrlKey
  const target = event.target as HTMLElement | null
  const isInput =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)

  // Cmd/Ctrl + B -> toggle sidebar
  if (isMod && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    uiStore.toggleSidebar()
    return
  }

  // Cmd/Ctrl + N -> new conversation (not when typing in input)
  if (isMod && event.key.toLowerCase() === 'n' && !isInput) {
    event.preventDefault()
    void handleNewChat()
    return
  }

  // Cmd/Ctrl + Shift + K -> open knowledge base
  if (isMod && event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    handleOpenKb()
    return
  }

  // Cmd/Ctrl + , -> open settings
  if (isMod && event.key === ',') {
    event.preventDefault()
    handleOpenSettings()
    return
  }

  // Escape -> stop generation (if generating)
  if (event.key === 'Escape' && isGenerating.value) {
    event.preventDefault()
    void handleStop()
    return
  }
}

async function handleNewChat(): Promise<void> {
  // 优先使用设置的默认模型，回退到列表第一个
  const defaultId = settingsStore.settings?.defaultModelId
  const defaultModel = defaultId
    ? modelStore.models.find((m) => m.id === defaultId)
    : null
  const selectedModel = defaultModel ?? modelStore.models[0]

  if (!selectedModel) {
    // No models configured — open settings so user can add one
    uiStore.setCurrentView('settings')
    return
  }
  await chatStore.newConversation(selectedModel.id)
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

async function handleClearConversation(id: string): Promise<void> {
  await chatStore.clearConversation(id)
}

async function handleSearchConversations(keyword: string): Promise<void> {
  chatStore.searchQuery = keyword
  await chatStore.searchConversations(keyword)
}

async function handleSend(content: string, skillName?: string): Promise<void> {
  const conv = chatStore.currentConversation
  if (!conv) return

  // 乐观添加用户消息到 UI（Agent IPC 会持久化到 DB）
  const userMessage: ChatMessage = {
    id: `temp-user-${Date.now()}`,
    conversationId: conv.id,
    role: 'user',
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  chatStore.messages.push(userMessage)

  // 始终走 Agent 路径，让 AI 具备工具调用能力
  // 无论是否选择 Skill，都通过 ReAct 引擎执行
  try {
    const result = await agentStore.execute({
      conversationId: conv.id,
      userInput: content,
      modelId: conv.modelId,
      approvalMode: conv.approvalMode,
      maxSteps: 20,
      skillName: skillName ?? undefined,
    })
    // Trigger audit after execution completes (WA-07)
    if (result) {
      await agentStore.runAudit()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`执行失败: ${message}`, 'error')
  } finally {
    // 执行完成后重新加载消息（Agent 会将结果持久化到 DB）
    await chatStore.selectConversation(conv.id)
    await chatStore.loadConversations({ silent: true })
    agentStore.reset()
  }
}

async function handleStop(): Promise<void> {
  // 同时停止 Chat 和 Agent 两种路径
  if (agentStore.isRunning) {
    await agentStore.stop()
  }
  if (chatStore.isGenerating) {
    await chatStore.stopGeneration()
  }
}

/** Send an example prompt from the welcome screen (OPT-UI-01) */
async function handleSendPrompt(prompt: string): Promise<void> {
  // Ensure we have a conversation first
  if (!chatStore.currentConversation) {
    await handleNewChat()
    if (!chatStore.currentConversation) return
  }
  await handleSend(prompt)
}

const hasConversation = computed(() => chatStore.currentConversationId !== null)

// ─── Message action handlers (OPT-UI-02) ───────────────────────

/** Edit message modal state */
const editingMessage = ref<ChatMessage | null>(null)
const editContent = ref('')
const showEditModal = ref(false)

function handleCopyMessage(_content: string): void {
  // Copy is handled inside MessageItem; this hook is for future extensions (e.g. toast)
}

/** Retry an assistant message: re-send the previous user message */
async function handleRetryMessage(message: ChatMessage): Promise<void> {
  const idx = chatStore.messages.findIndex((m) => m.id === message.id)
  if (idx <= 0) return
  const prevUserMessage = chatStore.messages[idx - 1]
  if (prevUserMessage.role !== 'user') return

  // Remove the assistant message being retried and any messages after it
  chatStore.messages = chatStore.messages.slice(0, idx)

  // Re-send through agent path
  await handleSend(prevUserMessage.content)
}

/** Open edit modal for a user message */
function handleEditMessage(message: ChatMessage): void {
  editingMessage.value = message
  editContent.value = message.content
  showEditModal.value = true
}

/** Confirm edit: delete subsequent messages and re-send */
async function handleConfirmEdit(): Promise<void> {
  if (!editingMessage.value) return
  const newContent = editContent.value.trim()
  if (!newContent) return

  const idx = chatStore.messages.findIndex((m) => m.id === editingMessage.value!.id)
  if (idx !== -1) {
    // Remove this message and everything after it
    chatStore.messages = chatStore.messages.slice(0, idx)
  }
  showEditModal.value = false
  editingMessage.value = null
  await handleSend(newContent)
}

function handleCancelEdit(): void {
  showEditModal.value = false
  editingMessage.value = null
  editContent.value = ''
}

async function handleDeleteMessage(messageId: string): Promise<void> {
  await chatStore.deleteMessage(messageId)
}

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
        :conversations="chatStore.filteredConversations"
        :current-id="chatStore.currentConversationId"
        :loading="chatStore.loading"
        :search-query="chatStore.searchQuery"
        @select="handleSelectConversation"
        @new-chat="handleNewChat"
        @delete="handleDeleteConversation"
        @rename="handleRenameConversation"
        @clear="handleClearConversation"
        @update:search-query="handleSearchConversations"
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
        @copy="handleCopyMessage"
        @retry="handleRetryMessage"
        @edit="handleEditMessage"
        @delete-message="handleDeleteMessage"
        @new-chat="handleNewChat"
        @open-settings="handleOpenSettings"
        @open-kb="handleOpenKb"
        @send-prompt="handleSendPrompt"
      />
      <ExecutionPanel />
      <AuditReportPanel />
      <ChatInput
        :disabled="!hasConversation"
        :is-generating="isGenerating"
        @send="handleSend"
        @stop="handleStop"
      />
      <!-- Voice control panel (V1-08) - fixed position global player -->
      <VoiceControlPanel />
    </main>

    <!-- Edit message modal (OPT-UI-02) -->
    <NModal
      v-model:show="showEditModal"
      preset="dialog"
      title="编辑消息"
      positive-text="发送"
      negative-text="取消"
      @positive-click="handleConfirmEdit"
      @negative-click="handleCancelEdit"
      @close="handleCancelEdit"
    >
      <NInput
        v-model:value="editContent"
        type="textarea"
        :rows="4"
        placeholder="编辑消息内容..."
        @keydown.enter.prevent="handleConfirmEdit"
      />
    </NModal>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
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
