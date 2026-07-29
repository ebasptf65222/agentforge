<script setup lang="ts">
// P3-01: ConversationTreeModal - 显示会话分支树的弹窗
// Shows ancestors and children of a conversation in a tree layout.

import { ref, watch, computed } from 'vue'
import { NModal, NIcon, NButton, NSpin, NEmpty } from 'naive-ui'
import { AccountTreeOutlined, ArrowUpwardOutlined, ArrowDownwardOutlined } from '@vicons/material'
import type { Conversation } from '@shared/types'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  /** 目标会话 ID */
  conversationId: string | null
  /** 是否显示弹窗 */
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [id: string]
}>()

const chatStore = useChatStore()

// ─── State ────────────────────────────────────────────────────

const loading = ref(false)
const ancestors = ref<Conversation[]>([])
const children = ref<Conversation[]>([])
const targetConv = ref<Conversation | null>(null)

// ─── Computed ─────────────────────────────────────────────────

/** 构建完整树：祖先链 + 当前 + 子分支 */
const treeNodes = computed(() => {
  const nodes: Array<{ conv: Conversation; level: number; isTarget: boolean }> = []

  // 祖先（从上到下）
  for (const ancestor of ancestors.value) {
    nodes.push({ conv: ancestor, level: 0, isTarget: false })
  }

  // 当前会话
  if (targetConv.value) {
    nodes.push({ conv: targetConv.value, level: 0, isTarget: true })
  }

  // 子分支
  for (const child of children.value) {
    nodes.push({ conv: child, level: 1, isTarget: false })
  }

  return nodes
})

// ─── Watch ────────────────────────────────────────────────────

watch(
  () => props.show,
  async (visible) => {
    if (visible && props.conversationId) {
      await loadTree()
    }
  },
)

watch(
  () => props.conversationId,
  async (id) => {
    if (props.show && id) {
      await loadTree()
    }
  },
)

// ─── Actions ──────────────────────────────────────────────────

async function loadTree(): Promise<void> {
  if (!props.conversationId) return

  loading.value = true
  try {
    const tree = await chatStore.getConversationTree(props.conversationId)
    if (tree) {
      ancestors.value = tree.ancestors
      children.value = tree.children
      targetConv.value =
        chatStore.conversations.find((c) => c.id === props.conversationId) ?? null
    }
  } catch (error) {
    console.error('[ConversationTreeModal] loadTree error:', error)
  } finally {
    loading.value = false
  }
}

function handleSelect(id: string): void {
  emit('select', id)
  emit('update:show', false)
}

function handleClose(): void {
  emit('update:show', false)
}

function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return ''
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 1000 / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="对话分支树"
    style="width: 480px; max-width: 90vw"
    :bordered="false"
    @update:show="handleClose"
    @close="handleClose"
  >
    <div class="conversation-tree">
      <NSpin v-if="loading" size="small" />
      <NEmpty v-else-if="treeNodes.length === 0" description="无分支数据" size="small" />
      <template v-else>
        <!-- Tree nodes -->
        <div
          v-for="node in treeNodes"
          :key="node.conv.id"
          class="tree-node"
          :class="{
            'tree-node--target': node.isTarget,
            'tree-node--ancestor': !node.isTarget && node.level === 0,
            'tree-node--child': node.level === 1,
          }"
          @click="handleSelect(node.conv.id)"
        >
          <!-- Indent / connector line -->
          <div class="tree-node__indent">
            <div v-if="node.level > 0" class="tree-node__connector" />
          </div>

          <!-- Content -->
          <div class="tree-node__content">
            <div class="tree-node__header">
              <NIcon v-if="node.isTarget" :size="14" class="tree-node__icon tree-node__icon--target">
                <AccountTreeOutlined />
              </NIcon>
              <NIcon
                v-else-if="node.level === 0"
                :size="12"
                class="tree-node__icon tree-node__icon--ancestor"
              >
                <ArrowUpwardOutlined />
              </NIcon>
              <NIcon
                v-else
                :size="12"
                class="tree-node__icon tree-node__icon--child"
              >
                <ArrowDownwardOutlined />
              </NIcon>
              <span class="tree-node__title" :title="node.conv.title">
                {{ node.conv.title }}
              </span>
            </div>
            <div class="tree-node__meta">
              <span>{{ node.conv.messageCount ?? 0 }} 条消息</span>
              <span>{{ formatRelativeTime(node.conv.lastMessageAt ?? node.conv.updatedAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="tree-node__legend">
          <div class="tree-legend__item">
            <span class="tree-legend__dot tree-legend__dot--target" />
            <span>当前会话</span>
          </div>
          <div class="tree-legend__item">
            <span class="tree-legend__dot tree-legend__dot--ancestor" />
            <span>上游会话</span>
          </div>
          <div class="tree-legend__item">
            <span class="tree-legend__dot tree-legend__dot--child" />
            <span>分支会话</span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <NButton size="small" @click="handleClose">关闭</NButton>
    </template>
  </NModal>
</template>

<style scoped>
.conversation-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 400px;
  overflow-y: auto;
}

.tree-node {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--af-radius-sm, 6px);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.tree-node:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.06));
}

.tree-node--target {
  background-color: var(--af-brand-bg, rgba(99, 102, 241, 0.1));
  border: 1px solid var(--af-brand, #6366f1);
}

.tree-node--target:hover {
  background-color: var(--af-brand-bg, rgba(99, 102, 241, 0.15));
}

.tree-node__indent {
  width: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tree-node__connector {
  width: 2px;
  height: 100%;
  background-color: var(--af-border, #374151);
}

.tree-node__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tree-node__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tree-node__icon {
  flex-shrink: 0;
}

.tree-node__icon--target {
  color: var(--af-brand, #6366f1);
}

.tree-node__icon--ancestor {
  color: var(--af-text-muted, #6b7280);
}

.tree-node__icon--child {
  color: var(--af-success, #10b981);
}

.tree-node__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--af-text-primary, #e5e7eb);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-node--target .tree-node__title {
  font-weight: 600;
}

.tree-node__meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

/* Legend */
.tree-node__legend {
  display: flex;
  gap: 16px;
  padding: 12px;
  margin-top: 8px;
  border-top: 1px solid var(--af-border, #374151);
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

.tree-legend__item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tree-legend__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tree-legend__dot--target {
  background-color: var(--af-brand, #6366f1);
}

.tree-legend__dot--ancestor {
  background-color: var(--af-text-muted, #6b7280);
}

.tree-legend__dot--child {
  background-color: var(--af-success, #10b981);
}
</style>
