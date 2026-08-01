<script setup lang="ts">
// SchedulerConfig - 定时任务管理界面
// 支持创建/编辑/删除/启用禁用/立即执行/查看历史

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
  NSwitch,
  NSpace,
  NPopconfirm,
  NEmpty,
  NSpin,
  NTooltip,
  NRadioGroup,
  NRadio,
  NInputNumber,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  type DataTableColumns,
} from 'naive-ui'
import {
  AddOutlined,
  EditOutlined,
  DeleteOutlined,
  RefreshOutlined,
  PlayArrowOutlined,
  ScheduleOutlined,
  HistoryOutlined,
  WarningOutlined,
} from '@vicons/material'
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduleType,
  TaskRunStatus,
  CreateScheduledTaskParams,
  UpdateScheduledTaskParams,
  TaskAgentConfig,
} from '@shared/types'
import { useSchedulerStore } from '@/stores/scheduler'
import { useModelStore } from '@/stores/model'

const schedulerStore = useSchedulerStore()
const modelStore = useModelStore()

onMounted(() => {
  void schedulerStore.loadTasks()
  if (modelStore.models.length === 0) {
    void modelStore.loadModels()
  }
})

// ─── 表单状态 ──────────────────────────────────────────────────

const modalVisible = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const historyModalVisible = ref(false)
const historyTaskName = ref('')

interface SchedulerFormState {
  name: string
  scheduleType: ScheduleType
  cronExpr: string
  atMs: number | null
  everyMs: number | null
  timezone: string
  prompt: string
  modelId: string | null
  approvalMode: 'suggest' | 'auto-edit' | 'full-auto'
  maxSteps: number
  skillName: string
  isDevTask: boolean
}

const DEFAULT_FORM: SchedulerFormState = {
  name: '',
  scheduleType: 'cron',
  cronExpr: '0 9 * * *',
  atMs: null,
  everyMs: 3600000,
  timezone: '',
  prompt: '',
  modelId: null,
  approvalMode: 'auto-edit',
  maxSteps: 20,
  skillName: '',
  isDevTask: false,
}

const form = reactive<SchedulerFormState>({ ...DEFAULT_FORM })

const isEditing = computed(() => editingId.value !== null)
const modalTitle = computed(() => (isEditing.value ? '编辑定时任务' : '创建定时任务'))

const scheduleTypeOptions = [
  { label: 'Cron 表达式', value: 'cron' },
  { label: '定时执行（一次性）', value: 'at' },
  { label: '间隔执行', value: 'every' },
]

const approvalModeOptions = [
  { label: '建议模式', value: 'suggest' },
  { label: '自动编辑', value: 'auto-edit' },
  { label: '全自动', value: 'full-auto' },
]

const modelOptions = computed(() => {
  const opts = modelStore.models.map((m) => ({
    label: m.name,
    value: m.id,
  }))
  return [{ label: '使用默认模型', value: null }, ...opts]
})

// ─── 表单操作 ──────────────────────────────────────────────────

function resetForm(): void {
  Object.assign(form, DEFAULT_FORM)
  editingId.value = null
}

function openCreateModal(): void {
  resetForm()
  modalVisible.value = true
}

function openEditModal(task: ScheduledTask): void {
  editingId.value = task.id
  form.name = task.name
  form.scheduleType = task.scheduleType
  form.cronExpr = task.cronExpr ?? ''
  form.atMs = task.atMs
  form.everyMs = task.everyMs
  form.timezone = task.timezone ?? ''
  form.prompt = task.agentConfig.prompt
  form.modelId = task.agentConfig.modelId ?? null
  form.approvalMode = task.agentConfig.approvalMode ?? 'auto-edit'
  form.maxSteps = task.agentConfig.maxSteps ?? 20
  form.skillName = task.agentConfig.skillName ?? ''
  form.isDevTask = task.agentConfig.isDevTask ?? false
  modalVisible.value = true
}

function handleDevTaskToggle(value: boolean): void {
  form.isDevTask = value
  if (value) {
    form.approvalMode = 'full-auto'
    form.maxSteps = 50
  } else {
    form.approvalMode = 'auto-edit'
    form.maxSteps = 20
  }
}

