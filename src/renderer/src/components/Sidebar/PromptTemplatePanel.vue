<script setup lang="ts">
// PT-02: PromptTemplatePanel - Prompt 模板库面板
// 列表展示已保存的 Prompt 模板，支持搜索、分类筛选、创建/编辑/删除/复制

import { ref, reactive, computed, onMounted } from 'vue'
import {
  NIcon,
  NInput,
  NButton,
  NSelect,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NEmpty,
  NSpin,
  NPopconfirm,
  NDynamicTags,
  NSpace,
  NTooltip,
} from 'naive-ui'
import {
  AddOutlined,
  EditOutlined,
  DeleteOutlined,
  RefreshOutlined,
  ContentCopyOutlined,
  SearchOutlined,
  TextSnippetOutlined,
} from '@vicons/material'
import type { PromptTemplate } from '@shared/types'
import type {
  CreatePromptTemplateParams,
  UpdatePromptTemplateParams,
} from '@/types/electron-api'
import { usePromptTemplateStore } from '@/stores/prompt-template'

const store = usePromptTemplateStore()

onMounted(() => {
  void store.loadTemplates()
})

// ─── 表单状态 ──────────────────────────────────────────────────

const modalVisible = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

interface PromptTemplateFormState {
  title: string
  content: string
  category: string
  variables: string[]
}

const DEFAULT_FORM: PromptTemplateFormState = {
  title: '',
  content: '',
  category: 'general',
  variables: [],
}

const form = reactive<PromptTemplateFormState>({ ...DEFAULT_FORM })

const isEditing = computed(() => editingId.value !== null)
const modalTitle = computed(() => (isEditing.value ? '编辑模板' : '新建模板'))

// 常用分类快捷选项
const categoryOptions = computed(() => {
  const preset = ['general', 'writing', 'coding', 'analysis', 'translation']
  const existing = store.templates.map((t) => t.category)
  const all = Array.from(new Set([...preset, ...existing]))
  return all.map((c) => ({ label: c, value: c }))
})

function resetForm(): void {
  Object.assign(form, DEFAULT_FORM)
  editingId.value = null
}

function openCreateModal(): void {
  resetForm()
  modalVisible.value = true
}

function openEditModal(template: PromptTemplate): void {
  editingId.value = template.id
  form.title = template.title
  form.content = template.content
  form.category = template.category
  form.variables = [...template.variables]
  modalVisible.value = true
}

function buildParams(): CreatePromptTemplateParams | UpdatePromptTemplateParams {
  const data = {
    title: form.title.trim(),
    content: form.content.trim(),
    category: form.category.trim() || 'general',
    variables: form.variables,
  }

  if (isEditing.value && editingId.value) {
    return { id: editingId.value, ...data } as UpdatePromptTemplateParams
  }

  return data as CreatePromptTemplateParams
}

