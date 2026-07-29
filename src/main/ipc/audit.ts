// AgentForge Workflow Auditor — IPC Handlers
// WA-05: audit 域 IPC handler 注册
// Channel: audit:run (Renderer→Main), audit:report (Main→Renderer)

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type { AuditInput, AuditReport } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { getMainWindowWebContents } from '../utils/electron-helpers'
import { getToolRegistry } from '../tools/registry'
import { getSettings } from '../db/repos/app-settings'
import { listSkills } from '../db/repos/skill'
import { listMcpServers } from '../mcp/db-repo'
import { AuditEngine, type AuditEngineConfig } from '../audit/engine'

/** 推送审计报告到渲染进程 */
function sendAuditReport(report: AuditReport): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('audit:report', report)
  }
}

/**
 * audit:run — 触发审计评估。
 *
 * 从全局 ToolRegistry、AppSettings、Skill DB 收集配置，
 * 调用 AuditEngine 生成审计报告，
 * 通过 audit:report 事件推送到渲染进程。
 */
export async function handleAuditRun(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<AuditReport> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Audit run params must be an object.')
  }

  const p = params as Record<string, unknown>

  // 验证必填字段
  if (typeof p['executionId'] !== 'string' || !p['executionId']) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "executionId" is required.')
  }
  if (typeof p['conversationId'] !== 'string' || !p['conversationId']) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "conversationId" is required.')
  }
  if (!Array.isArray(p['trajectories'])) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "trajectories" must be an array.')
  }

  const input = p as unknown as AuditInput

  // 收集配置
  const settings = getSettings()
  const skills = listSkills()
  const mcpServers = listMcpServers()

  const engineConfig: AuditEngineConfig = {
    skillCount: skills.length,
    mcpServerCount: mcpServers.length,
    maxSteps: settings.maxExecutionSteps,
  }

  // 获取工具映射
  const registry = getToolRegistry()
  const tools = new Map()
  for (const tool of registry.list()) {
    tools.set(tool.definition.name, tool)
  }

  // 执行审计
  const engine = new AuditEngine(engineConfig)
  const report = engine.evaluate(input, tools)

  // 推送报告到渲染进程
  sendAuditReport(report)

  return report
}

// ─── 通道注册 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  {
    channel: 'audit:run',
    handler: (event, params: unknown) => handleAuditRun(event, params),
  },
]

/**
 * 注册 Audit 域的 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerAuditHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
