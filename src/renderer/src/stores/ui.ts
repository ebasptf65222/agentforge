// UI store - manages view state, sidebar collapse, etc.
// UI-REDESIGN v1.0: + viewport breakpoint tracking, auxiliary panel arbitration

import { defineStore } from 'pinia'
import { ref } from 'vue'

type ViewName = 'chat' | 'settings' | 'kb' | 'wiki'

/** 视口断点（UI-REDESIGN v1.0） */
export type Viewport = 'compact' | 'medium' | 'wide'

export const useUiStore = defineStore('ui', () => {
  const currentView = ref<ViewName>('chat')

  /** Whether the sidebar is collapsed (P1-12) */
  const sidebarCollapsed = ref(false)

  /** Whether the workspace file panel is visible (WS-05) */
  const filePanelVisible = ref(false)

  /** Whether the checkpoint timeline panel is visible (P2-02) */
  const checkpointPanelVisible = ref(false)

  /** Incrementing trigger to open ModelSwitcher popover (Ctrl+Shift+M) */
  const modelSwitcherTrigger = ref(0)

  /** Incrementing trigger to open EngineSwitcher config (Ctrl+Shift+E) */
  const engineSwitcherTrigger = ref(0)

  /** 当前应用内预览的链接 URL（null 表示关闭预览面板） */
  const linkPreviewUrl = ref<string | null>(null)

  // ─── UI-REDESIGN v1.0: viewport 断点与面板仲裁 ──────────────

  /** 当前视口断点（<900 compact / 900–1280 medium / >1280 wide） */
  const viewport = ref<Viewport>('wide')

  /** resize 防抖定时器 */
  let viewportTimer: ReturnType<typeof setTimeout> | null = null

  /** 计算断点并写入 viewport（防抖 200ms） */
  function handleViewportResize(): void {
    if (viewportTimer) clearTimeout(viewportTimer)
    viewportTimer = setTimeout(() => {
      const w = window.innerWidth
      viewport.value = w < 900 ? 'compact' : w <= 1280 ? 'medium' : 'wide'
      // 断点降级时收起无法容纳的面板
      if (viewport.value !== 'wide') setFilePanelVisible(false)
      if (viewport.value === 'compact') {
        setCheckpointPanelVisible(false)
        setSidebarCollapsed(true)
      }
    }, 200)
  }

  /** 启动 viewport 监听（App.vue onMounted 调用一次；返回清理函数） */
  function initViewportListener(): () => void {
    handleViewportResize()
    window.addEventListener('resize', handleViewportResize)
    return () => {
      window.removeEventListener('resize', handleViewportResize)
      if (viewportTimer) clearTimeout(viewportTimer)
      viewportTimer = null
    }
  }

  function setCurrentView(view: ViewName): void {
    currentView.value = view
  }

  /** 打开应用内链接预览面板 */
  function openLinkPreview(url: string): void {
    linkPreviewUrl.value = url
  }

  /** 关闭链接预览面板 */
  function closeLinkPreview(): void {
    linkPreviewUrl.value = null
  }

  /** Toggle the sidebar between collapsed and expanded (P1-12) */
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /** Explicitly set the sidebar collapsed state */
  function setSidebarCollapsed(collapsed: boolean): void {
    sidebarCollapsed.value = collapsed
  }

  /** Toggle the file panel visibility (WS-05).
   * UI-REDESIGN v1.0: 面板仲裁 —— medium 断点下与检查点面板互斥。 */
  function toggleFilePanel(): void {
    const next = !filePanelVisible.value
    if (next && viewport.value === 'medium') setCheckpointPanelVisible(false)
    filePanelVisible.value = next
  }

  /** Set the file panel visibility (WS-05). 同样执行互斥仲裁。 */
  function setFilePanelVisible(visible: boolean): void {
    if (visible && viewport.value === 'medium') setCheckpointPanelVisible(false)
    filePanelVisible.value = visible
  }

  /** Toggle the checkpoint panel visibility (P2-02). 与文件面板互斥（medium）。 */
  function toggleCheckpointPanel(): void {
    const next = !checkpointPanelVisible.value
    if (next && viewport.value === 'medium') setFilePanelVisible(false)
    checkpointPanelVisible.value = next
  }

  /** Set the checkpoint panel visibility (P2-02)。 */
  function setCheckpointPanelVisible(visible: boolean): void {
    if (visible && viewport.value === 'medium') setFilePanelVisible(false)
    checkpointPanelVisible.value = visible
  }

  /** Trigger model switcher open (keyboard shortcut) */
  function triggerModelSwitcher(): void {
    modelSwitcherTrigger.value++
  }

  /** Trigger engine switcher config open (keyboard shortcut) */
  function triggerEngineSwitcher(): void {
    engineSwitcherTrigger.value++
  }

  return {
    currentView,
    sidebarCollapsed,
    filePanelVisible,
    checkpointPanelVisible,
    viewport,
    initViewportListener,
    modelSwitcherTrigger,
    engineSwitcherTrigger,
    linkPreviewUrl,
    setCurrentView,
    openLinkPreview,
    closeLinkPreview,
    toggleSidebar,
    setSidebarCollapsed,
    toggleFilePanel,
    setFilePanelVisible,
    toggleCheckpointPanel,
    setCheckpointPanelVisible,
    triggerModelSwitcher,
    triggerEngineSwitcher,
  }
})
