// AgentForge: terminal_exec 内置工具
// 在用户工作区中执行终端命令
// 高风险工具，所有模式下都需要审批

import type { ToolDefinition, ToolExecutionResult } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { exec, type ExecOptions } from 'child_process'
import path from 'path'
import { getWorkspacePath } from '../ipc/workspace'
import type { BuiltinTool } from './types'

/** stdout 截断阈值 */
const MAX_OUTPUT_LENGTH = 10_000

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 最大超时时间（毫秒） */
const MAX_TIMEOUT_MS = 120_000

/** 最小超时时间（毫秒） */
const MIN_TIMEOUT_MS = 1_000

/**
 * 危险命令黑名单正则列表。
 * 匹配到任意一条即拒绝执行。
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-[rf]+\s+\//,
  /mkfs/,
  /format\s+[a-z]:/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /:\(\)\s*\{:\|:&\s*\};:/,
  /shutdown|reboot|halt|poweroff/,
  /\|\s*rm/,
  /chmod\s+777\s+\//,
]

/**
 * 检测命令是否包含危险模式。
 * @param command - 待检测的命令字符串
 * @returns 如果匹配到危险模式则返回匹配描述，否则返回 null
 */
function detectDangerousCommand(command: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Command matches forbidden pattern: ${pattern.source}`
    }
  }
  return null
}

/** terminal_exec 工具定义与执行函数 */
export const terminalExecTool: BuiltinTool = {
  definition: {
    name: 'terminal_exec',
    description:
      'Execute a shell command in the user\'s workspace directory. Use for running build scripts, tests, git commands, package managers, and other CLI operations. The command runs in a sandboxed environment with the workspace as the working directory.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (defaults to workspace root)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default 30000, max 120000)',
        },
        env: {
          type: 'object',
          description: 'Additional environment variables to set',
        },
      },
      required: ['command'],
    },
    riskLevel: 'high',
    source: 'builtin',
  } satisfies ToolDefinition,
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const command = args['command']
    const cwd = args['cwd']
    const timeout = args['timeout']
    const env = args['env']

    // ─── 参数校验 ────────────────────────────────────────────────

    if (typeof command !== 'string' || command.trim() === '') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Command must be a non-empty string.', { command })
    }

    // 危险命令检测
    const danger = detectDangerousCommand(command)
    if (danger) {
      throw new AppError(ErrorCodes.TOOL_EXECUTION_ERROR, `Dangerous command blocked: ${danger}`, {
        command,
      })
    }

    // 超时范围校验
    const timeoutMs =
      typeof timeout === 'number'
        ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(timeout)))
        : DEFAULT_TIMEOUT_MS

    if (typeof timeout === 'number' && (timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`,
        { timeout },
      )
    }

    // 可选参数类型校验
    if (cwd !== undefined && typeof cwd !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'cwd must be a string.', { cwd })
    }
    if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env))) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'env must be an object.', { env })
    }

    // ─── 确定工作目录 ─────────────────────────────────────────────

    const workspaceRoot = getWorkspacePath()
    const resolvedCwd = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : workspaceRoot

    // 如果指定了相对路径，则基于工作区根解析
    const execCwd = path.isAbsolute(resolvedCwd) ? resolvedCwd : path.resolve(workspaceRoot, resolvedCwd)

    // ─── 构建执行选项 ─────────────────────────────────────────────

    const options: ExecOptions = {
      cwd: execCwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
      env: env ? { ...process.env, ...(env as Record<string, string>) } : process.env,
    }

    // ─── 执行命令 ─────────────────────────────────────────────────

    try {
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
        (resolve, _reject) => {
          exec(command, options, (error, stdout, stderr) => {
            if (error) {
              // 区分超时和其他错误
              if ((error as NodeJS.ErrnoException).killed) {
                resolve({
                  stdout: truncateOutput(stdout),
                  stderr: `Command timed out after ${timeoutMs}ms.\n${stderr}`,
                  exitCode: null,
                })
              } else {
                resolve({
                  stdout: truncateOutput(stdout),
                  stderr,
                  exitCode: error.code as number | null ?? 1,
                })
              }
            } else {
              resolve({
                stdout: truncateOutput(stdout),
                stderr,
                exitCode: 0,
              })
            }
          })
        },
      )

      const isError = result.exitCode !== null && result.exitCode !== 0
      const truncated =
        result.stdout.length > MAX_OUTPUT_LENGTH || result.stderr.length > MAX_OUTPUT_LENGTH

      return {
        isError,
        content: isError
          ? `Command exited with code ${result.exitCode}.\n${result.stderr || result.stdout}`
          : result.stdout || '(no output)',
        metadata: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated,
          cwd: execCwd,
        },
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCodes.TOOL_EXECUTION_ERROR,
        `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
        { command },
      )
    }
  },
}

/**
 * 截断输出到最大长度。
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output
  return output.slice(0, MAX_OUTPUT_LENGTH) + `\n... (truncated, ${output.length} chars total)`
}
