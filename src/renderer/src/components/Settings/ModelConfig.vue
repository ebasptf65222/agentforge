<script setup lang="ts">
// P1-15: ModelConfig - model configuration management UI.
// List with skeleton loading, add/edit modal form, connection test,
// and delete (with default-model guard).

import { ref, reactive, computed, onMounted } from 'vue'
import { useDialog } from 'naive-ui'
import type { ModelConfig, ModelProvider } from '@shared/types'
import type { ModelTestResult } from '@/types/electron-api'
import { useModelStore, PROVIDER_OPTIONS, getProviderMeta } from '@/stores/model'
import { showToast } from '@/utils/toast'
import AppButton from '@/components/common/AppButton.vue'
import AppInput from '@/components/common/AppInput.vue'
import AppModal from '@/components/common/AppModal.vue'

const modelStore = useModelStore()
const dialog = useDialog()

onMounted(() => {
  void modelStore.loadModels()
})

// ─── Modal / form state ────────────────────────────────────────

const modalVisible = ref(false)
/** Editing target; null when adding a new model. */
const editingId = ref<string | null>(null)
const saving = ref(false)

interface FormState {
  name: string
  provider: ModelProvider
  modelId: string
  apiKey: string
  baseUrl: string
  temperature: number
  maxTokens: number
}

const DEFAULT_FORM: FormState = {
  name: '',
  provider: 'openai',
  modelId: '',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.7,
  maxTokens: 4096,
}

const form = reactive<FormState>({ ...DEFAULT_FORM })

/** Placeholder for the base URL field, derived from the selected provider. */
const baseUrlPlaceholder = computed(() => {
  const meta = getProviderMeta(form.provider)
  return meta && meta.defaultBaseUrl !== '' ? meta.defaultBaseUrl : 'https://api.example.com/v1'
})

interface FormErrors {
  name?: string
  provider?: string
  modelId?: string
  apiKey?: string
  baseUrl?: string
  maxTokens?: string
}

const errors = reactive<FormErrors>({})

// ─── Connection test state ─────────────────────────────────────

/** Per-row test status keyed by model id. */
interface TestStatus {
  loading: boolean
  result?: ModelTestResult
  error?: string
}

const rowTestStatus = ref<Record<string, TestStatus>>({})
/** In-form test status (for the add/edit modal). */
const formTestStatus = ref<TestStatus>({ loading: false })

// ─── Validation ────────────────────────────────────────────────

function validateForm(): boolean {
  errors.name = undefined
  errors.provider = undefined
  errors.modelId = undefined
  errors.apiKey = undefined
  errors.baseUrl = undefined
  errors.maxTokens = undefined

  let ok = true

  if (form.name.trim() === '') {
    errors.name = '请输入模型名称'
    ok = false
  }

  if (form.provider.trim() === '') {
    errors.provider = '请选择提供商'
    ok = false
  }

  if (form.modelId.trim() === '') {
    errors.modelId = '请输入模型 ID'
    ok = false
  }

  // API Key required. When editing, the masked value '***' is shown in the list
  // but the form starts empty; the user must re-enter a key to change it, OR
  // leave it blank to keep the existing key (handled on submit).
  if (editingId.value === null) {
    if (form.apiKey.trim() === '') {
      errors.apiKey = '请输入 API Key'
      ok = false
    } else if (form.apiKey.length < 10) {
      errors.apiKey = 'API Key 长度至少为 10 个字符'
      ok = false
    }
  } else if (form.apiKey.trim() !== '' && form.apiKey.length < 10) {
    errors.apiKey = 'API Key 长度至少为 10 个字符'
    ok = false
  }

  if (form.maxTokens < 100 || form.maxTokens > 128000) {
    errors.maxTokens = 'Max Tokens 范围为 100 - 128000'
    ok = false
  }

  return ok
}

// ─── Modal open/close ──────────────────────────────────────────

/** Clear all validation errors by reassigning each field explicitly. */
function clearErrors(): void {
  errors.name = undefined
  errors.provider = undefined
  errors.modelId = undefined
  errors.apiKey = undefined
  errors.baseUrl = undefined
  errors.maxTokens = undefined
}

function openAdd(): void {
  editingId.value = null
  Object.assign(form, DEFAULT_FORM)
  // Reset provider-dependent defaults
  form.baseUrl = baseUrlPlaceholder.value
  clearErrors()
  formTestStatus.value = { loading: false }
  modalVisible.value = true
}

function openEdit(model: ModelConfig): void {
  editingId.value = model.id
  form.name = model.name
  form.provider = model.provider
  form.modelId = model.modelId
  // Masked from the list; user must re-enter to change.
  form.apiKey = ''
  form.baseUrl = model.baseUrl ?? baseUrlPlaceholder.value
  form.temperature = model.temperature
  form.maxTokens = model.maxTokens
  clearErrors()
  formTestStatus.value = { loading: false }
  modalVisible.value = true
}

