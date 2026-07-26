<script setup lang="ts">
interface AppButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<AppButtonProps>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  type: 'button',
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

function handleClick(event: MouseEvent): void {
  if (props.loading || props.disabled) {
    return
  }
  emit('click', event)
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="app-button"
    :class="[
      `app-button--${variant}`,
      `app-button--${size}`,
      {
        'app-button--disabled': disabled,
        'app-button--loading': loading,
      },
    ]"
    @click="handleClick"
  >
    <span v-if="loading" class="app-button__spinner" aria-hidden="true" />
    <span class="app-button__content"><slot /></span>
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s ease;
  white-space: nowrap;
  user-select: none;
}

/* Sizes */
.app-button--sm {
  padding: 4px 12px;
  font-size: 12px;
}

.app-button--md {
  padding: 6px 16px;
  font-size: 14px;
}

.app-button--lg {
  padding: 10px 20px;
  font-size: 16px;
}

/* Variants */
.app-button--primary {
  background-color: #4f46e5;
  color: #fff;
}

.app-button--primary:hover:not(.app-button--disabled):not(.app-button--loading) {
  background-color: #4338ca;
}

.app-button--secondary {
  background-color: #374151;
  color: #e5e7eb;
}

.app-button--secondary:hover:not(.app-button--disabled):not(.app-button--loading) {
  background-color: #4b5563;
}

.app-button--ghost {
  background-color: transparent;
  color: #e5e7eb;
}

.app-button--ghost:hover:not(.app-button--disabled):not(.app-button--loading) {
  background-color: rgba(255, 255, 255, 0.08);
}

.app-button--danger {
  background-color: #dc2626;
  color: #fff;
}

.app-button--danger:hover:not(.app-button--disabled):not(.app-button--loading) {
  background-color: #b91c1c;
}

/* States */
.app-button--disabled,
.app-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.app-button--loading {
  cursor: wait;
}

/* Spinner */
.app-button__spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: app-button-spin 0.6s linear infinite;
}

@keyframes app-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
