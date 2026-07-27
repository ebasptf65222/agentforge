# AgentForge 全局优化 - 任务拆解 v0.2

> 基于 v0.1 优化后的第二轮深度审查（后端 + 前端）。
> v0.1 已完成 OPT-01 ~ OPT-04（P0 安全）、OPT-09/11/12/13（P1）、OPT-14（P2）。
> 本轮聚焦：上一轮遗漏的锁泄漏、新发现的安全漏洞、前端功能缺陷、数据一致性。

### 复杂度图例

| 等级 | 说明 | 预估时间 |
|------|------|----------|
| S | 简单，纯配置或类型定义 | 1-2h |
| M | 中等，需编写逻辑或组件 | 3-4h |
| L | 复杂，涉及多个文件联动 | 5-7h |
| XL | 高复杂度，跨层架构改动 | 7h+ |

### 优先级图例

| 等级 | 说明 |
|------|------|
| P0 | 安全漏洞 / 功能不可用，必须立即修复 |
| P1 | 重要缺陷 / 数据完整性，尽快修复 |
| P2 | 可靠性 / 性能改善 |
| P3 | 代码质量 / 可维护性 |

---

## P0 - 安全漏洞与功能不可用

### OPT2-01: kb:import 任意文件读取漏洞

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-01 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | 知识库导入添加路径边界校验 |
| **目标** | handleImport 仅校验 filePath 非空，未限制路径范围。渲染进程可读取 /etc/passwd 等系统文件 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/knowledge-base.ts`(修改) `src/main/knowledge-base/parser.ts`(修改) |
| **输入** | 已有 `resolveWorkspacePath` / `isPathInWorkspace` |
| **输出** | kb:import 拒绝工作区外路径，测试覆盖 |
| **验收标准** | 1) 拒绝绝对路径; 2) 拒绝 ../ 逃逸; 3) 拒绝符号链接逃逸; 4) 既有 KB 测试通过; 5) 新增路径安全测试 |
| **预估复杂度** | M（3-4h） |

### OPT2-02: MCP 命令黑名单路径变体绕过

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-02 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | MCP stdio 命令校验增强，防止路径变体绕过 |
| **目标** | 当前黑名单仅匹配纯命令名，/bin/bash、./bash、bash.local 等变体可绕过 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/mcp/transport.ts`(修改) `src/main/mcp/transport.test.ts`(修改) |
| **输入** | 当前 COMMAND_BLOCKLIST + 纯字符串匹配 |
| **输出** | 对 command 做 basename 提取后再匹配，禁止包含路径分隔符的 command |
| **验收标准** | 1) /bin/bash 被拒绝; 2) ./bash 被拒绝; 3) bash.local 被拒绝; 4) git 仍允许; 5) 既有测试通过; 6) 新增路径变体测试 |
| **预估复杂度** | S（2h） |

### OPT2-03: Agent 锁泄漏导致功能永久瘫痪

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-03 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | agent.ts handleExecute 锁泄漏修复 |
| **目标** | currentExecutor 赋值在 try 块外，如果后续同步操作抛异常，finally 不执行，锁永远不释放 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/agent.ts`(修改) |
| **输入** | 当前 handleExecute 中 currentExecutor = executor 在 line 161，try 在 line 193 |
| **输出** | 所有可能在加锁后抛异常的操作包入 try，finally 中释放锁 |
| **验收标准** | 1) DB 异常后 currentExecutor 被正确清空; 2) 后续 agent:execute 可正常调用; 3) 既有 agent 测试通过; 4) 新增锁释放测试 |
| **预估复杂度** | S（1-2h） |

### OPT2-04: TitleBar 新建对话使用硬编码无效 modelId

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-04 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | 修复 TitleBar 新建对话硬编码 'default' modelId |
| **目标** | handleNewChat 传入 'default' 而非真实模型 ID，创建的会话无法使用 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/common/TitleBar.vue`(修改) |
| **输入** | 当前 `await chatStore.newConversation('default')` |
| **输出** | 从 modelStore 获取第一个可用模型 ID |
| **验收标准** | 1) 新建对话使用真实模型; 2) 无模型时给出友好提示; 3) 类型检查通过 |
| **预估复杂度** | S（1h） |