async function handleSave(): Promise<void> {
  if (!form.name.trim()) {
    return
  }
  if (!form.prompt.trim()) {
    return
  }

  saving.value = true
  try {
    const agentConfig: TaskAgentConfig = {
      prompt: form.prompt.trim(),
      modelId: form.modelId ?? undefined,
      approvalMode: form.approvalMode,
      maxSteps: form.maxSteps,
      skillName: form.skillName.trim() || undefined,
      isDevTask: form.isDevTask,
    }

    if (isEditing.value && editingId.value) {
      const params: UpdateScheduledTaskParams = {
        name: form.name.trim(),
        scheduleType: form.scheduleType,
        cronExpr: form.scheduleType === 'cron' ? form.cronExpr.trim() : null,
        atMs: form.scheduleType === 'at' ? form.atMs : null,
        everyMs: form.scheduleType === 'every' ? form.everyMs : null,
        timezone: form.timezone.trim() || null,
        agentConfig,
      }
      await schedulerStore.updateTask(editingId.value, params)
    } else {
      const params: CreateScheduledTaskParams = {
        name: form.name.trim(),
        scheduleType: form.scheduleType,
        cronExpr: form.scheduleType === 'cron' ? form.cronExpr.trim() : undefined,
        atMs: form.scheduleType === 'at' ? form.atMs ?? undefined : undefined,
        everyMs: form.scheduleType === 'every' ? form.everyMs ?? undefined : undefined,
        timezone: form.timezone.trim() || undefined,
        agentConfig,
        sessionTarget: 'isolated',
        enabled: true,
      }
      await schedulerStore.createTask(params)
    }
    modalVisible.value = false
  } catch {
    // 错误已在 store 中处理
  } finally {
    saving.value = false
  }
}

async function handleDelete(task: ScheduledTask): Promise<void> {
  await schedulerStore.deleteTask(task.id)
}

async function handleToggle(task: ScheduledTask): Promise<void> {
  await schedulerStore.toggleTask(task.id, !task.enabled)
}

async function handleRunNow(task: ScheduledTask): Promise<void> {
  await schedulerStore.runTaskNow(task.id)
}

async function handleRefresh(): Promise<void> {
  await schedulerStore.loadTasks()
}

async function openHistory(task: ScheduledTask): Promise<void> {
  historyTaskName.value = task.name
  await schedulerStore.loadTaskHistory(task.id)
  historyModalVisible.value = true
}

// ─── 格式化辅助 ────────────────────────────────────────────────

function formatTimestamp(ms: number | null): string {
  if (ms === null) return '-'
  return new Date(ms).toLocaleString('zh-CN')
}

function formatRelativeTime(ms: number | null): string {
  if (ms === null) return '从未执行'
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatSchedule(task: ScheduledTask): string {
  switch (task.scheduleType) {
    case 'cron':
      return task.cronExpr ?? '-'
    case 'at':
      return formatTimestamp(task.atMs)
    case 'every':
      if (!task.everyMs) return '-'
      const mins = Math.round(task.everyMs / 60_000)
      if (mins < 60) return `每 ${mins} 分钟`
      const hours = Math.round(mins / 60)
      if (hours < 24) return `每 ${hours} 小时`
      return `每 ${Math.round(hours / 24)} 天`
    default:
      return '-'
  }
}

const statusTagType: Record<TaskRunStatus | 'idle' | 'disabled', 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  ok: 'success',
  error: 'error',
  skipped: 'warning',
  timeout: 'warning',
  running: 'info',
  idle: 'default',
  disabled: 'default',
}

function getStatusTag(task: ScheduledTask): { type: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string } {
  if (!task.enabled) return { type: 'default', label: '已禁用' }
  if (task.runningAtMs !== null) return { type: 'info', label: '执行中' }
  if (task.lastStatus === 'ok') return { type: 'success', label: '正常' }
  if (task.lastStatus === 'error') return { type: 'error', label: '错误' }
  if (task.lastStatus === 'skipped') return { type: 'warning', label: '已跳过' }
  if (task.errorCount > 0) return { type: 'warning', label: `${task.errorCount} 次错误` }
  return { type: 'default', label: '空闲' }
}

// ─── 数据表格列 ────────────────────────────────────────────────

