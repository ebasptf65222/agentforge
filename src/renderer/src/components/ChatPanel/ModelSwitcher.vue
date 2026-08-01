<script setup lang="ts">
// ModelSwitcher - Quick model switching dropdown for the chat input toolbar.
// Displays the current conversation's model and allows switching without
// navigating to the settings page.

import { computed, ref, watch } from 'vue'
import { NPopover, NIcon, NDivider } from 'naive-ui'
import { ArrowDropDownOutlined, SmartToyOutlined } from '@vicons/material'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useUiStore } from '@/stores/ui'
import { getProviderMeta } from '@/stores/model'

const chatStore = useChatStore()
const modelStore = useModelStore()
const uiStore = useUiStore()

const showPopover = ref(false)

// Watch for keyboard shortcut trigger (Ctrl+Shift+M)
watch(() => uiStore.modelSwitcherTrigger, () => {
  showPopover.value = true
})

/** Current conversation's model ID */
const currentModelId = computed(() => chatStore.currentConversation?.modelId ?? null)

/** Current model display name */
const currentModelName = computed(() => {
  if (!currentModelId.value) return '未选择模型'
  const model = modelStore.models.find((m) => m.id === currentModelId.value)
  return model?.name ?? '未知模型'
})

/** Current model provider color */
const currentProviderColor = computed(() => {
  if (!currentModelId.value) return '#6b7280'
  const model = modelStore.models.find((m) => m.id === currentModelId.value)
  if (!model) return '#6b7280'
  return getProviderMeta(model.provider)?.color ?? '#6b7280'
})

/** Handle model selection */
async function handleSelectModel(modelId: string): Promise<void> {
  const conv = chatStore.currentConversation
  if (!conv || conv.modelId === modelId) {
    showPopover.value = false
    return
  }
  await chatStore.updateConversationModel(conv.id, modelId)
  showPopover.value = false
}

/** Navigate to model settings */
function handleOpenSettings(): void {
  showPopover.value = false
  uiStore.setCurrentView('settings')
}
</script>

<template>
  <NPopover
    v-model:show="showPopover"
    trigger="click"
    placement="top-end"
    :width="240"
    :show-arrow="false"
    class="model-switcher-popover"
  >
    <template #trigger>
      <button
        class="model-switcher"
        :title="`当前模型: ${currentModelName}`"
      >
        <span
          class="model-switcher__dot"
          :style="{ backgroundColor: currentProviderColor }"
        />
        <span class="model-switcher__name">{{ currentModelName }}</span>
        <NIcon :size="14" class="model-switcher__arrow">
          <ArrowDropDownOutlined />
        </NIcon>
      </button>
    </template>

    <div class="model-list">
      <div class="model-list__header">
        <NIcon :size="14"><SmartToyOutlined /></NIcon>
        <span>选择模型</span>
      </div>
      <div class="model-list__items">
        <button
          v-for="model in modelStore.models"
          :key="model.id"
          class="model-item"
          :class="{ 'model-item--active': model.id === currentModelId }"
          @click="handleSelectModel(model.id)"
        >
          <span
            class="model-item__dot"
            :style="{ backgroundColor: getProviderMeta(model.provider)?.color ?? '#6b7280' }"
          />
          <span class="model-item__name">{{ model.name }}</span>
          <span class="model-item__id">{{ model.modelId }}</span>
        </button>
        <div v-if="modelStore.models.length === 0" class="model-list__empty">
          暂无可用模型
        </div>
      </div>
      <NDivider class="model-list__divider" />
      <button class="model-list__manage" @click="handleOpenSettings">
        管理模型...
      </button>
    </div>
  </NPopover>
</template>

<style scoped>
.model-switcher {
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
  max-width: 180px;
}

.model-switcher:hover {
  border-color: var(--af-brand, #4f46e5);
  color: var(--af-text-secondary, #d1d5db);
}

.model-switcher__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.model-switcher__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--af-text-secondary, #d1d5db);
}

.model-switcher__arrow {
  flex-shrink: 0;
  opacity: 0.6;
}

/* Popover content */
.model-list {
  display: flex;
  flex-direction: column;
}

.model-list__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-secondary, #d1d5db);
}

.model-list__items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--af-text-secondary, #d1d5db);
  transition: background-color 0.12s ease;
  text-align: left;
  width: 100%;
}

.model-item:hover {
  background-color: var(--af-bg-hover, #374151);
}

.model-item--active {
  background-color: color-mix(in srgb, var(--af-brand, #4f46e5) 12%, transparent);
  color: var(--af-brand, #818cf8);
}

.model-item__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.model-item__name {
  font-weight: 500;
  white-space: nowrap;
}

.model-item__id {
  margin-left: auto;
  font-size: 10px;
  color: var(--af-text-muted, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.model-list__empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--af-text-muted, #6b7280);
}

.model-list__divider {
  margin: 6px 0 !important;
}

.model-list__manage {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--af-brand, #818cf8);
  text-align: left;
  transition: background-color 0.12s ease;
}

.model-list__manage:hover {
  background-color: var(--af-bg-hover, #374151);
}

/* Responsive: hide model name on very narrow screens */
@media (max-width: 720px) {
  .model-switcher {
    max-width: 100px;
  }

  .model-switcher__name {
    display: none;
  }
}
</style>
