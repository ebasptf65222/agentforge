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

/** Maximum file size for preview (1MB) */
const MAX_PREVIEW_SIZE = 1024 * 1024

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
   * @param node - the file node to preview
   */
  async function previewFile(node: FileTreeNode): Promise<void> {
    if (node.isDirectory) return

    // Check file extension
    const ext = node.name.split('.').pop()?.toLowerCase() ?? ''
    if (!TEXT_EXTENSIONS.has(ext)) {
      previewPath.value = node.relativePath
      previewContent.value = ''
      previewError.value = '不支持预览此文件类型'
      return
    }

    // Check file size
    if (node.size > MAX_PREVIEW_SIZE) {
      previewPath.value = node.relativePath
      previewContent.value = ''
      previewError.value = `文件过大（${(node.size / 1024 / 1024).toFixed(2)} MB），不支持预览（最大 1MB）`
      return
    }

    previewLoading.value = true
    previewError.value = null
    previewPath.value = node.relativePath

    try {
      previewContent.value = await window.electron.workspace.read(node.relativePath)
    } catch (error) {
      previewContent.value = ''
      previewError.value = error instanceof Error ? error.message : String(error)
    } finally {
      previewLoading.value = false
    }
  }

  /**
   * Close the file preview.
   */
  function closePreview(): void {
    previewPath.value = null
    previewContent.value = ''
    previewError.value = null
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
