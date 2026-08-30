// WS-05: Workspace store - manages file tree state and file preview.
// Wraps the electron.workspace IPC API and exposes reactive state.

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FileTreeNode, WorkspaceDirectoryEntry } from '@shared/types'
import { useSettingsStore } from './settings'

/** Text file extensions that can be previewed */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'xml', 'html', 'htm',
  'css', 'scss', 'less', 'js', 'ts', 'tsx', 'jsx', 'vue', 'py', 'rb',
  'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp', 'cs',
  'php', 'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'gql',
  'toml', 'ini', 'cfg', 'conf', 'env', 'gitignore', 'dockerignore',
  'csv', 'tsv', 'log', 'diff', 'patch', 'svg', 'vue',
])

/** Maximum file size for text preview (1MB) */
const MAX_PREVIEW_SIZE = 1024 * 1024

/**
 * viewer 模式扩展名集合。这些格式由 File Viewer 渲染：
 * - 办公文档（@file-viewer/preset-office）
 * - 图片 / 音频 / 视频（@file-viewer/preset-lite）
 * 优先使用 agentfile:// 协议流式加载，不经过文本读取。
 */
const VIEWER_EXTENSIONS = new Set([
  // PDF / OFD
  'pdf', 'ofd',
  // Word
  'docx', 'doc', 'rtf', 'odt', 'wps',
  // Excel
  'xlsx', 'xls', 'xlsm', 'ods', 'csv', 'et',
  // PowerPoint
  'pptx', 'ppt', 'pps', 'ppsx', 'odp', 'dps',
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
  // 音频
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  // 视频
  'mp4', 'webm', 'mov', 'mkv', 'avi',
])

/**
 * 可渲染预览（源码 + 渲染效果双视图）的扩展名集合。
 * 这些文件默认以 text 模式读取，同时支持在 FilePreviewPanel 中切换为渲染视图：
 * - md/markdown → MarkdownRenderer（marked + mermaid）
 * - html/htm    → webview 加载 agentfile:// URL
 * - svg         → <img> 显示
 */
const RENDERABLE_EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'svg'])

/** 预览模式：使用 File Viewer 渲染办公文档，还是回退文本预览 */
export type PreviewMode = 'viewer' | 'text' | 'none'

/**
 * 判断文件应使用哪种预览模式。
 * 独立纯函数，便于单元测试。
 */
export function getPreviewMode(
  relativePath: string,
  filename: string,
  size: number,
): PreviewMode {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  // 办公文档 / 图片 / 音视频 → File Viewer
  if (VIEWER_EXTENSIONS.has(ext)) return 'viewer'

  // 文本/代码 → 文本预览
  if (TEXT_EXTENSIONS.has(ext)) return 'text'

  // 超出文本预览大小时，非文本格式回退：超大文件直接给 none
  if (size > MAX_PREVIEW_SIZE) return 'none'

  return 'none'
}

/**
 * 判断文件是否支持渲染视图（md / html / svg 等源码 + 渲染双视图）。
 * 独立纯函数，便于单元测试。
 */
