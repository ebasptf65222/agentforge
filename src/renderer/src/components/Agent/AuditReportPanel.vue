<script setup lang="ts">
// WA-07: AuditReportPanel - 审计报告可视化面板
// 展示五维度雷达图 + 发现列表 + 维度详情

import { computed, ref } from 'vue'
import type {
  AuditReport,
  AuditFinding,
  DimensionScore,
  AuditDimension,
  AuditSeverity,
  EvidenceState,
  SupportTrack,
} from '@shared/types'
import { useAgentStore } from '@/stores/agent'

const agentStore = useAgentStore()

// ─── 维度元数据 ─────────────────────────────────────────────────

const DIMENSION_META: Record<AuditDimension, { label: string; short: string; color: string }> = {
  'task-understanding': { label: '任务理解', short: 'TU', color: '#6366f1' },
  'controlled-execution': { label: '受控执行', short: 'CE', color: '#0ea5e9' },
  'change-validation': { label: '变更验证', short: 'CV', color: '#10b981' },
  'reliable-delivery': { label: '可靠交付', short: 'RD', color: '#f59e0b' },
  'learning-capture': { label: '学习捕获', short: 'LC', color: '#ec4899' },
}

const DIMENSION_ORDER: AuditDimension[] = [
  'task-understanding',
  'controlled-execution',
  'change-validation',
  'reliable-delivery',
  'learning-capture',
]

const SEVERITY_META: Record<AuditSeverity, { label: string; color: string; bg: string; order: number }> = {
  high: { label: '高', color: 'var(--af-error, #ef4444)', bg: 'rgba(239, 68, 68, 0.1)', order: 0 },
  medium: { label: '中', color: 'var(--af-warning, #f59e0b)', bg: 'rgba(245, 158, 11, 0.1)', order: 1 },
  low: { label: '低', color: 'var(--af-info, #0ea5e9)', bg: 'rgba(14, 165, 233, 0.1)', order: 2 },
}

const EVIDENCE_META: Record<EvidenceState, { label: string; color: string }> = {
  missing: { label: '缺失', color: 'var(--af-error, #ef4444)' },
  present: { label: '存在', color: 'var(--af-warning, #f59e0b)' },
  exercised: { label: '已验证', color: 'var(--af-success, #10b981)' },
}

