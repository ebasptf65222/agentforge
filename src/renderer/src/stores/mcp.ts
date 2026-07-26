// MCP Store - 管理 MCP Server 配置的 Pinia store

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MCPServerConfig, MCPServerStatus } from '@shared/types'
import type { McpAddParams, McpServerInfo } from '@/types/electron-api'
import { showToast } from '@/utils/toast'

export const useMcpStore = defineStore('mcp', () => {
  // ─── State ───────────────────────────────────────────────────

  const servers = ref<MCPServerConfig[]>([])
  const loading = ref(false)

  // 缓存每个 server 的状态信息
  const serverStatus = ref<Map<string, McpServerInfo>>(new Map())

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

  return {
    servers,
    loading,
    serverStatus,
    loadServers,
    addServer,
    removeServer,
    toggleEnable,
    loadStatus,
    getStatus,
  }
})
