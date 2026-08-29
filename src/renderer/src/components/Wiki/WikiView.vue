<script setup lang="ts">
// LLM Wiki View - Karpathy 模式知识库浏览器
// 展示 .llm-wiki/ 目录状态、页面列表和活动日志

import { onMounted, ref, computed } from 'vue'
import { NButton, NIcon, NTag, NCard, NSpin, NEmpty, NCollapse, NCollapseItem, NDataTable, useMessage, type DataTableColumns } from 'naive-ui'
import {
  RefreshOutlined,
  UploadOutlined,
  FolderOutlined,
  ArticleOutlined,
  DescriptionOutlined,
  ChatBubbleOutlined,
} from '@vicons/material'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()
const message = useMessage()

// ─── State ─────────────────────────────────────────────────────

const loading = ref(false)
const uploading = ref(false)
const wikiInitialized = ref(false)
const rawCount = ref(0)
const pageCount = ref(0)
const lastIngest = ref<string | null>(null)
const lastLint = ref<string | null>(null)
const pages = ref<Array<{ title: string; path: string; summary: string }>>([])
const rawFiles = ref<string[]>([])
const recentLogs = ref('')
const error = ref<string | null>(null)
const isDragOver = ref(false)

// ─── Computed ──────────────────────────────────────────────────

const columns = computed<DataTableColumns<{ title: string; path: string; summary: string }>>(() => [
  { title: '标题', key: 'title', width: 200, ellipsis: { tooltip: true } },
  { title: '路径', key: 'path', width: 250, ellipsis: { tooltip: true } },
  { title: '摘要', key: 'summary', ellipsis: { tooltip: true } },
])

// ─── Lifecycle ────────────────────────────────────────────────

onMounted(() => {
  void loadWikiStatus()
})

// ─── Handlers ─────────────────────────────────────────────────

async function loadWikiStatus(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await window.electron.wiki.status()
    wikiInitialized.value = result.initialized
    rawCount.value = result.rawCount ?? 0
    pageCount.value = result.pageCount ?? 0
    lastIngest.value = result.lastIngest ?? null
    lastLint.value = result.lastLint ?? null
    pages.value = result.pages ?? []
    rawFiles.value = result.rawFiles ?? []
    recentLogs.value = result.recentLogs ?? ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// UI-REDESIGN v1.0: handleBack 已移除（导航由 AppShell 承担）

function handleRefresh(): void {
  void loadWikiStatus()
}

async function handleInitWiki(): Promise<void> {
  try {
    await window.electron.wiki.init()
    void loadWikiStatus()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '初始化失败')
  }
}

