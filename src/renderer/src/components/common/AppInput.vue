<script setup lang="ts">
/**
 * AppInput — naive-ui NInput 薄包装器
 * 保持原有 modelValue/error API 不变，内部映射到 naive-ui props。
 */
import { NInput } from 'naive-ui'

interface AppInputProps {
  modelValue?: string
  placeholder?: string
  type?: string
  error?: string
  maxlength?: number
  disabled?: boolean
}

withDefaults(defineProps<AppInputProps>(), {
  modelValue: '',
  placeholder: '',
  type: 'text',
  error: '',
  maxlength: undefined,
  disabled: false,
})

defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="app-input-wrapper">
    <NInput
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxlength"
      :status="error ? 'error' : undefined"
      :type="type === 'password' ? 'password' : 'text'"
      @update:value="$emit('update:modelValue', $event)"
    />
    <p v-if="error !== ''" class="app-input__error-text">{{ error }}</p>
  </div>
</template>

<style scoped>
.app-input-wrapper {
  width: 100%;
}

.app-input__error-text {
  margin: 4px 2px 0;
  color: var(--af-error, #ef4444);
  font-size: 12px;
  line-height: 1.4;
}
</style>
