<script setup lang="ts">
// AppShell - 全局导航壳（UI-REDESIGN v1.0 批次 A）
// 左侧 56px 图标导航栏（rail）统一四视图切换，替代各视图自带的返回按钮
// 与 TitleBar 菜单中的重复入口。选中态：品牌色底 + 左侧 3px 指示条。

import { computed } from 'vue'
import { NIcon, NTooltip } from 'naive-ui'
import {
  ChatBubbleOutlined,
  BookOutlined,
  AutoStoriesOutlined,
  SettingsOutlined,
  VideoLibraryOutlined,
} from '@vicons/material'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()

interface RailItem {
  view: 'chat' | 'kb' | 'wiki' | 'video' | 'settings'
  label: string
  icon: unknown
}

const railItems: RailItem[] = [
  { view: 'chat', label: '对话', icon: ChatBubbleOutlined },
  { view: 'video', label: '视频库', icon: VideoLibraryOutlined },
  { view: 'kb', label: '知识库', icon: BookOutlined },
  { view: 'wiki', label: 'Wiki', icon: AutoStoriesOutlined },
  { view: 'settings', label: '设置', icon: SettingsOutlined },
]

const currentView = computed(() => uiStore.currentView)

function switchView(view: RailItem['view']): void {
  uiStore.setCurrentView(view)
}
</script>

<template>
  <div class="app-shell">
    <nav class="app-shell__rail">
      <div class="app-shell__logo" title="AgentForge">AF</div>
      <NTooltip v-for="item in railItems" :key="item.view" placement="right" :show-arrow="false">
        <template #trigger>
          <button
            class="app-shell__item"
            :class="{ 'app-shell__item--active': currentView === item.view }"
            :title="item.label"
            @click="switchView(item.view)"
          >
            <NIcon :size="20">
              <component :is="item.icon" />
            </NIcon>
          </button>
        </template>
        {{ item.label }}
      </NTooltip>
      <div class="app-shell__spacer" />
    </nav>
    <div class="app-shell__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  flex: 1;
  min-height: 0;
  display: flex;
}

.app-shell__rail {
  width: var(--af-rail-width, 56px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--af-space-3, 12px) 0;
  background-color: var(--af-bg-surface, #1e293b);
  border-right: 1px solid var(--af-border, #334155);
}

.app-shell__logo {
  width: 32px;
  height: 32px;
  border-radius: var(--af-radius, 8px);
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: var(--af-font-sm, 12px);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--af-space-3, 12px);
  user-select: none;
}

.app-shell__item {
  position: relative;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background: transparent;
  color: var(--af-text-muted, #64748b);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color var(--af-dur-fast, 120ms) var(--af-ease, ease),
    color var(--af-dur-fast, 120ms) var(--af-ease, ease);
}

.app-shell__item:hover {
  background-color: var(--af-bg-hover, #334155);
  color: var(--af-text-primary, #f1f5f9);
}

.app-shell__item--active {
  background-color: var(--af-brand-dim, rgba(129, 140, 248, 0.12));
  color: var(--af-brand, #818cf8);
}

/* 左侧选中指示条 */
.app-shell__item--active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 2px;
  background-color: var(--af-brand, #818cf8);
}

.app-shell__spacer {
  flex: 1;
}

.app-shell__body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
