<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="naiveThemeOverrides">
    <NMessageProvider>
      <NDialogProvider>
        <div class="app">
          <TitleBar />
          <AppShell>
            <div class="app__content">
              <ChatView v-if="uiStore.currentView === 'chat'" />
              <KbView v-else-if="uiStore.currentView === 'kb'" />
              <WikiView v-else-if="uiStore.currentView === 'wiki'" />
              <SettingsView v-else />
            </div>
          </AppShell>
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/composables/use-theme'
import TitleBar from '@/components/common/TitleBar.vue'
import AppShell from '@/components/common/AppShell.vue'
import WikiView from '@/components/Wiki/WikiView.vue'
import ChatView from '@/views/ChatView.vue'
import KbView from '@/views/KbView.vue'
import SettingsView from '@/views/SettingsView.vue'

const uiStore = useUiStore()
const { naiveTheme, naiveThemeOverrides } = useTheme()

// UI-REDESIGN v1.0: viewport 断点监听（HMR 安全：onUnmounted 清理）
let cleanupViewport: (() => void) | null = null
onMounted(() => {
  cleanupViewport = uiStore.initViewportListener()
})
onUnmounted(() => {
  cleanupViewport?.()
  cleanupViewport = null
})
</script>

<style>
/* Global reset & base styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* Naive UI providers (NConfigProvider / NMessageProvider / NDialogProvider)
   each render a wrapper <div> between #app and .app. Pass the viewport
   height through these wrappers so .app's flex column can work.
   注意：只穿透 provider 包装层本身（.app 的直接祖先链），
   不能用后代通配，否则 .app 内部元素（如 .title-bar）也会被强制 height:100%。 */
#app > div > div > div > div.app,
#app > div > div > div.app,
#app > div > div.app,
#app > div.app {
  width: 100%;
  height: 100%;
}
/* provider 包装层自身也要撑满并允许内部 flex 布局 */
#app > div:not(.app),
#app .n-config-provider,
#app .n-message-provider,
#app .n-dialog-provider {
  width: 100%;
  height: 100%;
}
.n-config-provider,
.n-message-provider,
.n-dialog-provider {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

body {
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: var(--af-bg, #0f172a);
  color: var(--af-text-primary, #e5e7eb);
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Scrollbar styling — uses theme tokens */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--af-border, #334155);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--af-text-muted, #64748b);
}

/* Selection */
::selection {
  background: rgba(99, 102, 241, 0.3);
}

/* ─── Action toast buttons (UI-REDESIGN v0.3) ─────────────────── */
/* Rendered imperatively by showActionToast() into notification action slot */

.af-toast-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.af-toast-actions__btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--af-border, #334155);
  background: var(--af-bg-surface, #1e293b);
  color: var(--af-brand, #818cf8);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.af-toast-actions__btn:hover {
  background: color-mix(in srgb, var(--af-brand, #6366f1) 12%, transparent);
  border-color: var(--af-brand, #6366f1);
}
</style>
