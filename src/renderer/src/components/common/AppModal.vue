<script setup lang="ts">
/**
 * AppModal — naive-ui NModal 薄包装器
 * 使用 preset="card" 获得 header/body/footer 三段式布局。
 * 保持原有 visible/title/width API 不变。
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
    :style="{ maxWidth: `${width}px`, width: `${width}px` }"
    :mask-closable="true"
    @update:show="handleUpdateVisible"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </NModal>
</template>
