<script setup lang="ts">
// WS-05: FilePreview - previews text file content from the workspace.
// Shows content for text files, error for unsupported types or large files.

import { computed } from 'vue'
import { NIcon, NSpin } from 'naive-ui'
import { CloseOutlined, WarningAmberOutlined } from '@vicons/material'
import { useWorkspaceStore } from '@/stores/workspace'

const workspaceStore = useWorkspaceStore()

const hasPreview = computed(() => workspaceStore.previewPath !== null)
const isError = computed(() => workspaceStore.previewError !== null)
const isLoading = computed(() => workspaceStore.previewLoading)
</script>

<template>
  <div v-if="hasPreview" class="file-preview">
    <!-- Header -->
    <div class="file-preview__header">
      <span class="file-preview__filename" :title="workspaceStore.previewPath ?? ''">
        {{ workspaceStore.previewPath }}
      </span>
      <button
        class="file-preview__close"
        type="button"
        title="关闭预览"
        @click="workspaceStore.closePreview()"
      >
        <NIcon :size="14">
          <CloseOutlined />
        </NIcon>
      </button>
    </div>

    <!-- Body -->
    <div class="file-preview__body">
      <!-- Loading -->
      <div v-if="isLoading" class="file-preview__loading">
        <NSpin size="small" />
      </div>

      <!-- Error -->
      <div v-else-if="isError" class="file-preview__error">
        <NIcon :size="32" class="file-preview__error-icon">
          <WarningAmberOutlined />
        </NIcon>
        <p class="file-preview__error-text">{{ workspaceStore.previewError }}</p>
      </div>

      <!-- Content -->
      <pre v-else class="file-preview__content">{{ workspaceStore.previewContent }}</pre>
    </div>
  </div>
</template>

<style scoped>
.file-preview {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 45%;
  min-height: 0;
  background-color: var(--af-bg, #0f172a);
  border-top: 1px solid var(--af-border, #374151);
}

.file-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background-color: var(--af-bg-surface, #111827);
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.file-preview__filename {
  font-size: 12px;
  font-family: monospace;
  color: var(--af-text-tertiary, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.file-preview__close {
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
  flex-shrink: 0;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.file-preview__close:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.file-preview__body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-preview__loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 32px;
}

.file-preview__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 12px;
}

.file-preview__error-icon {
  color: var(--af-warning, #f59e0b);
}

.file-preview__error-text {
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
  text-align: center;
  margin: 0;
}

.file-preview__content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 12px;
  font-size: 13px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  color: var(--af-text-primary, #e5e7eb);
  background-color: transparent;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
