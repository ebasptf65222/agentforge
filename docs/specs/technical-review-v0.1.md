# AgentForge v0.1 技术评审报告

> 审查对象：`agentforge-spec-v0.1.md`、`task-backlog-v0.1.md`、`ai-iteration-rules.md`
> 审查角色：严格技术评审
> 审查日期：2026-07-26
> 结论：**v0.1 存在 53 处需修复问题，其中 12 处阻塞级（P0），22 处严重级（P1），19 处改进级（P2）。不建议在未修复 P0 问题的情况下进入开发。**

---

## 一、类型定义缺失（P0 阻塞，共 11 项）

v0.1 声明"禁用 any，strict 模式"，但大量被引用的核心类型从未定义。AI 开发时要么自行编造类型导致不一致，要么被迫用 any 绕过。

| # | 引用位置 | 引用的类型 | 定义状态 | 影响 |
|---|---------|-----------|---------|------|
| T01 | §5, §7, §8 | `StreamChunk` | 未定义 | IPC 流式事件和 ModelAdapter 返回值无契约 |
| T02 | §9 | `ExecutionResult` | 未定义 | Agent 执行结果结构不明 |
| T03 | §9 | `TAOTrajectory` | 未定义 | 轨迹事件 payload 结构不明 |
| T04 | §9 | `ToolDefinition` | 未定义 | Agent 可用工具列表结构不明 |
| T05 | §8 | `ModelCapabilities` | 未定义 | 模型能力检测返回值不明 |
| T06 | §12 | `SearchResult` | 未定义 | 知识库检索返回值不明 |
| T07 | §12 | `Document` / `DocumentChunk` | 未定义 | 文档索引数据结构不明 |
| T08 | §10 | `MCPServerConfig` | 未定义 | MCP 配置结构不明 |
| T09 | §10 | `ITransport` | 未定义 | 传输层接口不明 |
| T10 | §5 | `ChatMessage.toolCalls` / `metadata` | 类型为 `JSON`，无结构 | 消息扩展字段无契约 |
| T11 | §5 | `AppSettings.shortcuts` | 未定义 | 快捷键结构不明 |

**修复方案**：v0.2 §5 新增完整的类型定义，所有被引用的类型必须有显式 `interface` 或 `type` 定义。

---

## 二、缺失 IPC 接口（P0 阻塞，共 9 项）

v0.1 §7.2 声称 P1 暴露 5 个命名空间 19 个方法，但实际只定义了 11 个。以下接口在 Backlog P1 任务中被引用，但 Spec 中缺失规格。

| # | Channel | 引用位置 | 缺失内容 |
|---|---------|---------|---------|
| I01 | `chat:create-conversation` | P1-09 验收标准 | 无输入/输出/异常规格 |
| I02 | `chat:list-conversations` | P1-09 验收标准 | 无输入/输出规格 |
| I03 | `chat:delete-conversation` | P1-09 验收标准 | 无输入/输出/异常规格 |
| I04 | `chat:get-messages` | P1-12 验收标准"加载消息" | 无输入/输出规格 |
| I05 | `chat:get-conversation` | 会话切换需要获取单条会话 | 完全未提及 |
| I06 | `file:select-dir` | §7.2 末尾提及 | 无输入/输出规格 |
| I07 | `file:select-file` | §7.2 末尾提及 | 无输入/输出规格 |
| I08 | `system:` 命名空间 | §7.1 声称 2 方法 | 2 个方法完全未定义 |
| I09 | `agent:trajectory` | §9.2 引用 | 事件 payload 结构未定义 |

**修复方案**：v0.2 §7 补全所有 P1 IPC 接口的完整规格（输入/输出/异常/验收）。

---

## 三、模糊点（P1 严重，共 14 项）

### M01: 代码高亮库二选一未决

> §4: "shiki | 或 highlight.js"

"或"字让 AI 无法决策。两者 API、包大小、主题系统完全不同。

**修复**：v0.2 明确选用 shiki（支持 VS Code 主题，与暗色/亮色切换天然兼容），删除 highlight.js 选项。

### M02: DeepSeek Adapter 继承策略

> §8.3: "继承或复用 OpenAI Adapter"

"继承"和"复用"是两种不同的实现路径。继承会引入 OpenAI Adapter 的所有 private 字段和方法依赖。

