<script setup lang="ts">
// P3-02: McpMarketplace - MCP 市场组件
// 展示预置 MCP Server 目录，支持搜索、分类筛选、一键安装

import { ref, computed, onMounted, reactive } from 'vue'
import {
  NButton,
  NIcon,
  NInput,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NSpin,
  NEmpty,
  NSpace,
  NSelect,
  type SelectOption,
} from 'naive-ui'
import {
  SearchOutlined,
  DownloadOutlined,
  CheckOutlined,
  OpenInNewOutlined,
} from '@vicons/material'
import type { McpCatalogEntry, McpCategory } from '@/types/electron-api'
import { useMcpStore } from '@/stores/mcp'

const mcpStore = useMcpStore()

// ─── 分类标签 ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<McpCategory, string> = {
  filesystem: '文件系统',
  search: '搜索',
  database: '数据库',
  devtools: '开发工具',
  productivity: '生产力',
  communication: '通信',
}

const categoryOptions: SelectOption[] = [
  { label: '全部分类', value: '' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
    label,
    value,
  })),
]

// ─── 搜索与筛选 ────────────────────────────────────────────────

const searchQuery = ref('')
const selectedCategory = ref<string>('')

const filteredCatalog = computed(() => {
  let items = mcpStore.catalog

  if (selectedCategory.value) {
    items = items.filter((e) => e.category === selectedCategory.value)
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    items = items.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    )
  }

  return items
})

// ─── 安装流程 ──────────────────────────────────────────────────

const installModalVisible = ref(false)
const installingEntry = ref<McpCatalogEntry | null>(null)
const installing = ref(false)
const envValues = reactive<Record<string, string>>({})

function openInstallModal(entry: McpCatalogEntry): void {
  installingEntry.value = entry
  // 初始化环境变量表单
  for (const key of Object.keys(envValues)) {
    Reflect.deleteProperty(envValues, key)
  }
  if (entry.envKeys) {
    for (const envKey of entry.envKeys) {
      envValues[envKey.key] = ''
    }
  }
  installModalVisible.value = true
}

async function handleInstall(): Promise<void> {
  if (!installingEntry.value) return
  installing.value = true
  try {
    // 只传递非空的环境变量
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(envValues)) {
      if (v.trim()) env[k] = v.trim()
    }
    const result = await mcpStore.installFromCatalog(
      installingEntry.value.id,
      Object.keys(env).length > 0 ? env : undefined,
    )
    if (result) {
      installModalVisible.value = false
    }
  } finally {
    installing.value = false
  }
}

// ─── 图标映射 ──────────────────────────────────────────────────

const ICON_SVG: Record<string, string> = {
  folder: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  github: 'M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10 10 0 0 0 12 2z',
  search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  database: 'M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 9v3c0 2.21 3.58 4 8 4s8-1.79 8-4V9c0 2.21-3.58 4-8 4s-8-1.79-8-4zm0 5v3c0 2.21 3.58 4 8 4s8-1.79 8-4v-3c0 2.21-3.58 4-8 4s-8-1.79-8-4z',
  brain: 'M12 2a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 7 8v.5A2.5 2.5 0 0 0 5 11v1a2.5 2.5 0 0 0 2 2.45V16a2.5 2.5 0 0 0 2 2.45V19a3 3 0 0 0 6 0v-3a2.5 2.5 0 0 0 2-2.45v-1A2.5 2.5 0 0 0 19 10.5V8a2.5 2.5 0 0 0-2-2.45V5a3 3 0 0 0-3-3z',
  browser: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  cloud: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  chat: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z',
  image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  'cloud-download': 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  gitlab: 'M23.6 9.6l-.03-.08L20.4 1a.85.85 0 0 0-.82-.56.83.83 0 0 0-.79.57l-2.18 6.67H7.4L5.21 1.01a.83.83 0 0 0-.79-.57.85.85 0 0 0-.82.56L.42 9.52l-.03.08a6 6 0 0 0 2.18 6.93l.01.01.03.02 7.5 5.6 3.71 2.81 3.71-2.81 7.5-5.6.03-.02.01-.01a6 6 0 0 0 2.18-6.93z',
  lightbulb: 'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19A7 7 0 0 0 5 9c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A6.99 6.99 0 0 0 19 9a7 7 0 0 0-7-7z',
}

