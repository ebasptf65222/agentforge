// AgentForge IPC Handlers 注册入口
// 聚合所有域的 IPC handler 注册函数
// 在 app.whenReady() 后调用 registerIpcHandlers()

import { registerModelHandlers } from './model'
import { registerChatHandlers } from './chat'
import { registerSettingsHandlers } from './settings'
import { registerFileHandlers } from './file'
import { registerSystemHandlers } from './system'
import { registerMcpHandlers } from './mcp'
import { registerMcpMarketplaceHandlers } from './mcp-marketplace'
import { registerAgentHandlers } from './agent'
import { registerSkillHandlers } from './skill'
import { registerKbHandlers } from './knowledge-base'
import { registerVoiceHandlers } from './voice'
import { registerWindowHandlers } from './window'
import { registerWorkspaceHandlers } from './workspace'
import { registerWikiHandlers } from './wiki'
import { registerAuditHandlers } from './audit'
import { registerPromptTemplateHandlers } from './prompt-template'
import { registerCodebaseHandlers } from './codebase'
import { registerGitHandlers } from './git'
import { registerBrowserHandlers } from './browser'
import { registerCheckpointHandlers } from './checkpoint'
import { registerSchedulerHandlers } from './scheduler'
import { registerVideoHandlers } from './video'

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

  // ─── MCP 市场域 (P3-02) ──────────────────────────────────────
  registerMcpMarketplaceHandlers()

  // ─── Agent 域 (P2-04) ──────────────────────────────────────────
  registerAgentHandlers()

  // ─── Skill 域 (P3-02) ──────────────────────────────────────────
  registerSkillHandlers()

  // ─── Knowledge Base 域 (P4/P5) ─────────────────────────────────
  registerKbHandlers()

  // ─── Voice 域 (V1) ────────────────────────────────────────────
  registerVoiceHandlers()

  // ─── Window 域 (自定义菜单/窗口控制) ──────────────────────────
  registerWindowHandlers()

  // ─── Workspace 域 (本地文件工作区) ───────────────────────────
  registerWorkspaceHandlers()

  // ─── LLM Wiki 域 (Karpathy 模式) ─────────────────────────────
  registerWikiHandlers()

  // ─── Audit 域 (工作流审计) ────────────────────────────────────
  registerAuditHandlers()

  // ─── Prompt Template 域 (Prompt 模板库) ──────────────────────
  registerPromptTemplateHandlers()

  // ─── Codebase 域 (代码库索引) ────────────────────────────────
  registerCodebaseHandlers()

  // ─── Git 域 (Git 工作流) ────────────────────────────────────
  registerGitHandlers()

  // ─── Browser 域 (浏览器自动化) ──────────────────────────────
  registerBrowserHandlers()

  // ─── Checkpoint 域 (快照回滚) ──────────────────────────────
  registerCheckpointHandlers()

  // ─── Scheduler 域 (定时任务) ──────────────────────────────
  registerSchedulerHandlers()

  // ─── Video 域 (AI 视频生成 M1) ────────────────────────────
  registerVideoHandlers()
}