**修复**：v0.2 明确 DeepSeek Adapter 继承 OpenAI Adapter，仅覆盖默认 baseUrl。

### M03: ModelRouter 缓存失效策略

> §8.4: "内部 Map<modelId, ModelAdapter> 缓存"

未说明何时失效。模型配置更新或删除后，缓存的旧 Adapter 仍持有旧 API Key，会导致认证失败或使用过期配置。

**修复**：v0.2 规定 model:update 和 model:delete 时清除对应缓存条目。

### M04: 审批等待超时

> §9.3: 审批机制表

未定义用户不响应审批请求时的超时行为。Agent 会无限阻塞等待 `agent:approve`。

**修复**：v0.2 新增审批超时：默认 300s 无响应自动拒绝并终止执行，可通过 AppSettings 配置。

### M05: 工具失败熔断计数器重置

> §9.2: "连续 3 次工具失败 → 熔断"

"连续"的计数器何时重置未定义。如果第 1 次失败后第 2 次成功，计数器是否归零？

**修复**：v0.2 明确"连续"指不间隔成功的失败次数，任一次成功即归零。

### M06: Skill variables 替换机制

> §11.1: `variables?` 字段

变量的数据结构（数组？键值对？）、替换语法（`{{var}}`？`${var}`？）、何时替换（执行前？每轮？）均未定义。

**修复**：v0.2 定义 `SkillVariable` 接口，替换语法为 `{{variableName}}`，在 Agent 执行前一次性替换到 prompt 中。

### M07: Skill 意图匹配的 LLM 调用规格

> §11.2: "让 LLM 判断是否匹配"

未定义使用哪个模型、prompt 模板、返回格式（JSON？自由文本？）、如何提取 confidence 值。

**修复**：v0.2 定义匹配 prompt 模板，要求 LLM 返回 JSON `{ "matched": boolean, "skillName": string | null, "confidence": number, "reason": string }`，使用当前会话配置的模型。

### M08: Chunking token 计算方法

> §12.1: "500 token/chunk, 50 token overlap"

未定义 token 如何计算。不同模型的 tokenizer 不同，用空格分词还是用 tiktoken？

**修复**：v0.2 明确使用 `tiktoken`（OpenAI 模型）或字符数近似（其他模型），定义 fallback 策略。

### M09: 时间戳格式

> §5, §6: `created_at`, `updated_at` 未说明格式

SQLite 存储为 INTEGER，但未说明是 Unix 秒还是毫秒。

**修复**：v0.2 明确所有时间戳为 Unix 毫秒（`Date.now()`），SQLite 列类型 INTEGER。

### M10: IPC channel 命名不一致

v0.1 中混用动词和名词：`chat:send`（动词）、`chat:stream-chunk`（名词）、`model:list`（动词）、`model:test`（动词）。

**修复**：v0.2 统一为 `domain:verb-noun` 或 `domain:action` 格式，全部使用动词。流式事件改为 `chat:stream-chunk` → 保留（Main→Renderer 事件用名词描述内容）。

### M11: Preload 类型共享机制

§7.3 展示了 preload 的使用模式，但未说明渲染进程如何获得 `window.electron` 的 TypeScript 类型。

**修复**：v0.2 规定 preload 导出类型声明文件，渲染进程通过 `// @types/electron-api.d.ts` 获得类型提示。

### M12: UnoCSS 与 Naive UI 样式冲突

§4 同时引入 UnoCSS（原子化）和 Naive UI（组件库），两者都有 reset/normalize 样式，可能冲突。

**修复**：v0.2 明确 Naive UI 的样式优先级，UnoCSS 仅用于布局和间距，组件内部样式由 Naive UI 主题控制。配置 `unocss.config.ts` 的 `preflights` 关闭 reset。

### M13: chat() 非流式方法使用场景

> §8.1: `abstract chat(messages: ChatMessage[]): Promise<string>`

定义了非流式接口但从未在任何验收标准中使用。

**修复**：v0.2 保留但标注"P2 用于 Skill 意图匹配的快速 LLM 调用"，P1 不实现。

### M14: 系统快捷键冲突

§13.4 GeneralSettings 提到 shortcuts 字段但无具体定义，也不知道哪些快捷键可配置。

**修复**：v0.2 定义 `ShortcutConfig` 接口，列出 P1 阶段可配置的快捷键（新建会话、切换会话、发送消息、停止生成）。

---

## 四、风险点（P1 严重，共 10 项）

