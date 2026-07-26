<script setup lang="ts">
// WS-05: FileTreePanel - workspace file tree browser.
// Displays a collapsible file tree with lazy-loaded subdirectories.
// Clicking a file opens it in the FilePreview component.

import { onMounted, watch } from 'vue'
import { NIcon, NButton, NSpin, NEmpty } from 'naive-ui'
import {
  RefreshOutlined,
  ArrowBackOutlined,
} from '@vicons/material'
import type { FileTreeNode } from '@shared/types'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import FileTreeNodeItem from './FileTreeNodeItem.vue'

const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()

onMounted(async () => {
  await workspaceStore.loadTree()
})

// Reload tree when file panel becomes visible
watch(
  () => uiStore.filePanelVisible,
  async (visible) => {
    if (visible) {
      await workspaceStore.loadTree()
    }
  },
)

function handleNodeClick(node: FileTreeNode): void {
  if (node.isDirectory) {
    void workspaceStore.toggleExpand(node)
  } else {
    void workspaceStore.previewFile(node)
  }
}

function handleRefresh(): void {
  void workspaceStore.refreshTree()
}

function handleGoToSettings(): void {
  uiStore.setFilePanelVisible(false)
  uiStore.setCurrentView('settings')
}
</script>

<template>
  <div class="file-tree-panel">
    <!-- Header -->
    <div class="file-tree-panel__header">
      <span class="file-tree-panel__title">文件</span>
      <div class="file-tree-panel__actions">
        <button
          class="file-tree-panel__btn"
          type="button"
          title="刷新"
          @click="handleRefresh"
        >
          <NIcon :size="14">
            <RefreshOutlined />
          </NIcon>
        </button>
        <button
          class="file-tree-panel__btn"
          type="button"
          title="关闭"
          @click="uiStore.setFilePanelVisible(false)"
        >
          <NIcon :size="14">
            <ArrowBackOutlined />
          </NIcon>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="file-tree-panel__content">
      <!-- Loading -->
      <div v-if="workspaceStore.treeLoading" class="file-tree-panel__loading">
        <NSpin size="small" />
      </div>

      <!-- No workspace -->
      <div v-else-if="!workspaceStore.isWorkspaceSet" class="file-tree-panel__empty">
        <NEmpty description="未设置工作区" size="small">
          <template #extra>
            <NButton size="small" type="primary" @click="handleGoToSettings">
              前往设置
            </NButton>
          </template>
        </NEmpty>
      </div>

      <!-- Empty tree -->
      <div v-else-if="!workspaceStore.rootNode" class="file-tree-panel__empty">
        <NEmpty description="工作区为空" size="small" />
      </div>

      <!-- File tree -->
      <div v-else class="file-tree-panel__tree">
        <template v-if="workspaceStore.rootNode.children">
          <FileTreeNodeItem
            v-for="child in workspaceStore.rootNode.children"
            :key="child.id"
            :node="child"
            :depth="0"
            :is-expanded="(path: string) => workspaceStore.isExpanded(path)"
            :on-toggle="handleNodeClick"
          />
        </template>
        <div v-else class="file-tree-panel__empty">
          <NEmpty description="没有文件" size="small" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-tree-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background-color: var(--af-bg-surface, #111827);
}

.file-tree-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.file-tree-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.file-tree-panel__actions {
  display: flex;
  gap: 4px;
}

.file-tree-panel__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-tertiary, #9ca3af);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.file-tree-panel__btn:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.file-tree-panel__content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.file-tree-panel__loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 32px;
}

.file-tree-panel__empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 32px 16px;
}

.file-tree-panel__tree {
  padding: 4px 0;
}

/* Tree node styles (global since recursive component uses render functions) */
:deep(.tree-node-wrapper) {
  display: flex;
  flex-direction: column;
}

:deep(.tree-node) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
  transition: background-color 0.1s ease;
}

:deep(.tree-node:hover) {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.06));
}

:deep(.tree-node--dir) {
  color: var(--af-text-primary, #e5e7eb);
}

:deep(.tree-node__label) {
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.tree-node__loading) {
  padding: 4px 8px;
}
</style>
