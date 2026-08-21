<script setup lang="ts">
// UI-REDESIGN v0.3: ThinkingIndicator - three-dot pulse animation
// Shown while waiting for the first streamed token (Copilot/ChatGPT style)

defineProps<{
  /** Optional label, defaults to "思考中" */
  label?: string
}>()
</script>

<template>
  <div class="thinking-indicator" role="status" :aria-label="label ?? '思考中'">
    <span class="thinking-indicator__dot" />
    <span class="thinking-indicator__dot" />
    <span class="thinking-indicator__dot" />
    <span v-if="label" class="thinking-indicator__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.thinking-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 0;
}

.thinking-indicator__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--af-text-muted, #94a3b8);
  animation: thinking-bounce 1.2s ease-in-out infinite;
}

.thinking-indicator__dot:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-indicator__dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes thinking-bounce {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.thinking-indicator__label {
  margin-left: 6px;
  font-size: 12px;
  color: var(--af-text-muted, #94a3b8);
}

/* Respect reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  .thinking-indicator__dot {
    animation: none;
    opacity: 0.6;
  }
}
</style>