function getIconPath(icon: string): string {
  return ICON_SVG[icon] ?? ICON_SVG['lightbulb']
}

// ─── 生命周期 ──────────────────────────────────────────────────

onMounted(() => {
  void mcpStore.loadCatalog()
})
</script>

<template>
  <div class="mcp-marketplace">
    <!-- 搜索与筛选栏 -->
    <div class="mcp-marketplace__toolbar">
      <NInput
        v-model:value="searchQuery"
        placeholder="搜索 MCP 服务器..."
        size="small"
        clearable
        class="mcp-marketplace__search"
      >
        <template #prefix>
          <NIcon :size="14"><SearchOutlined /></NIcon>
        </template>
      </NInput>
      <NSelect
        v-model:value="selectedCategory"
        :options="categoryOptions"
        size="small"
        class="mcp-marketplace__category"
      />
    </div>

    <!-- 加载中 -->
    <div v-if="mcpStore.catalogLoading" class="mcp-marketplace__loading">
      <NSpin size="medium" />
    </div>

    <!-- 空状态 -->
    <NEmpty
      v-else-if="filteredCatalog.length === 0"
      description="未找到匹配的 MCP 服务器"
      size="small"
      class="mcp-marketplace__empty"
    />

    <!-- 卡片网格 -->
    <div v-else class="mcp-marketplace__grid">
      <div
        v-for="entry in filteredCatalog"
        :key="entry.id"
        class="marketplace-card"
        :class="{ 'marketplace-card--installed': mcpStore.isInstalled(entry) }"
      >
        <!-- 卡片头部 -->
        <div class="marketplace-card__header">
          <div class="marketplace-card__icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path :d="getIconPath(entry.icon)" />
            </svg>
          </div>
          <div class="marketplace-card__title-area">
            <h3 class="marketplace-card__title">{{ entry.name }}</h3>
            <NTag size="tiny" :bordered="false">
              {{ CATEGORY_LABELS[entry.category] }}
            </NTag>
          </div>
        </div>

        <!-- 描述 -->
        <p class="marketplace-card__description">{{ entry.description }}</p>

        <!-- 传输方式 -->
        <div class="marketplace-card__meta">
          <span class="marketplace-card__transport">
            <NTag size="tiny" :type="entry.transport === 'stdio' ? 'info' : 'success'" :bordered="false">
              {{ entry.transport === 'stdio' ? 'Stdio' : 'HTTP' }}
            </NTag>
          </span>
          <span v-if="entry.envKeys?.length" class="marketplace-card__env-badge">
            需要 {{ entry.envKeys.length }} 个配置
          </span>
        </div>

        <!-- 操作按钮 -->
        <div class="marketplace-card__actions">
          <NButton
            v-if="mcpStore.isInstalled(entry)"
            size="small"
            type="success"
            ghost
            disabled
          >
            <template #icon>
              <NIcon><CheckOutlined /></NIcon>
            </template>
            已安装
          </NButton>
          <NButton
            v-else
            size="small"
            type="primary"
            :loading="installing && installingEntry?.id === entry.id"
            @click="openInstallModal(entry)"
          >
            <template #icon>
              <NIcon><DownloadOutlined /></NIcon>
            </template>
            安装
          </NButton>
          <NButton
            v-if="entry.homepage"
            size="small"
            quaternary
            tag="a"
            :href="entry.homepage"
            target="_blank"
            rel="noopener noreferrer"
            title="查看文档"
          >
            <template #icon>
              <NIcon><OpenInNewOutlined /></NIcon>
            </template>
          </NButton>
        </div>
      </div>
    </div>

    <!-- 安装确认弹窗 -->
    <NModal
      v-model:show="installModalVisible"
      preset="card"
      :title="`安装 ${installingEntry?.name ?? ''}`"
      style="width: 480px; max-width: 90vw"
      :mask-closable="false"
    >
      <template v-if="installingEntry">
        <p class="install-modal__desc">{{ installingEntry.description }}</p>

        <!-- 配置预览 -->
        <div class="install-modal__preview">
          <div class="install-modal__preview-row">
            <span class="install-modal__preview-label">传输方式:</span>
            <span>{{ installingEntry.transport === 'stdio' ? 'Stdio (本地进程)' : 'HTTP (远程)' }}</span>
          </div>
          <div v-if="installingEntry.command" class="install-modal__preview-row">
            <span class="install-modal__preview-label">命令:</span>
            <code>{{ installingEntry.command }} {{ (installingEntry.args ?? []).join(' ') }}</code>
          </div>
          <div v-if="installingEntry.url" class="install-modal__preview-row">
            <span class="install-modal__preview-label">URL:</span>
            <code>{{ installingEntry.url }}</code>
          </div>
        </div>

        <!-- 环境变量表单 -->
        <NForm v-if="installingEntry.envKeys?.length" label-placement="top" size="small" style="margin-top: 16px">
          <NFormItem
            v-for="envKey in installingEntry.envKeys"
            :key="envKey.key"
            :label="envKey.label"
            :required="envKey.required"
          >
            <NInput
              v-model:value="envValues[envKey.key]"
              :type="envKey.secret ? 'password' : 'text'"
              :placeholder="envKey.placeholder ?? `输入 ${envKey.label}`"
              show-password-on="click"
            />
          </NFormItem>
        </NForm>

        <div v-if="!installingEntry.envKeys?.length" class="install-modal__no-env">
          <NIcon :size="16" class="install-modal__no-env-icon">
            <CheckOutlined />
          </NIcon>
          <span>此服务器无需额外配置，可直接安装。</span>
        </div>
      </template>

      <template #footer>
        <NSpace justify="end">
          <NButton size="small" @click="installModalVisible = false">取消</NButton>
          <NButton
            type="primary"
            size="small"
            :loading="installing"
            @click="handleInstall"
          >
            确认安装
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.mcp-marketplace {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.mcp-marketplace__toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}

