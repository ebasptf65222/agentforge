<script setup lang="ts">
// OPT-UI: CodeDiffPreview - 并排显示 old/new 代码变更

import { computed } from 'vue'

const props = defineProps<{
  oldCode?: string
  newCode?: string
  filename?: string
  language?: string
  maxLines?: number
}>()

// 简单的逐行 diff：标记添加/删除/修改行
interface DiffLine {
  type: 'same' | 'add' | 'remove' | 'modify'
  oldNum?: number
  newNum?: number
  content: string
}

const diffLines = computed<DiffLine[]>(() => {
  const oldLines = (props.oldCode ?? '').split('\n')
  const newLines = (props.newCode ?? '').split('\n')
  const result: DiffLine[] = []

  // 使用最长公共子序列（LCS）简化版的 diff 算法
  const m = oldLines.length
  const n = newLines.length

  // 简单逐行比较（对于合理长度的 diff 足够）
  let oi = 0, ni = 0

  while (oi < m || ni < n) {
    if (oi < m && ni < n && oldLines[oi] === newLines[ni]) {
      result.push({ type: 'same', oldNum: oi + 1, newNum: ni + 1, content: oldLines[oi] })
      oi++; ni++
    } else if (ni < n && (oi >= m || oldLines[oi] !== newLines[ni])) {
      result.push({ type: 'add', newNum: ni + 1, content: newLines[ni] })
      ni++
    } else if (oi < m) {
      result.push({ type: 'remove', oldNum: oi + 1, content: oldLines[oi] })
      oi++
    }
  }

  return result
})

const max = computed(() => props.maxLines ?? 50)
const totalLines = computed(() => diffLines.value.length)
const isTruncated = computed(() => totalLines.value > max.value)
const visibleLines = computed(() => isTruncated.value ? diffLines.value.slice(0, max.value) : diffLines.value)
const stats = computed(() => {
  const lines = diffLines.value
  return {
    added: lines.filter(l => l.type === 'add').length,
    removed: lines.filter(l => l.type === 'remove').length,
    unchanged: lines.filter(l => l.type === 'same').length,
  }
})
</script>

<template>
  <div class="code-diff">
    <!-- Stats bar -->
    <div class="code-diff__stats">
      <span class="diff-stat diff-stat--added">+{{ stats.added }}</span>
      <span class="diff-stat diff-stat--removed">-{{ stats.removed }}</span>
      <span class="diff-stat diff-stat--unchanged">{{ stats.unchanged }} unchanged</span>
      <span v-if="isTruncated" class="diff-stat diff-stat--truncated">
        (showing {{ max }} of {{ totalLines }} lines)
      </span>
    </div>
    <!-- Diff table -->
    <div class="code-diff__table">
      <div
        v-for="(line, idx) in visibleLines"
        :key="idx"
        class="diff-row"
        :class="`diff-row--${line.type}`"
      >
        <span class="diff-num diff-num--old">{{ line.oldNum ?? '' }}</span>
        <span class="diff-num diff-num--new">{{ line.newNum ?? '' }}</span>
        <span class="diff-marker">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>
        <pre class="diff-content">{{ line.content }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-diff {
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius-sm, 6px);
  overflow: hidden;
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: 12px;
}

.code-diff__stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--af-bg-hover, #1f2937);
  border-bottom: 1px solid var(--af-border, #334155);
  font-size: 11px;
}

.diff-stat { color: var(--af-text-muted, #6b7280); }
.diff-stat--added { color: var(--af-success, #10b981); font-weight: 600; }
.diff-stat--removed { color: var(--af-error, #ef4444); font-weight: 600; }
.diff-stat--unchanged { color: var(--af-text-muted, #6b7280); }
.diff-stat--truncated { color: var(--af-warning, #f59e0b); margin-left: auto; }

.code-diff__table {
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.diff-row {
  display: flex;
  line-height: 1.5;
}

.diff-row--add { background: rgba(16, 185, 129, 0.08); }
.diff-row--remove { background: rgba(239, 68, 68, 0.08); }
.diff-row--same { background: transparent; }

.diff-num {
  display: inline-block;
  width: 36px;
  text-align: right;
  padding: 0 6px;
  color: var(--af-text-muted, #6b7280);
  user-select: none;
  flex-shrink: 0;
  background: rgba(0,0,0,0.15);
}

.diff-marker {
  display: inline-block;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
  user-select: none;
  font-weight: 600;
}

.diff-row--add .diff-marker { color: var(--af-success, #10b981); }
.diff-row--remove .diff-marker { color: var(--af-error, #ef4444); }

.diff-content {
  margin: 0;
  padding: 0 8px;
  white-space: pre;
  color: var(--af-text-primary, #e5e7eb);
  min-width: 0;
  flex: 1;
}
</style>
