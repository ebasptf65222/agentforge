// AgentForge Chat 域 IPC Handlers
// 实现 P1-08: 对话发送/停止 + 流式事件 + 持久化 + 并发控制
// 实现 P1-09a: 会话 CRUD + 消息查询
// 通道命名: chat:send, chat:stop, chat:create-conversation,
//           chat:list-conversations, chat:get-conversation,
//           chat:delete-conversation, chat:get-messages

import { ipcMain, type IpcMainInvokeHandler } from 'electron'
import type {
  Conversation,
  ChatMessage,
  StreamChunk,
  StreamEndMetadata,
  StreamError,
  MessageMetadata,
  ApprovalMode,
} from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'
import { assertNonEmptyString } from '../utils/assertions'
import { getMainWindowWebContents } from '../utils/electron-helpers'
import {
  createConversation,
  listConversations,
  getConversationById,
  deleteConversation,
  updateConversationTitle,
  incrementMessageCount,
  updateLastMessageAt,
  forkConversation,
  getConversationChildren,
  getConversationAncestors,
  type ForkConversationParams,
} from '../db/repos/conversation'
import { createMessage, getMessagesByConversationId, deleteMessagesByConversationId } from '../db/repos/message'
import { modelConfigExists } from '../db/repos/model-config'
import { getModelAdapter } from '../models/router'
import type { AdapterMessage } from '../models/adapter'
import { semanticSearch } from '../knowledge-base/search'
import { getDatabase } from '../db'
import { getSessionManager } from '../copilot/session-manager'

// ─── 并发控制 ─────────────────────────────────────────────────────

/** 当前正在运行的 AbortController，null 表示空闲 */
let currentAbortController: AbortController | null = null

/**
 * 获取当前 AbortController（仅供测试使用）。
 */
export function getCurrentAbortController(): AbortController | null {
  return currentAbortController
}

/**
 * 重置当前 AbortController（仅供测试使用）。
 */
export function resetAbortController(): void {
  currentAbortController = null
}

// ─── 流式事件推送辅助 ─────────────────────────────────────────────

/**
 * 推送流式 chunk 到渲染进程。
 */
function sendStreamChunk(chunk: StreamChunk): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('chat:stream-chunk', chunk)
  }
}

/**
 * 推送流式结束事件到渲染进程。
 */
function sendStreamEnd(metadata: StreamEndMetadata): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('chat:stream-end', metadata)
  }
}

/**
 * 推送流式错误事件到渲染进程。
 */
function sendStreamError(error: StreamError): void {
  const wc = getMainWindowWebContents()
  if (wc) {
    wc.send('chat:stream-error', error)
  }
}

// ─── 近似 token 计算 ──────────────────────────────────────────────

/**
 * 近似计算 token 数量（content 长度 / 4，无 tiktoken）。
 */
function approximateTokenCount(content: string): number {
  return Math.ceil(content.length / 4)
}

// ─── IPC 通道处理函数 ─────────────────────────────────────────────

/**
 * chat:send - 发送消息并流式生成回复。
 *
 * 流程：
 * 1. 检查并发锁（currentAbortController）
 * 2. 验证 conversationId 存在
 * 3. 获取模型适配器
 * 4. 保存用户消息
 * 5. 构建消息历史，开始流式生成
 * 6. 每个 chunk 推送到渲染进程
 * 7. 流式结束后保存助手消息，更新会话统计
 * 8. 首条消息时自动生成标题
 */