function handleProviderChange(): void {
  // Auto-fill base URL with provider default when it is empty or matches a
  // known provider default (i.e., the user hasn't customized it).
  const meta = getProviderMeta(form.provider)
  if (!meta) return
  const knownDefaults = PROVIDER_OPTIONS.map((p) => p.defaultBaseUrl)
  if (form.baseUrl === '' || knownDefaults.includes(form.baseUrl)) {
    form.baseUrl = meta.defaultBaseUrl
  }
}

// ─── Submit ────────────────────────────────────────────────────

async function handleSubmit(): Promise<void> {
  if (!validateForm()) return

  saving.value = true
  try {
    if (editingId.value === null) {
      await modelStore.createModel({
        name: form.name.trim(),
        provider: form.provider,
        modelId: form.modelId.trim(),
        apiKey: form.apiKey,
        baseUrl: form.baseUrl.trim() === '' ? undefined : form.baseUrl.trim(),
        temperature: form.temperature,
        maxTokens: form.maxTokens,
      })
      showToast('模型已添加', 'success')
    } else {
      // Only include apiKey when the user typed a new one.
      const apiKeyParam = form.apiKey.trim() !== '' ? form.apiKey : undefined
      await modelStore.updateModel({
        id: editingId.value,
        name: form.name.trim(),
        apiKey: apiKeyParam,
        baseUrl: form.baseUrl.trim() === '' ? undefined : form.baseUrl.trim(),
        temperature: form.temperature,
        maxTokens: form.maxTokens,
      })
      showToast('模型已更新', 'success')
    }
    modalVisible.value = false
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  } finally {
    saving.value = false
  }
}

// ─── Connection test ───────────────────────────────────────────