### OPT2-05: VoiceConfig TTS 测试返回类型不匹配

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-05 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | 修复 testTts API 返回类型与 VoiceConfig 使用不匹配 |
| **目标** | electron-api 声明 testTts 返回 void，但 VoiceConfig.vue 将其当 ArrayBuffer 用 |
| **依赖任务** | 无 |
| **涉及文件** | `src/preload/electron-api.ts`(修改或确认) `src/renderer/src/components/Settings/VoiceConfig.vue`(修改) `src/main/ipc/voice.ts`(修改) |
| **输入** | VoiceConfig.vue:228 `const audioBuffer = await testTts(...)` 但 API 返回 void |
| **输出** | testTts 返回 ArrayBuffer 或 VoiceConfig 使用正确的 API |
| **验收标准** | 1) TTS 测试能正常播放音频; 2) 类型声明与实现一致; 3) 无 TypeScript 错误 |
| **预估复杂度** | M（3-4h） |

---

## P1 - 重要缺陷与数据完整性

### OPT2-06: chat.ts handleSend 锁泄漏

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-06 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | chat.ts handleSend 锁泄漏修复 |
| **目标** | 与 OPT2-03 同类问题，currentAbortController 赋值在 try 块外 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/chat.ts`(修改) |
| **输入** | currentAbortController 赋值在 line 143，try 在 line 198 |
| **输出** | 所有操作包入 try/finally |
| **验收标准** | 1) DB 异常后 currentAbortController 被正确清空; 2) 后续 chat:send 可正常调用; 3) 既有 chat 测试通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-07: handleApprove 未校验 approved 类型

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-07 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | 修复 agent:approve approved 字段类型未校验 |
| **目标** | `as boolean` 不校验实际类型，字符串 'false' 会被当 truthy，拒绝被误判为批准 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/agent.ts`(修改) |
| **输入** | line 243 `const approved = p['approved'] as boolean` |
| **输出** | 添加 `typeof p['approved'] !== 'boolean'` 校验 |
| **验收标准** | 1) 传入字符串 'false' 抛 VALIDATION_ERROR; 2) 传入 undefined 抛错; 3) 传入 true/false 正常工作; 4) 既有测试通过 |
| **预估复杂度** | S（1h） |

### OPT2-08: chat.ts 多步消息持久化缺少事务

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-08 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | chat.ts 消息持久化添加数据库事务 |
| **目标** | handleSend 中 6+ 个独立 DB 操作不在事务中，崩溃后数据不一致 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/chat.ts`(修改) |
| **输入** | better-sqlite3 支持 db.transaction() |
| **输出** | 消息创建 + 计数递增 + 标题更新 + lastMessageAt 更新包在事务中 |
| **验收标准** | 1) 崩溃恢复后数据一致; 2) 既有 chat 测试通过; 3) 新增事务回滚测试 |
| **预估复杂度** | M（3-4h） |

### OPT2-09: model-config 设置默认模型缺少事务

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-09 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | model-config updateModelConfig 设置默认模型添加事务 |
| **目标** | 先取消所有默认再设置新默认，两步不在事务中，第二步失败则无默认模型 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/db/repos/model-config.ts`(修改) |
| **输入** | line 300 和 line 308 两个 UPDATE |
| **输出** | 包裹在 db.transaction() 中 |
| **验收标准** | 1) 第二步失败时全部回滚; 2) 既有模型 CRUD 测试通过; 3) 新增事务测试 |
| **预估复杂度** | S（2h） |

### OPT2-10: GeneralSettings 主题类名冲突 + matchMedia 监听器泄漏

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-10 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | 修复主题切换冲突 + matchMedia 监听器泄漏 |
| **目标** | GeneralSettings 使用 'theme-dark' 类名与 useTheme 的 'dark' 不一致；matchMedia 监听器无清理 |
| **依赖任务** | 无（与 v0.1 OPT-10 部分重叠但独立） |
| **涉及文件** | `src/renderer/src/components/Settings/GeneralSettings.vue`(修改) |
| **输入** | applyTheme 添加 'theme-dark'/'theme-light'；matchMedia 监听器在 setup 顶层 |
| **输出** | 删除独立 applyTheme，仅更新 settings store；matchMedia 监听器在 onUnmounted 中移除 |
| **验收标准** | 1) 主题切换统一走 useTheme; 2) 组件卸载后监听器已移除; 3) 深色/浅色/跟随系统三种模式均正常; 4) 无 TypeScript 错误 |
| **预估复杂度** | M（3-4h） |