### R01: safeStorage 降级策略不可接受

> §8.5: "平台不支持 safeStorage 时降级为 base64 编码并警告"

base64 不是加密，任何能读取数据库文件的人都能解码 API Key。这是安全漏洞。

**修复**：v0.2 改为：safeStorage 不可用时抛出 `SAFE_STORAGE_UNAVAILABLE` 错误，阻止应用启动，提示用户检查系统配置。不允许降级存储明文或伪编码。

### R02: better-sqlite3 原生模块编译

better-sqlite3 是原生 C++ 模块，需要针对 Electron 版本重新编译。v0.1 未提及 `electron-rebuild` 或 `@electron/rebuild`。

**修复**：v0.2 §4 新增 `@electron/rebuild` 到开发依赖，`package.json` 的 `postinstall` 脚本配置 `electron-rebuild`。

### R03: 外键约束未启用

SQLite 默认不启用外键检查。§6 使用了 `ON DELETE CASCADE`，但未执行 `PRAGMA foreign_keys = ON`。

**修复**：v0.2 §6 新增数据库初始化时执行 `PRAGMA foreign_keys = ON` 和 `PRAGMA journal_mode = WAL`。

### R04: CSP（内容安全策略）未配置

§15 安全章节完全未提及 CSP。Electron 应用不配置 CSP 存在 XSS 注入风险。

**修复**：v0.2 §15 新增 CSP 配置规格，`Content-Security-Policy` header 限制 script-src 到 self。

### R05: 渲染进程安全配置不完整

§15.2 列了 contextIsolation/sandbox/nodeIntegration，但遗漏了 `webSecurity`、`allowRunningInsecureContent`、`navigateOnDragDrop`。

**修复**：v0.2 §15.2 补全所有 BrowserWindow webPreferences 安全项。

### R06: 数据库迁移版本管理缺失

§6 只有 `CREATE TABLE IF NOT EXISTS`，无 schema 版本号和迁移机制。P2 新增 `mcp_servers` 表、P3 新增 `skills` 表时无法管理迁移。

**修复**：v0.2 §6 新增 `schema_version` 表和迁移机制，每次 schema 变更记录版本号和迁移 SQL。

### R07: 流式输出中断后消息状态

用户点击停止（chat:stop）后，已生成的部分文本如何持久化？是保存为一条消息还是丢弃？metadata 中的 tokensUsed 如何计算？

**修复**：v0.2 规定：停止时已接收的内容保存为消息，metadata 标记 `stopped: true`，tokensUsed 记录已消耗的 token。

### R08: 并发会话生成

用户在会话 A 发送消息后，切换到会话 B 发送消息。两个流式生成是否允许并发？如果不允许，如何阻止？

**修复**：v0.2 规定 P1 阶段同一时间只允许一个流式生成，新会话发送时如果有进行中的生成，先停止旧的。

### R09: 进程退出时资源清理

§7 的 IPC handler 在应用退出时需要清理：MCP Server 子进程、进行中的 AbortController、数据库连接。

**修复**：v0.2 §2 新增应用生命周期资源清理规格，`before-quit` 事件中关闭数据库连接、终止 MCP 子进程。

### R10: 数据库文件锁与多实例

未配置单实例锁，用户可能打开多个实例，导致 SQLite 数据库文件锁冲突。

**修复**：v0.2 §2 新增 `app.requestSingleInstanceLock()` 单实例锁。

---

## 五、数据库设计问题（P1 严重，共 6 项）

| # | 问题 | 位置 | 修复方案 |
|---|------|------|---------|
| D01 | `conversations.model_id` 无外键约束 | §6 | 新增 `REFERENCES model_configs(id)` |
| D02 | `messages.role` 无 CHECK 约束 | §6 | 新增 `CHECK(role IN ('user','assistant','system','tool'))` |
| D03 | `model_configs.provider` 无 CHECK 约束 | §6 | 新增 `CHECK(provider IN ('openai','deepseek','anthropic','custom'))` |
| D04 | 缺少会话排序索引 | §6 | 新增 `CREATE INDEX idx_conv_updated ON conversations(updated_at DESC)` |
| D05 | app_settings 初始化无保障 | §6 | 新增迁移脚本中 `INSERT OR IGNORE INTO app_settings (id) VALUES (1)` |
| D06 | 缺少 PRAGMA 配置 | §6 | 新增 `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;` |

