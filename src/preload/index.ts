import { contextBridge, ipcRenderer } from 'electron'

// ─── 事件监听辅助函数 ──────────────────────────────────────────
// 返回 cleanup 函数，与 Spec v0.2 §7.7 一致

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: unknown, data: T): void => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// ─── Chat 命名空间 ──────────────────────────────────────────────

const chat = {
  createConversation: (params: {
    title?: string
    modelId: string
    approvalMode?: string
  }): Promise<unknown> => ipcRenderer.invoke('chat:create-conversation', params),

  listConversations: (): Promise<unknown[]> => ipcRenderer.invoke('chat:list-conversations'),

  getConversation: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('chat:get-conversation', { id }),

  deleteConversation: (id: string): Promise<void> =>
    ipcRenderer.invoke('chat:delete-conversation', { id }),

  getMessages: (conversationId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('chat:get-messages', { conversationId }),

  send: (conversationId: string, content: string, modelId: string): Promise<void> =>
    ipcRenderer.invoke('chat:send', { conversationId, content, modelId }),

  stop: (): Promise<void> => ipcRenderer.invoke('chat:stop'),

  onStreamChunk: (callback: (chunk: unknown) => void): (() => void) =>
    onEvent('chat:stream-chunk', callback),

  onStreamEnd: (callback: (meta: unknown) => void): (() => void) =>
    onEvent('chat:stream-end', callback),

  onStreamError: (callback: (error: unknown) => void): (() => void) =>
    onEvent('chat:stream-error', callback),
}

// ─── Model 命名空间 ─────────────────────────────────────────────

const model = {
  list: (): Promise<unknown[]> => ipcRenderer.invoke('model:list'),

  create: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('model:create', params),

  update: (params: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('model:update', params),

  delete: (id: string): Promise<void> => ipcRenderer.invoke('model:delete', { id }),

  test: (id: string): Promise<unknown> => ipcRenderer.invoke('model:test', { id }),

  get: (id: string): Promise<unknown> => ipcRenderer.invoke('model:get', { id }),
}

// ─── Settings 命名空间 ───────────────────────────────────────────

const settings = {
  get: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),

  update: (params: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('settings:update', params),
}

// ─── File 命名空间 ───────────────────────────────────────────────

const file = {
  selectDir: (params?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('file:select-dir', params ?? {}),

  selectFile: (params?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('file:select-file', params ?? {}),
}

// ─── System 命名空间 ─────────────────────────────────────────────

const system = {
  getVersion: (): Promise<unknown> => ipcRenderer.invoke('system:get-version'),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:open-external', { url }),
}

// ─── Agent 命名空间 (P2-04) ─────────────────────────────────────

const agent = {
  execute: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('agent:execute', params),

  stop: (): Promise<void> => ipcRenderer.invoke('agent:stop'),

  approve: (params: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('agent:approve', params),

  onTrajectory: (callback: (data: unknown) => void): (() => void) =>
    onEvent('agent:trajectory', callback),

  onApprovalRequest: (callback: (data: unknown) => void): (() => void) =>
    onEvent('agent:approval-request', callback),

  onStreamChunk: (callback: (data: unknown) => void): (() => void) =>
    onEvent('agent:stream-chunk', callback),
}

// ─── MCP 命名空间 (P2-08) ───────────────────────────────────────

const mcp = {
  add: (params: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke('mcp:add', params),

  remove: (id: string): Promise<void> => ipcRenderer.invoke('mcp:remove', { id }),

  list: (): Promise<unknown[]> => ipcRenderer.invoke('mcp:list'),

  getStatus: (id: string): Promise<unknown> => ipcRenderer.invoke('mcp:get-status', { id }),

  toggleEnable: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('mcp:toggle-enable', { id, enabled }),
}

// ─── Skill 命名空间 (P3-02) ─────────────────────────────────────

const skill = {
  list: (params?: Record<string, unknown>): Promise<unknown[]> =>
    ipcRenderer.invoke('skill:list', params ?? {}),

  get: (id: string): Promise<unknown> => ipcRenderer.invoke('skill:get', { id }),

  getByName: (name: string): Promise<unknown> => ipcRenderer.invoke('skill:getByName', { name }),

  create: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('skill:create', params),

  update: (params: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('skill:update', params),

  delete: (id: string): Promise<void> => ipcRenderer.invoke('skill:delete', { id }),
}

// ─── Knowledge Base 命名空间 (P5-01) ─────────────────────────────

const kb = {
  import: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('kb:import', params),

  list: (params?: Record<string, unknown>): Promise<unknown[]> =>
    ipcRenderer.invoke('kb:list', params ?? {}),

  get: (id: string): Promise<unknown> => ipcRenderer.invoke('kb:get', { id }),

  delete: (id: string): Promise<void> => ipcRenderer.invoke('kb:delete', { id }),

  reimport: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('kb:reimport', params),

  search: (params: Record<string, unknown>): Promise<unknown[]> =>
    ipcRenderer.invoke('kb:search', params),

  index: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('kb:index', params),

  reindex: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('kb:reindex', params),

  stats: (): Promise<unknown> => ipcRenderer.invoke('kb:stats'),
}

// ─── 暴露到渲染进程 ─────────────────────────────────────────────
// 与 Spec v0.2 §15.2 一致：渲染进程不直接访问 Node.js

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      chat,
      model,
      settings,
      file,
      system,
      agent,
      mcp,
      skill,
      kb,
    })
  } catch (error) {
    console.error('[AgentForge Preload] contextBridge.exposeInMainWorld failed:', error)
  }
} else {
  console.error('[AgentForge Preload] contextIsolation is disabled, skipping bridge setup')
}
