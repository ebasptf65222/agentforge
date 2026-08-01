<script setup lang="ts">
// WorkspaceSwitcher - Quick workspace switching from the chat input toolbar.
// Shows the current workspace directory name as a pill button.
// Clicking opens a popover with recent workspaces and directory picker.

import { computed, ref } from 'vue'
import { NPopover, NIcon, NDivider } from 'naive-ui'
import { FolderOutlined, FolderOpenOutlined, ClearOutlined } from '@vicons/material'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { showToast } from '@/utils/toast'

const settingsStore = useSettingsStore()
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()

const showPopover = ref(false)
const selectingDir = ref(false)

/** Current workspace path */
const workspacePath = computed(() => settingsStore.settings?.workspace?.path ?? null)

/** Current workspace directory name (last segment of path) */
const workspaceName = computed(() => {
  if (!workspacePath.value) return '未设置'
  const segments = workspacePath.value.replace(/[/\\]+$/, '').split(/[/\\]/)
  return segments[segments.length - 1] || workspacePath.value
})

/** Recent workspace paths */
const recentPaths = computed(() => settingsStore.settings?.workspace?.recentPaths ?? [])

/** Switch to a workspace path */
async function handleSwitchWorkspace(path: string): Promise<void> {
  if (path === workspacePath.value) {
    showPopover.value = false
    return
  }
  try {
    await settingsStore.updateWorkspace({ path })
    showToast(`已切换到: ${path}`, 'success')
    // Refresh file tree if panel is open
    if (uiStore.filePanelVisible) {
      await workspaceStore.refreshTree()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`切换工作区失败: ${message}`, 'error')
  }
  showPopover.value = false
}

/** Open directory picker */
async function handleSelectDir(): Promise<void> {
  selectingDir.value = true
  try {
    const selectedPath = await window.electron.file.selectDir({
      title: '选择工作区目录',
      defaultPath: workspacePath.value ?? undefined,
    })
    if (selectedPath === null) return
    await settingsStore.updateWorkspace({ path: selectedPath })
    showToast(`工作区已设置为: ${selectedPath}`, 'success')
    if (uiStore.filePanelVisible) {
      await workspaceStore.refreshTree()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`设置工作区失败: ${message}`, 'error')
  } finally {
    selectingDir.value = false
  }
  showPopover.value = false
}

/** Clear workspace */
async function handleClearWorkspace(): Promise<void> {
  try {
    await settingsStore.updateWorkspace({ path: null })
    showToast('已清除工作区路径', 'info')
    if (uiStore.filePanelVisible) {
      await workspaceStore.refreshTree()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`清除工作区失败: ${message}`, 'error')
  }
  showPopover.value = false
}
</script>

<template>
  <NPopover
    v-model:show="showPopover"
    trigger="click"
    placement="top-start"
    :width="280"
    :show-arrow="false"
  >
    <template #trigger>
      <button
        class="workspace-switcher"
        :class="{ 'workspace-switcher--unset': !workspacePath }"
        :title="workspacePath ? `工作区: ${workspacePath}` : '未设置工作区'"
      >
        <NIcon :size="13" class="workspace-switcher__icon">
          <FolderOutlined />
        </NIcon>
        <span class="workspace-switcher__name">{{ workspaceName }}</span>
      </button>
    </template>

    <div class="ws-panel">
      <!-- Current path -->
      <div class="ws-panel__current">
        <span class="ws-panel__label">当前工作区</span>
        <span class="ws-panel__path">{{ workspacePath ?? '未设置' }}</span>
      </div>

      <NDivider class="ws-panel__divider" />

      <!-- Recent workspaces -->
      <div v-if="recentPaths.length > 0" class="ws-panel__section">
        <span class="ws-panel__label">最近使用</span>
        <div class="ws-panel__list">
          <button
            v-for="path in recentPaths"
            :key="path"
            class="ws-item"
            :class="{ 'ws-item--active': path === workspacePath }"
            :title="path"
            @click="handleSwitchWorkspace(path)"
          >
            <NIcon :size="13" class="ws-item__icon">
              <FolderOutlined />
            </NIcon>
            <span class="ws-item__path">{{ path }}</span>
          </button>
        </div>
      </div>

      <NDivider class="ws-panel__divider" />

      <!-- Actions -->
      <div class="ws-panel__actions">
        <button
          class="ws-action"
          :disabled="selectingDir"
          @click="handleSelectDir"
        >
          <NIcon :size="14">
            <FolderOpenOutlined />
          </NIcon>
          <span>{{ selectingDir ? '选择中...' : '选择新目录...' }}</span>
        </button>
        <button
          v-if="workspacePath"
          class="ws-action ws-action--danger"
          @click="handleClearWorkspace"
        >
          <NIcon :size="14">
            <ClearOutlined />
          </NIcon>
          <span>清除工作区</span>
        </button>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.workspace-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  height: 26px;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  font-size: 11px;
  color: var(--af-text-muted, #9ca3af);
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 140px;
}

.workspace-switcher:hover {
  border-color: var(--af-brand, #4f46e5);
  color: var(--af-text-secondary, #d1d5db);
}

.workspace-switcher--unset {
  border-style: dashed;
}

.workspace-switcher__icon {
  flex-shrink: 0;
  color: var(--af-text-muted, #6b7280);
}

.workspace-switcher__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--af-text-secondary, #d1d5db);
}

/* Popover panel */
.ws-panel {
  display: flex;
  flex-direction: column;
}

.ws-panel__current {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ws-panel__label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--af-text-muted, #6b7280);
}

.ws-panel__path {
  font-size: 12px;
  color: var(--af-text-secondary, #d1d5db);
  word-break: break-all;
}

.ws-panel__divider {
  margin: 8px 0 !important;
}

.ws-panel__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ws-panel__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}

.ws-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--af-text-secondary, #d1d5db);
  transition: background-color 0.12s ease;
  text-align: left;
  width: 100%;
}

.ws-item:hover {
  background-color: var(--af-bg-hover, #374151);
}

.ws-item--active {
  background-color: color-mix(in srgb, var(--af-brand, #4f46e5) 12%, transparent);
  color: var(--af-brand, #818cf8);
}

.ws-item__icon {
  flex-shrink: 0;
  color: var(--af-text-muted, #6b7280);
}

.ws-item__path {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-panel__actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ws-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--af-brand, #818cf8);
  transition: background-color 0.12s ease;
  text-align: left;
  width: 100%;
}

.ws-action:hover:not(:disabled) {
  background-color: var(--af-bg-hover, #374151);
}

.ws-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ws-action--danger {
  color: var(--af-error, #ef4444);
}

/* Responsive: hide workspace name on narrow screens */
@media (max-width: 720px) {
  .workspace-switcher {
    max-width: 80px;
  }

  .workspace-switcher__name {
    display: none;
  }
}
</style>
