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

  updateTitle: (id: string, title: string): Promise<unknown> =>
    ipcRenderer.invoke('chat:update-title', { id, title }),

  getMessages: (conversationId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('chat:get-messages', { conversationId }),

  clearConversation: (id: string): Promise<void> =>
    ipcRenderer.invoke('chat:clear-conversation', { id }),

  searchConversations: (keyword: string): Promise<unknown[]> =>
    ipcRenderer.invoke('chat:search-conversations', { keyword }),

  send: (conversationId: string, content: string, modelId: string, kbEnabled?: boolean): Promise<void> =>
    ipcRenderer.invoke('chat:send', { conversationId, content, modelId, kbEnabled }),

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

  // OPT2-12: 原子更新，替代先删后增
  update: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('mcp:update', params),

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

// ─── Voice 命名空间 (TTS + STT) ────────────────────────────────

const voice = {
  // TTS
  synthesize: (text: string, options?: unknown): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('voice:tts-synthesize', { text, options }),

  testTts: (config: unknown): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('voice:tts-test', { config }),

  // STT
  transcribe: (audioBuffer: ArrayBuffer, options?: unknown): Promise<string> =>
    ipcRenderer.invoke('voice:stt-transcribe', { audioBuffer, options }),

  testStt: (config: unknown, audioBuffer?: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('voice:stt-test', { config, audioBuffer }),
}

// ─── Window 命名空间 (自定义菜单/窗口控制) ──────────────────────

const win = {
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: (): Promise<void> => ipcRenderer.invoke('window:maximize-toggle'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  toggleDevtools: (): Promise<void> => ipcRenderer.invoke('window:toggle-devtools'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) =>
    onEvent<{ maximized: boolean }>('window:maximize-state-changed', (data) =>
      callback(data.maximized),
    ),
}

// ─── Workspace 命名空间 (本地文件工作区) ──────────────────────

const workspace = {
  read: (path: string): Promise<string> =>
    ipcRenderer.invoke('ws:read', { path }),

  write: (path: string, content: string): Promise<number> =>
    ipcRenderer.invoke('ws:write', { path, content }),

  list: (path?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('ws:list', path !== undefined ? { path } : undefined),

  mkdir: (path: string): Promise<void> =>
    ipcRenderer.invoke('ws:mkdir', { path }),

  delete: (path: string): Promise<void> =>
    ipcRenderer.invoke('ws:delete', { path }),

  rename: (from: string, to: string): Promise<void> =>
    ipcRenderer.invoke('ws:rename', { from, to }),

  tree: (path?: string, maxDepth?: number): Promise<unknown> =>
    ipcRenderer.invoke('ws:tree', { path, maxDepth }),
}

// ─── Wiki 命名空间 (LLM Wiki / Karpathy 模式) ─────────────────

const wiki = {
  status: (): Promise<unknown> => ipcRenderer.invoke('wiki:status'),
  init: (): Promise<unknown> => ipcRenderer.invoke('wiki:init'),
  ingest: (sourcePath: string): Promise<unknown> =>
    ipcRenderer.invoke('wiki:ingest', { sourcePath }),
}

// ─── Audit 命名空间 (工作流审计) ──────────────────────────────

const audit = {
  run: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('audit:run', params),

  onReport: (callback: (data: unknown) => void): (() => void) =>
    onEvent('audit:report', callback),
}

// ─── Prompt Template 命名空间 (Prompt 模板库) ─────────────────

const promptTemplate = {
  list: (params?: Record<string, unknown>): Promise<unknown[]> =>
    ipcRenderer.invoke('prompt-template:list', params ?? {}),

  get: (id: string): Promise<unknown> => ipcRenderer.invoke('prompt-template:get', { id }),

  create: (params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('prompt-template:create', params),

  update: (id: string, data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('prompt-template:update', { id, ...data }),

  delete: (id: string): Promise<void> => ipcRenderer.invoke('prompt-template:delete', { id }),
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
      voice,
      window: win,
      workspace,
      wiki,
      audit,
      promptTemplate,
    })
  } catch (error) {
    console.error('[AgentForge Preload] contextBridge.exposeInMainWorld failed:', error)
  }
} else {
  console.error('[AgentForge Preload] contextIsolation is disabled, skipping bridge setup')
}
