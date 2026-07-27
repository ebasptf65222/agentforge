<script setup lang="ts">
// McpConfig - MCP 服务器配置管理界面
// 列表展示已添加的 MCP 服务器，支持添加/编辑/删除/启用禁用/状态刷新

import { ref, reactive, computed, onMounted, h } from 'vue'
import {
  NDataTable,
  NButton,
  NIcon,
  NTag,
  NSwitch,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NPopconfirm,
  type DataTableColumns,
} from 'naive-ui'
import { AddOutlined, DeleteOutlined, RefreshOutlined, EditOutlined } from '@vicons/material'
import type { MCPServerConfig } from '@shared/types'
import type { McpAddParams, McpUpdateParams } from '@/types/electron-api'
import { useMcpStore } from '@/stores/mcp'

const mcpStore = useMcpStore()

onMounted(() => {
  void mcpStore.loadServers().then(() => {
    // Refresh status for all enabled servers after loading
    for (const server of mcpStore.servers) {
      if (server.enabled) {
        void mcpStore.loadStatus(server.id)
      }
    }
  })
})

// ─── 状态颜色映射 ──────────────────────────────────────────────

const statusTagType: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  connected: 'success',
  disconnected: 'default',
  error: 'error',
  connecting: 'warning',
}

const statusLabels: Record<string, string> = {
  connected: '已连接',
  disconnected: '未连接',
  error: '错误',
  connecting: '连接中',
}

// ─── 添加/编辑服务器表单 ──────────────────────────────────────

const modalVisible = ref(false)
const saving = ref(false)
/** null = add mode, string = edit mode (server id) */
const editingId = ref<string | null>(null)

const modalTitle = computed(() => (editingId.value ? '编辑 MCP 服务器' : '添加 MCP 服务器'))

interface McpFormState {
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string
  url: string
  envText: string
}

const DEFAULT_FORM: McpFormState = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  envText: '',
}

const form = reactive<McpFormState>({ ...DEFAULT_FORM })

const transportOptions = [
  { label: 'Stdio (本地进程)', value: 'stdio' },
  { label: 'HTTP (远程服务)', value: 'http' },
]

function resetForm(): void {
  Object.assign(form, DEFAULT_FORM)
}

function openAddModal(): void {
  resetForm()
  editingId.value = null
  modalVisible.value = true
}

function openEditModal(server: MCPServerConfig): void {
  editingId.value = server.id
  form.name = server.name
  form.transport = server.transport
  form.command = server.command ?? ''
  form.args = (server.args ?? []).join(' ')
  form.url = server.url ?? ''
  // Reconstruct env text from Record
  if (server.env) {
    form.envText = Object.entries(server.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  } else {
    form.envText = ''
  }
  modalVisible.value = true
}

function parseEnvText(text: string): Record<string, string> | undefined {
  if (!text.trim()) return undefined
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx > 0) {
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
    }
  }
  return Object.keys(env).length > 0 ? env : undefined
}