const columns = computed<DataTableColumns<ScheduledTask>>(() => [
  {
    title: '任务名称',
    key: 'name',
    width: 180,
    render: (row) =>
      h('div', { style: 'display: flex; align-items: center; gap: 6px;' }, [
        row.agentConfig.isDevTask
          ? h(
              NTag,
              { size: 'tiny', type: 'warning', bordered: false },
              { default: () => 'DEV' },
            )
          : null,
        h('span', { style: 'font-weight: 500;' }, row.name),
      ]),
  },
  {
    title: '调度',
    key: 'schedule',
    width: 160,
    render: (row) => formatSchedule(row),
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => {
      const status = getStatusTag(row)
      return h(NTag, { type: status.type, size: 'small', bordered: false }, { default: () => status.label })
    },
  },
  {
    title: '下次执行',
    key: 'nextRunAtMs',
    width: 160,
    render: (row) => formatTimestamp(row.nextRunAtMs),
  },
  {
    title: '上次执行',
    key: 'lastRunAtMs',
    width: 120,
    render: (row) => formatRelativeTime(row.lastRunAtMs),
  },
  {
    title: '执行次数',
    key: 'runCount',
    width: 80,
    render: (row) => `${row.runCount}`,
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render: (row) =>
      h(NSpace, { size: 'small' }, () => [
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  onClick: () => handleRunNow(row),
                },
                { icon: () => h(NIcon, null, { default: () => h(PlayArrowOutlined) }) },
              ),
            default: () => '立即执行',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  onClick: () => openEditModal(row),
                },
                { icon: () => h(NIcon, null, { default: () => h(EditOutlined) }) },
              ),
            default: () => '编辑',
          },
        ),
        h(
          NTooltip,
          {},
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  onClick: () => openHistory(row),
                },
                { icon: () => h(NIcon, null, { default: () => h(HistoryOutlined) }) },
              ),
            default: () => '执行历史',
          },
        ),
        h(
          NSwitch,
          {
            size: 'small',
            value: row.enabled,
            onUpdateValue: (val: boolean) => handleToggle(row),
          },
        ),
        h(
          NPopconfirm,
          {
            onPositiveClick: () => handleDelete(row),
          },
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  type: 'error',
                },
                { icon: () => h(NIcon, null, { default: () => h(DeleteOutlined) }) },
              ),
            default: () => `确认删除 "${row.name}"？`,
          },
        ),
      ]),
  },
])
</script>

