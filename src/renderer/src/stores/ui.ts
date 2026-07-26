// UI store - manages view state, sidebar collapse, etc.

import { defineStore } from 'pinia'
import { ref } from 'vue'

type ViewName = 'chat' | 'settings' | 'kb'

export const useUiStore = defineStore('ui', () => {
  const currentView = ref<ViewName>('chat')

  /** Whether the sidebar is collapsed (P1-12) */
  const sidebarCollapsed = ref(false)

  /** Whether the workspace file panel is visible (WS-05) */
  const filePanelVisible = ref(false)

  function setCurrentView(view: ViewName): void {
    currentView.value = view
  }

  /** Toggle the sidebar between collapsed and expanded (P1-12) */
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /** Explicitly set the sidebar collapsed state */
  function setSidebarCollapsed(collapsed: boolean): void {
    sidebarCollapsed.value = collapsed
  }

  /** Toggle the file panel visibility (WS-05) */
  function toggleFilePanel(): void {
    filePanelVisible.value = !filePanelVisible.value
  }

  /** Set the file panel visibility (WS-05) */
  function setFilePanelVisible(visible: boolean): void {
    filePanelVisible.value = visible
  }

  return {
    currentView,
    sidebarCollapsed,
    filePanelVisible,
    setCurrentView,
    toggleSidebar,
    setSidebarCollapsed,
    toggleFilePanel,
    setFilePanelVisible,
  }
})
