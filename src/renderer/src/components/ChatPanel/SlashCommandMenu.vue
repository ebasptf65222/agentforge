<script setup lang="ts">
// UI-REDESIGN v0.3: SlashCommandMenu - "/" triggers skill quick-select
// Filtered list of manual skills; keyboard navigable (↑↓ Enter Esc)

import { computed, ref, watch } from 'vue'
import type { Skill } from '@shared/types'

const props = defineProps<{
  /** All available skills (manual trigger only) */
  skills: Skill[]
  /** Current filter text typed after "/" */
  filter: string
}>()

const emit = defineEmits<{
  select: [skill: Skill]
  close: []
}>()

const activeIndex = ref(0)

/** Skills filtered by the current query */
const filtered = computed<Skill[]>(() => {
  const q = props.filter.trim().toLowerCase()
  if (!q) return props.skills
  return props.skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  )
})

// Reset active index when the filter changes
watch(
  () => props.filter,
  () => {
    activeIndex.value = 0
  },
)

// Guard against out-of-range index
watch(filtered, () => {
  if (activeIndex.value >= filtered.value.length) {
    activeIndex.value = Math.max(0, filtered.value.length - 1)
  }
})

function moveDown(): void {
  if (filtered.value.length === 0) return
  activeIndex.value = (activeIndex.value + 1) % filtered.value.length
}

function moveUp(): void {
  if (filtered.value.length === 0) return
  activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % filtered.value.length
}

function confirmActive(): void {
  const skill = filtered.value[activeIndex.value]
  if (skill) {
    emit('select', skill)
  }
}

defineExpose({ moveDown, moveUp, confirmActive })
</script>

<template>
  <div v-if="filtered.length > 0" class="slash-menu" role="listbox" aria-label="Skill 快速选择">
    <div class="slash-menu__header">
      选择 Skill
      <span class="slash-menu__hint">↑↓ 导航 · Enter 确认 · Esc 关闭</span>
    </div>
    <button
      v-for="(skill, idx) in filtered"
      :key="skill.id"
      class="slash-menu__item"
      :class="{ 'is-active': idx === activeIndex }"
      role="option"
      :aria-selected="idx === activeIndex"
      @mouseenter="activeIndex = idx"
      @click="emit('select', skill)"
    >
      <span class="slash-menu__name">{{ skill.displayName }}</span>
      <span class="slash-menu__desc">{{ skill.description }}</span>
    </button>
  </div>
</template>

<style scoped>
.slash-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 280px;
  max-width: 420px;
  max-height: 260px;
  overflow-y: auto;
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px solid var(--af-border, #334155);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 100;
  padding: 4px;
}

.slash-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--af-text-tertiary, #94a3b8);
  border-bottom: 1px solid var(--af-border-light, #1f2937);
  margin-bottom: 2px;
}

.slash-menu__hint {
  font-weight: 400;
  color: var(--af-text-muted, #64748b);
}

.slash-menu__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.slash-menu__item.is-active {
  background-color: color-mix(in srgb, var(--af-brand, #6366f1) 15%, transparent);
}

.slash-menu__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--af-text-primary, #f1f5f9);
}

.slash-menu__desc {
  font-size: 12px;
  color: var(--af-text-tertiary, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