export function isRenderablePreview(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return RENDERABLE_EXTENSIONS.has(ext)
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const settingsStore = useSettingsStore()

  // ─── State ───────────────────────────────────────────────────

  /** Root file tree node (null if not loaded) */
  const rootNode = ref<FileTreeNode | null>(null)

  /** Whether the tree is currently loading */
  const treeLoading = ref(false)

  /** Currently expanded directory paths (Set of relative paths) */
  const expandedDirs = ref<Set<string>>(new Set())

  /** Lazy-loaded children cache: relativePath -> FileTreeNode[] */
  const childrenCache = ref<Map<string, FileTreeNode[]>>(new Map())

  /** Currently previewed file path */
  const previewPath = ref<string | null>(null)

  /** Previewed file content */
  const previewContent = ref<string>('')

  /** Whether preview is loading */
  const previewLoading = ref(false)

  /** Preview error message (null if no error) */
  const previewError = ref<string | null>(null)

  /** 预览模式：'viewer'(File Viewer) / 'text'(文本) / 'none'(无) */
  const previewMode = ref<PreviewMode>('none')

  /** 当前预览文件的 agentfile:// URL（viewer 模式 / 可渲染文件的 webview、img 加载使用） */
  const previewFileUrl = ref<string | null>(null)

  /** 当前预览文件名（供 File Viewer 显示） */
  const previewFilename = ref<string>('')

  /** 当前预览文件是否支持渲染视图（md/html/svg，源码 + 渲染双视图） */
  const previewRenderable = ref(false)

  /** Search query for filtering file tree */
  const searchQuery = ref('')

  // ─── Computed ────────────────────────────────────────────────

  /** Whether a workspace path is set */
  const isWorkspaceSet = ref<boolean>(false)

  /**
   * Filter file tree nodes by search query.
   * Returns nodes whose name contains the query (case-insensitive).
   * If query is empty, returns the original root node.
   */
  const filteredRootNode = computed<FileTreeNode | null>(() => {
    if (!searchQuery.value.trim() || !rootNode.value) {
      return rootNode.value
    }
    const query = searchQuery.value.toLowerCase().trim()
    return filterNode(rootNode.value, query)
  })

  /**
   * Recursively filter a node and its children by name query.
   * A node is kept if its name matches or any of its descendants match.
   */
  function filterNode(node: FileTreeNode, query: string): FileTreeNode | null {
    const nameMatch = node.name.toLowerCase().includes(query)

    if (!node.isDirectory || !node.children) {
      return nameMatch ? node : null
    }

    const filteredChildren: FileTreeNode[] = []
    for (const child of node.children) {
      const filtered = filterNode(child, query)
      if (filtered) {
        filteredChildren.push(filtered)
      }
    }

    if (nameMatch || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      }
    }

    return null
  }

  // ─── Actions ─────────────────────────────────────────────────

  /**
   * Check if workspace is configured by loading settings.
   */
  async function checkWorkspace(): Promise<void> {
    if (!settingsStore.settings) {
      await settingsStore.loadSettings()
    }
    isWorkspaceSet.value = settingsStore.settings?.workspace?.path != null
  }

  /**
   * Load the root file tree (depth 1 for lazy loading).
   */
  async function loadTree(): Promise<void> {
    await checkWorkspace()
    if (!isWorkspaceSet.value) {
      rootNode.value = null
      return
    }

    treeLoading.value = true
    try {
      rootNode.value = await window.electron.workspace.tree(undefined, 1)
      // Root is always expanded
      expandedDirs.value.add('')
    } catch {
      rootNode.value = null
    } finally {
      treeLoading.value = false
    }
  }

  /**
   * Load children of a directory node (lazy loading).
   * OPT2-27: 实现真正的缓存逻辑，优先从缓存读取。
   * @param node - the directory node to expand
   */
  async function loadChildren(node: FileTreeNode): Promise<void> {
    if (node.children !== null) {
      // Already loaded, just toggle expansion
      return
    }

    const cached = childrenCache.value.get(node.relativePath)
    if (cached) {
      // 使用缓存
      node.children = cached
      return
    }

    try {
      const entries = await window.electron.workspace.list(node.relativePath)
      const children: FileTreeNode[] = entries.map((entry: WorkspaceDirectoryEntry) => ({
        id: entry.name === '' ? node.relativePath : `${node.relativePath}/${entry.name}`,
        name: entry.name,
        relativePath: entry.name === '' ? node.relativePath : `${node.relativePath}/${entry.name}`.replace(/^\/+/, ''),
        isDirectory: entry.isDirectory,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        children: null,
      }))

      // Update the node's children
      node.children = children
      childrenCache.value.set(node.relativePath, children)
    } catch {
      // Silently fail - node stays with null children
    }
  }

  /**
   * Toggle expansion of a directory node.
   * Loads children lazily if not yet loaded.
   */
  async function toggleExpand(node: FileTreeNode): Promise<void> {
    if (!node.isDirectory) return

    const path = node.relativePath
    if (expandedDirs.value.has(path)) {
      expandedDirs.value.delete(path)
    } else {
      expandedDirs.value.add(path)
      await loadChildren(node)
    }
  }

  /**
   * Check if a directory node is currently expanded.
   */
  function isExpanded(relativePath: string): boolean {
    return expandedDirs.value.has(relativePath)
  }

  /**
   * Preview a file's content.
   * - 办公文档（viewer 模式）：构建 agentfile:// URL，由 FileViewer 组件流式渲染
   * - 文本/代码（text 模式）：读取内容并展示
   * - 其他：提示不支持
   * @param node - the file node to preview
   */
  async function previewFile(node: FileTreeNode): Promise<void> {
    if (node.isDirectory) return

    const mode = getPreviewMode(node.relativePath, node.name, node.size)

    // 重置前置状态
    previewPath.value = node.relativePath
    previewFilename.value = node.name
    previewContent.value = ''
    previewError.value = null
    previewLoading.value = false
    previewMode.value = mode
    previewFileUrl.value = null
    previewRenderable.value = isRenderablePreview(node.name)

    // viewer 模式：直接构建 URL，交给 FileViewer 加载（无需 IPC 读取全文）
    if (mode === 'viewer') {
      previewFileUrl.value = window.electron.workspace.buildFileUrl(node.relativePath)
      return
    }

    // text 模式：检查大小限制后读取
    if (mode === 'text') {
      // 可渲染文件（html/svg）需要 agentfile:// URL 供 webview / <img> 加载渲染视图
      if (previewRenderable.value) {
        previewFileUrl.value = window.electron.workspace.buildFileUrl(node.relativePath)
      }
      if (node.size > MAX_PREVIEW_SIZE) {
        previewError.value = `文件过大（${(node.size / 1024 / 1024).toFixed(2)} MB），不支持预览（最大 1MB）`
        return
      }
      previewLoading.value = true
      try {
        previewContent.value = await window.electron.workspace.read(node.relativePath)
      } catch (error) {
        previewContent.value = ''
        previewError.value = error instanceof Error ? error.message : String(error)
      } finally {
        previewLoading.value = false
      }
      return
    }

    // none 模式：提示不支持预览
    previewError.value = '不支持预览此文件类型'
  }

  /**
   * Close the file preview.
   */
  function closePreview(): void {
    previewPath.value = null
    previewFilename.value = ''
    previewContent.value = ''
    previewError.value = null
    previewMode.value = 'none'
    previewFileUrl.value = null
  }

  /**
   * Refresh the file tree (reload from root).
   */
  async function refreshTree(): Promise<void> {
    expandedDirs.value.clear()
    childrenCache.value.clear()
    await loadTree()
  }

  return {
    // State
    rootNode,
    treeLoading,
    expandedDirs,
    previewPath,
    previewContent,
    previewLoading,
    previewError,
    previewMode,
    previewFileUrl,
    previewFilename,
    previewRenderable,
    isWorkspaceSet,
    searchQuery,
    // Computed
    filteredRootNode,
    // Actions
    checkWorkspace,
    loadTree,
    loadChildren,
    toggleExpand,
    isExpanded,
    previewFile,
    closePreview,
    refreshTree,
  }
})