export async function handleSend(
  _event: Electron.IpcMainInvokeEvent,
  params: unknown,
): Promise<void> {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Send message params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['conversationId'], 'conversationId')
  assertNonEmptyString(p['content'], 'content')
  assertNonEmptyString(p['modelId'], 'modelId')

  const { conversationId, content, modelId } = p as {
    conversationId: string
    content: string
    modelId: string
  }

  // 1. 并发控制：已有生成任务在运行
  if (currentAbortController !== null) {
    throw new AppError(ErrorCodes.CHAT_ALREADY_RUNNING, 'A chat generation is already running.')
  }

  // 2. 验证会话存在
  const conversation = getConversationById(conversationId)

  // 3. 获取模型适配器（内部会验证 modelId 对应的配置是否存在）
  const adapter = getModelAdapter(modelId)

  // 4. 创建 AbortController 并加锁
  const abortController = new AbortController()
  currentAbortController = abortController

  // OPT2-06: 所有后续操作包入 try/finally，确保锁在异常时也能释放
  try {
    // OPT2-08: 消息持久化添加数据库事务，确保数据一致性
    const db = getDatabase()
    const execTransaction = db.transaction(() => {
      // 5. 保存用户消息
      createMessage({
        conversationId,
        role: 'user',
        content,
      })

      // 递增消息计数（用户消息 +1，后面助手消息再 +1）
      incrementMessageCount(conversationId, 1)

      // 6. 首条消息时自动生成标题
      if (conversation.messageCount === 0 && conversation.title === '新会话') {
        const newTitle = (content.length > 20 ? content.slice(0, 20) : content).trim()
        updateConversationTitle(conversationId, newTitle)
      }
    })
    execTransaction()

    // 7. 构建消息历史
    const history = getMessagesByConversationId(conversationId)
    const adapterMessages: AdapterMessage[] = []

    // 7a. 如果启用了知识库关联，先搜索知识库并注入结果
    const kbEnabled = p['kbEnabled'] === true
    if (kbEnabled) {
      try {
        const kbResults = await semanticSearch(content, { topK: 5, threshold: 0.5 })
        if (kbResults.length > 0) {
          const kbContext = [
            '以下是从知识库中检索到的相关信息，请在回答时参考这些内容：',
            ...kbResults.map(
              (r, i) =>
                `[${i + 1}] 来源: ${r.fileName}（相似度: ${(r.score * 100).toFixed(1)}%）\n内容: ${r.content}`,
            ),
          ].join('\n\n')
          adapterMessages.push({ role: 'system', content: kbContext })
        }
      } catch (kbError) {
        console.error('[ChatIPC] KB search error:', kbError)
        // 知识库搜索失败不影响正常对话，继续执行
      }
    }

    adapterMessages.push(
      ...history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    )

    // 8. 流式生成
    const startTime = Date.now()
    let assistantContent = ''
    let stopped = false

    try {
      const stream = adapter.streamChat(adapterMessages, abortController.signal)

      for await (const chunk of stream) {
        // 推送 chunk 到渲染进程
        sendStreamChunk(chunk)

        // 收集文本内容
        if (chunk.type === 'text' && chunk.content) {
          assistantContent += chunk.content
        }

        // 检查是否被中断
        if (abortController.signal.aborted) {
          stopped = true
          break
        }
      }
    } catch (error) {
      // 被中断（AbortError）视为正常停止
      if (error instanceof Error && error.name === 'AbortError') {
        stopped = true
      } else if (error instanceof AppError) {
        // 推送流式错误
        const streamError: StreamError = {
          code: error.code,
          message: error.message,
          details: error.details,
        }
        sendStreamError(streamError)
        // 仍然保存已生成的内容
      } else {
        // 未知错误
        const streamError: StreamError = {
          code: ErrorCodes.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Unknown error during streaming',
        }
        sendStreamError(streamError)
      }
    } finally {
      // 9. 保存助手消息（OPT2-08: 事务内持久化助手消息 + 会话统计更新）
      const duration = Date.now() - startTime
      const tokensUsed = approximateTokenCount(assistantContent)

      const assistantMetadata: MessageMetadata = {
        modelId,
        tokensUsed,
        duration,
        stopped,
      }

      const saveAssistantTx = getDatabase().transaction(() => {
        const assistantMessage = createMessage({
          conversationId,
          role: 'assistant',
          content: assistantContent,
          metadata: assistantMetadata,
        })

        // 10. 更新会话统计
        incrementMessageCount(conversationId, 1)
        updateLastMessageAt(conversationId)

        return assistantMessage
      })
      const assistantMessage = saveAssistantTx()

      // 11. 推送流式结束事件
      const endMetadata: StreamEndMetadata = {
        messageId: assistantMessage.id,
        tokensUsed,
        duration,
        modelId,
        stopped,
      }
      sendStreamEnd(endMetadata)

      // 12. 释放并发锁
      currentAbortController = null
    }
  } finally {
    // OPT2-06: 外层 finally 确保锁在任何异常下都能释放
    //（内层 finally 已释放，此处幂等）
    currentAbortController = null
  }
}

/**
 * chat:stop - 中断当前流式生成。
 */
export function handleStop(): void {
  if (currentAbortController !== null) {
    currentAbortController.abort()
  }
}

// ─── P1-09a: 会话 CRUD + 消息查询 ──────────────────────────────────

const VALID_APPROVAL_MODES: readonly ApprovalMode[] = ['suggest', 'auto-edit', 'full-auto']

