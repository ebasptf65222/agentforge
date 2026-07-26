<script setup lang="ts">
// WS-04: WorkspaceConfig - workspace settings UI.
// Allows selecting a workspace directory, switching between recent workspaces,
// editing exclude patterns, and toggling auto-restore on startup.

import { computed, onMounted, ref } from 'vue'
import {
  NCard,
  NSwitch,
  NSelect,
  NInput,
  NButton,
  NForm,
  NFormItem,
  NTag,
  NSpace,
  NEmpty,
  NDynamicTags,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import type { AppSettings, WorkspaceConfig } from '@shared/types'
import { useSettingsStore } from '@/stores/settings'
import { showToast } from '@/utils/toast'

const settingsStore = useSettingsStore()

onMounted(async () => {
  await settingsStore.loadSettings()
})

// ─── Reactive snapshot ────────────────────────────────────────

const settings = computed<AppSettings | null>(() => settingsStore.settings)
const isLoading = computed(() => settingsStore.loading || settings.value === null)

// ─── Default fallback ─────────────────────────────────────────

const DEFAULT_WORKSPACE: WorkspaceConfig = {
  path: null,
  recentPaths: [],
  autoRestore: false,
  excludePatterns: ['node_modules', '.git', 'dist', '.DS_Store'],
}

const workspace = computed<WorkspaceConfig>(
  () => settings.value?.workspace ?? DEFAULT_WORKSPACE,
)

// ─── Recent workspace options ─────────────────────────────────

const recentPathOptions = computed<SelectOption[]>(() => {
  return workspace.value.recentPaths.map((p) => ({
    label: p,
    value: p,
  }))
})

// ─── Selecting a directory ────────────────────────────────────

const selectingDir = ref(false)

async function handleSelectDir(): Promise<void> {
  selectingDir.value = true
  try {
    const selectedPath = await window.electron.file.selectDir({
      title: '选择工作区目录',
      defaultPath: workspace.value.path ?? undefined,
    })
    if (selectedPath === null) {
      // User cancelled
      return
    }
    await settingsStore.updateWorkspace({ path: selectedPath })
    showToast(`工作区已设置为: ${selectedPath}`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`设置工作区失败: ${message}`, 'error')
  } finally {
    selectingDir.value = false
  }
}

// ─── Switching workspace from recent list ────────────────────

async function handleSwitchWorkspace(path: string): Promise<void> {
  if (path === workspace.value.path) return
  try {
    await settingsStore.updateWorkspace({ path })
    showToast(`已切换到: ${path}`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`切换工作区失败: ${message}`, 'error')
  }
}

// ─── Clear workspace ──────────────────────────────────────────

async function handleClearWorkspace(): Promise<void> {
  try {
    await settingsStore.updateWorkspace({ path: null })
    showToast('已清除工作区路径', 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`清除工作区失败: ${message}`, 'error')
  }
}

// ─── Toggle autoRestore ───────────────────────────────────────

async function handleAutoRestoreChange(value: boolean): Promise<void> {
  try {
    await settingsStore.updateWorkspace({ autoRestore: value })
    showToast(value ? '已启用启动时自动恢复' : '已关闭启动时自动恢复', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存失败: ${message}`, 'error')
  }
}

// ─── Edit exclude patterns ────────────────────────────────────

async function handleExcludePatternsChange(patterns: string[]): Promise<void> {
  try {
    await settingsStore.updateWorkspace({ excludePatterns: patterns })
    showToast('排除规则已更新', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showToast(`保存排除规则失败: ${message}`, 'error')
  }
}
</script>

<template>
  <div class="workspace-config">
    <div class="workspace-config__header">
      <h2 class="workspace-config__title">工作区设置</h2>
      <p class="workspace-config__subtitle">
        选择本地目录作为 AI 的工作区，用于读写文件、生成文档等
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="workspace-config__loading">
      <div class="setting-skeleton" />
      <div class="setting-skeleton" />
    </div>

    <!-- Form -->
    <div v-else class="workspace-config__sections">
      <!-- ==================== 当前工作区 ==================== -->
      <NCard title="当前工作区" class="workspace-card">
        <NForm label-placement="left" label-width="100">
          <NFormItem label="工作区路径">
            <div class="path-display">
              <NInput
                :value="workspace.path ?? ''"
                placeholder="未设置工作区"
                readonly
              >
                <template #suffix>
                  <NTag
                    v-if="workspace.path"
                    size="small"
                    type="success"
                    :bordered="false"
                  >
                    已设置
                  </NTag>
                  <NTag v-else size="small" type="warning" :bordered="false">
                    未设置
                  </NTag>
                </template>
              </NInput>
            </div>
          </NFormItem>

          <NFormItem label="操作">
            <NSpace>
              <NButton
                type="primary"
                :loading="selectingDir"
                @click="handleSelectDir"
              >
                选择目录
              </NButton>
              <NButton
                v-if="workspace.path"
                quaternary
                type="error"
                @click="handleClearWorkspace"
              >
                清除
              </NButton>
            </NSpace>
          </NFormItem>
        </NForm>
      </NCard>

      <!-- ==================== 最近工作区 ==================== -->
      <NCard title="最近使用的工作区" class="workspace-card">
        <NEmpty
          v-if="recentPathOptions.length === 0"
          description="暂无最近使用的工作区"
        />
        <NForm v-else label-placement="left" label-width="100">
          <NFormItem label="快速切换">
            <NSelect
              :value="workspace.path ?? null"
              :options="recentPathOptions"
              placeholder="选择一个最近的工作区"
              clearable
              @update:value="(v) => v && handleSwitchWorkspace(v as string)"
            />
          </NFormItem>
        </NForm>
      </NCard>

      <!-- ==================== 文件排除规则 ==================== -->
      <NCard title="文件排除规则" class="workspace-card">
        <p class="card-hint">
          匹配以下模式的文件/目录将不会在文件树中显示（支持 glob 语法）
        </p>
        <NDynamicTags
          :value="workspace.excludePatterns"
          type="info"
          round
          :max="20"
          @update:value="handleExcludePatternsChange"
        />
      </NCard>

      <!-- ==================== 启动选项 ==================== -->
      <NCard title="启动选项" class="workspace-card">
        <NForm label-placement="left" label-width="100">
          <NFormItem label="自动恢复">
            <NSwitch
              :value="workspace.autoRestore"
              @update:value="handleAutoRestoreChange"
            />
            <span class="switch-hint">
              应用启动时自动恢复上次使用的工作区
            </span>
          </NFormItem>
        </NForm>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.workspace-config {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.workspace-config__header {
  padding: 4px 0 20px;
  border-bottom: 1px solid var(--af-border, #334155);
  margin-bottom: 16px;
}

.workspace-config__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--af-text-primary, #f1f5f9);
}

.workspace-config__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
}

.workspace-config__loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-skeleton {
  height: 120px;
  border-radius: var(--af-radius, 8px);
  background-color: var(--af-bg-input, #1f2937);
  animation: ws-skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes ws-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.workspace-config__sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

.workspace-card {
  border-radius: var(--af-radius, 8px);
}

.path-display {
  width: 100%;
}

.card-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
}

.switch-hint {
  margin-left: 12px;
  font-size: 13px;
  color: var(--af-text-tertiary, #94a3b8);
}
</style>
