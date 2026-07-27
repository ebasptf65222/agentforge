<template>
  <div class="app">
    <NConfigProvider :theme="naiveTheme" :theme-overrides="naiveThemeOverrides">
      <NMessageProvider>
        <NDialogProvider>
          <TitleBar />
          <div class="app__content">
            <ChatView v-if="uiStore.currentView === 'chat'" />
            <KbView v-else-if="uiStore.currentView === 'kb'" />
            <WikiView v-else-if="uiStore.currentView === 'wiki'" />
            <SettingsView v-else />
          </div>
        </NDialogProvider>
      </NMessageProvider>
    </NConfigProvider>
  </div>
</template>

<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/composables/use-theme'
import TitleBar from '@/components/common/TitleBar.vue'
import WikiView from '@/components/Wiki/WikiView.vue'
import ChatView from '@/views/ChatView.vue'
import KbView from '@/views/KbView.vue'
import SettingsView from '@/views/SettingsView.vue'

const uiStore = useUiStore()
const { naiveTheme, naiveThemeOverrides } = useTheme()
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

/* Naive-ui provider wrappers must fill the flex parent height */
.app > .n-config-provider {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app > .n-config-provider > .n-message-provider {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app > .n-config-provider > .n-message-provider > .n-dialog-provider {
  flex: 1;
  min-height: 0;
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
</style>