async function handleSave(): Promise<void> {
  if (!form.title.trim() || !form.content.trim()) return

  saving.value = true
  try {
    const params = buildParams()
    if (isEditing.value && editingId.value) {
      const { id, ...rest } = params as UpdatePromptTemplateParams
      await store.updateTemplate(id, rest)
    } else {
      await store.createTemplate(params as CreatePromptTemplateParams)
    }
    modalVisible.value = false
  } catch {
    // 错误已在 store 中处理
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string): Promise<void> {
  await store.deleteTemplate(id)
}

async function handleRefresh(): Promise<void> {
  await store.loadTemplates()
}

function handleCopy(template: PromptTemplate): void {
  void store.copyTemplateContent(template)
}

/** 内容预览（截断） */
function previewContent(content: string, max = 120): string {
  const text = content.replace(/\n+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '...' : text
}

/** 格式化变量名为 {{变量名}} 形式 */
function formatVariable(name: string): string {
  return `{{${name}}}`
}

/** 相对时间格式化 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="prompt-template-panel">
    <!-- Header -->
    <div class="prompt-template-panel__header">
      <span class="prompt-template-panel__title">
        <NIcon :size="14"><TextSnippetOutlined /></NIcon>
        Prompt 模板
      </span>
      <div class="prompt-template-panel__actions">
        <button
          class="prompt-template-panel__btn"
          type="button"
          title="新建模板"
          @click="openCreateModal"
        >
          <NIcon :size="14"><AddOutlined /></NIcon>
        </button>
        <button
          class="prompt-template-panel__btn"
          type="button"
          title="刷新"
          @click="handleRefresh"
        >
          <NIcon :size="14"><RefreshOutlined /></NIcon>
        </button>
      </div>
    </div>

    <!-- Search -->
    <div class="prompt-template-panel__search">
      <NInput
        v-model:value="store.searchQuery"
        placeholder="搜索模板..."
        size="small"
        clearable
      >
        <template #prefix>
          <NIcon :size="14"><SearchOutlined /></NIcon>
        </template>
      </NInput>
    </div>

    <!-- Category filter -->
    <div class="prompt-template-panel__categories">
      <NSelect
        v-model:value="store.selectedCategory"
        size="small"
        :options="store.categories.map((c) => ({ label: c === 'all' ? '全部分类' : c, value: c }))"
        placeholder="选择分类"
      />
    </div>

    <!-- Content -->
    <div class="prompt-template-panel__content">
      <!-- Loading -->
      <div v-if="store.loading" class="prompt-template-panel__loading">
        <NSpin size="small" />
      </div>

      <!-- Empty state -->
      <div v-else-if="store.filteredTemplates.length === 0" class="prompt-template-panel__empty">
        <NEmpty size="small" description="暂无模板">
          <template #extra>
            <NButton size="small" type="primary" @click="openCreateModal">
              创建第一个模板
            </NButton>
          </template>
        </NEmpty>
      </div>

      <!-- Template list -->
      <div v-else class="prompt-template-panel__list">
        <div
          v-for="template in store.filteredTemplates"
          :key="template.id"
          class="template-card"
        >
          <div class="template-card__header">
            <span class="template-card__title" :title="template.title">
              {{ template.title }}
            </span>
            <div class="template-card__actions">
              <NTooltip>
                <template #trigger>
                  <button
                    class="template-card__btn template-card__btn--copy"
                    title="复制内容"
                    @click="handleCopy(template)"
                  >
                    <NIcon :size="14"><ContentCopyOutlined /></NIcon>
                  </button>
                </template>
                复制内容到剪贴板
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <button
                    class="template-card__btn template-card__btn--edit"
                    title="编辑"
                    @click="openEditModal(template)"
                  >
                    <NIcon :size="14"><EditOutlined /></NIcon>
                  </button>
                </template>
                编辑模板
              </NTooltip>
              <NPopconfirm
                :show-icon="false"
                placement="left"
                @positive-click="handleDelete(template.id)"
              >
                <template #trigger>
                  <button
                    class="template-card__btn template-card__btn--delete"
                    title="删除"
                  >
                    <NIcon :size="14"><DeleteOutlined /></NIcon>
                  </button>
                </template>
                <div style="max-width: 200px">
                  <p style="margin: 0 0 8px; font-weight: 500">删除模板</p>
                  <p style="margin: 0; font-size: 13px; color: var(--af-text-muted, #9ca3af)">
                    确定要删除「{{ template.title }}」吗？此操作不可恢复。
                  </p>
                </div>
              </NPopconfirm>
            </div>
          </div>

          <p class="template-card__content">{{ previewContent(template.content) }}</p>

          <div class="template-card__footer">
            <div class="template-card__tags">
              <NTag size="small" type="info" :bordered="false">
                {{ template.category }}
              </NTag>
              <NTag
                v-for="v in template.variables"
                :key="v"
                size="small"
                :bordered="false"
              >
                {{ formatVariable(v) }}
              </NTag>
            </div>
            <span class="template-card__time">
              {{ formatRelativeTime(template.updatedAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建/编辑模板弹窗 -->
    <NModal
      v-model:show="modalVisible"
      preset="card"
      :title="modalTitle"
      style="width: 640px"
      :mask-closable="false"
    >
      <NForm label-placement="top" size="small">
        <NFormItem label="标题" required>
          <NInput
            v-model:value="form.title"
            placeholder="模板标题，例如：代码审查 Prompt"
            maxlength="100"
          />
        </NFormItem>

        <NFormItem label="分类">
          <NSelect
            v-model:value="form.category"
            :options="categoryOptions"
            filterable
            tag
            placeholder="选择或输入分类"
          />
        </NFormItem>

        <NFormItem label="内容" required>
          <NInput
            v-model:value="form.content"
            type="textarea"
            :rows="8"
            placeholder="Prompt 内容，支持 {{变量名}} 插值"
          />
        </NFormItem>

        <NFormItem label="变量">
          <NDynamicTags
            v-model:value="form.variables"
            :max="20"
            type="info"
            placeholder="输入变量名后回车"
          />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton size="small" @click="modalVisible = false">取消</NButton>
          <NButton
            type="primary"
            size="small"
            :loading="saving"
            :disabled="!form.title.trim() || !form.content.trim()"
            @click="handleSave"
          >
            {{ isEditing ? '保存' : '创建' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.prompt-template-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background-color: var(--af-bg-surface, #111827);
}

.prompt-template-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.prompt-template-panel__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.prompt-template-panel__actions {
  display: flex;
  gap: 4px;
}

.prompt-template-panel__btn {
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

.prompt-template-panel__btn:hover {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.prompt-template-panel__search {
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.prompt-template-panel__categories {
  padding: 0 12px 8px;
  flex-shrink: 0;
}

.prompt-template-panel__content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.prompt-template-panel__loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 32px;
}

.prompt-template-panel__empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 32px 16px;
}

.prompt-template-panel__list {
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ─── Template Card ─────────────────────────────────────────── */
.template-card {
  background-color: var(--af-bg-elevated, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius, 8px);
  padding: 10px 12px;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.template-card:hover {
  border-color: var(--af-brand, #4f46e5);
  background-color: var(--af-bg-hover, #1f2937);
}

.template-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.template-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-primary, #e5e7eb);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.template-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.template-card:hover .template-card__actions {
  opacity: 1;
}

.template-card__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--af-text-muted, #9ca3af);
  cursor: pointer;
  transition: all 0.15s ease;
}

.template-card__btn--copy:hover {
  color: var(--af-info, #0ea5e9);
  background-color: color-mix(in srgb, var(--af-info, #0ea5e9) 10%, transparent);
}

.template-card__btn--edit:hover {
  color: var(--af-brand, #4f46e5);
  background-color: color-mix(in srgb, var(--af-brand, #4f46e5) 10%, transparent);
}

.template-card__btn--delete:hover {
  color: var(--af-error, #ef4444);
  background-color: color-mix(in srgb, var(--af-error, #ef4444) 10%, transparent);
}

.template-card__content {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--af-text-secondary, #cbd5e1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.template-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}

.template-card__time {
  font-size: 11px;
  color: var(--af-text-muted, #6b7280);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
