<script setup lang="ts">
/**
 * AppButton — naive-ui NButton 薄包装器
 * 保持原有 variant/size API 不变，内部映射到 naive-ui props。
 */
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import type { ButtonProps } from 'naive-ui'

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

const naiveType = computed<ButtonProps['type']>(() => {
  switch (props.variant) {
    case 'primary':
      return 'primary'
    case 'danger':
      return 'error'
    case 'ghost':
      return 'default'
    default:
      return 'default'
  }
})

const naiveSize = computed<ButtonProps['size']>(() => {
  switch (props.size) {
    case 'sm':
      return 'small'
    case 'lg':
      return 'large'
    default:
      return 'medium'
  }
})

const isGhost = computed(() => props.variant === 'ghost')
const isSecondary = computed(() => props.variant === 'secondary')

function handleClick(event: MouseEvent): void {
  if (props.loading || props.disabled) {
    return
  }
  emit('click', event)
}
</script>

<template>
  <NButton
    :type="naiveType"
    :size="naiveSize"
    :loading="loading"
    :disabled="disabled"
    :ghost="isGhost"
    :secondary="isSecondary"
    :attr-type="type"
    @click="handleClick"
  >
    <slot />
  </NButton>
</template>
