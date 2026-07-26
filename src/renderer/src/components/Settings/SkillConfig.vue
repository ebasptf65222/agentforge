<script setup lang="ts">
// SkillConfig - Skills 配置管理界面
// 列表展示已创建的 Skills，支持创建/编辑/删除

import { ref, reactive, computed, onMounted, h } from 'vue'
import {
  NDataTable,
  NButton,
  NIcon,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NPopconfirm,
  NDynamicTags,
  type DataTableColumns,
} from 'naive-ui'
import { AddOutlined, EditOutlined, DeleteOutlined, RefreshOutlined } from '@vicons/material'
import type { Skill, SkillTrigger } from '@shared/types'
import type { CreateSkillParams, UpdateSkillParams } from '@/types/electron-api'
import { useSkillStore } from '@/stores/skill'
import { useModelStore } from '@/stores/model'

const skillStore = useSkillStore()
const modelStore = useModelStore()

onMounted(() => {
  void skillStore.loadSkills()
  // 确保模型列表已加载（供 Skill 表单中选择模型）
  if (modelStore.models.length === 0) {
    void modelStore.loadModels()
  }
})

// ─── 表单状态 ──────────────────────────────────────────────────

const modalVisible = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

interface SkillFormState {
  name: string
  displayName: string
  description: string
  prompt: string
  modelId: string | null
  allowedTools: string[]
  trigger: SkillTrigger
}

const DEFAULT_FORM: SkillFormState = {
  name: '',
  displayName: '',
  description: '',
  prompt: '',
  modelId: null,
  allowedTools: [],
  trigger: 'manual',
}

const form = reactive<SkillFormState>({ ...DEFAULT_FORM })

const triggerOptions = [
  { label: '手动触发', value: 'manual' },
  { label: '自动触发', value: 'auto' },
]

const modelOptions = computed(() => {
  const opts = modelStore.models.map((m) => ({
    label: m.name,
    value: m.id,
  }))
  return [{ label: '使用默认模型', value: null }, ...opts]
})

const isEditing = computed(() => editingId.value !== null)
const modalTitle = computed(() => (isEditing.value ? '编辑 Skill' : '创建 Skill'))

function resetForm(): void {
  Object.assign(form, DEFAULT_FORM)
  editingId.value = null
}

function openCreateModal(): void {
  resetForm()
  modalVisible.value = true
}

function openEditModal(skill: Skill): void {
  editingId.value = skill.id
  form.name = skill.name
  form.displayName = skill.displayName
  form.description = skill.description
  form.prompt = skill.prompt
  form.modelId = skill.modelId ?? null
  form.allowedTools = [...skill.allowedTools]
  form.trigger = skill.trigger
  modalVisible.value = true
}

function buildParams(): CreateSkillParams | UpdateSkillParams {
  const base = {
    displayName: form.displayName.trim(),
    description: form.description.trim(),
    prompt: form.prompt.trim(),
    modelId: form.modelId,
    allowedTools: form.allowedTools,
    trigger: form.trigger,
  }

  if (isEditing.value && editingId.value) {
    return { id: editingId.value, ...base } as UpdateSkillParams
  }

  return {
    name: form.name.trim(),
    ...base,
  } as CreateSkillParams
}

