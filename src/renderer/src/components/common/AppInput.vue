<script setup lang="ts">
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
  <div class="app-input-wrapper" :class="{ 'app-input-wrapper--error': error !== '' }">
    <input
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :type="type"
      :maxlength="maxlength"
      class="app-input"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="error !== ''" class="app-input__error-text">{{ error }}</p>
  </div>
</template>

<style scoped>
.app-input-wrapper {
  width: 100%;
}

.app-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #374151;
  border-radius: 6px;
  background-color: #1f2937;
  color: #e5e7eb;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
}

.app-input:focus {
  border-color: #4f46e5;
}

.app-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.app-input-wrapper--error .app-input {
  border-color: #dc2626;
}

.app-input-wrapper--error .app-input:focus {
  border-color: #dc2626;
}

.app-input__error-text {
  margin: 4px 2px 0;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.4;
}
</style>