### OPT2-11: Agent 流式内容不展示

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-11 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | 修复 Agent 执行模式流式文本不显示的问题 |
| **目标** | agentStore.streamingContent 累积了流式文本，但 ChatView 传给 MessageList 的是 chatStore.streamingContent |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/views/ChatView.vue`(修改) `src/renderer/src/components/ChatPanel/MessageList.vue`(修改) |
| **输入** | ChatView.vue:167 传 chatStore.streamingContent; agentStore.handleStreamChunk 累积到 agentStore.streamingContent |
| **输出** | Agent 模式下 MessageList 接收 agentStore.streamingContent |
| **验收标准** | 1) Agent 执行时流式文本实时显示; 2) Chat 模式不受影响; 3) 执行结束后显示完整结果 |
| **预估复杂度** | M（3-4h） |

### OPT2-12: McpConfig 编辑非原子操作（先删后增）

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-12 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | McpConfig 编辑改为使用更新 API 而非先删后增 |
| **目标** | 编辑 MCP 服务器时先 removeServer 再 addServer，addServer 失败则数据丢失 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/Settings/McpConfig.vue`(修改) `src/main/ipc/mcp.ts`(需确认有 update API) |
| **输入** | 当前 saveServer 逻辑: if (editingId) { removeServer(editingId) } then addServer |
| **输出** | 使用 updateServer API 或确保操作原子性 |
| **验收标准** | 1) 编辑保存失败时原数据不丢失; 2) 服务器 ID 保持不变; 3) 既有 MCP 测试通过 |
| **预估复杂度** | M（3-4h） |

---

## P2 - 可靠性与性能

### OPT2-13: StdioTransport.close() 未等待子进程退出

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-13 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | StdioTransport 关闭时等待子进程退出 + SIGKILL 兜底 |
| **目标** | close() 调用 kill 后立即置 null，不等待 exit，可能产生僵尸进程 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/mcp/transport.ts`(修改) |
| **输入** | 当前 close() 调用 process.kill() 后 this.process = null |
| **输出** | 等待 exit 事件（带超时），超时后 SIGKILL；close 时移除所有监听器 |
| **验收标准** | 1) 正常退出在合理时间内完成; 2) 超时后发送 SIGKILL; 3) 既有 transport 测试通过 |
| **预估复杂度** | M（3-4h） |

### OPT2-14: MCPClient.handleError 空实现

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-14 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | MCPClient.handleError 添加错误日志和致命错误处理 |
| **目标** | 传输层错误被完全忽略，用户需等 10s 超时才看到错误 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/mcp/client.ts`(修改) |
| **输入** | 当前 handleError 为空实现 |
| **输出** | 添加 console.error 日志；对致命错误（EPIPE 等）拒绝所有 pending 请求 |
| **验收标准** | 1) 传输层错误有日志; 2) 致命错误时 pending 请求立即被拒绝; 3) 既有 client 测试通过 |
| **预估复杂度** | M（3-4h） |

### OPT2-15: embedding API 调用无超时控制

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-15 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | 知识库 embedding API 添加请求超时 |
| **目标** | generateOllamaEmbedding / generateOpenAiEmbedding 的 fetch 无 AbortController，可能无限等待 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/knowledge-base/embedding.ts`(修改) |
| **输入** | 对比 web-scrape.ts 有 10s 超时 |
| **输出** | 添加 AbortController + 30s/60s 超时 |
| **验收标准** | 1) 超时后抛出明确错误; 2) 正常请求不受影响; 3) 既有 embedding 测试通过 |
| **预估复杂度** | S（2h） |

### OPT2-16: parser.ts 同步读取大文件阻塞主进程

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-16 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | 知识库文档解析改用异步文件读取 |
| **目标** | parsePdf/parseDocx/parseXlsx 使用 readFileSync，大文件会阻塞主进程 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/knowledge-base/parser.ts`(修改) |
| **输入** | 当前 readFileSync(filePath) |
| **输出** | 改用 fs.promises.readFile |
| **验收标准** | 1) 文件读取不再阻塞主进程; 2) 解析结果与之前一致; 3) 既有 parser 测试通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-17: message.ts tool_calls JSON.parse 无 try-catch

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-17 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | message.ts rowToMessage 的 JSON.parse 添加安全解析 |
| **目标** | tool_calls 字段 JSON.parse 无 try-catch，无效 JSON 会导致整个会话历史无法加载 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/db/repos/message.ts`(修改) `src/main/mcp/db-repo.ts`(修改) |
| **输入** | line 54 JSON.parse(row.tool_calls) 无保护 |
| **输出** | 使用 safeParseJson 模式（参考 skill.ts） |
| **验收标准** | 1) 无效 JSON 不崩溃，返回 null/fallback; 2) 有效 JSON 正常解析; 3) 既有消息测试通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-18: chat:update-title 使用错误错误码

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-18 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | 修复 chat.ts update-title 使用字符串字面量错误码 |
| **目标** | 使用 'INVALID_PARAMS' 字面量而非 ErrorCodes.VALIDATION_ERROR |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/chat.ts`(修改) |
| **输入** | line 443 `throw new AppError('INVALID_PARAMS', ...)` |
| **输出** | 改为 ErrorCodes.VALIDATION_ERROR + assertNonEmptyString 校验 |
| **验收标准** | 1) 错误码与项目统一; 2) 既有测试通过 |
| **预估复杂度** | S（0.5h） |

