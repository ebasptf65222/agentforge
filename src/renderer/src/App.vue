<template>
  <div class="app">
    <ChatView v-if="uiStore.currentView === 'chat'" />
    <KbView v-else-if="uiStore.currentView === 'kb'" />
    <SettingsView v-else />
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import ChatView from '@/views/ChatView.vue'
import KbView from '@/views/KbView.vue'
import SettingsView from '@/views/SettingsView.vue'

const uiStore = useUiStore()
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
  background-color: #0f172a;
  color: #e5e7eb;
}

.app {
  width: 100%;
  height: 100%;
}
</style>
