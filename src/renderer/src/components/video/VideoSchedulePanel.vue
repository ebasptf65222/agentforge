<script setup lang="ts">
// M17: VideoSchedulePanel - 定时/脚本化批量造片面板
//  - 列出所有视频批量调度（cron 定时 / 手动批量）。
//  - 支持创建/编辑调度：cron 表达式（含常用预设）、批量任务行（每行一个 prompt）、并发上限。
//  - 支持连续性序列批次：粘贴分段或绑定序列模板，到点触发首尾帧衔接的长视频序列。
//  - 支持启停 / 删除 / 立即执行 / 查看执行历史。

import { computed, onMounted, reactive, ref } from 'vue'
import {
  NButton,
  NCard,
  NDropdown,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  NTooltip,
  useDialog,
} from 'naive-ui'
import {
  PlusOutlined,
  PlayCircleOutlined,
  EditOutlined,
  ScheduleOutlined,
} from '@vicons/material'
import type {
  CreateVideoScheduleParams,
  UpdateVideoScheduleParams,
  VideoSchedule,
  VideoBatchConfig,
  VideoResolution,
  VideoAspect,
} from '@shared/types'
import { useVideoStore } from '@/stores/video'
import { showToast } from '@/utils/toast'

const videoStore = useVideoStore()
const dialog = useDialog()

const loading = computed(() => videoStore.schedulesLoading)

/** 表单中批量任务行数（实时反馈） */
const promptRowCount = computed(
  () => form.prompts.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).length,
)

/** 卡片「更多」下拉：执行历史 / 删除 */
const scheduleMoreOptions: { label: string; key: string }[] = [
  { label: '执行历史', key: 'history' },
  { label: '删除', key: 'delete' },
]

