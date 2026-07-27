// AgentForge LLM Wiki IPC Handlers
// 连接渲染进程 WikiView 与主进程 wiki-manager
// 通道命名: wiki:status, wiki:init

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { WikiStatus } from '@shared/types'
import {
  initWikiWorkspace,
  isWikiInitialized,
  getWikiStats,
  listWikiPages,
  listRawSources,
  readRecentLogs,
  addRawSource,
  appendLog,
} from '../wiki/wiki-manager'

// ─── Handler 函数 ───────────────────────────────────────────────

/**
 * 获取 Wiki 当前状态（用于 UI 展示）。
 */
async function handleWikiStatus(): Promise<WikiStatus> {
  const initialized = await isWikiInitialized()

  if (!initialized) {
    return {
      initialized: false,
      rawCount: 0,
      pageCount: 0,
      lastIngest: null,
      lastLint: null,
      pages: [],
      rawFiles: [],
      recentLogs: '',
    }
  }

  const [stats, pages, rawFiles, recentLogs] = await Promise.all([
    getWikiStats(),
    listWikiPages(),
    listRawSources(),
    readRecentLogs(10),
  ])

  return {
    initialized: true,
    rawCount: stats.rawCount,
    pageCount: stats.wikiPageCount,
    lastIngest: stats.lastIngest,
    lastLint: stats.lastLint,
    pages: pages.map((p) => ({
      title: p.title,
      path: p.path,
      summary: p.summary,
    })),
    rawFiles,
    recentLogs,
  }
}

/**
 * 初始化 Wiki 工作区结构。
 * 在工作区下创建 .llm-wiki/ 目录结构。
 */
async function handleWikiInit(): Promise<{ success: boolean }> {
  await initWikiWorkspace()
  return { success: true }
}

/**
 * 将文件添加到 raw/ 目录（从 UI 上传的便捷入口）。
 * @param sourcePath - 源文件绝对路径
 * @returns raw/ 中的相对路径
 */
async function handleWikiIngest(sourcePath: string): Promise<{ rawRelPath: string; fileName: string }> {
  if (!(await isWikiInitialized())) {
    await initWikiWorkspace()
  }
  const rawRelPath = await addRawSource(sourcePath)
  const fileName = rawRelPath.replace(/^raw\//, '')
  await appendLog('ingest', `通过 UI 上传原始资料: ${fileName}`)
  return { rawRelPath, fileName }
}

// ─── IPC 通道注册 ───────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'wiki:status',
    handler: () => handleWikiStatus(),
  },
  {
    channel: 'wiki:init',
    handler: () => handleWikiInit(),
  },
  {
    channel: 'wiki:ingest',
    handler: (_event, params: { sourcePath: string }) => handleWikiIngest(params.sourcePath),
  },
]

/**
 * 注册所有 Wiki IPC handlers。
 * 幂等：多次调用安全。
 */
export function registerWikiHandlers(): void {
  for (const { channel, handler } of registrations) {
    // 移除旧 handler 后重新注册，保证幂等
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}