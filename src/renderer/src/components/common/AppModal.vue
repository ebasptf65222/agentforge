<script setup lang="ts">
/**
 * AppModal — naive-ui NModal wrapper
 * 
 * P1-11 requirements:
 * - fade animation (via NModal default transition)
 * - mask-closable (click overlay to close)
 * - ESC close (explicit close-on-esc)
 * - z-index 1000
 */
import { NModal } from 'naive-ui'

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

function handleUpdateVisible(value: boolean): void {
  emit('update:visible', value)
}
</script>

<template>
  <NModal
    :show="props.visible"
    :title="title || undefined"
    preset="card"
    :bordered="false"
    :z-index="1000"
    :mask-closable="true"
    :close-on-esc="true"
    :style="{ maxWidth: `${width}px`, width: `${width}px` }"
    :transition-props="{ name: 'fade' }"
    @update:show="handleUpdateVisible"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </NModal>
</template>
