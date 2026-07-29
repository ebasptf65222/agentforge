// AgentForge LangGraph 引擎: StateGraph 构建
//
// Phase 1: 简单 ReAct 循环（不使用 StateGraph）
//   由于 LangChain.js 的 createAgent 需要 BaseChatModel 实例，
//   而我们用 ModelWrapper（不继承 BaseChatModel），
//   所以 Phase 1 直接在 react-loop.ts 中实现简单的 ReAct 循环。
//
// Phase 2: 迁移到显式 StateGraph + interrupt
//   使用 LangGraph 的 StateGraph 构建 agent 循环图，
//   包含 agent（调用 LLM）和 tools（执行工具）两个节点，
//   审批通过 interrupt() 暂停/恢复。

// Phase 1: 简单 ReAct 循环（保留作为回退方案）
export { createReactLoop } from './react-loop'

// Phase 2: 显式 StateGraph + interrupt 审批 Gate
export { executeWithStateGraph } from './state-graph'
export type { StateGraphOptions } from './state-graph'

// Phase 2: MCP 适配器迁移
export {
  loadMcpToolsAsLangChain,
  convertAllLangChainTools,
  closeMcpClient,
  convertLangChainToolToWrapped,
} from './mcp-adapter'

// Phase 2: Copilot SDK 编码节点
export {
  createCodingNodeTool,
  createWrappedCodingNode,
  getCodingNodeTool,
  resetCodingNode,
} from './coding-node'
export type { CodingNodeOptions } from './coding-node'

// Phase 2: Memory Store
export { MemoryStore, getMemoryStore, resetMemoryStore } from './memory-store'
export type { MemoryEntry, MemoryStoreConfig } from './memory-store'