async function handleSave(): Promise<void> {
  if (!form.displayName.trim() || !form.prompt.trim()) return

  saving.value = true
  try {
    const params = buildParams()
    if (isEditing.value) {
      await skillStore.updateSkill(params as UpdateSkillParams)
    } else {
      await skillStore.createSkill(params as CreateSkillParams)
    }
    modalVisible.value = false
  } catch {
    // 错误已在 store 中处理
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string): Promise<void> {
  await skillStore.deleteSkill(id)
}

async function handleRefresh(): Promise<void> {
  await skillStore.loadSkills()
}

// ─── 表格列定义 ────────────────────────────────────────────────

const columns = computed<DataTableColumns<Skill>>(() => [
  {
    title: '名称',
    key: 'displayName',
    width: 140,
    ellipsis: { tooltip: true },
    render(row) {
      return h('div', { style: 'display:flex; align-items:center; gap:6px' }, [
        h('span', null, row.displayName),
        row.isBuiltin
          ? h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => '内置' })
          : null,
      ])
    },
  },
  {
    title: '描述',
    key: 'description',
    ellipsis: { tooltip: true },
  },
  {
    title: '触发',
    key: 'trigger',
    width: 90,
    render(row) {
      return h(
        NTag,
        { size: 'small', type: row.trigger === 'auto' ? 'success' : 'default', bordered: false },
        { default: () => (row.trigger === 'auto' ? '自动' : '手动') },
      )
    },
  },
  {
    title: '工具',
    key: 'allowedTools',
    width: 100,
    render(row) {
      return row.allowedTools.length > 0
        ? `${row.allowedTools.length} 个`
        : '全部'
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render(row) {
      const buttons = [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            onClick: () => openEditModal(row),
          },
          {
            icon: () => h(NIcon, null, { default: () => h(EditOutlined) }),
          },
        ),
      ]

      if (!row.isBuiltin) {
        buttons.push(
          h(
            NPopconfirm,
            {
              onPositiveClick: () => handleDelete(row.id),
            },
            {
              trigger: () =>
                h(
                  NButton,
                  { size: 'small', quaternary: true, type: 'error' },
                  {
                    icon: () => h(NIcon, null, { default: () => h(DeleteOutlined) }),
                  },
                ),
              default: () => `确定删除 Skill "${row.displayName}" 吗？`,
            },
          ),
        )
      }

      return h('div', { style: 'display:flex; gap:4px' }, buttons)
    },
  },
])
</script>

<template>
  <div class="skill-config">
    <!-- 操作栏 -->
    <div class="skill-config__toolbar">
      <NSpace>
        <NButton type="primary" size="small" @click="openCreateModal">
          <template #icon>
            <NIcon><AddOutlined /></NIcon>
          </template>
          创建 Skill
        </NButton>
        <NButton quaternary size="small" @click="handleRefresh">
          <template #icon>
            <NIcon><RefreshOutlined /></NIcon>
          </template>
          刷新
        </NButton>
      </NSpace>
    </div>

    <!-- Skills 列表 -->
    <NDataTable
      :columns="columns"
      :data="skillStore.skills"
      :loading="skillStore.loading"
      :bordered="false"
      size="small"
      :row-key="(row: Skill) => row.id"
    />

    <!-- 创建/编辑 Skill 弹窗 -->
    <NModal
      v-model:show="modalVisible"
      preset="card"
      :title="modalTitle"
      style="width: 600px"
      :mask-closable="false"
    >
      <NForm label-placement="top" size="small">
        <NFormItem v-if="!isEditing" label="标识名称 (name)" required>
          <NInput
            v-model:value="form.name"
            placeholder="英文标识符，例如：code-review"
          />
        </NFormItem>

        <NFormItem label="显示名称" required>
          <NInput v-model:value="form.displayName" placeholder="例如：代码审查" />
        </NFormItem>

        <NFormItem label="描述">
          <NInput
            v-model:value="form.description"
            type="textarea"
            :rows="2"
            placeholder="描述这个 Skill 的用途"
          />
        </NFormItem>

        <NFormItem label="Prompt 模板" required>
          <NInput
            v-model:value="form.prompt"
            type="textarea"
            :rows="6"
            placeholder="Agent 执行此 Skill 时使用的 prompt，支持 {{变量名}} 插值"
          />
        </NFormItem>

        <NSpace>
          <NFormItem label="触发方式">
            <NSelect v-model:value="form.trigger" :options="triggerOptions" style="width: 160px" />
          </NFormItem>

          <NFormItem label="指定模型">
            <NSelect
              v-model:value="form.modelId"
              :options="modelOptions"
              style="width: 200px"
              clearable
            />
          </NFormItem>
        </NSpace>

        <NFormItem label="允许的工具">
          <NDynamicTags
            v-model:value="form.allowedTools"
            :max="20"
            type="info"
            placeholder="输入工具名后回车"
          />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton size="small" @click="modalVisible = false">取消</NButton>
          <NButton type="primary" size="small" :loading="saving" @click="handleSave">
            {{ isEditing ? '保存' : '创建' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.skill-config {
  width: 100%;
}

.skill-config__toolbar {
  margin-bottom: 16px;
}
</style>
