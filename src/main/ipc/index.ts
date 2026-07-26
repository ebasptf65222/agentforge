// AgentForge IPC Handlers 注册入口
// 聚合所有域的 IPC handler 注册函数
// 在 app.whenReady() 后调用 registerIpcHandlers()

import { registerModelHandlers } from './model'
import { registerChatHandlers } from './chat'
import { registerSettingsHandlers } from './settings'
import { registerFileHandlers } from './file'
import { registerSystemHandlers } from './system'
import { registerMcpHandlers } from './mcp'
import { registerAgentHandlers } from './agent'
import { registerSkillHandlers } from './skill'

/**
 * 注册所有 IPC handlers。
 * 应在 app.whenReady() 之后、createWindow() 之前调用。
 * 各域的注册函数内部保证幂等。
 */
export function registerIpcHandlers(): void {
  // ─── Model 域 (P1-06) ───────────────────────────────────────────
  registerModelHandlers()

  // ─── Chat 域 (P1-08 + P1-09a) ───────────────────────────────────
  registerChatHandlers()

  // ─── Settings 域 (P1-09b) ───────────────────────────────────────
  registerSettingsHandlers()

  // ─── File 域 (P1-09b) ──────────────────────────────────────────
  registerFileHandlers()

  // ─── System 域 (P1-09b) ────────────────────────────────────────
  registerSystemHandlers()

  // ─── MCP 域 (P2-07/P2-08) ──────────────────────────────────────
  registerMcpHandlers()

  // ─── Agent 域 (P2-04) ──────────────────────────────────────────
  registerAgentHandlers()

  // ─── Skill 域 (P3-02) ──────────────────────────────────────────
  registerSkillHandlers()
}
