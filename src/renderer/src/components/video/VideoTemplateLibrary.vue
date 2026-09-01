<script setup lang="ts">
// M19: VideoTemplateLibrary - 分镜模板库面板
//  - 列出可复用的分镜/序列模板。
//  - 支持创建/编辑模板（类型、分辨率、画幅、镜头行、连续性、标签）。
//  - 一键按模板生成视频（可选厂商覆盖），支持删除。

import { computed, onMounted, reactive, ref } from 'vue'
import {
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
} from 'naive-ui'
import {
  AddPhotoAlternateOutlined,
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  CollectionsBookmarkOutlined,
} from '@vicons/material'
import type {
  CreateVideoTemplateParams,
  UpdateVideoTemplateParams,
  VideoResolution,
  VideoAspect,
  VideoTemplate,
} from '@shared/types'
import { useVideoStore } from '@/stores/video'
import { showToast } from '@/utils/toast'

const videoStore = useVideoStore()

const loading = computed(() => videoStore.templatesLoading)

/** 模板搜索（名称 / 标签，前端过滤） */
const search = ref('')
const filteredTemplates = computed(() => {
  const k = search.value.trim().toLowerCase()
  if (!k) return videoStore.templates
  return videoStore.templates.filter(
    (t) =>
      t.name.toLowerCase().includes(k) ||
      (t.tags ?? []).some((tag) => tag.toLowerCase().includes(k)),
  )
})

const RESOLUTION_OPTIONS = [
  { label: '480P', value: '480P' },
  { label: '720P', value: '720P' },
  { label: '1080P', value: '1080P' },
]
const ASPECT_OPTIONS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '1:1', value: '1:1' },
]
const TYPE_OPTIONS = [
  { label: '单镜头', value: 'shot' },
  { label: '多镜头序列', value: 'sequence' },
]
const PROVIDER_OPTIONS = [
  { label: '自动（智能路由）', value: '' },
  { label: 'Seedance', value: 'seedance' },
  { label: 'Kling', value: 'kling' },
  { label: '自定义', value: 'custom' },
]

interface TemplateForm {
  name: string
  description: string
  type: 'shot' | 'sequence'
  resolution: VideoResolution
  aspect: VideoAspect
  continuity: boolean
  model: string
  tags: string
  prompts: string
}

const showModal = ref(false)
const editingId = ref<string | null>(null)
const modalSaving = ref(false)
const form = reactive<TemplateForm>({
  name: '',
  description: '',
  type: 'shot',
  resolution: '720P',
  aspect: '16:9',
  continuity: false,
  model: '',
  tags: '',
  prompts: '',
})

function resetForm(): void {
  editingId.value = null
  form.name = ''
  form.description = ''
  form.type = 'shot'
  form.resolution = '720P'
  form.aspect = '16:9'
  form.continuity = false
  form.model = ''
  form.tags = ''
  form.prompts = ''
}

function openCreate(): void {
  resetForm()
  showModal.value = true
}

function openEdit(template: VideoTemplate): void {
  editingId.value = template.id
  form.name = template.name
  form.description = template.description
  form.type = template.type
  form.resolution = template.resolution
  form.aspect = template.aspect
  form.continuity = template.continuity
  form.model = template.model ?? ''
  form.tags = (template.tags ?? []).join(', ')
  form.prompts = (template.shots ?? []).map((s) => s.prompt).join('\n')
  showModal.value = true
}

function promptsToShots(): { prompt: string }[] {
  return form.prompts
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((prompt) => ({ prompt }))
}

async function saveTemplate(): Promise<void> {
  if (!form.name.trim()) {
    showToast('请输入模板名称', 'warning')
    return
  }
  if (promptsToShots().length === 0 || (form.type === 'sequence' && promptsToShots().length < 2)) {
    showToast(form.type === 'sequence' ? '序列模板至少需要 2 个镜头' : '请至少输入一个镜头', 'warning')
    return
  }
  const shots = promptsToShots() as unknown as TemplateForm[]
  const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
  const base = {
    type: form.type,
    resolution: form.resolution,
    aspect: form.aspect,
    shots,
    continuity: form.type === 'sequence' ? form.continuity : false,
    model: form.model.trim() || null,
    tags,
  }
  modalSaving.value = true
  try {
    if (editingId.value) {
      const params: UpdateVideoTemplateParams = {
        ...base,
        description: form.description.trim(),
        name: form.name.trim(),
      }
      await videoStore.updateTemplate(editingId.value, params)
    } else {
      const params: CreateVideoTemplateParams = {
        ...base,
        description: form.description.trim(),
        name: form.name.trim(),
      }
      await videoStore.createTemplate(params)
    }
    showModal.value = false
  } finally {
    modalSaving.value = false
  }
}

async function generateFrom(template: VideoTemplate): Promise<void> {
  await videoStore.generateFromTemplate(template.id)
  showToast(`已按模板「${template.name}」提交生成任务`, 'success')
}

onMounted(() => {
  void videoStore.fetchTemplates()
})
</script>