function assertApprovalMode(value: unknown): asserts value is ApprovalMode {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !VALID_APPROVAL_MODES.includes(value as ApprovalMode))
  ) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Invalid approvalMode: ${String(value)}. Must be one of: ${VALID_APPROVAL_MODES.join(', ')}.`,
      { approvalMode: value },
    )
  }
}

/**
 * chat:create-conversation - 创建会话。
 *
 * - title 为空字符串或 undefined 时使用默认值 "新会话"
 * - approvalMode 为 undefined 时使用默认值 "auto-edit"
 * - modelId 不存在于 model_configs 表时抛出 MODEL_NOT_FOUND
 *
 * @param params - { title?, modelId, approvalMode? }
 * @returns 新建的 Conversation
 */
export function handleCreateConversation(params: unknown): Conversation {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Create conversation params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['modelId'], 'modelId')
  assertApprovalMode(p['approvalMode'])

  // title 可选；非空字符串才使用，否则使用默认值
  let title: string | undefined
  if (p['title'] !== undefined) {
    if (typeof p['title'] !== 'string') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Field "title" must be a string.', {
        title: p['title'],
      })
    }
    const trimmed = p['title'].trim()
    title = trimmed === '' ? undefined : trimmed
  }

  const modelId = p['modelId'] as string
  const approvalMode = p['approvalMode'] as ApprovalMode | undefined

  // 验证 modelId 在 model_configs 表中存在
  if (!modelConfigExists(modelId)) {
    throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model with id "${modelId}" not found.`, {
      modelId,
    })
  }

  return createConversation({
    title,
    modelId,
    approvalMode,
  })
}

/**
 * chat:list-conversations - 列出所有会话（按 updated_at 降序）。
 *
 * @returns Conversation 数组
 */
export function handleListConversations(): Conversation[] {
  return listConversations()
}

/**
 * chat:get-conversation - 查询单个会话。
 *
 * @param params - { id }
 * @returns Conversation
 * @throws {AppError} CONVERSATION_NOT_FOUND - 会话不存在
 */
export function handleGetConversation(params: unknown): Conversation {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get conversation params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  return getConversationById(p['id'] as string)
}

/**
 * chat:delete-conversation - 删除会话（级联删除消息）。
 *
 * @param params - { id }
 * @throws {AppError} CONVERSATION_NOT_FOUND - 会话不存在
 */
export function handleDeleteConversation(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Delete conversation params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  const id = p['id'] as string
  deleteConversation(id)

  // 清理对应的 Copilot SDK 持久化会话
  void getSessionManager().destroySession(id)
}

/**
 * chat:get-messages - 查询会话下的所有消息（按 created_at 升序）。
 *
 * @param params - { conversationId }
 * @returns ChatMessage 数组
 */
export function handleGetMessages(params: unknown): ChatMessage[] {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get messages params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['conversationId'], 'conversationId')

  return getMessagesByConversationId(p['conversationId'] as string)
}

/**
 * chat:clear-conversation - 清空会话的所有消息（保留会话本身）。
 *
 * @param params - { id }
 * @throws {AppError} CONVERSATION_NOT_FOUND - 会话不存在
 */
export function handleClearConversation(params: unknown): void {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Clear conversation params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  const id = p['id'] as string
  // 验证会话存在
  getConversationById(id)

  // 删除所有消息
  deleteMessagesByConversationId(id)

  // 重置会话统计
  const db = getDatabase()
  db.prepare(
    'UPDATE conversations SET message_count = 0, last_message_at = NULL, updated_at = ? WHERE id = ?',
  ).run(Date.now(), id)

  // 清理对应的 Copilot SDK 持久化会话（消息已清空，需重建上下文）
  void getSessionManager().destroySession(id)
}

/**
 * chat:search-conversations - 搜索会话（按标题和消息内容）。
 *
 * @param params - { keyword }
 * @returns 匹配的 Conversation 数组
 */
