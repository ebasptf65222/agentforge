// MCP Store - 管理 MCP Server 配置的 Pinia store

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MCPServerConfig, MCPServerStatus } from '@shared/types'
import type {
  McpAddParams,
  McpUpdateParams,
  McpServerInfo,
  McpCatalogEntry,
  McpCategory,
  McpInstallResult,
} from '@/types/electron-api'
import { showToast } from '@/utils/toast'

export const useMcpStore = defineStore('mcp', () => {
  // ─── State ───────────────────────────────────────────────────

  const servers = ref<MCPServerConfig[]>([])
  const loading = ref(false)

  // 缓存每个 server 的状态信息
  const serverStatus = ref<Map<string, McpServerInfo>>(new Map())

  // P3-02: 市场目录
  const catalog = ref<McpCatalogEntry[]>([])
  const catalogLoading = ref(false)

  // ─── Actions ─────────────────────────────────────────────────

  async function loadServers(): Promise<void> {
    loading.value = true
    try {
      servers.value = await window.electron.mcp.list()
    } catch (error) {
      console.error('[McpStore] loadServers failed:', error)
      showToast('加载 MCP 服务器列表失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function addServer(params: McpAddParams): Promise<void> {
    try {
      await window.electron.mcp.add(params)
      showToast('MCP 服务器添加成功', 'success')
      await loadServers()
    } catch (error) {
      console.error('[McpStore] addServer failed:', error)
      showToast('添加 MCP 服务器失败', 'error')
      throw error
    }
  }

  // OPT2-12: 原子更新，替代先删后增
  async function updateServer(params: McpUpdateParams): Promise<void> {
    try {
      await window.electron.mcp.update(params)
      showToast('MCP 服务器已更新', 'success')
      await loadServers()
    } catch (error) {
      console.error('[McpStore] updateServer failed:', error)
      showToast('更新 MCP 服务器失败', 'error')
      throw error
    }
  }

  async function removeServer(id: string): Promise<void> {
    try {
      await window.electron.mcp.remove(id)
      showToast('MCP 服务器已删除', 'success')
      await loadServers()
    } catch (error) {
      console.error('[McpStore] removeServer failed:', error)
      showToast('删除 MCP 服务器失败', 'error')
      throw error
    }
  }

  async function toggleEnable(id: string, enabled: boolean): Promise<void> {
    try {
      await window.electron.mcp.toggleEnable(id, enabled)
      await loadServers()
    } catch (error) {
      console.error('[McpStore] toggleEnable failed:', error)
      showToast('切换启用状态失败', 'error')
      throw error
    }
  }

  async function loadStatus(id: string): Promise<void> {
    try {
      const info = await window.electron.mcp.getStatus(id)
      serverStatus.value.set(id, info)
    } catch (error) {
      console.error('[McpStore] loadStatus failed:', error)
    }
  }

  function getStatus(id: string): MCPServerStatus | undefined {
    return serverStatus.value.get(id)?.status
  }

  // ─── P3-02: 市场目录 ────────────────────────────────────────

  async function loadCatalog(params?: {
    category?: McpCategory
    query?: string
  }): Promise<void> {
    catalogLoading.value = true
    try {
      catalog.value = await window.electron.mcp.catalogList(params ?? {})
    } catch (error) {
      console.error('[McpStore] loadCatalog failed:', error)
      showToast('加载市场目录失败', 'error')
    } finally {
      catalogLoading.value = false
    }
  }

  async function installFromCatalog(
    id: string,
    env?: Record<string, string>,
  ): Promise<McpInstallResult | null> {
    try {
      const result = await window.electron.mcp.catalogInstall(id, env)
      showToast('安装成功', 'success')
      await loadServers()
      // 刷新新安装 server 的状态
      const installed = result as McpInstallResult
      if (installed?.config?.id) {
        void loadStatus(installed.config.id)
      }
      return installed
    } catch (error) {
      console.error('[McpStore] installFromCatalog failed:', error)
      const message = error instanceof Error ? error.message : String(error)
      showToast(`安装失败: ${message}`, 'error')
      return null
    }
  }

  /** 检查某个目录条目是否已安装（按 name 匹配） */
  function isInstalled(entry: McpCatalogEntry): boolean {
    return servers.value.some((s) => s.name === entry.name)
  }

  return {
    servers,
    loading,
    serverStatus,
    catalog,
    catalogLoading,
    loadServers,
    addServer,
    updateServer,
    removeServer,
    toggleEnable,
    loadStatus,
    getStatus,
    loadCatalog,
    installFromCatalog,
    isInstalled,
  }
})