### OPT2-19: voice.ts IPC handlers 缺少参数校验

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-19 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | voice.ts 所有 IPC handler 添加参数类型校验 |
| **目标** | 直接解构 params 不校验，null/undefined 会导致 TypeError 而非 AppError |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/voice.ts`(修改) |
| **输入** | 4 个 handler 直接解构 params |
| **输出** | 使用 assertNonEmptyString + typeof 校验 |
| **验收标准** | 1) null params 抛 AppError; 2) 缺少字段抛 AppError; 3) 正常参数正常工作; 4) 类型检查通过 |
| **预估复杂度** | S（2h） |

### OPT2-20: db/index.ts initDatabase 失败后状态不一致

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-20 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | initDatabase 失败时正确清理全局 db 实例 |
| **目标** | db = new Database() 先赋值，PRAGMA/schema 失败后 db 处于坏状态但 getDatabase() 仍返回它 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/db/index.ts`(修改) |
| **输入** | line 64 赋值 db，line 67-74 可能抛异常 |
| **输出** | try-catch 包裹初始化，失败时 db.close() + db = null + 重新抛出 |
| **验收标准** | 1) 初始化失败后 db 为 null; 2) 二次调用 initDatabase 可重试; 3) 既有 DB 测试通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-21: MCP connectServer 失败后未清理已注册工具

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-21 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | MCP Manager connectServer 失败时清理已注册工具 |
| **目标** | 注册工具中途失败，已注册的工具指向失效 client |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/mcp/manager.ts`(修改) |
| **输入** | connectServer for 循环中途抛错 |
| **输出** | catch 中调用 registry.unregisterMcpServer(id) |
| **验收标准** | 1) 连接失败后无孤儿工具; 2) 既有 MCP manager 测试通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-22: search.ts fileNameCache 未在文档删除时清理

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-22 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | 文档删除/重命名时清理 fileNameCache |
| **目标** | 缓存无上限增长，删除文档后可能返回过时数据 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/knowledge-base/search.ts`(修改) `src/main/knowledge-base/importer.ts`(修改) |
| **输入** | removeDocument 不调用 clearSearchCache |
| **输出** | removeDocument/updateKbDocument 后清理缓存 |
| **验收标准** | 1) 删除文档后缓存被清理; 2) 既有搜索测试通过 |
| **预估复杂度** | S（1h） |

---

## P3 - 代码质量与可维护性

### OPT2-23: TTS Player playBuffer Object URL 泄漏

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-23 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | TTS Player audio.play() 失败时清理 Object URL |
| **目标** | play() 抛出时未调用 revokeObjectURL，导致内存泄漏 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/utils/tts-player.ts`(修改) |
| **输入** | play() catch 块未调用 URL.revokeObjectURL(url) |
| **输出** | catch 中添加 revokeObjectURL |
| **验收标准** | 1) play 失败后 Object URL 被释放; 2) 正常播放不受影响 |
| **预估复杂度** | S（0.5h） |

### OPT2-24: 会话列表每次消息结束闪烁骨架屏

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-24 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | 修复消息结束后会话列表闪烁骨架屏 |
| **目标** | loadConversations 设置 loading=true 导致侧边栏闪烁 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/stores/chat.ts`(修改) |
| **输入** | handleStreamEnd 调用 loadConversations() |
| **输出** | 静默更新列表或使用独立的 loading 状态 |
| **验收标准** | 1) 消息结束后侧边栏无闪烁; 2) 列表正常更新排序 |
| **预估复杂度** | S（1h） |

