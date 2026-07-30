// AgentForge WS-03: Workspace 文件操作 IPC Handlers
// 实现工作区内文件的读写、列表、创建、删除、重命名等操作
// 通道命名: ws:read, ws:write, ws:list, ws:mkdir, ws:delete, ws:rename, ws:tree
//
// 架构优化批次B-2: 业务逻辑已移至 WorkspaceService（services/workspace-service.ts）。
// 本文件仅保留 IPC handler 注册和参数校验，文件操作委托给服务层。

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { FileTreeNode, WorkspaceDirectoryEntry } from '@shared/types'
import {
  createValidatedHandler,
  validateNonEmptyString,
  validateOptionalNumber,
  validateOptionalString,
  validateString,
} from '../utils/ipc-validator'
import { getWorkspaceService } from '../services/workspace-service'

// ─── 向后兼容的重导出 ───────────────────────────────────────────
// 其他模块（project-rules, wiki-manager, checkpoint, tools/*）从此处导入
// getWorkspacePath。保持导出以避免破坏现有引用。

export function getWorkspacePath(): string {
  return getWorkspaceService().getPath()
}

// ─── 文件操作处理函数（委托给 WorkspaceService） ──────────────

/**
 * 读取工作区内文件内容。
 * @param relativePath - 相对于工作区根的路径
 * @returns 文件内容字符串
 */
export async function handleWsRead(relativePath: string): Promise<string> {
  const path = validateNonEmptyString(relativePath, 'path')
  return getWorkspaceService().readFile(path)
}

/**
 * 写入/创建工作区内文件，自动创建父目录。
 * @param relativePath - 相对于工作区根的路径
 * @param content - 文件内容
 * @returns 写入字节数
 */
export async function handleWsWrite(relativePath: string, content: string): Promise<number> {
  const path = validateNonEmptyString(relativePath, 'path')
  const validatedContent = validateString(content, 'content')
  return getWorkspaceService().writeFile(path, validatedContent)
}

/**
 * 列出工作区内指定目录的条目。
 * @param relativePath - 相对于工作区根的路径（默认为根目录）
 * @returns 目录条目列表
 */
export async function handleWsList(relativePath?: string): Promise<WorkspaceDirectoryEntry[]> {
  const path = validateOptionalString(relativePath, 'path')
  return getWorkspaceService().listDirectory(path)
}

/**
 * 在工作区内创建目录（支持递归创建）。
 * @param relativePath - 相对于工作区根的路径
 */
export async function handleWsMkdir(relativePath: string): Promise<void> {
  const path = validateNonEmptyString(relativePath, 'path')
  return getWorkspaceService().makeDirectory(path)
}

/**
 * 删除工作区内的文件或空目录。
 * 不递归删除非空目录。
 * @param relativePath - 相对于工作区根的路径
 */
export async function handleWsDelete(relativePath: string): Promise<void> {
  const path = validateNonEmptyString(relativePath, 'path')
  return getWorkspaceService().delete(path)
}

/**
 * 重命名/移动工作区内的文件或目录。
 * @param from - 源路径（相对路径）
 * @param to - 目标路径（相对路径）
 */
export async function handleWsRename(from: string, to: string): Promise<void> {
  const fromPath = validateNonEmptyString(from, 'from')
  const toPath = validateNonEmptyString(to, 'to')
  return getWorkspaceService().rename(fromPath, toPath)
}

/**
 * 获取工作区文件树结构。
 * @param relativePath - 起始路径（默认为根目录）
 * @param maxDepth - 最大递归深度（默认 5）
 * @returns 文件树根节点
 */
export async function handleWsTree(
  relativePath?: string,
  maxDepth?: number,
): Promise<FileTreeNode> {
  const path = validateOptionalString(relativePath, 'path')
  const depth = validateOptionalNumber(maxDepth, 'maxDepth')
  return getWorkspaceService().getTree(path, depth)
}

// ─── IPC 通道注册 ───────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'ws:read',
    handler: createValidatedHandler(
      (p) => ({ path: validateNonEmptyString(p['path'], 'path') }),
      ({ path }) => handleWsRead(path),
    ),
  },
  {
    channel: 'ws:write',
    handler: createValidatedHandler(
      (p) => ({
        path: validateNonEmptyString(p['path'], 'path'),
        content: validateString(p['content'], 'content'),
      }),
      ({ path, content }) => handleWsWrite(path, content),
    ),
  },
  // ws:list / ws:tree 的 params 在 preload 中可能为 undefined（未传 path 时），
  // createValidatedHandler 会对 undefined 抛错，因此这里保留箭头函数形式，
  // 改用集中式校验器对可选字段做运行时校验。
  {
    channel: 'ws:list',
    handler: (_event, ...args) => {
      const params = args[0]
      const path =
        params === undefined || params === null
          ? undefined
          : validateOptionalString((params as Record<string, unknown>)['path'], 'path')
      return handleWsList(path)
    },
  },
  {
    channel: 'ws:mkdir',
    handler: createValidatedHandler(
      (p) => ({ path: validateNonEmptyString(p['path'], 'path') }),
      ({ path }) => handleWsMkdir(path),
    ),
  },
  {
    channel: 'ws:delete',
    handler: createValidatedHandler(
      (p) => ({ path: validateNonEmptyString(p['path'], 'path') }),
      ({ path }) => handleWsDelete(path),
    ),
  },
  {
    channel: 'ws:rename',
    handler: createValidatedHandler(
      (p) => ({
        from: validateNonEmptyString(p['from'], 'from'),
        to: validateNonEmptyString(p['to'], 'to'),
      }),
      ({ from, to }) => handleWsRename(from, to),
    ),
  },
  {
    channel: 'ws:tree',
    handler: (_event, ...args) => {
      const params = args[0]
      const obj =
        params === undefined || params === null
          ? undefined
          : (params as Record<string, unknown>)
      const path = obj ? validateOptionalString(obj['path'], 'path') : undefined
      const maxDepth = obj ? validateOptionalNumber(obj['maxDepth'], 'maxDepth') : undefined
      return handleWsTree(path, maxDepth)
    },
  },
]

/**
 * 注册 Workspace 域的所有 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerWorkspaceHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
