// UI store - manages view state, sidebar collapse, etc.

import { defineStore } from 'pinia'
import { ref } from 'vue'

type ViewName = 'chat' | 'settings'

export const useUiStore = defineStore('ui', () => {
  const currentView = ref<ViewName>('chat')

  /** Whether the sidebar is collapsed (P1-12) */
  const sidebarCollapsed = ref(false)

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

  return {
    currentView,
    sidebarCollapsed,
    setCurrentView,
    toggleSidebar,
    setSidebarCollapsed,
  }
})