async function testRow(model: ModelConfig): Promise<void> {
  rowTestStatus.value[model.id] = { loading: true }
  try {
    const result = await modelStore.testModel(model.id)
    rowTestStatus.value[model.id] = { loading: false, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    rowTestStatus.value[model.id] = { loading: false, error: message }
  }
}

/**
 * Test connection from inside the add/edit modal.
 * For new (unsaved) models this is not supported by the IPC, so we require
 * the model to be saved first. For existing models we test by id.
 */
async function testFromForm(): Promise<void> {
  if (editingId.value === null) {
    showToast('请先保存模型后再测试连接', 'info')
    return
  }
  formTestStatus.value = { loading: true }
  try {
    const result = await modelStore.testModel(editingId.value)
    formTestStatus.value = { loading: false, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    formTestStatus.value = { loading: false, error: message }
  }
}

// ─── Delete ────────────────────────────────────────────────────

function handleDelete(model: ModelConfig): void {
  if (model.isDefault) {
    // The store will also toast on the IPC error, but we short-circuit here
    // for a snappier UX when we already know it is the default model.
    showToast('无法删除默认模型，请先设置其他模型为默认', 'error')
    return
  }
  dialog.warning({
    title: '删除模型',
    content: `确定删除模型「${model.name}」吗？此操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await modelStore.deleteModel(model.id)
        showToast('模型已删除', 'success')
      } catch {
        // Error already toasted by the store.
      }
    },
  })
}

// ─── Temperature slider helper ─────────────────────────────────

function handleTemperatureChange(event: Event): void {
  const target = event.target as HTMLInputElement
  form.temperature = Number.parseFloat(target.value)
}

function handleMaxTokensInput(value: string): void {
  const parsed = Number.parseInt(value, 10)
  form.maxTokens = Number.isNaN(parsed) ? 0 : parsed
}

// ─── Provider label/color ──────────────────────────────────────

function providerLabel(provider: ModelProvider): string {
  return getProviderMeta(provider)?.label ?? provider
}

function providerColor(provider: ModelProvider): string {
  return getProviderMeta(provider)?.color ?? '#6b7280'
}

// ─── Skeleton rows ─────────────────────────────────────────────

const skeletonRows = [0, 1, 2, 3]

const isModalOpen = computed({
  get: () => modalVisible.value,
  set: (v: boolean) => {
    modalVisible.value = v
  },
})
</script>

<template>
  <div class="model-config">
    <!-- Header -->
    <div class="model-config__header">
      <div>
        <h2 class="model-config__title">模型配置</h2>
        <p class="model-config__subtitle">管理可用的 AI 模型及其 API 凭据</p>
      </div>
      <AppButton variant="primary" @click="openAdd">+ 添加模型</AppButton>
    </div>

    <!-- List -->
    <div class="model-config__list">
      <!-- Skeleton loading -->
      <div v-if="modelStore.loading" class="model-config__skeleton">
        <div v-for="i in skeletonRows" :key="`skeleton-${i}`" class="skeleton-row">
          <div class="skeleton-row__cell skeleton-row__name" />
          <div class="skeleton-row__cell skeleton-row__provider" />
          <div class="skeleton-row__cell skeleton-row__actions" />
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="modelStore.models.length === 0" class="model-config__empty">
        <p class="model-config__empty-title">暂无模型配置</p>
        <p class="model-config__empty-hint">点击右上角「添加模型」开始配置</p>
      </div>

      <!-- Table -->
      <table v-else class="model-table">
        <thead>
          <tr>
            <th class="model-table__th">名称</th>
            <th class="model-table__th">提供商</th>
            <th class="model-table__th">模型 ID</th>
            <th class="model-table__th">默认</th>
            <th class="model-table__th model-table__th--actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="model in modelStore.models" :key="model.id" class="model-table__row">
            <td class="model-table__td model-table__td--name">{{ model.name }}</td>
            <td class="model-table__td">
              <span
                class="provider-tag"
                :style="{
                  backgroundColor: `${providerColor(model.provider)}22`,
                  color: providerColor(model.provider),
                }"
              >
                {{ providerLabel(model.provider) }}
              </span>
            </td>
            <td class="model-table__td model-table__td--mono">{{ model.modelId }}</td>
            <td class="model-table__td">
              <span v-if="model.isDefault" class="default-badge">默认</span>
              <span v-else class="model-table__muted">-</span>
            </td>
            <td class="model-table__td model-table__td--actions">
              <div class="row-actions">
                <!-- Test result (inline) -->
                <span v-if="rowTestStatus[model.id]?.result" class="row-test row-test--success">
                  连接成功 ({{ rowTestStatus[model.id]?.result?.latency }}ms)
                </span>
                <span
                  v-else-if="rowTestStatus[model.id]?.error"
                  class="row-test row-test--error"
                  :title="rowTestStatus[model.id]?.error"
                >
                  连接失败
                </span>

                <AppButton
                  size="sm"
                  variant="ghost"
                  :loading="rowTestStatus[model.id]?.loading === true"
                  @click="testRow(model)"
                >
                  测试
                </AppButton>
                <AppButton size="sm" variant="ghost" @click="openEdit(model)">编辑</AppButton>
                <AppButton
                  size="sm"
                  variant="ghost"
                  :class="{ 'row-actions__delete': model.isDefault }"
                  @click="handleDelete(model)"
                >
                  删除
                </AppButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Add / Edit modal -->
    <AppModal
      v-model:visible="isModalOpen"
      :title="editingId === null ? '添加模型' : '编辑模型'"
      :width="520"
    >
      <form class="model-form" @submit.prevent="handleSubmit">
        <!-- 名称 -->
        <div class="model-form__field">
          <label class="model-form__label">名称 <span class="model-form__required">*</span></label>
          <AppInput
            v-model="form.name"
            placeholder="例如：我的 GPT-4o"
            :maxlength="50"
            :error="errors.name ?? ''"
          />
        </div>

        <!-- 提供商 -->
        <div class="model-form__field">
          <label class="model-form__label"
            >提供商 <span class="model-form__required">*</span></label
          >
          <select v-model="form.provider" class="model-form__select" @change="handleProviderChange">
            <option v-for="p in PROVIDER_OPTIONS" :key="p.value" :value="p.value">
              {{ p.label }}
            </option>
          </select>
          <p v-if="errors.provider" class="model-form__error">{{ errors.provider }}</p>
        </div>

        <!-- 模型 ID -->
        <div class="model-form__field">
          <label class="model-form__label"
            >模型 ID <span class="model-form__required">*</span></label
          >
          <AppInput v-model="form.modelId" placeholder="gpt-4o" :error="errors.modelId ?? ''" />
        </div>

        <!-- API Key -->
        <div class="model-form__field">
          <label class="model-form__label">
            API Key <span class="model-form__required">*</span>
            <span v-if="editingId !== null" class="model-form__hint">（留空则不修改）</span>
          </label>
          <AppInput
            v-model="form.apiKey"
            type="password"
            placeholder="sk-..."
            :error="errors.apiKey ?? ''"
          />
        </div>

        <!-- Base URL -->
        <div class="model-form__field">
          <label class="model-form__label">Base URL</label>
          <AppInput v-model="form.baseUrl" :placeholder="baseUrlPlaceholder" />
        </div>

        <!-- Temperature -->
        <div class="model-form__field">
          <label class="model-form__label">
            Temperature
            <span class="model-form__value">{{ form.temperature.toFixed(1) }}</span>
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            :value="form.temperature"
            class="model-form__range"
            @input="handleTemperatureChange"
          />
        </div>

        <!-- Max Tokens -->
        <div class="model-form__field">
          <label class="model-form__label">Max Tokens</label>
          <input
            type="number"
            :value="form.maxTokens"
            min="100"
            max="128000"
            class="model-form__number"
            @input="handleMaxTokensInput(($event.target as HTMLInputElement).value)"
          />
          <p v-if="errors.maxTokens" class="model-form__error">{{ errors.maxTokens }}</p>
        </div>

        <!-- Test connection (in-form) -->
        <div class="model-form__test">
          <AppButton
            type="button"
            variant="secondary"
            size="sm"
            :loading="formTestStatus.loading"
            :disabled="editingId === null"
            @click="testFromForm"
          >
            测试连接
          </AppButton>
          <span v-if="formTestStatus.result" class="form-test form-test--success">
            连接成功 ({{ formTestStatus.result.latency }}ms)
          </span>
          <span
            v-else-if="formTestStatus.error"
            class="form-test form-test--error"
            :title="formTestStatus.error"
          >
            连接失败
          </span>
          <span v-else-if="editingId === null" class="form-test form-test--hint">
            保存后可测试连接
          </span>
        </div>
      </form>

      <template #footer>
        <AppButton variant="ghost" @click="modalVisible = false">取消</AppButton>
        <AppButton variant="primary" :loading="saving" @click="handleSubmit">
          {{ editingId === null ? '添加' : '保存' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.model-config {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.model-config__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 4px 0 20px;
  border-bottom: 1px solid #374151;
  margin-bottom: 16px;
}

.model-config__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #f9fafb;
}

.model-config__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #9ca3af;
}

.model-config__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* ─── Empty state ─────────────────────────────────────────── */
.model-config__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.model-config__empty-title {
  margin: 0;
  font-size: 15px;
  color: #9ca3af;
}

.model-config__empty-hint {
  margin: 6px 0 0;
  font-size: 13px;
  color: #6b7280;
}

/* ─── Table ───────────────────────────────────────────────── */
.model-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.model-table__th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 600;
  color: #9ca3af;
  border-bottom: 1px solid #374151;
  white-space: nowrap;
}

.model-table__th--actions {
  text-align: right;
}

.model-table__row {
  border-bottom: 1px solid #1f2937;
  transition: background-color 0.15s ease;
}

.model-table__row:hover {
  background-color: #1f2937;
}

.model-table__td {
  padding: 12px;
  color: #e5e7eb;
  vertical-align: middle;
}

.model-table__td--name {
  font-weight: 500;
}

.model-table__td--mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  color: #9ca3af;
}

.model-table__td--actions {
  text-align: right;
}

.model-table__muted {
  color: #4b5563;
}

/* Provider tag */
.provider-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

/* Default badge */
.default-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background-color: rgba(79, 70, 229, 0.2);
  color: #a5b4fc;
}

/* Row actions */
.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}

.row-actions__delete {
  color: #ef4444;
}

.row-test {
  font-size: 11px;
  margin-right: 4px;
}

.row-test--success {
  color: #10b981;
}

.row-test--error {
  color: #ef4444;
}

/* ─── Skeleton ────────────────────────────────────────────── */
.model-config__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid #1f2937;
}

.skeleton-row__cell {
  height: 14px;
  border-radius: 4px;
  background-color: #374151;
  animation: model-skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-row__name {
  width: 30%;
}

.skeleton-row__provider {
  width: 80px;
}

.skeleton-row__actions {
  flex: 1;
  max-width: 200px;
  margin-left: auto;
}

@keyframes model-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

/* ─── Form (inside modal) ─────────────────────────────────── */
.model-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-form__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-form__label {
  font-size: 13px;
  color: #d1d5db;
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-form__required {
  color: #ef4444;
}

.model-form__hint {
  font-size: 11px;
  color: #6b7280;
  font-weight: 400;
}

.model-form__value {
  margin-left: auto;
  font-size: 12px;
  color: #a5b4fc;
  font-family: 'SFMono-Regular', Consolas, monospace;
}

.model-form__error {
  margin: 2px 2px 0;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.4;
}

.model-form__select,
.model-form__number {
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

.model-form__select:focus,
.model-form__number:focus {
  border-color: #4f46e5;
}

.model-form__select {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.model-form__range {
  width: 100%;
  accent-color: #4f46e5;
  cursor: pointer;
}

.model-form__test {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}

.form-test {
  font-size: 12px;
}

.form-test--success {
  color: #10b981;
}

.form-test--error {
  color: #ef4444;
}

.form-test--hint {
  color: #6b7280;
}
</style>
