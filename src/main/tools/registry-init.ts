// AgentForge P2-05: 内置工具注册入口
// 将所有内置工具注册到全局 ToolRegistry

import { getToolRegistry } from './registry'
import { webSearchTool } from './web-search'
import { webScrapeTool } from './web-scrape'
import { fileReadTool } from './file-read'
import { fileWriteTool } from './file-write'
import { terminalExecTool } from './terminal-exec'
import { directoryListTool } from './directory-list'
import { kbSearchTool } from './kb-search'
import { kgExtractTool } from './kg-extract'
import { kgQueryTool } from './kg-query'
import { allWsTools } from './ws-tools'
import { wikiIngestTool } from './wiki-ingest'
import { wikiQueryTool } from './wiki-query'
import { wikiLintTool } from './wiki-lint'

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
  // 注册终端命令执行工具（高风险，需要审批）
  registry.registerBuiltin(terminalExecTool)
  registry.registerBuiltin(directoryListTool)
  registry.registerBuiltin(kbSearchTool)
  registry.registerBuiltin(kgExtractTool)
  registry.registerBuiltin(kgQueryTool)

  // 注册 LLM Wiki 工具（Karpathy 模式）
  registry.registerBuiltin(wikiIngestTool)
  registry.registerBuiltin(wikiQueryTool)
  registry.registerBuiltin(wikiLintTool)

  // 注册所有 ws_* 工作区工具
  for (const tool of allWsTools) {
    registry.registerBuiltin(tool)
  }
}