export function handleSearchConversations(params: unknown): Conversation[] {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Search params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['keyword'], 'keyword')

  const keyword = p['keyword'] as string
  const db = getDatabase()

  // 搜索标题匹配的会话
  const titleMatches = db
    .prepare('SELECT * FROM conversations WHERE title LIKE ? ORDER BY updated_at DESC')
    .all(`%${keyword}%`) as ConversationRow[]

  // 搜索消息内容匹配的会话 ID
  const messageMatches = db
    .prepare(
      'SELECT DISTINCT conversation_id FROM messages WHERE content LIKE ?',
    )
    .all(`%${keyword}%`) as { conversation_id: string }[]

  const matchedIds = new Set<string>(titleMatches.map((r) => r.id))
  for (const m of messageMatches) {
    matchedIds.add(m.conversation_id)
  }

  if (matchedIds.size === 0) return []

  // 获取所有匹配的完整会话数据
  const placeholders = Array.from(matchedIds).map(() => '?').join(',')
  const allMatches = db
    .prepare(`SELECT * FROM conversations WHERE id IN (${placeholders}) ORDER BY updated_at DESC`)
    .all(...Array.from(matchedIds)) as ConversationRow[]

  return allMatches.map(rowToConversation)
}

// ─── P3-01: 对话分支 (Fork) IPC Handlers ─────────────────────────

/**
 * chat:fork-conversation - Fork 一个会话。
 *
 * @param params - { sourceConversationId, messageCount? }
 * @returns 新建的 fork 会话
 * @throws {AppError} CONVERSATION_NOT_FOUND - 源会话不存在
 */
export function handleForkConversation(params: unknown): Conversation {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Fork params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['sourceConversationId'], 'sourceConversationId')

  const forkParams: ForkConversationParams = {
    sourceConversationId: p['sourceConversationId'] as string,
  }

  if (p['messageCount'] !== undefined) {
    const mc = Number(p['messageCount'])
    if (Number.isNaN(mc) || mc < 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'messageCount must be a non-negative number.', {
        messageCount: p['messageCount'],
      })
    }
    forkParams.messageCount = mc
  }

  return forkConversation(forkParams)
}

/**
 * chat:get-conversation-tree - 获取会话的分支树。
 *
 * @param params - { id }
 * @returns { ancestors: Conversation[], children: Conversation[] }
 */
export function handleGetConversationTree(params: unknown): {
  ancestors: Conversation[]
  children: Conversation[]
} {
  if (params === null || typeof params !== 'object') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Get tree params must be an object.')
  }
  const p = params as Record<string, unknown>

  assertNonEmptyString(p['id'], 'id')

  const id = p['id'] as string

  // 验证会话存在
  getConversationById(id)

  return {
    ancestors: getConversationAncestors(id),
    children: getConversationChildren(id),
  }
}

// ─── 通道注册表 ───────────────────────────────────────────────────

interface ChannelRegistration {
  channel: string
  handler: IpcMainInvokeHandler
}

const registrations: ChannelRegistration[] = [
  { channel: 'chat:send', handler: handleSend },
  { channel: 'chat:stop', handler: () => handleStop() },
  // P1-09a: 会话 CRUD + 消息查询
  {
    channel: 'chat:create-conversation',
    handler: (_event, params: unknown) => handleCreateConversation(params),
  },
  { channel: 'chat:list-conversations', handler: () => handleListConversations() },
  {
    channel: 'chat:get-conversation',
    handler: (_event, params: unknown) => handleGetConversation(params),
  },
  {
    channel: 'chat:delete-conversation',
    handler: (_event, params: unknown) => handleDeleteConversation(params),
  },
  {
    channel: 'chat:get-messages',
    handler: (_event, params: unknown) => handleGetMessages(params),
  },
  {
    channel: 'chat:update-title',
    // OPT2-18: 使用统一的 ErrorCodes.VALIDATION_ERROR
    handler: (_event, params: unknown) => {
      if (params === null || typeof params !== 'object') {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Update title params must be an object.')
      }
      const p = params as Record<string, unknown>
      assertNonEmptyString(p['id'], 'id')
      assertNonEmptyString(p['title'], 'title')
      updateConversationTitle(p['id'] as string, (p['title'] as string).trim())
      return getConversationById(p['id'] as string)
    },
  },
  {
    channel: 'chat:clear-conversation',
    handler: (_event, params: unknown) => handleClearConversation(params),
  },
  {
    channel: 'chat:search-conversations',
    handler: (_event, params: unknown) => handleSearchConversations(params),
  },
  // P3-01: 对话分支
  {
    channel: 'chat:fork-conversation',
    handler: (_event, params: unknown) => handleForkConversation(params),
  },
  {
    channel: 'chat:get-conversation-tree',
    handler: (_event, params: unknown) => handleGetConversationTree(params),
  },
]

/**
 * 注册 Chat 域的 IPC handlers。
 * 幂等：重复调用时会先移除已注册的 handler 再重新注册。
 */
export function registerChatHandlers(): void {
  for (const { channel, handler } of registrations) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
}