async function handleSave(): Promise<void> {
  if (!form.name.trim()) return

  saving.value = true
  try {
    const params: McpAddParams = {
      name: form.name.trim(),
      transport: form.transport,
      enabled: true,
    }

    if (form.transport === 'stdio') {
      params.command = form.command.trim()
      params.args = form.args.trim()
        ? form.args.trim().split(/\s+/).filter(Boolean)
        : undefined
    } else {
      params.url = form.url.trim()
    }

    const env = parseEnvText(form.envText)
    if (env) params.env = env

    // OPT2-12: 编辑模式使用原子 update 而非先删后增，避免 addServer 失败时数据丢失
    if (editingId.value) {
      const updateParams: McpUpdateParams = { id: editingId.value }
      updateParams.name = params.name
      updateParams.transport = params.transport
      if (params.command) updateParams.command = params.command
      if (params.args) updateParams.args = params.args
      if (params.env) updateParams.env = params.env
      if (params.url) updateParams.url = params.url
      await mcpStore.updateServer(updateParams)
    } else {
      await mcpStore.addServer(params)
    }
    modalVisible.value = false
  } catch {
    // 错误已在 store 中处理
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string): Promise<void> {
  await mcpStore.removeServer(id)
}

async function handleToggle(id: string, enabled: boolean): Promise<void> {
  await mcpStore.toggleEnable(id, enabled)
  // After enabling, refresh status
  if (enabled) {
    void mcpStore.loadStatus(id)
  }
}

async function handleRefresh(): Promise<void> {
  await mcpStore.loadServers()
  for (const server of mcpStore.servers) {
    if (server.enabled) {
      void mcpStore.loadStatus(server.id)
    }
  }
}

// ─── 表格列定义 ────────────────────────────────────────────────

const columns = computed<DataTableColumns<MCPServerConfig>>(() => [
  {
    title: '名称',
    key: 'name',
    width: 160,
    ellipsis: { tooltip: true },
  },
  {
    title: '传输',
    key: 'transport',
    width: 100,
    render(row) {
      return row.transport === 'stdio' ? 'Stdio' : 'HTTP'
    },
  },
  {
    title: '地址',
    key: 'address',
    ellipsis: { tooltip: true },
    render(row) {
      return row.transport === 'stdio'
        ? `${row.command ?? ''} ${(row.args ?? []).join(' ')}`
        : (row.url ?? '')
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render(row) {
      const status = mcpStore.getStatus(row.id) ?? 'disconnected'
      return h(NTag, { type: statusTagType[status] ?? 'default', size: 'small' }, {
        default: () => statusLabels[status] ?? '未知',
      })
    },
  },
  {
    title: '启用',
    key: 'enabled',
    width: 80,
    render(row) {
      return h(NSwitch, {
        value: row.enabled,
        size: 'small',
        onUpdateValue: (val: boolean) => {
          void handleToggle(row.id, val)
        },
      })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render(row) {
      return h(NSpace, { size: 4 }, {
        default: () => [
          h(
            NButton,
            { size: 'small', quaternary: true, onClick: () => openEditModal(row) },
            { icon: () => h(NIcon, null, { default: () => h(EditOutlined) }) },
          ),
          h(
            NPopconfirm,
            { onPositiveClick: () => handleDelete(row.id) },
            {
              trigger: () =>
                h(
                  NButton,
                  { size: 'small', quaternary: true, type: 'error' },
                  { icon: () => h(NIcon, null, { default: () => h(DeleteOutlined) }) },
                ),
              default: () => `确定删除服务器 "${row.name}" 吗？`,
            },
          ),
        ]
      })
    },
  },
])
</script>

<template>
  <div class="mcp-config">
    <!-- 操作栏 -->
    <div class="mcp-config__toolbar">
      <NSpace>
        <NButton type="primary" size="small" @click="openAddModal">
          <template #icon>
            <NIcon><AddOutlined /></NIcon>
          </template>
          添加服务器
        </NButton>
        <NButton quaternary size="small" @click="handleRefresh">
          <template #icon>
            <NIcon><RefreshOutlined /></NIcon>
          </template>
          刷新
        </NButton>
      </NSpace>
    </div>

    <!-- 服务器列表 -->
    <NDataTable
      :columns="columns"
      :data="mcpStore.servers"
      :loading="mcpStore.loading"
      :bordered="false"
      size="small"
      :row-key="(row: MCPServerConfig) => row.id"
    />

    <!-- 添加/编辑服务器弹窗 -->
    <NModal
      v-model:show="modalVisible"
      preset="card"
      :title="modalTitle"
      style="width: 520px"
      :mask-closable="false"
    >
      <NForm label-placement="top" size="small">
        <NFormItem label="名称" required>
          <NInput v-model:value="form.name" placeholder="例如：filesystem-server" />
        </NFormItem>

        <NFormItem label="传输方式" required>
          <NSelect v-model:value="form.transport" :options="transportOptions" />
        </NFormItem>

        <template v-if="form.transport === 'stdio'">
          <NFormItem label="命令" required>
            <NInput v-model:value="form.command" placeholder="例如：npx 或 node" />
          </NFormItem>
          <NFormItem label="参数">
            <NInput
              v-model:value="form.args"
              placeholder="空格分隔，例如：-y @modelcontextprotocol/server-filesystem /tmp"
            />
          </NFormItem>
        </template>

        <template v-else>
          <NFormItem label="URL" required>
            <NInput v-model:value="form.url" placeholder="例如：http://localhost:3000/mcp" />
          </NFormItem>
        </template>

        <NFormItem label="环境变量">
          <NInput
            v-model:value="form.envText"
            type="textarea"
            placeholder="每行一个，格式 KEY=VALUE&#10;# 注释行会被忽略"
            :rows="3"
          />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton size="small" @click="modalVisible = false">取消</NButton>
          <NButton type="primary" size="small" :loading="saving" @click="handleSave">
            {{ editingId ? '保存' : '添加' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.mcp-config {
  width: 100%;
}

.mcp-config__toolbar {
  margin-bottom: 16px;
}
</style>