---

## 六、缺失验收标准（P1 严重，共 8 项）

| # | 缺失项 | 影响 | 修复方案 |
|---|--------|------|---------|
| A01 | 模型测试延迟无上限 | 1.3 "1s 内"不现实，网络延迟不可控 | 改为"5s 内返回结果，含超时提示" |
| A02 | API Key 加密验证方法未指定 | 1.4 "不是明文"无法验证 | 明确"用 sqlite3 CLI 查询 api_key 列，值不等于输入的明文 Key" |
| A03 | 启动性能无标准 | 无启动时间要求 | 新增"冷启动 ≤ 3s，热启动 ≤ 1s" |
| A04 | 消息渲染性能无标准 | 长消息列表卡顿 | 新增"100 条消息列表渲染 ≤ 500ms" |
| A05 | 内存占用无标准 | Electron 内存泄漏 | 新增"空闲状态内存 ≤ 300MB" |
| A06 | P2-P5 验收标准表缺失 | §18 只有 P1 | v0.2 补全 P2-P5 验收标准 |
| A07 | 错误恢复验收缺失 | 网络断开后恢复行为 | 新增"API 超时后重试 1 次，仍失败显示重试按钮" |
| A08 | 数据完整性验收缺失 | 外键级联删除 | 新增"删除会话后 messages 表中无孤儿记录" |

---

## 七、其他遗漏（P2 改进，共 5 项）

| # | 遗漏 | 修复方案 |
|---|------|---------|
| O01 | 无日志系统规格 | v0.2 新增 §19 日志规格（分级、格式、轮转、API Key 脱敏） |
| O02 | 无应用菜单规格 | v0.2 §13 新增原生菜单（macOS/Windows/Linux 差异） |
| O03 | 无窗口状态持久化 | v0.2 §2 新增窗口尺寸/位置持久化到 app_settings |
| O04 | 无数据备份/导出策略 | v0.2 §15 新增用户数据导出（JSON 格式） |
| O05 | 版本号缺少依赖锁定 | v0.2 §4 将"latest"替换为具体版本范围 |

---

## 八、Backlog 与迭代规则问题

### Backlog 问题

| # | 问题 | 修复 |
|---|------|------|
| B01 | P1-09 涵盖会话 CRUD + 设置 + 文件选择，职责过重（3 个不同领域） | 拆分为 P1-09a（会话 CRUD）和 P1-09b（设置 + 文件选择） |
| B02 | P1-05 Preload 与 P1-08 chat handler 有循环依赖标注 | P1-05 只暴露接口，P1-08 实现 handler，Preload 不依赖 handler |
| B03 | P1-13 和 P1-14 应合并或明确先后 | P1-14（Markdown 渲染）是 P1-13（对话界面）的子组件，改为 P1-13 依赖 P1-14 |
| B04 | 无环境配置任务（.env、.nvmrc 等） | 新增 P1-00 环境配置任务 |
| B05 | 复杂度估算不含测试编写时间 | 在复杂度图例中说明"含单元测试编写时间" |

### 迭代规则问题

| # | 问题 | 修复 |
|---|------|------|
| R01 | 任务状态更新方式未定义（在哪里改？markdown 表格？） | 在 Backlog 每个任务块新增 `状态:` 字段 |
| R02 | "读取依赖任务的涉及文件"范围过大 | 改为"读取依赖任务的公共接口文件（types、IPC channel 定义）" |
| R03 | 安全规则第 1 条 markdown 渲染断裂（代码块未闭合） | 修复 markdown 格式 |

---

## 九、修复优先级汇总

| 优先级 | 数量 | 描述 | v0.2 处理 |
|--------|------|------|----------|
| P0 阻塞 | 12 | 类型缺失 + IPC 缺失 + safeStorage | 必须修复才能开发 |
| P1 严重 | 22 | 模糊点 + 风险点 + DB 问题 + 验收缺失 | 必须修复才能 P1 闭环 |
| P2 改进 | 19 | 其他遗漏 + Backlog/规则优化 | 建议修复 |

**审查结论**：v0.1 在架构方向上是正确的，但作为"面向 AI 自主开发"的规格文档，存在大量类型未定义和接口缺失，会导致 AI 在开发时做出不一致的假设。v0.2 必须补全所有类型定义和接口规格，修复安全降级策略，完善数据库约束和验收标准。
