<script setup lang="ts">
// ChatView - main chat experience with Sidebar + ChatPanel + Agent ExecutionPanel

import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
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
import ConversationTreeModal from '@/components/Sidebar/ConversationTreeModal.vue'
import FileTreePanel from '@/components/Sidebar/FileTreePanel.vue'
import FilePreviewPanel from '@/components/FilePreviewPanel.vue'
import MessageList from '@/components/ChatPanel/MessageList.vue'
import ContextUsageBar from '@/components/ChatPanel/ContextUsageBar.vue'
import ChatInput from '@/components/ChatPanel/ChatInput.vue'
import LinkPreviewPanel from '@/components/ChatPanel/LinkPreviewPanel.vue'
import ExecutionSummaryBar from '@/components/Agent/ExecutionSummaryBar.vue'
import ExecutionDrawer from '@/components/Agent/ExecutionDrawer.vue'
import CheckpointPanel from '@/components/Checkpoint/CheckpointPanel.vue'
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
  await Promise.all([
    chatStore.loadConversations(),
    modelStore.loadModels(),
    settingsStore.loadSettings(),
  ])
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

  // Cmd/Ctrl + Shift + M -> open model switcher
  if (isMod && event.shiftKey && event.key.toLowerCase() === 'm') {
    event.preventDefault()
    uiStore.triggerModelSwitcher()
    return
  }

  // Cmd/Ctrl + Shift + E -> open engine switcher config
  if (isMod && event.shiftKey && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    uiStore.triggerEngineSwitcher()
    return
  }

  // Cmd/Ctrl + , -> open settings
  if (isMod && event.key === ',') {
    event.preventDefault()
    handleOpenSettings()
    return
  }

    // Cmd/Ctrl + Enter -> approve pending approval
  if (isMod && event.key === 'Enter' && agentStore.isWaitingApproval) {
    event.preventDefault()
    agentStore.respondApproval(true)
    return
  }
  
  // Cmd/Ctrl + Shift + X -> reject pending approval
  if (isMod && event.shiftKey && event.key.toLowerCase() === 'x' && agentStore.isWaitingApproval) {
    event.preventDefault()
    agentStore.respondApproval(false, '用户拒绝（快捷键）')
    return
  }
  
  // Escape -> close preview panel (if open, takes priority over stop generation)
  if (event.key === 'Escape' && uiStore.previewPanelOpen) {
    event.preventDefault()
    uiStore.closePreviewPanel()
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

function handleOpenCheckpoints(): void {
  uiStore.toggleCheckpointPanel()
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

async function handleForkConversation(id: string): Promise<void> {
  // P3-01: Fork 对话
  const conv = chatStore.conversations.find((c) => c.id === id)
  if (!conv) return

  const forked = await chatStore.forkConversation()
  if (forked) {
    // 分支成功后切换到新会话
    await chatStore.selectConversation(forked.id)
  }
}

// P3-01: 分支树视图
const showTreeModal = ref(false)
const treeTargetId = ref<string | null>(null)

function handleShowTree(id: string): void {
  treeTargetId.value = id
  showTreeModal.value = true
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
  const editing = editingMessage.value
  if (!editing) return
  const newContent = editContent.value.trim()
  if (!newContent) return

  const idx = chatStore.messages.findIndex((m) => m.id === editing.id)
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

// ─── Inline permission card handlers (UI-REDESIGN v0.3) ─────────

function handleInlineApprove(remember: boolean): void {
  agentStore.respondApproval(true, undefined, remember)
}

function handleInlineReject(reason?: string): void {
  agentStore.respondApproval(false, reason)
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
const sidebarWidth = computed(() => (uiStore.sidebarCollapsed ? '0px' : 'var(--af-panel-sidebar, 240px)'))

// ─── UI-REDESIGN v1.0: 执行详情抽屉状态 ────────────────────
const executionDrawerOpen = ref(false)

/** 执行开始时自动展开抽屉 */
watch(
  () => agentStore.isRunning,
  (running) => {
    if (running) executionDrawerOpen.value = true
  },
)
</script>

<template>
  <div
    class="chat-view"
    :class="`chat-view--${uiStore.viewport}`"
  >
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
        @open-checkpoints="handleOpenCheckpoints"
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
        @fork="handleForkConversation"
        @show-tree="handleShowTree"
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

    <!-- File Panel (WS-05) — only FileTreePanel; preview takes over main area -->
    <aside
      v-if="uiStore.filePanelVisible"
      class="chat-view__file-panel"
    >
      <FileTreePanel />
    </aside>

    <!-- Checkpoint Panel (P2-02) -->
    <aside
      v-if="uiStore.checkpointPanelVisible"
      class="chat-view__checkpoint-panel"
    >
      <CheckpointPanel />
    </aside>

    <!-- Main area — preview takes over when open; chat hidden via v-show to preserve state -->
    <main class="chat-view__main">
      <div v-show="!uiStore.previewPanelOpen" class="chat-view__chat-content">
        <ContextUsageBar />
        <MessageList
          :messages="chatStore.messages"
          :streaming-content="activeStreamingContent"
          :is-generating="isGenerating"
          :pending-approval="agentStore.pendingApproval"
          :approval-resolved="agentStore.approvalResolved"
          @copy="handleCopyMessage"
          @retry="handleRetryMessage"
          @edit="handleEditMessage"
          @delete-message="handleDeleteMessage"
          @new-chat="handleNewChat"
          @open-settings="handleOpenSettings"
          @open-kb="handleOpenKb"
          @send-prompt="handleSendPrompt"
          @approve="handleInlineApprove"
          @reject="handleInlineReject"
        />
        <ExecutionSummaryBar @expand="executionDrawerOpen = true" />
        <ExecutionDrawer v-model:open="executionDrawerOpen" />
        <ChatInput
          :disabled="!hasConversation"
          :is-generating="isGenerating"
          @send="handleSend"
          @stop="handleStop"
        />
        <VoiceControlPanel />
      </div>
      <Transition name="preview-fade">
        <FilePreviewPanel v-if="uiStore.previewPanelOpen" />
      </Transition>
    </main>

    <!-- 应用内链接预览面板 -->
    <LinkPreviewPanel />

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

    <!-- Conversation branch tree modal (P3-01) -->
    <ConversationTreeModal
      v-model:show="showTreeModal"
      :conversation-id="treeTargetId"
      @select="handleSelectConversation"
    />
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
  width: var(--af-panel-aux, 280px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--af-border, #374151);
  overflow: hidden;
}

.chat-view__checkpoint-panel {
  width: var(--af-panel-checkpoint, 360px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ─── UI-REDESIGN v1.0: compact 断点 —— 面板 overlay 抽屉化 ── */
.chat-view--compact .chat-view__sidebar,
.chat-view--compact .chat-view__file-panel,
.chat-view--compact .chat-view__checkpoint-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 30;
  box-shadow: var(--af-shadow-2, 0 4px 16px rgba(0, 0, 0, 0.4));
}

.chat-view--compact .chat-view__sidebar {
  left: 0;
}

.chat-view--compact .chat-view__file-panel,
.chat-view--compact .chat-view__checkpoint-panel {
  right: 0;
  border-left: 1px solid var(--af-border, #374151);
}

/* ─── File preview panel transition & layout ─────────────────── */

/* Chat content wrapper: fills main area, v-show toggles visibility */
.chat-view__chat-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* Preview panel fade transition */
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity var(--af-dur-base, 200ms) var(--af-ease, ease);
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}
</style>
