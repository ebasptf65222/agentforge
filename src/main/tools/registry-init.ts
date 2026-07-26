// AgentForge P2-05: 内置工具注册入口
// 将所有内置工具注册到全局 ToolRegistry

import { getToolRegistry } from './registry'
import { webSearchTool } from './web-search'
import { webScrapeTool } from './web-scrape'
import { fileReadTool } from './file-read'
import { fileWriteTool } from './file-write'
import { directoryListTool } from './directory-list'
import { kbSearchTool } from './kb-search'

/**
 * 初始化并注册所有内置工具到全局 ToolRegistry。
 * 幂等：重复调用会覆盖同名工具（Map.set 语义）。
 */
export function initBuiltinTools(): void {
  const registry = getToolRegistry()
  registry.registerBuiltin(webSearchTool)
  registry.registerBuiltin(webScrapeTool)
  registry.registerBuiltin(fileReadTool)
  registry.registerBuiltin(fileWriteTool)
  registry.registerBuiltin(directoryListTool)
  registry.registerBuiltin(kbSearchTool)
}