<template>
  <div class="template-panel">
    <div class="template-panel__header">
      <h3 class="template-panel__title">
        <CollectionsBookmarkOutlined class="template-panel__title-icon" />
        分镜模板库
      </h3>
      <div class="template-panel__actions">
        <NInput
          v-model:value="search"
          size="small"
          clearable
          placeholder="搜索模板名称 / 标签…"
          class="template-panel__search"
        />
        <NButton type="primary" size="small" :disabled="loading" @click="openCreate">
          <template #icon><AddPhotoAlternateOutlined /></template>
          新建模板
        </NButton>
      </div>
    </div>

    <NSpin :show="loading">
      <NEmpty
        v-if="!loading && videoStore.templates.length === 0"
        description="还没有分镜模板，新建一个开始复用"
      >
        <template #extra>
          <NButton type="primary" size="small" @click="openCreate">新建模板</NButton>
        </template>
      </NEmpty>

      <NEmpty
        v-else-if="!loading && filteredTemplates.length === 0"
        description="没有匹配的模板"
        style="padding: 16px 0"
      />

      <div v-else class="template-panel__grid">
        <NCard
          v-for="template in filteredTemplates"
          :key="template.id"
          class="template-card"
          :bordered="true"
        >
          <div class="template-card__head">
            <div class="template-card__name">
              <NTag :type="template.type === 'sequence' ? 'info' : 'success'" size="small">
                {{ template.type === 'sequence' ? '序列' : '单镜头' }}
              </NTag>
              <span class="template-card__title">{{ template.name }}</span>
            </div>
            <NSpace size="small" align="center">
              <NPopconfirm @positive-click="generateFrom(template)">
                <template #trigger>
                  <NButton size="tiny" type="primary" secondary>
                    <template #icon><PlayCircleOutlined /></template>
                    一键生成
                  </NButton>
                </template>
                按该模板提交生成任务？
              </NPopconfirm>
              <NButton size="tiny" quaternary @click="openEdit(template)">
                <template #icon><EditOutlined /></template>
              </NButton>
              <NPopconfirm @positive-click="videoStore.deleteTemplate(template.id)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error">
                    <template #icon><DeleteOutlined /></template>
                  </NButton>
                </template>
                确认删除该模板？
              </NPopconfirm>
            </NSpace>
          </div>

          <div class="template-card__meta">
            <NText depth="3">
              {{ (template.shots ?? []).length }} 个镜头 · {{ template.resolution }} ·
              {{ template.aspect }}
              <template v-if="template.continuity"> · 连续性衔接</template>
              <template v-if="template.model"> · {{ template.model }}</template>
            </NText>
          </div>

          <p v-if="template.description" class="template-card__desc">{{ template.description }}</p>

          <div class="template-card__prompts">
            <div v-for="(shot, i) in template.shots" :key="i" class="template-card__prompt">
              <NTag size="tiny" type="warning">{{ i + 1 }}</NTag>
              <NText depth="2" class="template-card__prompt-text">{{ shot.prompt }}</NText>
            </div>
          </div>

          <NSpace v-if="template.tags && template.tags.length > 0" size="small" class="template-card__tags">
            <NTag v-for="tag in template.tags" :key="tag" size="tiny" type="info">{{ tag }}</NTag>
          </NSpace>
        </NCard>
      </div>
    </NSpin>

    <!-- 新建/编辑模板 -->
    <NModal
      v-model:show="showModal"
      preset="card"
      :style="{ width: '640px' }"
      :title="editingId ? '编辑模板' : '新建模板'"
    >
      <NForm label-placement="top" class="template-form">
        <NFormItem label="模板名称">
          <NInput v-model:value="form.name" placeholder="例如：产品开箱三镜头" />
        </NFormItem>
        <NFormItem label="描述">
          <NInput v-model:value="form.description" placeholder="模板用途描述（可选）" />
        </NFormItem>
        <NSpace :size="12">
          <NFormItem label="类型" style="flex: 1">
            <NSelect v-model:value="form.type" :options="TYPE_OPTIONS" />
          </NFormItem>
          <NFormItem label="分辨率" style="flex: 1">
            <NSelect v-model:value="form.resolution" :options="RESOLUTION_OPTIONS" />
          </NFormItem>
          <NFormItem label="画幅" style="flex: 1">
            <NSelect v-model:value="form.aspect" :options="ASPECT_OPTIONS" />
          </NFormItem>
        </NSpace>
        <NFormItem label="厂商模型（可选）">
          <NSelect
            v-model:value="form.model"
            :options="PROVIDER_OPTIONS"
            placeholder="留空则使用默认模型"
          />
        </NFormItem>
        <NFormItem v-if="form.type === 'sequence'" label="连续性衔接（镜头尾帧作为下个镜头首帧）">
          <NSwitch v-model:value="form.continuity" size="small" />
        </NFormItem>
        <NFormItem label="镜头提示词（每行一个镜头）">
          <NInput
            v-model:value="form.prompts"
            type="textarea"
            :rows="5"
            placeholder="逐行输入镜头提示词；序列模板至少 2 行"
          />
        </NFormItem>
        <NFormItem label="标签（逗号分隔）">
          <NInput v-model:value="form.tags" placeholder="例如：产品, 开箱, 竖屏" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModal = false">取消</NButton>
          <NButton type="primary" :loading="modalSaving" @click="saveTemplate">保存</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.template-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.template-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
}
.template-panel__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.template-panel__search {
  width: 220px;
}
.template-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.template-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.template-card__name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.template-card__title {
  font-weight: 600;
}
.template-card__meta {
  margin-top: 10px;
  font-size: 12px;
}
.template-card__desc {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--n-text-color-3, #999);
}
.template-card__prompts {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.template-card__prompt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
}
.template-card__prompt-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}
.template-card__tags {
  margin-top: 10px;
}
.template-form {
  max-height: 60vh;
  overflow: auto;
}
</style>