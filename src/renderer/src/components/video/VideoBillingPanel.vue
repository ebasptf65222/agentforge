<script setup lang="ts">
// M20: VideoBillingPanel - 成本与用量计费面板
//  - 时间范围选择（近期 N 天）。
//  - 总览卡片：总任务数、总视频时长、测算总成本。
//  - 按厂商 / 日期 / 模型的用量与成本明细（条形图 + 表格）。

import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NCard, NEmpty, NSelect, NSpace, NSpin, NText, NGrid, NGi, NTag } from 'naive-ui'
import { RefreshOutlined, ReceiptLongOutlined } from '@vicons/material'
import type { VideoBillingBucket } from '@shared/types'
import { useVideoStore } from '@/stores/video'

const videoStore = useVideoStore()

const RANGE_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
  { label: '近 180 天', value: 180 },
]

const range = ref(30)
const overview = computed(() => videoStore.billing)
const loading = computed(() => videoStore.billingLoading)

function fmtSeconds(sec: number | undefined): string {
  if (sec === undefined || sec === null) return '0'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${(sec / 60).toFixed(1)}min`
  return `${(sec / 3600).toFixed(2)}h`
}

function fmtCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return '¥0.00'
  return `¥${cost.toFixed(2)}`
}

/** 返回每个桶的成本占用百分比（相对最大值），用于条形宽度 */
function barWidth(list: VideoBillingBucket[]): (b: VideoBillingBucket) => number {
  const max = list.length > 0 ? Math.max(...list.map((x) => x.cost ?? 0)) : 0
  return (b) => (max > 0 ? ((b.cost ?? 0) / max) * 100 : 0)
}

const providerFmt = computed(() => barWidth(overview.value?.byProvider ?? []))
const modelFmt = computed(() => barWidth(overview.value?.byModel ?? []))
const dayFmt = computed(() => barWidth(overview.value?.byDay ?? []))

const byProvider = computed(() => overview.value?.byProvider ?? [])
const byModel = computed(() => overview.value?.byModel ?? [])
const byDay = computed(() => overview.value?.byDay ?? [])

/** 按日期桶折叠：默认仅展示前 N 行 */
const DAY_VISIBLE = 10
const dayExpanded = ref(false)

/** 三组明细统一渲染（消除重复模板；空桶渲染占位防布局跳动） */
const bucketGroups = computed(() => [
  { title: '按厂商', list: byProvider.value, fmt: providerFmt.value, more: 0 },
  { title: '按模型', list: byModel.value, fmt: modelFmt.value, more: 0 },
  {
    title: '按日期',
    list: dayExpanded.value ? byDay.value : byDay.value.slice(0, DAY_VISIBLE),
    fmt: dayFmt.value,
    more: Math.max(0, byDay.value.length - DAY_VISIBLE),
  },
])

watch(range, (v) => {
  void videoStore.fetchBilling(v)
})

onMounted(() => {
  void videoStore.fetchBilling(range.value)
})
</script>

<template>
  <div class="billing-panel">
    <div class="billing-panel__header">
      <h3 class="billing-panel__title">
        <ReceiptLongOutlined class="billing-panel__title-icon" />
        成本与用量计费
      </h3>
      <NSpace size="small">
        <NSelect v-model:value="range" :options="RANGE_OPTIONS" size="small" style="width: 110px" />
        <NButton size="small" secondary :loading="loading" @click="videoStore.fetchBilling(range)">
          <template #icon><RefreshOutlined /></template>
          刷新
        </NButton>
      </NSpace>
    </div>

    <NSpin :show="loading">
      <template v-if="overview">
        <NGrid :cols="3" :x-gap="12" class="billing-panel__summary">
          <NGi>
            <NCard size="small">
              <NText depth="3" class="billing-stat__label">成功任务</NText>
              <div class="billing-stat__value">{{ overview.totalTasks }}</div>
            </NCard>
          </NGi>
          <NGi>
            <NCard size="small">
              <NText depth="3" class="billing-stat__label">产出视频时长</NText>
              <div class="billing-stat__value">{{ fmtSeconds(overview.totalVideoSeconds) }}</div>
            </NCard>
          </NGi>
          <NGi>
            <NCard size="small">
              <NText depth="3" class="billing-stat__label">测算总成本</NText>
              <div class="billing-stat__value billing-stat__cost">{{ fmtCost(overview.totalCost) }}</div>
            </NCard>
          </NGi>
        </NGrid>

        <!-- 用量与成本明细：按厂商 / 模型 / 日期 -->
        <div
          v-for="group in bucketGroups"
          :key="group.title"
          class="billing-table"
          :class="{ 'billing-table--empty': group.list.length === 0 }"
        >
          <h4 class="billing-table__title">{{ group.title }}</h4>
          <template v-if="group.list.length > 0">
            <div class="billing-table__rows">
              <div v-for="bucket in group.list" :key="bucket.key" class="billing-table__row">
                <div class="billing-table__key">
                  <NTag size="small">{{ bucket.key }}</NTag>
                  <NText depth="3">{{ bucket.tasks }} 个 · {{ fmtSeconds(bucket.videoSeconds) }}</NText>
                </div>
                <div class="billing-table__bar-track">
                  <div class="billing-table__bar" :style="{ width: `${group.fmt(bucket)}%` }" />
                </div>
                <div class="billing-table__cost">{{ fmtCost(bucket.cost) }}</div>
              </div>
            </div>
            <NButton
              v-if="group.more > 0"
              size="tiny"
              text
              type="primary"
              class="billing-table__more"
              @click="dayExpanded = !dayExpanded"
            >
              {{ dayExpanded ? '收起' : `展开其余 ${group.more} 行` }}
            </NButton>
          </template>
          <div v-else class="billing-table__empty">该范围内暂无数据</div>
        </div>
      </template>
      <NEmpty v-else description="暂无计费数据（需要至少一个成功任务）" style="padding: 32px 0" />
    </NSpin>
  </div>
</template>

<style scoped>
.billing-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.billing-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
}
.billing-panel__summary {
  margin-bottom: 16px;
}
.billing-stat__label {
  font-size: 12px;
}
.billing-stat__value {
  font-size: 20px;
  font-weight: 700;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.billing-stat__cost {
  color: var(--n-primary-color, #18a058);
}
.billing-table {
  margin-bottom: 16px;
}
.billing-table__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 14px;
}
.billing-table__title::before {
  content: '';
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: var(--n-primary-color, #18a058);
}
.billing-table__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.billing-table__row {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) 1.6fr 90px;
  gap: 12px;
  align-items: center;
}
.billing-table__key {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
.billing-table__bar-track {
  height: 8px;
  border-radius: 4px;
  background: var(--n-border-color, rgba(128, 128, 128, 0.2));
  overflow: hidden;
}
.billing-table__bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--n-primary-color, #18a058), #73d13d);
}
.billing-table__cost {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.billing-table__more {
  margin-top: 6px;
}
.billing-table--empty .billing-table__empty {
  font-size: 12px;
  color: var(--af-text-muted, #8494ad);
  padding: 4px 0;
}
</style>