function confirmDeleteSchedule(schedule: VideoSchedule): void {
  dialog.warning({
    title: '删除定时任务',
    content: `确认删除「${schedule.name}」？已生成的视频不受影响。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      void videoStore.deleteSchedule(schedule.id)
    },
  })
}

function handleScheduleMore(schedule: VideoSchedule, key: string | number): void {
  if (key === 'history') void openHistory(schedule)
  else if (key === 'delete') confirmDeleteSchedule(schedule)
}

// ─── 常用 cron 预设 ─────────────────────────────────────────────
const CRON_PRESETS = [
  { label: '每小时（0 分）', value: '0 * * * *' },
  { label: '每天 00:00', value: '0 0 * * *' },
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每月 1 日 09:00', value: '0 9 1 * *' },
  { label: '每分钟（测试）', value: '* * * * *' },
]

const TIMEZONES = [
  { label: '系统默认时区', value: '' },
  { label: '亚洲/上海 (Asia/Shanghai)', value: 'Asia/Shanghai' },
  { label: '亚洲/香港 (Asia/Hong_Kong)', value: 'Asia/Hong_Kong' },
  { label: '欧洲/伦敦 (Europe/London)', value: 'Europe/London' },
  { label: '美洲/纽约 (America/New_York)', value: 'America/New_York' },
]

// ─── 表单状态 ─────────────────────────────────────────────────
interface ScheduleForm {
  name: string
  cronExpr: string
  timezone: string
  concurrency: number | null
  prompts: string
  /** 批量类型：tasks=单视频批量 / sequence=连续性序列（长视频） */
  batchKind: 'tasks' | 'sequence'
  /** 序列模式镜头来源：text=粘贴分段 / template=绑定分镜模板 */
  sourceKind: 'text' | 'template'
  seqTitle: string
  seqShotsText: string
  seqDuration: number | null
  seqResolution: VideoResolution
  seqAspect: VideoAspect
  selectedTemplateIds: string[]
}

const showModal = ref(false)
const editingId = ref<string | null>(null)
const modalSaving = ref(false)
const form = reactive<ScheduleForm>({
  name: '',
  cronExpr: '0 9 * * *',
  timezone: '',
  concurrency: 2,
  prompts: '',
  batchKind: 'tasks',
  sourceKind: 'text',
  seqTitle: '',
  seqShotsText: '',
  seqDuration: 5,
  seqResolution: '720P',
  seqAspect: '16:9',
  selectedTemplateIds: [],
})

function resetForm(): void {
  editingId.value = null
  form.name = ''
  form.cronExpr = '0 9 * * *'
  form.timezone = ''
  form.concurrency = 2
  form.prompts = ''
  form.batchKind = 'tasks'
  form.sourceKind = 'text'
  form.seqTitle = ''
  form.seqShotsText = ''
  form.seqDuration = 5
  form.seqResolution = '720P'
  form.seqAspect = '16:9'
  form.selectedTemplateIds = []
}

function openCreate(): void {
  resetForm()
  showModal.value = true
}

function openEdit(schedule: VideoSchedule): void {
  editingId.value = schedule.id
  form.name = schedule.name
  form.cronExpr = schedule.cronExpr ?? '0 9 * * *'
  form.timezone = schedule.timezone ?? ''
  form.concurrency = schedule.batch.concurrency ?? 2
  form.prompts = (schedule.batch.rows ?? [])
    .map((r) => r.prompt)
    .filter(Boolean)
    .join('\n')

  // 序列/模板模式回填（旧数据两者皆空 → tasks 模式）
  const seq = schedule.batch.sequences?.[0]
  if (seq) {
    form.batchKind = 'sequence'
    form.sourceKind = 'text'
    form.seqTitle = seq.title ?? ''
    form.seqShotsText = (seq.shots ?? []).join('\n\n')
    form.seqDuration = seq.duration ?? 5
    form.seqResolution = seq.resolution ?? '720P'
    form.seqAspect = seq.aspect ?? '16:9'
    form.selectedTemplateIds = []
  } else if ((schedule.batch.templateIds?.length ?? 0) > 0) {
    form.batchKind = 'sequence'
    form.sourceKind = 'template'
    form.selectedTemplateIds = [...(schedule.batch.templateIds ?? [])]
    form.seqShotsText = ''
  } else {
    form.batchKind = 'tasks'
    form.sourceKind = 'text'
  }
  showModal.value = true
}

function promptsToRows(): { prompt: string }[] {
  return form.prompts
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((prompt) => ({ prompt }))
}

/** 序列分段：按空行拆分镜头 prompt */
function parseSeqShots(): string[] {
  return form.seqShotsText
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 镜头数实时徽标 */
const seqShotCount = computed(() => parseSeqShots().length)

/** 序列模板选项（仅 sequence 类型模板） */
const sequenceTemplateOptions = computed(() =>
  videoStore.templates
    .filter((t) => t.type === 'sequence')
    .map((t) => ({ label: `${t.name}（${t.shots.length} 镜头）`, value: t.id })),
)

/** 卡片批次摘要文案 */
function batchSummary(schedule: VideoSchedule): string {
  const seqs = schedule.batch.sequences ?? []
  if (seqs.length > 0) {
    const shotTotal = seqs.reduce((acc, s) => acc + (s.shots?.length ?? 0), 0)
    return `连续性序列 ${seqs.length} 个（共 ${shotTotal} 镜头）`
  }
  const tplCount = schedule.batch.templateIds?.length ?? 0
  if (tplCount > 0) return `模板 × ${tplCount}`
  return `共 ${(schedule.batch.rows ?? []).length} 行任务`
}

async function saveSchedule(): Promise<void> {
  if (!form.name.trim()) {
    showToast('请输入调度名称', 'warning')
    return
  }
  let batch: VideoBatchConfig
  if (form.batchKind === 'tasks') {
    if (promptsToRows().length === 0) {
      showToast('至少输入一条任务 prompt', 'warning')
      return
    }
    batch = {
      rows: promptsToRows(),
      concurrency: form.concurrency ?? undefined,
    }
  } else if (form.sourceKind === 'text') {
    const shots = parseSeqShots()
    if (shots.length < 2) {
      showToast('连续性序列至少需要 2 个镜头（用空行分段）', 'warning')
      return
    }
    batch = {
      rows: [],
      sequences: [
        {
          title: form.seqTitle.trim() || undefined,
          shots,
          duration: form.seqDuration ?? undefined,
          resolution: form.seqResolution,
          aspect: form.seqAspect,
        },
      ],
    }
  } else {
    if (form.selectedTemplateIds.length === 0) {
      showToast('请至少绑定一个序列模板', 'warning')
      return
    }
    batch = { rows: [], templateIds: [...form.selectedTemplateIds] }
  }
  modalSaving.value = true
  try {
    if (editingId.value) {
      const params: UpdateVideoScheduleParams = {
        name: form.name.trim(),
        cronExpr: form.cronExpr.trim() || null,
        timezone: form.timezone || null,
        batch,
      }
      await videoStore.updateSchedule(editingId.value, params)
    } else {
      const params: CreateVideoScheduleParams = {
        name: form.name.trim(),
        cronExpr: form.cronExpr.trim(),
        timezone: form.timezone || undefined,
        batch,
        enabled: true,
        trigger: 'cron',
      }
      await videoStore.createSchedule(params)
    }
    showModal.value = false
  } finally {
    modalSaving.value = false
  }
}

// ─── 执行历史 ─────────────────────────────────────────────────
const showHistoryModal = ref(false)

async function openHistory(schedule: VideoSchedule): Promise<void> {
  await videoStore.fetchScheduleHistory(schedule.id)
  showHistoryModal.value = true
}

function formatRunTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString()
}

const runStatusMap: Record<string, { color: string; text: string }> = {
  ok: { color: 'success', text: '成功' },
  error: { color: 'error', text: '失败' },
  running: { color: 'info', text: '执行中' },
  skipped: { color: 'warning', text: '跳过' },
}

onMounted(() => {
  void videoStore.fetchSchedules()
  void videoStore.fetchTemplates()
})
</script>

<template>
  <div class="schedule-panel">
    <div class="schedule-panel__header">
      <h3 class="schedule-panel__title">
        <ScheduleOutlined class="schedule-panel__title-icon" />
        定时/脚本化批量造片
      </h3>
      <NButton type="primary" size="small" :disabled="loading" @click="openCreate">
        <template #icon><PlusOutlined /></template>
        新建调度
      </NButton>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!loading && videoStore.schedules.length === 0" description="还没有定时批量任务">
        <template #extra>
          <NButton type="primary" size="small" @click="openCreate">新建调度</NButton>
        </template>
      </NEmpty>

      <div v-else class="schedule-panel__list">
        <NCard v-for="schedule in videoStore.schedules" :key="schedule.id" :bordered="true">
          <div class="schedule-card__head">
            <div class="schedule-card__name">
              <NTag :type="schedule.enabled ? 'success' : 'default'" size="small">
                {{ schedule.trigger === 'cron' ? 'Cron 定时' : '手动批量' }}
              </NTag>
              <span class="schedule-card__title">{{ schedule.name }}</span>
            </div>
            <NSpace size="small" align="center">
              <NTooltip>
                <template #trigger>
                  <NSwitch
                    size="small"
                    :value="schedule.enabled"
                    :disabled="schedule.runningAtMs !== null"
                    :aria-label="schedule.enabled ? '停用调度' : '启用调度'"
                    @update:value="videoStore.toggleSchedule(schedule.id, !schedule.enabled)"
                  />
                </template>
                <span>{{ schedule.enabled ? '已启用（点击停用）' : '已停用（点击启用）' }}</span>
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton size="tiny" quaternary @click="videoStore.runScheduleNow(schedule.id)">
                    <template #icon><PlayCircleOutlined /></template>
                  </NButton>
                </template>
                立即执行
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton size="tiny" quaternary @click="openEdit(schedule)">
                    <template #icon><EditOutlined /></template>
                  </NButton>
                </template>
                编辑
              </NTooltip>
              <NDropdown
                trigger="click"
                :options="scheduleMoreOptions"
                @select="(key: string | number) => handleScheduleMore(schedule, key)"
              >
                <NButton size="tiny" quaternary aria-label="更多操作">
                  更多
                </NButton>
              </NDropdown>
            </NSpace>
          </div>

          <div class="schedule-card__cron">
            <NTag v-if="schedule.cronExpr" type="info" size="small">
              <code>{{ schedule.cronExpr }}</code>
            </NTag>
            <NText v-if="schedule.timezone" depth="3" class="schedule-card__tz">
              {{ schedule.timezone }}
            </NText>
          </div>

          <div class="schedule-card__meta">
            <NText depth="3">
              {{ batchSummary(schedule) }}
              <template v-if="schedule.batch.concurrency">
                · 并发 {{ schedule.batch.concurrency }}
              </template>
            </NText>
            <NText depth="3">
              运行 {{ schedule.runCount }} 次
              <template v-if="schedule.lastStatus">
                · 上次
                <NTag size="tiny" :type="runStatusMap[schedule.lastStatus]?.color as never">
                  {{ runStatusMap[schedule.lastStatus]?.text }}
                </NTag>
              </template>
              <template v-if="schedule.runningAtMs !== null"> · 执行中</template>
            </NText>
          </div>
        </NCard>
      </div>
    </NSpin>

    <!-- 新建/编辑调度 -->
    <NModal
      v-model:show="showModal"
      preset="card"
      :style="{ width: '640px' }"
      :title="editingId ? '编辑定时调度' : '新建定时调度'"
    >
      <NForm label-placement="top" class="schedule-form">
        <NFormItem label="调度名称">
          <NInput v-model:value="form.name" placeholder="例如：每日早报视频" />
        </NFormItem>
        <NFormItem label="cron 表达式">
          <NInput v-model:value="form.cronExpr" placeholder="0 9 * * *" />
        </NFormItem>
        <NFormItem label="常用预设">
          <NSelect
            :value="null"
            placeholder="点击选择预设"
            :options="CRON_PRESETS"
            size="small"
            @update:value="(v: string) => (form.cronExpr = v)"
          />
        </NFormItem>
        <NFormItem label="时区">
          <NSelect v-model:value="form.timezone" :options="TIMEZONES" />
        </NFormItem>
        <NFormItem label="批量类型">
          <NRadioGroup v-model:value="form.batchKind">
            <NRadio value="tasks">单视频批量</NRadio>
            <NRadio value="sequence">连续性序列（长视频）</NRadio>
          </NRadioGroup>
        </NFormItem>

        <!-- 单视频批量：逐行 prompt -->
        <template v-if="form.batchKind === 'tasks'">
          <NFormItem>
            <NInput
              v-model:value="form.prompts"
              type="textarea"
              :rows="6"
              placeholder="逐行输入视频 prompt，一行一个任务"
            />
            <template #label>
              批量任务行（每行一个 prompt）
              <NTag size="tiny" :bordered="false" :type="promptRowCount > 0 ? 'primary' : 'default'">
                {{ promptRowCount }} 行
              </NTag>
            </template>
          </NFormItem>
          <NFormItem label="并发上限（可选）">
            <NInputNumber v-model:value="form.concurrency" :min="1" :max="10" style="width: 120px" />
          </NFormItem>
        </template>

        <!-- 连续性序列：首尾帧衔接串成长视频 -->
        <template v-else>
          <NFormItem label="镜头来源">
            <NRadioGroup v-model:value="form.sourceKind">
              <NRadio value="text">粘贴分段</NRadio>
              <NRadio value="template">绑定模板</NRadio>
            </NRadioGroup>
          </NFormItem>

          <template v-if="form.sourceKind === 'text'">
            <NFormItem label="序列标题（可选）">
              <NInput v-model:value="form.seqTitle" placeholder="缺省取首镜头 prompt 截断" />
            </NFormItem>
            <NFormItem>
              <NInput
                v-model:value="form.seqShotsText"
                type="textarea"
                :rows="8"
                placeholder="粘贴一大段话，用空行分段：每段 = 一个镜头 prompt，生成时上一镜头尾帧自动作为下一镜头首帧"
              />
              <template #label>
                镜头分段（空行分隔，至少 2 段）
                <NTag
                  size="tiny"
                  :bordered="false"
                  :type="seqShotCount >= 2 ? 'primary' : 'warning'"
                >
                  {{ seqShotCount }} 镜头
                </NTag>
              </template>
            </NFormItem>
            <NFormItem label="每镜时长（秒）">
              <NInputNumber v-model:value="form.seqDuration" :min="1" :max="15" style="width: 120px" />
            </NFormItem>
            <NFormItem label="分辨率">
              <NSelect
                v-model:value="form.seqResolution"
                :options="[
                  { label: '480P', value: '480P' },
                  { label: '720P', value: '720P' },
                  { label: '1080P', value: '1080P' },
                ]"
                style="width: 160px"
              />
            </NFormItem>
            <NFormItem label="画面比例">
              <NSelect
                v-model:value="form.seqAspect"
                :options="[
                  { label: '16:9', value: '16:9' },
                  { label: '9:16', value: '9:16' },
                  { label: '4:3', value: '4:3' },
                  { label: '3:4', value: '3:4' },
                  { label: '1:1', value: '1:1' },
                ]"
                style="width: 160px"
              />
            </NFormItem>
          </template>

          <template v-else>
            <NFormItem label="选择序列模板（可多选，到点逐个生成）">
              <NSelect
                v-model:value="form.selectedTemplateIds"
                multiple
                clearable
                :options="sequenceTemplateOptions"
                :placeholder="
                  sequenceTemplateOptions.length === 0
                    ? '暂无序列模板，请先在 工作台 → 分镜模板 创建'
                    : '选择要执行的序列模板'
                "
              />
            </NFormItem>
          </template>
        </template>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModal = false">取消</NButton>
          <NButton type="primary" :loading="modalSaving" @click="saveSchedule">保存</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- 执行历史 -->
    <NModal
      v-model:show="showHistoryModal"
      preset="card"
      :style="{ width: '680px' }"
      title="执行历史"
    >
      <NEmpty
        v-if="videoStore.scheduleHistory.length === 0"
        description="暂无执行记录"
        style="padding: 24px 0"
      />
      <div v-else class="schedule-history">
        <div v-for="run in videoStore.scheduleHistory" :key="run.id" class="schedule-history__row">
          <div class="schedule-history__main">
            <NTag size="tiny" :type="runStatusMap[run.status]?.color as never">
              {{ runStatusMap[run.status]?.text }}
            </NTag>
            <NText depth="2">{{ formatRunTime(run.startedAtMs) }}</NText>
            <NText depth="3">
              提交 {{ run.taskCount }} 个
              <template v-if="run.failedCount">· 失败 {{ run.failedCount }}</template>
            </NText>
          </div>
          <div v-if="run.summary || run.error" class="schedule-history__note">
            <NText depth="3">{{ run.summary ?? run.error }}</NText>
          </div>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.schedule-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.schedule-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
}
.schedule-panel__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.schedule-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.schedule-card__name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.schedule-card__title {
  font-weight: 600;
}
.schedule-card__cron {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.schedule-card__tz {
  font-size: 12px;
}
.schedule-card__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
}
.schedule-form {
  max-height: 60vh;
  overflow: auto;
}
.schedule-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow: auto;
}
.schedule-history__row {
  padding: 8px 10px;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
  border-radius: 6px;
}
.schedule-history__main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.schedule-history__note {
  margin-top: 6px;
}
</style>