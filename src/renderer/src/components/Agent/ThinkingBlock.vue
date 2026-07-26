<script setup lang="ts">
// P2-10: ThinkingBlock - collapsible reasoning display
// Shows the Agent's Thought process in a collapsible card

import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    thought: string
    step?: number
    defaultOpen?: boolean
  }>(),
  {
    step: undefined,
    defaultOpen: false,
  },
)

const isOpen = ref(props.defaultOpen)

function toggle(): void {
  isOpen.value = !isOpen.value
}
</script>

<template>
  <div class="thinking-block">
    <button class="thinking-header" @click="toggle">
      <span class="thinking-icon" :class="{ open: isOpen }">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M4.5 2.5L8 6L4.5 9.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="thinking-label">Thinking</span>
      <span v-if="step" class="thinking-step">Step {{ step }}</span>
    </button>
    <Transition name="thinking-collapse">
      <div v-show="isOpen" class="thinking-content">
        <p class="thinking-text">{{ thought }}</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.thinking-block {
  border: 1px solid var(--af-border, #334155);
  border-radius: var(--af-radius, 8px);
  margin: 8px 0;
  overflow: hidden;
  background: var(--af-bg-surface, #1e293b);
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--af-text-secondary, #cbd5e1);
  transition: background 0.15s ease;
}

.thinking-header:hover {
  background: var(--af-bg-hover, #334155);
}

.thinking-icon {
  display: flex;
  align-items: center;
  transition: transform 0.2s ease;
}

.thinking-icon.open {
  transform: rotate(90deg);
}

.thinking-label {
  font-weight: 500;
}

.thinking-step {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.7;
}

.thinking-content {
  padding: 0 12px 12px;
  border-top: 1px solid var(--af-border, #334155);
}

.thinking-text {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--af-text-primary, #f1f5f9);
  white-space: pre-wrap;
  word-break: break-word;
}

/* Collapse transition */
.thinking-collapse-enter-active,
.thinking-collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.thinking-collapse-enter-from,
.thinking-collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.thinking-collapse-enter-to,
.thinking-collapse-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>
