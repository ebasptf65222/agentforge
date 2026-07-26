<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

interface AppModalProps {
  visible: boolean
  title?: string
  width?: number
}

const props = withDefaults(defineProps<AppModalProps>(), {
  title: '',
  width: 480,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

function close(): void {
  emit('update:visible', false)
}

function handleOverlayClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    close()
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.visible) {
    close()
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      document.addEventListener('keydown', handleKeydown)
    } else {
      document.removeEventListener('keydown', handleKeydown)
    }
  },
)

onMounted(() => {
  if (props.visible) {
    document.addEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition name="app-modal-fade">
    <div v-if="visible" class="app-modal-overlay" @click="handleOverlayClick">
      <div class="app-modal" :style="{ width: `${width}px` }" role="dialog" aria-modal="true">
        <div v-if="title !== ''" class="app-modal__header">
          <h3 class="app-modal__title">{{ title }}</h3>
          <button class="app-modal__close" type="button" aria-label="Close" @click="close">
            &times;
          </button>
        </div>
        <button
          v-else
          class="app-modal__close app-modal__close--floating"
          type="button"
          aria-label="Close"
          @click="close"
        >
          &times;
        </button>
        <div class="app-modal__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="app-modal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.app-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.6);
  z-index: 1000;
}

.app-modal {
  position: relative;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background-color: #1f2937;
  color: #e5e7eb;
  border: 1px solid #374151;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.app-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #374151;
}

.app-modal__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #e5e7eb;
}

.app-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: #9ca3af;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.app-modal__close:hover {
  color: #e5e7eb;
  background-color: rgba(255, 255, 255, 0.08);
}

.app-modal__close--floating {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

.app-modal__body {
  padding: 20px;
  overflow-y: auto;
  flex: 1 1 auto;
}

.app-modal__footer {
  padding: 12px 20px;
  border-top: 1px solid #374151;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Fade transition */
.app-modal-fade-enter-active,
.app-modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.app-modal-fade-enter-active .app-modal,
.app-modal-fade-leave-active .app-modal {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.app-modal-fade-enter-from,
.app-modal-fade-leave-to {
  opacity: 0;
}

.app-modal-fade-enter-from .app-modal,
.app-modal-fade-leave-to .app-modal {
  transform: scale(0.96);
  opacity: 0;
}
</style>