/** 通过系统文件选择器上传到 raw/ */
async function handleUploadClick(): Promise<void> {
  const filePath = await window.electron.file.selectFile({
    title: '选择原始资料',
    filters: [
      { name: '知识库文件', extensions: ['md', 'txt', 'pdf', 'docx', 'xlsx', 'csv', 'json', 'html', 'xml'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (filePath) {
    await handleFileSelect(filePath)
  }
}

/** 选中文件后上传到 raw/ */
async function handleFileSelect(filePath: string): Promise<void> {
  if (!filePath) return
  uploading.value = true
  try {
    await window.electron.wiki.ingest(filePath)
    message.success('资料已添加到 raw/ 目录')
    void loadWikiStatus()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

/** 拖拽事件 */
function handleDragOver(e: DragEvent): void {
  e.preventDefault()
  isDragOver.value = true
}

function handleDragLeave(): void {
  isDragOver.value = false
}

async function handleDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (let i = 0; i < files.length; i++) {
    const filePath = (files[i] as unknown as { path: string }).path
    if (filePath) {
      await handleFileSelect(filePath)
    }
  }
}

/** 跳转到对话视图并带提示 */
function handleGoCompile(): void {
  uiStore.setCurrentView('chat')
}
void handleGoCompile // UI-REDESIGN v1.0: 返回按钮已移除，保留跳转函数
</script>

<template>
  <div
    class="wiki-view"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Header -->
    <div class="wiki-view__header">
      <div class="wiki-view__header-left">
        <!-- UI-REDESIGN v1.0: 返回按钮已由 AppShell 导航栏替代 -->
        <span class="wiki-view__title">LLM Wiki</span>
        <NTag size="small" type="info">Karpathy 模式</NTag>
      </div>
      <div class="wiki-view__header-actions">
        <NButton
          v-if="wikiInitialized"
          size="tiny"
          type="primary"
          :loading="uploading"
          @click="handleUploadClick"
        >
          <template #icon>
            <NIcon><UploadOutlined /></NIcon>
          </template>
          上传资料
        </NButton>
        <NButton size="tiny" quaternary @click="handleRefresh">
          <template #icon>
            <NIcon><RefreshOutlined /></NIcon>
          </template>
          刷新
        </NButton>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="wiki-view__loading">
      <NSpin size="small" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="wiki-view__error">
      <NEmpty description="加载失败" :size="small">
        <template #extra>
          <span class="wiki-view__error-msg">{{ error }}</span>
          <NButton size="small" @click="handleRefresh">重试</NButton>
        </template>
      </NEmpty>
    </div>

    <!-- Content -->
    <div v-else class="wiki-view__content">
      <!-- Not initialized -->
      <NCard v-if="!wikiInitialized" class="wiki-view__card" title="三层架构" size="small">
        <template #header-extra>
          <NButton size="small" type="primary" @click="handleInitWiki">
            初始化 Wiki
          </NButton>
        </template>
        <p class="wiki-view__desc">
          LLM Wiki 采用 Karpathy 提出的三层架构，让 AI 将原始资料"编译"为结构化知识库。
        </p>
        <div class="wiki-view__layers">
          <div class="wiki-view__layer">
            <NIcon :size="20" color="#60a5fa"><FolderOutlined /></NIcon>
            <div>
              <strong>raw/</strong>
              <span>原始资料（不可变）</span>
            </div>
          </div>
          <div class="wiki-view__layer">
            <NIcon :size="20" color="#34d399"><ArticleOutlined /></NIcon>
            <div>
              <strong>wiki/</strong>
              <span>LLM 编译的知识页面</span>
            </div>
          </div>
          <div class="wiki-view__layer">
            <NIcon :size="20" color="#a78bfa"><DescriptionOutlined /></NIcon>
            <div>
              <strong>rules/</strong>
              <span>Schema 规则定义</span>
            </div>
          </div>
        </div>
        <p class="wiki-view__hint">
          点击"初始化 Wiki"在工作区创建目录结构，然后通过对话让 Agent 编译你的知识库。
        </p>
      </NCard>

      <!-- Stats -->
      <template v-else>
        <div class="wiki-view__stats">
          <NCard size="small" class="wiki-view__stat">
            <div class="wiki-view__stat-value">{{ rawCount }}</div>
            <div class="wiki-view__stat-label">原始资料</div>
          </NCard>
          <NCard size="small" class="wiki-view__stat">
            <div class="wiki-view__stat-value">{{ pageCount }}</div>
            <div class="wiki-view__stat-label">编译页面</div>
          </NCard>
          <NCard size="small" class="wiki-view__stat">
            <div class="wiki-view__stat-value">
              <NTag v-if="lastIngest" size="tiny" type="success">活跃</NTag>
              <NTag v-else size="tiny" type="warning">待编译</NTag>
            </div>
            <div class="wiki-view__stat-label">最后编译</div>
          </NCard>
        </div>

        <!-- Drag & Drop zone -->
        <div
          class="wiki-view__drop-zone"
          :class="{ 'wiki-view__drop-zone--active': isDragOver }"
        >
          <NIcon :size="28" :color="isDragOver ? 'var(--af-brand)' : 'var(--af-text-muted)'">
            <UploadOutlined />
          </NIcon>
          <span class="wiki-view__drop-text">{{ isDragOver ? '释放文件以上传' : '拖拽文件到此处，或点击上方按钮上传' }}</span>
          <span class="wiki-view__drop-hint">支持 .md .txt .pdf .docx .xlsx .csv .json</span>
        </div>

        <!-- Go compile prompt -->
        <div v-if="rawCount > 0 && pageCount === 0" class="wiki-view__compile-prompt">
          <NIcon :size="16" color="var(--af-brand)"><ChatBubbleOutlined /></NIcon>
          <span>已有 {{ rawCount }} 份原始资料，回到对话中告诉 AI "编译 wiki" 即可生成知识页面</span>
          <NButton size="tiny" type="primary" quaternary @click="handleGoCompile">
            去编译
          </NButton>
        </div>

        <!-- Pages Table -->
        <NCard size="small" title="Wiki 页面" class="wiki-view__section">
          <NDataTable
            v-if="pages.length > 0"
            :columns="columns"
            :data="pages"
            size="small"
            :bordered="false"
            :single-line="false"
            :max-height="300"
          />
          <NEmpty v-else description="暂无编译页面" size="small" />
        </NCard>

        <!-- Raw Sources -->
        <NCollapse class="wiki-view__section">
          <NCollapseItem
            title="原始资料"
            :name="'raw'"
          >
            <div v-if="rawFiles.length > 0" class="wiki-view__raw-list">
              <div v-for="f in rawFiles" :key="f" class="wiki-view__raw-item">
                <NIcon :size="14" color="#60a5fa"><DescriptionOutlined /></NIcon>
                <span>{{ f }}</span>
              </div>
            </div>
            <NEmpty v-else description="暂无原始资料" size="small" />
          </NCollapseItem>
          <NCollapseItem
            title="活动日志"
            :name="'log'"
          >
            <pre class="wiki-view__log">{{ recentLogs || '（暂无日志）' }}</pre>
          </NCollapseItem>
        </NCollapse>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wiki-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--af-bg, #0f172a);
  color: var(--af-text-primary, #f1f5f9);
}

.wiki-view__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--af-border, #334155);
  flex-shrink: 0;
  min-height: 44px;
}

.wiki-view__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wiki-view__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
}

.wiki-view__header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.wiki-view__loading {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
}

.wiki-view__error {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
}

.wiki-view__error-msg {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  margin-bottom: 8px;
  display: block;
}

.wiki-view__content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wiki-view__card {
  max-width: 600px;
  margin: 0 auto;
}

.wiki-view__desc {
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  line-height: 1.6;
  margin-bottom: 16px;
}

.wiki-view__layers {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.wiki-view__layer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--af-bg-input, #1f2937);
  border-radius: var(--af-radius-sm, 6px);
}

.wiki-view__layer div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wiki-view__layer strong {
  font-size: 13px;
  color: var(--af-text-primary, #f1f5f9);
}

.wiki-view__layer span {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
}

.wiki-view__hint {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  line-height: 1.5;
}

.wiki-view__stats {
  display: flex;
  gap: 12px;
}

.wiki-view__stat {
  flex: 1;
  text-align: center;
}

.wiki-view__stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
  margin-bottom: 4px;
}

.wiki-view__stat-label {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
}

/* ─── Drop zone ──────────────────────────────────────────── */

.wiki-view__drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  border: 2px dashed var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  transition: all 0.2s ease;
  cursor: pointer;
}

.wiki-view__drop-zone:hover,
.wiki-view__drop-zone--active {
  border-color: var(--af-brand, #818cf8);
  background-color: var(--af-bg-hover, #334155);
}

.wiki-view__drop-text {
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
}

.wiki-view__drop-hint {
  font-size: 11px;
  color: var(--af-text-muted, #64748b);
}

/* ─── Compile prompt ──────────────────────────────────────── */

.wiki-view__compile-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--af-bg-input, #1f2937);
  border-radius: var(--af-radius-sm, 6px);
  border-left: 3px solid var(--af-brand, #818cf8);
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
}

.wiki-view__compile-prompt span {
  flex: 1;
}

/* ─── Sections ───────────────────────────────────────────── */

.wiki-view__section {
  flex-shrink: 0;
}

.wiki-view__raw-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wiki-view__raw-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  padding: 4px 0;
}

.wiki-view__log {
  font-size: 12px;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  color: var(--af-text-tertiary, #94a3b8);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
}
</style>