.mcp-marketplace__search {
  flex: 1;
}

.mcp-marketplace__category {
  width: 140px;
  flex-shrink: 0;
}

.mcp-marketplace__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.mcp-marketplace__empty {
  padding: 60px 0;
}

/* ─── 卡片网格 ─────────────────────────────────────────────── */

.mcp-marketplace__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.marketplace-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-md, 8px);
  background-color: var(--af-bg-surface, #1e293b);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.marketplace-card:hover {
  border-color: var(--af-brand, #6366f1);
  box-shadow: 0 0 0 1px var(--af-brand, #6366f1);
}

.marketplace-card--installed {
  border-color: var(--af-success, #10b981);
  opacity: 0.85;
}

.marketplace-card__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.marketplace-card__icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--af-radius-sm, 6px);
  background-color: var(--af-brand-bg, rgba(99, 102, 241, 0.1));
  color: var(--af-brand, #6366f1);
}

.marketplace-card__title-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.marketplace-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--af-text-primary, #e5e7eb);
  margin: 0;
  line-height: 1.3;
}

.marketplace-card__description {
  font-size: 12px;
  color: var(--af-text-muted, #9ca3af);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.marketplace-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
}

.marketplace-card__env-badge {
  color: var(--af-warning, #f59e0b);
}

.marketplace-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

/* ─── 安装弹窗 ─────────────────────────────────────────────── */

.install-modal__desc {
  font-size: 13px;
  color: var(--af-text-secondary, #9ca3af);
  margin: 0 0 12px;
}

.install-modal__preview {
  background-color: var(--af-bg-input, #0f172a);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.install-modal__preview-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.install-modal__preview-label {
  color: var(--af-text-muted, #6b7280);
  flex-shrink: 0;
  min-width: 70px;
}

.install-modal__preview-row code {
  font-size: 11px;
  color: var(--af-info, #0ea5e9);
  word-break: break-all;
}

.install-modal__no-env {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background-color: var(--af-success-bg, rgba(16, 185, 129, 0.08));
  border-radius: var(--af-radius-sm, 6px);
  font-size: 13px;
  color: var(--af-success, #10b981);
}

.install-modal__no-env-icon {
  flex-shrink: 0;
}
</style>
