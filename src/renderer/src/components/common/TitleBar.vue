<script setup lang="ts">
// TitleBar - 自定义标题栏
// 替代 Electron 原生菜单栏，提供自定义菜单下拉 + 窗口控制按钮

import { ref, onMounted, onUnmounted, h, type Component } from 'vue'
import { NIcon, NDropdown, type DropdownOption } from 'naive-ui'
import {
  MenuOutlined,
  RemoveOutlined,
  CropSquareOutlined,
  CloseOutlined,
  ChatBubbleOutlined,
  BookOutlined,
  SettingsOutlined,
  InfoOutlined,
  DeveloperModeOutlined,
  LogOutOutlined,
  HorizontalRuleOutlined,
} from '@vicons/material'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useToast } from '@/utils/toast'

const uiStore = useUiStore()
const chatStore = useChatStore()
const modelStore = useModelStore()

const isMaximized = ref(false)
// 渲染进程中无法访问 Node.js process，使用 navigator 检测平台
const isMac = navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Mac')

let cleanupMaximize: (() => void) | null = null

onMounted(async () => {
  isMaximized.value = await window.electron.window.isMaximized()
  cleanupMaximize = window.electron.window.onMaximizeChange((maximized) => {
    isMaximized.value = maximized
  })
})

onUnmounted(() => {
  cleanupMaximize?.()
})

// ─── 菜单动作 ──────────────────────────────────────────────────

// OPT2-04: 使用真实模型 ID 而非硬编码 'default'
async function handleNewChat(): Promise<void> {
  uiStore.setCurrentView('chat')
  const modelId = modelStore.models[0]?.id
  if (!modelId) {
    useToast().showToast('请先在设置中配置至少一个模型', 'warning')
    return
  }
  await chatStore.newConversation(modelId)
}

function handleOpenKb(): void {
  uiStore.setCurrentView('kb')
}

function handleOpenSettings(): void {
  uiStore.setCurrentView('settings')
}

async function handleAbout(): Promise<void> {
  const info = await window.electron.system.getVersion()
  alert(
    `AgentForge v${info.appVersion}\n` +
      `Electron ${info.electronVersion}\n` +
      `Node.js ${info.nodeVersion}\n` +
      `Platform: ${info.platform}`,
  )
}

function handleToggleDevtools(): void {
  void window.electron.window.toggleDevtools()
}

function handleQuit(): void {
  void window.electron.window.quit()
}

// ─── 窗口控制 ──────────────────────────────────────────────────

function handleMinimize(): void {
  void window.electron.window.minimize()
}

function handleMaximizeToggle(): void {
  void window.electron.window.maximizeToggle()
}

function handleClose(): void {
  void window.electron.window.close()
}

// ─── 下拉菜单配置 ──────────────────────────────────────────────

function renderIcon(icon: Component): () => Component {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: DropdownOption[] = [
  {
    label: '新建对话',
    key: 'new-chat',
    icon: renderIcon(ChatBubbleOutlined),
  },
  {
    label: '知识库',
    key: 'kb',
    icon: renderIcon(BookOutlined),
  },
  {
    label: '设置',
    key: 'settings',
    icon: renderIcon(SettingsOutlined),
  },
  { type: 'divider', key: 'd1' },
  {
    label: '开发者工具',
    key: 'devtools',
    icon: renderIcon(DeveloperModeOutlined),
  },
  {
    label: '关于 AgentForge',
    key: 'about',
    icon: renderIcon(InfoOutlined),
  },
  { type: 'divider', key: 'd2' },
  {
    label: '退出',
    key: 'quit',
    icon: renderIcon(LogOutOutlined),
  },
]

function handleMenuSelect(key: string): void {
  switch (key) {
    case 'new-chat':
      void handleNewChat()
      break
    case 'kb':
      handleOpenKb()
      break
    case 'settings':
      handleOpenSettings()
      break
    case 'devtools':
      handleToggleDevtools()
      break
    case 'about':
      void handleAbout()
      break
    case 'quit':
      handleQuit()
      break
  }
}
</script>

<template>
  <div class="title-bar" :class="{ 'title-bar--mac': isMac }">
    <!-- 左侧：macOS 交通灯预留 + 菜单按钮 -->
    <div class="title-bar__left">
      <NDropdown
        trigger="click"
        :options="menuOptions"
        placement="bottom-start"
        @select="handleMenuSelect"
      >
        <button class="title-bar__menu-btn" title="菜单">
          <NIcon :size="18">
            <MenuOutlined />
          </NIcon>
        </button>
      </NDropdown>
      <span class="title-bar__title">AgentForge</span>
    </div>

    <!-- 右侧：窗口控制按钮（仅 Windows/Linux） -->
    <div v-if="!isMac" class="title-bar__controls">
      <button
        class="title-bar__ctrl-btn title-bar__ctrl-btn--minimize"
        title="最小化"
        @click="handleMinimize"
      >
        <NIcon :size="16">
          <RemoveOutlined />
        </NIcon>
      </button>
      <button
        class="title-bar__ctrl-btn title-bar__ctrl-btn--maximize"
        :title="isMaximized ? '还原' : '最大化'"
        @click="handleMaximizeToggle"
      >
        <NIcon :size="14">
          <CropSquareOutlined v-if="!isMaximized" />
          <HorizontalRuleOutlined v-else />
        </NIcon>
      </button>
      <button
        class="title-bar__ctrl-btn title-bar__ctrl-btn--close"
        title="关闭"
        @click="handleClose"
      >
        <NIcon :size="16">
          <CloseOutlined />
        </NIcon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 0 0 8px;
  background: var(--af-bg-surface, #1e293b);
  border-bottom: 1px solid var(--af-border, #334155);
  /* 拖拽区域：让标题栏可拖动移动窗口 */
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
}

/* macOS: 左侧预留交通灯空间 */
.title-bar--mac {
  padding-left: 78px;
}

.title-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
}

.title-bar__menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  cursor: pointer;
  /* 交互元素取消拖拽 */
  -webkit-app-region: no-drag;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.title-bar__menu-btn:hover {
  background-color: var(--af-bg-hover, #334155);
  color: var(--af-text-primary, #f1f5f9);
}

.title-bar__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-tertiary, #94a3b8);
  white-space: nowrap;
}

.title-bar__controls {
  display: flex;
  align-items: center;
  height: 100%;
  /* 交互元素区域取消拖拽 */
  -webkit-app-region: no-drag;
}

.title-bar__ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--af-text-secondary, #cbd5e1);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.title-bar__ctrl-btn--minimize:hover,
.title-bar__ctrl-btn--maximize:hover {
  background-color: var(--af-bg-hover, #334155);
}

.title-bar__ctrl-btn--close:hover {
  background-color: var(--af-error, #ef4444);
  color: #ffffff;
}

.title-bar__ctrl-btn:active {
  transform: scale(0.95);
}
</style>