const SUPPORT_TRACK_META: Record<SupportTrack, { label: string; color: string; bg: string }> = {
  bootstrap: { label: '初始阶段', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  operationalize: { label: '运营化阶段', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.15)' },
  optimize: { label: '优化阶段', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  undetermined: { label: '待定', color: '#64748b', bg: 'rgba(100, 116, 139, 0.15)' },
}

// ─── 雷达图配置 ─────────────────────────────────────────────────

const RADAR_SIZE = 260
const RADAR_CENTER = RADAR_SIZE / 2
const RADAR_RADIUS = 95
const RADAR_GRID_LEVELS = [0.25, 0.5, 0.75, 1.0]

/** 计算雷达图上某个维度的顶点坐标 */
function getAxisPoint(dimensionIndex: number, radiusRatio: number): { x: number; y: number } {
  // 从顶部开始（-90°），顺时针排列
  const angle = (-90 + (360 / DIMENSION_ORDER.length) * dimensionIndex) * (Math.PI / 180)
  const r = RADAR_RADIUS * radiusRatio
  return {
    x: RADAR_CENTER + r * Math.cos(angle),
    y: RADAR_CENTER + r * Math.sin(angle),
  }
}

/** 计算标签位置（在雷达图外侧） */
function getLabelPoint(dimensionIndex: number): { x: number; y: number } {
  return getAxisPoint(dimensionIndex, 1.28)
}

// ─── 计算属性 ────────────────────────────────────────────────────

const report = computed<AuditReport | null>(() => agentStore.auditReport)
const isLoading = computed(() => agentStore.auditLoading)
const hasReport = computed(() => report.value !== null)

/** 按维度顺序排列的维度评分 */
const orderedDimensions = computed<DimensionScore[]>(() => {
  if (!report.value) return []
  return DIMENSION_ORDER.map(
    (dim) => report.value!.dimensions.find((d) => d.dimension === dim),
  ).filter((d): d is DimensionScore => d !== undefined)
})

/** 雷达图多边形点坐标 */
const radarPolygonPoints = computed(() => {
  return orderedDimensions.value
    .map((dim, index) => {
      const ratio = Math.max(0, Math.min(1, dim.score / 100))
      const pt = getAxisPoint(index, ratio)
      return `${pt.x},${pt.y}`
    })
    .join(' ')
})

/** 按严重性排序的发现列表 */
const sortedFindings = computed<AuditFinding[]>(() => {
  if (!report.value) return []
  return [...report.value.findings].sort((a, b) => {
    const orderA = SEVERITY_META[a.severity]?.order ?? 99
    const orderB = SEVERITY_META[b.severity]?.order ?? 99
    return orderA - orderB
  })
})

/** 按严重性分组的统计 */
const severityStats = computed(() => {
  const stats: Record<AuditSeverity, number> = { high: 0, medium: 0, low: 0 }
  for (const f of report.value?.findings ?? []) {
    stats[f.severity]++
  }
  return stats
})

/** 总评分颜色 */
const scoreColor = computed(() => {
  const score = report.value?.overallScore ?? 0
  if (score >= 75) return 'var(--af-success, #10b981)'
  if (score >= 50) return 'var(--af-warning, #f59e0b)'
  return 'var(--af-error, #ef4444)'
})

/** 支持轨道信息 */
const supportTrackInfo = computed(() => {
  if (!report.value) return SUPPORT_TRACK_META.undetermined
  return SUPPORT_TRACK_META[report.value.supportTrack] ?? SUPPORT_TRACK_META.undetermined
})

// ─── 交互状态 ────────────────────────────────────────────────────

const expandedDimensions = ref<Set<AuditDimension>>(new Set())

function toggleDimension(dim: AuditDimension): void {
  if (expandedDimensions.value.has(dim)) {
    expandedDimensions.value.delete(dim)
  } else {
    expandedDimensions.value.add(dim)
  }
}

function isDimensionExpanded(dim: AuditDimension): boolean {
  return expandedDimensions.value.has(dim)
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** 关闭面板 */
function handleClose(): void {
  agentStore.auditReport = null
}
</script>

<template>
  <div v-if="hasReport || isLoading" class="audit-panel">
    <!-- Loading state -->
    <div v-if="isLoading" class="audit-loading">
      <div class="loading-spinner"></div>
      <span>正在生成审计报告...</span>
    </div>

    <!-- Report content -->
    <div v-else-if="report" class="audit-content">
      <!-- Header -->
      <div class="audit-header">
        <div class="header-left">
          <h3 class="audit-title">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="title-icon">
              <path
                d="M9 1L11 6.5L17 7L12.5 11L14 17L9 14L4 17L5.5 11L1 7L7 6.5L9 1Z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
            </svg>
            工作流审计报告
          </h3>
          <span class="audit-time">{{ formatTime(report.timestamp) }}</span>
        </div>
        <button class="btn-close" title="关闭" @click="handleClose">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- Overall score + support track -->
      <div class="score-section">
        <div class="score-display">
          <div class="score-number" :style="{ color: scoreColor }">
            {{ report.overallScore }}
          </div>
          <div class="score-label">总评分 / 100</div>
        </div>
        <div class="score-right">
          <div
            class="track-badge"
            :style="{
              color: supportTrackInfo.color,
              background: supportTrackInfo.bg,
            }"
          >
            {{ supportTrackInfo.label }}
          </div>
          <div class="severity-summary">
            <span v-if="severityStats.high > 0" class="sev-tag sev-high">
              {{ severityStats.high }} 高
            </span>
            <span v-if="severityStats.medium > 0" class="sev-tag sev-medium">
              {{ severityStats.medium }} 中
            </span>
            <span v-if="severityStats.low > 0" class="sev-tag sev-low">
              {{ severityStats.low }} 低
            </span>
            <span v-if="report.findings.length === 0" class="sev-none">无问题</span>
          </div>
        </div>
      </div>

      <!-- Summary text -->
      <p class="audit-summary">{{ report.summary }}</p>

      <!-- Radar chart -->
      <div class="radar-section">
        <svg
          :width="RADAR_SIZE"
          :height="RADAR_SIZE"
          :viewBox="`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`"
          class="radar-chart"
        >
          <!-- Grid rings -->
          <g class="radar-grid">
            <polygon
              v-for="(level, li) in RADAR_GRID_LEVELS"
              :key="li"
              :points="DIMENSION_ORDER.map((_, di) => {
                const pt = getAxisPoint(di, level)
                return `${pt.x},${pt.y}`
              }).join(' ')"
              fill="none"
              stroke="var(--af-border, #334155)"
              stroke-width="0.5"
              stroke-dasharray="2,3"
            />
          </g>

          <!-- Axis lines -->
          <g class="radar-axes">
            <line
              v-for="(_, di) in DIMENSION_ORDER"
              :key="di"
              :x1="RADAR_CENTER"
              :y1="RADAR_CENTER"
              :x2="getAxisPoint(di, 1).x"
              :y2="getAxisPoint(di, 1).y"
              stroke="var(--af-border, #334155)"
              stroke-width="0.5"
            />
          </g>

          <!-- Score polygon -->
          <polygon
            :points="radarPolygonPoints"
            fill="color-mix(in srgb, var(--af-brand, #818cf8) 20%, transparent)"
            stroke="var(--af-brand, #818cf8)"
            stroke-width="2"
            stroke-linejoin="round"
          />

          <!-- Score points -->
          <g class="radar-points">
            <circle
              v-for="(dim, di) in orderedDimensions"
              :key="di"
              :cx="getAxisPoint(di, Math.max(0, Math.min(1, dim.score / 100))).x"
              :cy="getAxisPoint(di, Math.max(0, Math.min(1, dim.score / 100))).y"
              r="3.5"
              :fill="DIMENSION_META[dim.dimension].color"
              stroke="var(--af-bg-surface, #1e293b)"
              stroke-width="1.5"
            />
          </g>

          <!-- Dimension labels -->
          <g class="radar-labels">
            <text
              v-for="(dim, di) in orderedDimensions"
              :key="di"
              :x="getLabelPoint(di).x"
              :y="getLabelPoint(di).y"
              text-anchor="middle"
              dominant-baseline="middle"
              class="radar-label"
              :style="{ fill: DIMENSION_META[dim.dimension].color }"
            >
              {{ DIMENSION_META[dim.dimension].label }}
            </text>
            <text
              v-for="(dim, di) in orderedDimensions"
              :key="`score-${di}`"
              :x="getLabelPoint(di).x"
              :y="getLabelPoint(di).y + 14"
              text-anchor="middle"
              dominant-baseline="middle"
              class="radar-score-label"
            >
              {{ dim.score }}
            </text>
          </g>
        </svg>
      </div>

      <!-- Dimension details -->
      <div class="dimensions-section">
        <div class="section-title">维度详情</div>
        <div class="dimension-list">
          <div
            v-for="dim in orderedDimensions"
            :key="dim.dimension"
            class="dimension-item"
            :class="{ expanded: isDimensionExpanded(dim.dimension) }"
          >
            <div class="dimension-header" @click="toggleDimension(dim.dimension)">
              <span class="dim-dot" :style="{ background: DIMENSION_META[dim.dimension].color }"></span>
              <span class="dim-label">{{ DIMENSION_META[dim.dimension].label }}</span>
              <span class="dim-score" :style="{ color: DIMENSION_META[dim.dimension].color }">
                {{ dim.score }}
              </span>
              <span
                class="dim-evidence"
                :style="{ color: EVIDENCE_META[dim.evidenceState].color }"
              >
                {{ EVIDENCE_META[dim.evidenceState].label }}
              </span>
              <svg
                class="dim-chevron"
                :class="{ rotated: isDimensionExpanded(dim.dimension) }"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <div v-if="isDimensionExpanded(dim.dimension)" class="dimension-checks">
              <div v-for="check in dim.checks" :key="check.checkId" class="check-item">
                <span
                  class="check-dot"
                  :style="{ background: EVIDENCE_META[check.evidenceState].color }"
                ></span>
                <div class="check-content">
                  <div class="check-label">{{ check.label }}</div>
                  <div class="check-desc">{{ check.description }}</div>
                </div>
                <span
                  class="check-state"
                  :style="{ color: EVIDENCE_META[check.evidenceState].color }"
                >
                  {{ EVIDENCE_META[check.evidenceState].label }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Findings list -->
      <div v-if="sortedFindings.length > 0" class="findings-section">
        <div class="section-title">
          审计发现
          <span class="findings-count">{{ sortedFindings.length }}</span>
        </div>
        <div class="findings-list">
          <div
            v-for="finding in sortedFindings"
            :key="finding.id"
            class="finding-card"
            :style="{
              borderLeftColor: SEVERITY_META[finding.severity].color,
            }"
          >
            <div class="finding-header">
              <span
                class="finding-severity"
                :style="{
                  color: SEVERITY_META[finding.severity].color,
                  background: SEVERITY_META[finding.severity].bg,
                }"
              >
                {{ SEVERITY_META[finding.severity].label }}
              </span>
              <span class="finding-title">{{ finding.title }}</span>
              <span
                class="finding-dimension"
                :style="{ color: DIMENSION_META[finding.dimension].color }"
              >
                {{ DIMENSION_META[finding.dimension].label }}
              </span>
            </div>
            <div class="finding-body">
              <div class="finding-field">
                <span class="field-label">描述</span>
                <p class="field-text">{{ finding.description }}</p>
              </div>
              <div v-if="finding.evidence" class="finding-field">
                <span class="field-label">证据</span>
                <p class="field-text field-evidence">{{ finding.evidence }}</p>
              </div>
              <div class="finding-field">
                <span class="field-label">影响</span>
                <p class="field-text">{{ finding.impact }}</p>
              </div>
              <div class="finding-field">
                <span class="field-label">修复建议</span>
                <p class="field-text field-repair">{{ finding.repair }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No findings -->
      <div v-else class="no-findings">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" class="no-findings-icon">
          <path
            d="M16 3L19 12L28 13L21 19L23 28L16 23L9 28L11 19L4 13L13 12L16 3Z"
            stroke="var(--af-success, #10b981)"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        </svg>
        <span>未发现审计问题，工作流状态良好</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audit-panel {
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  background: var(--af-bg-surface, #1e293b);
  padding: 16px;
  margin: 8px 0;
  max-height: 700px;
  overflow-y: auto;
}

/* ─── Loading ──────────────────────────────────────────────── */

.audit-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--af-text-tertiary, #94a3b8);
  font-size: 13px;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--af-border, #334155);
  border-top-color: var(--af-brand, #818cf8);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ─── Header ───────────────────────────────────────────────── */

.audit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.audit-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-icon {
  color: var(--af-brand, #818cf8);
}

.audit-time {
  font-size: 11px;
  color: var(--af-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

.btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background: transparent;
  color: var(--af-text-muted, #64748b);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.btn-close:hover {
  background: var(--af-bg-hover, #334155);
  color: var(--af-text-primary, #f1f5f9);
}

/* ─── Score Section ────────────────────────────────────────── */

.score-section {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 14px;
  background: var(--af-bg-input, #1f2937);
  border-radius: var(--af-radius, 8px);
  margin-bottom: 10px;
}

.score-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.score-number {
  font-size: 36px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.score-label {
  font-size: 11px;
  color: var(--af-text-muted, #64748b);
}

.score-right {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.track-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--af-radius-full, 999px);
  font-size: 12px;
  font-weight: 600;
  width: fit-content;
}

.severity-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sev-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--af-radius-sm, 6px);
}

.sev-high {
  color: var(--af-error, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}

.sev-medium {
  color: var(--af-warning, #f59e0b);
  background: rgba(245, 158, 11, 0.1);
}

.sev-low {
  color: var(--af-info, #0ea5e9);
  background: rgba(14, 165, 233, 0.1);
}

.sev-none {
  font-size: 11px;
  color: var(--af-success, #10b981);
  font-weight: 600;
}

/* ─── Summary ──────────────────────────────────────────────── */

.audit-summary {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--af-text-secondary, #cbd5e1);
}

/* ─── Radar Chart ─────────────────────────────────────────── */

.radar-section {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.radar-chart {
  display: block;
}

.radar-label {
  font-size: 11px;
  font-weight: 600;
}

.radar-score-label {
  font-size: 10px;
  fill: var(--af-text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

/* ─── Section Title ────────────────────────────────────────── */

.section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--af-text-tertiary, #94a3b8);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.findings-count {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--af-radius-full, 999px);
  background: var(--af-bg-hover, #334155);
  color: var(--af-text-secondary, #cbd5e1);
}

/* ─── Dimension List ───────────────────────────────────────── */

.dimension-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}

.dimension-item {
  border-radius: var(--af-radius-sm, 6px);
  background: var(--af-bg-input, #1f2937);
  overflow: hidden;
  transition: background 0.15s ease;
}

.dimension-item.expanded {
  background: var(--af-bg-hover, #334155);
}

.dimension-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
}

.dim-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dim-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
  flex: 1;
}

.dim-score {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.dim-evidence {
  font-size: 11px;
  font-weight: 600;
}

.dim-chevron {
  color: var(--af-text-muted, #64748b);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.dim-chevron.rotated {
  transform: rotate(180deg);
}

.dimension-checks {
  padding: 0 10px 8px 26px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  background: var(--af-bg-surface, #1e293b);
  border-radius: var(--af-radius-sm, 6px);
}

.check-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}

.check-content {
  flex: 1;
  min-width: 0;
}

.check-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--af-text-secondary, #cbd5e1);
  margin-bottom: 2px;
}

.check-desc {
  font-size: 11px;
  color: var(--af-text-muted, #64748b);
  line-height: 1.4;
}

.check-state {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 2px;
}

/* ─── Findings List ────────────────────────────────────────── */

.findings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.finding-card {
  border: 1px solid var(--af-border, #334155);
  border-left: 3px solid;
  border-radius: var(--af-radius-sm, 6px);
  background: var(--af-bg-input, #1f2937);
  overflow: hidden;
}

.finding-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--af-border-light, #1f2937);
}

.finding-severity {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--af-radius-sm, 6px);
  flex-shrink: 0;
}

.finding-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
  flex: 1;
}

.finding-dimension {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.finding-body {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.finding-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--af-text-muted, #64748b);
}

.field-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--af-text-secondary, #cbd5e1);
  white-space: pre-wrap;
  word-break: break-word;
}

.field-evidence {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--af-text-tertiary, #94a3b8);
}

.field-repair {
  color: var(--af-success, #10b981);
}

/* ─── No Findings ──────────────────────────────────────────── */

.no-findings {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--af-success, #10b981);
  font-size: 13px;
  font-weight: 500;
}

.no-findings-icon {
  opacity: 0.6;
}

/* ─── Responsive ───────────────────────────────────────────── */

@media (max-width: 480px) {
  .score-section {
    flex-direction: column;
    gap: 10px;
    text-align: center;
  }

  .score-right {
    align-items: center;
  }

  .radar-section {
    transform: scale(0.85);
  }
}
</style>