<template>
  <div class="scheduler-config">
    <!-- 工具栏 -->
    <div class="scheduler-config__toolbar">
      <NSpace>
        <NButton type="primary" size="small" @click="openCreateModal">
          <template #icon>
            <NIcon><AddOutlined /></NIcon>
          </template>
          创建任务
        </NButton>
        <NButton size="small" quaternary @click="handleRefresh">
          <template #icon>
            <NIcon><RefreshOutlined /></NIcon>
          </template>
          刷新
        </NButton>
      </NSpace>

      <div class="scheduler-config__stats">
        <NTag size="small" :bordered="false" type="info">
          共 {{ schedulerStore.tasks.length }} 个任务
        </NTag>
        <NTag size="small" :bordered="false" type="success">
          {{ schedulerStore.enabledTasks.length }} 个启用
        </NTag>
        <NTag v-if="schedulerStore.errorTasks.length > 0" size="small" :bordered="false" type="error">
          {{ schedulerStore.errorTasks.length }} 个异常
        </NTag>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="scheduler-config__table">
      <NSpin :show="schedulerStore.loading">
        <NDataTable
          :columns="columns"
          :data="schedulerStore.tasks"
          :bordered="false"
          :single-line="false"
          size="small"
          :pagination="{ pageSize: 10 }"
        />
      </NSpin>
    </div>

    <!-- 创建/编辑模态框 -->
    <NModal
      v-model:show="modalVisible"
      preset="card"
      :title="modalTitle"
      style="width: 640px; max-width: 90vw;"
      :bordered="false"
    >
      <NForm label-placement="top" :show-feedback="false" size="small">
        <!-- 任务名称 -->
        <NFormItem label="任务名称" required>
          <NInput v-model:value="form.name" placeholder="如：每日代码审查" />
        </NFormItem>

        <!-- 调度类型 -->
        <NFormItem label="调度方式" required>
          <NRadioGroup v-model:value="form.scheduleType">
            <NRadio value="cron">Cron 表达式</NRadio>
            <NRadio value="at">定时执行（一次性）</NRadio>
            <NRadio value="every">间隔执行</NRadio>
          </NRadioGroup>
        </NFormItem>

        <!-- Cron 表达式 -->
        <NFormItem v-if="form.scheduleType === 'cron'" label="Cron 表达式" required>
          <NInput
            v-model:value="form.cronExpr"
            placeholder="如：0 9 * * 1-5（工作日 9 点）"
          />
          <template #feedback>
            <span class="form-hint">
              格式：分 时 日 月 周。常用：
              <code>0 9 * * *</code> 每天 9 点 |
              <code>0 22 * * 1-5</code> 工作日 22 点 |
              <code>*/30 * * * *</code> 每 30 分钟
            </span>
          </template>
        </NFormItem>

        <!-- 一次性执行时间 -->
        <NFormItem v-if="form.scheduleType === 'at'" label="执行时间" required>
          <NInputNumber
            v-model:value="form.atMs"
            placeholder="Unix 时间戳（毫秒）"
            style="width: 100%;"
          />
          <template #feedback>
            <span class="form-hint">设置未来的某个时间点自动执行一次</span>
          </template>
        </NFormItem>

        <!-- 间隔执行 -->
        <NFormItem v-if="form.scheduleType === 'every'" label="执行间隔（毫秒）" required>
          <NInputNumber
            v-model:value="form.everyMs"
            :min="60000"
            :step="60000"
            placeholder="最小 60000（1 分钟）"
            style="width: 100%;"
          />
          <template #feedback>
            <span class="form-hint">最小间隔 1 分钟。60000 = 1 分钟，3600000 = 1 小时</span>
          </template>
        </NFormItem>

        <!-- 时区 -->
        <NFormItem label="时区（可选）">
          <NInput
            v-model:value="form.timezone"
            placeholder="如：Asia/Shanghai（留空使用系统时区）"
          />
        </NFormItem>

        <!-- 执行 Prompt -->
        <NFormItem label="执行指令（Prompt）" required>
          <NInput
            v-model:value="form.prompt"
            type="textarea"
            :rows="4"
            placeholder="AI 执行任务时收到的指令，如：请检查今天的代码变更并生成日报"
          />
        </NFormItem>

        <!-- 开发任务开关 -->
        <NFormItem label="开发任务模式">
          <NSwitch :value="form.isDevTask" @update:value="handleDevTaskToggle" />
          <span class="form-hint" style="margin-left: 12px;">
            开启后自动使用全自动模式 + 50 步上限，适合夜间自动开发
          </span>
        </NFormItem>

        <!-- 高级配置 -->
        <NCollapse>
          <NCollapseItem title="高级配置" name="advanced">
            <!-- 模型选择 -->
            <NFormItem label="模型">
              <NSelect
                v-model:value="form.modelId"
                :options="modelOptions"
                placeholder="使用默认模型"
                clearable
              />
            </NFormItem>

            <!-- 审批模式 -->
            <NFormItem label="审批模式">
              <NSelect
                v-model:value="form.approvalMode"
                :options="approvalModeOptions"
              />
            </NFormItem>

            <!-- 最大步数 -->
            <NFormItem label="最大执行步数">
              <NInputNumber v-model:value="form.maxSteps" :min="1" :max="100" style="width: 100%;" />
            </NFormItem>

            <!-- 技能 -->
            <NFormItem label="技能名称（可选）">
              <NInput v-model:value="form.skillName" placeholder="如：code-review" />
            </NFormItem>
          </NCollapseItem>
        </NCollapse>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="modalVisible = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="handleSave">
            {{ isEditing ? '保存' : '创建' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 执行历史模态框 -->
    <NModal
      v-model:show="historyModalVisible"
      preset="card"
      :title="`执行历史 - ${historyTaskName}`"
      style="width: 640px; max-width: 90vw;"
      :bordered="false"
    >
      <NEmpty v-if="schedulerStore.selectedTaskHistory.length === 0" description="暂无执行记录" />
      <NCollapse v-else>
        <NCollapseItem
          v-for="run in schedulerStore.selectedTaskHistory"
          :key="run.id"
          :name="run.id"
        >
          <template #header>
            <NSpace align="center" size="small">
              <NTag :type="statusTagType[run.status]" size="small" :bordered="false">
                {{ run.status }}
              </NTag>
              <span>{{ formatTimestamp(run.startedAtMs) }}</span>
              <span v-if="run.durationMs" style="color: var(--af-text-muted, #64748b); font-size: 12px;">
                耗时 {{ run.durationMs }}ms
              </span>
            </NSpace>
          </template>

          <NDescriptions :column="1" size="small" label-placement="left" bordered>
            <NDescriptionsItem label="开始时间">
              {{ formatTimestamp(run.startedAtMs) }}
            </NDescriptionsItem>
            <NDescriptionsItem label="结束时间">
              {{ formatTimestamp(run.finishedAtMs) }}
            </NDescriptionsItem>
            <NDescriptionsItem label="状态">
              <NTag :type="statusTagType[run.status]" size="small" :bordered="false">
                {{ run.status }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem v-if="run.conversationId" label="会话 ID">
              {{ run.conversationId }}
            </NDescriptionsItem>
            <NDescriptionsItem v-if="run.summary" label="执行摘要">
              {{ run.summary }}
            </NDescriptionsItem>
            <NDescriptionsItem v-if="run.error" label="错误信息">
              <span style="color: var(--af-error, #ef4444);">{{ run.error }}</span>
            </NDescriptionsItem>
          </NDescriptions>
        </NCollapseItem>
      </NCollapse>
    </NModal>
  </div>
</template>

<style scoped>
.scheduler-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scheduler-config__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.scheduler-config__stats {
  display: flex;
  gap: 8px;
}

.scheduler-config__table {
  min-height: 200px;
}

.form-hint {
  font-size: 12px;
  color: var(--af-text-muted, #64748b);
}

.form-hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--af-surface-hover, rgba(255, 255, 255, 0.08));
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
}
</style>