### OPT2-25: VoiceInputButton 大量死代码清理

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-25 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | 清理 VoiceInputButton 未使用的导入和变量 |
| **目标** | NModal/NSpace/NButton、settingsStore、showConfirmModal 等导入但未使用 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/ChatPanel/VoiceInputButton.vue`(修改) |
| **输入** | 6+ 处未使用的导入和变量 |
| **输出** | 移除所有未使用的导入和变量 |
| **验收标准** | 1) 无未使用的导入; 2) 组件功能不受影响; 3) TypeScript 检查通过 |
| **预估复杂度** | S（0.5h） |

### OPT2-26: voice.ts 死代码清理（VAD 定时器/streamEnqueuedCount/未使用导出）

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-26 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | 清理 voice store 死代码 |
| **目标** | vadTimer/silenceTimer 声明但从未赋值；streamEnqueuedCount 递增但从未读取；多个导出函数无调用者 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/stores/voice.ts`(修改) |
| **输入** | 死代码列表见审查报告 |
| **输出** | 移除死代码 |
| **验收标准** | 1) 无未使用的变量和函数; 2) 语音功能不受影响; 3) TypeScript 检查通过 |
| **预估复杂度** | S（1h） |

### OPT2-27: workspace.ts childrenCache 写入但从未读取

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-27 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | 清理 workspace store 无效 childrenCache |
| **目标** | childrenCache 写入但从不调用 .get()，缓存形同虚设 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/stores/workspace.ts`(修改) |
| **输入** | childrenCache.set() 和 childrenCache.clear() 从不配合 get() |
| **输出** | 实现真正的缓存逻辑或移除 childrenCache |
| **验收标准** | 1) 目录展开不重复请求; 2) TypeScript 检查通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-28: 提取重复 escapeHtml 到公共模块

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-28 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | 提取 CodeBlock.vue 中重复的 escapeHtml 到 utils |
| **目标** | escapeHtml 在 CodeBlock.vue 和 markdown.ts 中重复定义 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/common/CodeBlock.vue`(修改) `src/renderer/src/utils/markdown.ts`(修改) |
| **输入** | 两处独立的 escapeHtml 实现 |
| **输出** | 提取到 utils/html.ts，两处统一引用 |
| **验收标准** | 1) 只有一份 escapeHtml 实现; 2) 两处功能不变; 3) TypeScript 检查通过 |
| **预估复杂度** | S（0.5h） |

### OPT2-29: IPC handler 注册幂等性统一

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-29 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | 统一所有 IPC handler 注册为幂等模式 |
| **目标** | voice/kb/window 使用不一致的注册模式，部分不幂等 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/voice.ts`(修改) `src/main/ipc/knowledge-base.ts`(修改) `src/main/ipc/window.ts`(修改) |
| **输入** | 其他域统一使用 removeHandler + handle 模式 |
| **输出** | 移除标志位，统一使用 removeHandler + handle |
| **验收标准** | 1) 重复调用 registerXxxHandlers 不抛错; 2) handler 正确替换; 3) 既有测试通过 |
| **预估复杂度** | S（1-2h） |

### OPT2-30: Agent 组件硬编码英文 → 中文

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT2-30 |
| **优先级** | P3 |
| **状态** | done |
| **标题** | ApprovalCard/ExecutionPanel 硬编码英文改为中文 |
| **目标** | Agent 相关组件使用英文，与全应用中文不一致 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/Agent/ApprovalCard.vue`(修改) `src/renderer/src/components/Agent/ExecutionPanel.vue`(修改) |
| **输入** | 'Approval Required'/'Approve'/'Reject'/'Idle'/'Running' 等 |
| **输出** | 统一为中文 UI 文本 |
| **验收标准** | 1) 所有 Agent 相关 UI 为中文; 2) 语义准确 |
| **预估复杂度** | S（1h） |

---

## 未纳入本轮的任务（留待后续）

以下问题识别但暂不纳入本轮，需要更大规模重构：

- **SEC-03**: SSRF DNS 重绑定/重定向绕过（需自定义 DNS resolver 或 undici dispatcher，复杂度高）
- **RC-03**: ApprovalManager executionId 校验（需修改审批协议，影响面广）
- **PF-01**: 知识库全表扫描（需引入 sqlite-vec 等向量扩展，属于新功能）
- **ARCH-01**: tools → ipc 反向依赖（需抽象 workspace-service 层，属于架构重构）
- **ARCH-02**: 执行锁抽象（需设计 ExecutionLock 泛型类）
- **ARCH-03**: AgentExecutor 拆分（需大规模重构，属于架构演进）
- **TS-01**: IPC 边界 zod schema 校验（全量改造，工作量大）
- **voice.ts VAD 资源泄漏/waitForStreamEnd**: 涉及整个 VAD 子系统重写
- **DOMPurify style 属性**: 需评估 Shiki 依赖后决定
</arg_value>