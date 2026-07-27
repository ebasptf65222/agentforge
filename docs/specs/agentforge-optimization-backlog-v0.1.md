# AgentForge 全局优化 - 任务拆解 v0.1

> 基于对项目后端/前端/构建配置的全面代码审查。
> 采用与语音/工作区功能相同的开发流程：小步快跑，每个任务完成后提交到 Gitee。

### 复杂度图例

| 等级 | 说明 | 预估时间 |
|------|------|----------|
| S | 简单，纯配置或类型定义 | 2-3h |
| M | 中等，需编写逻辑或组件 | 4-5h |
| L | 复杂，涉及多个文件联动 | 6-8h |
| XL | 高复杂度，跨层架构改动 | 8h+ |

### 优先级图例

| 等级 | 说明 |
|------|------|
| P0 | 安全漏洞 / 功能不可用，必须立即修复 |
| P1 | 重要缺陷 / 性能问题，尽快修复 |
| P2 | 代码质量 / 可维护性改善 |
| P3 | 锦上添花，低优先级 |

---

## P0 - 安全漏洞与功能不可用

### OPT-01: file_read / directory_list 工具路径安全漏洞

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-01 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | file_read / directory_list 工具添加路径边界校验 |
| **目标** | 将 file_read 和 directory_list 工具的路径校验从弱 `!path.includes('..')` 替换为 path-guard 模块，统一路径安全策略 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/tools/file-read.ts`(修改) `src/main/tools/directory-list.ts`(修改) |
| **输入** | 已有 `path-guard.ts` 的 `isPathInWorkspace` / `resolveWorkspacePath` |
| **输出** | file_read / directory_list 均通过 path-guard 校验路径，测试覆盖 |
| **验收标准** | 1) file_read 拒绝绝对路径; 2) file_read 拒绝 ../ 逃逸; 3) directory_list 同理; 4) 既有测试通过; 5) 新增路径安全测试 |
| **预估复杂度** | M（4-5h） |

### OPT-02: Agent 并发执行竞态修复

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-02 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | Agent 并发执行竞态条件修复 |
| **目标** | 将 currentExecutor 的设置移到第一个 await 之前，防止两个并发调用同时通过 null 检查 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/ipc/agent.ts`(修改) |
| **输入** | 当前 handleExecute 函数流程 |
| **输出** | 设置 currentExecutor 在所有异步操作之前 |
| **验收标准** | 1) 并发调用被正确拒绝; 2) 返回 AGENT_BUSY 或类似错误码; 3) 既有测试通过 |
| **预估复杂度** | S（2-3h） |

### OPT-03: MCP 命令黑名单增强

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-03 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | MCP stdio 命令黑名单增强 |
| **目标** | 扩展 COMMAND_BLOCKLIST，屏蔽 bash/sh/python/node/curl/wget 等可执行任意命令的程序 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/mcp/transport.ts`(修改) |
| **输入** | 当前 COMMAND_BLOCKLIST 仅含 rm/del/format/mkfs |
| **输出** | 完善的命令黑名单 + 对应测试 |
| **验收标准** | 1) 屏蔽 bash/sh/zsh/csh/fish/cmd/powershell/python/node/ruby/perl/php/go/java/curl/wget; 2) 允许 git/npm/pnpx 等安全工具; 3) 既有 MCP transport 测试通过; 4) 新增黑名单测试 |
| **预估复杂度** | S（2-3h） |

### OPT-04: SSRF 防护 - web-scrape 限制内网访问

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-04 |
| **优先级** | P0 |
| **状态** | done |
| **标题** | web-scrape 添加 SSRF 防护，限制内网访问 |
| **目标** | 在 web-scrape 工具中添加 URL 校验，拒绝内网地址（localhost/127.0.0.1/10.x/172.16-31.x/192.168.x/169.254.x 等） |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/tools/web-scrape.ts`(修改) |
| **输入** | 当前 fetch 任意 URL 无限制 |
| **输出** | URL 校验函数 + 错误码 + 测试 |
| **验收标准** | 1) 拒绝 localhost/127.0.0.1; 2) 拒绝 10.0.0.0/8; 3) 拒绝 172.16.0.0/12; 4) 拒绝 192.168.0.0/16; 5) 拒绝 169.254.169.254; 6) 拒绝 ::1; 7) 允许正常外网 URL; 8) 既有测试通过 |
| **预估复杂度** | M（4-5h） |

---

## P1 - 重要缺陷与性能问题

### OPT-05: CSP 策略动态化

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-05 |
| **优先级** | P1 |
| **状态** | pending |
| **标题** | CSP connect-src 从硬编码改为动态生成 |
| **目标** | 根据 model_configs 中的 baseUrl 动态构建 CSP connect-src，支持 Ollama/Anthropic/自定义端点 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/index.ts`(修改) |
| **输入** | 当前硬编码 openai.com + deepseek.com |
| **输出** | 启动时读取所有 model baseUrl，构建 CSP connect-src 白名单 |
| **验收标准** | 1) Ollama localhost:11434 可正常调用; 2) 自定义 OpenAI 兼容端点可正常调用; 3) 未知外部域名仍被拦截; 4) 既有功能不受影响 |
| **预估复杂度** | M（4-5h） |

### OPT-06: Markdown 渲染性能优化

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-06 |
| **优先级** | P1 |
| **状态** | pending |
| **标题** | 流式输出时 Markdown 降级渲染，减少重复解析 |
| **目标** | 流式输出期间使用纯文本渲染（仅转义 HTML），流结束后切换为完整 Markdown 渲染 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/common/MarkdownRenderer.vue`(修改) `src/renderer/src/components/ChatPanel/MessageList.vue`(修改) |
| **输入** | 当前每个 chunk 都触发完整 marked + DOMPurify 渲染 |
| **输出** | isStreaming prop 控制：streaming 时纯文本，结束后 markdown |
| **验收标准** | 1) 流式期间消息显示纯文本; 2) 流结束后自动切换为 markdown; 3) 不影响历史消息的 markdown 渲染; 4) 类型检查通过 |
| **预估复杂度** | M（4-5h） |

### OPT-07: API Key 加密存储

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-07 |
| **优先级** | P1 |
| **状态** | pending |
| **标题** | 使用 Electron safeStorage 加密 API Key 存储 |
| **目标** | model_configs 表中的 api_key 使用 electron safeStorage 加密字符串存储，读取时解密 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/db/repos/model-config.ts`(修改) `src/main/ipc/model.ts`(修改) |
| **输入** | 当前 api_key 明文 TEXT 存储 |
| **输出** | encryptApiKey / decryptApiKey 工具函数 + model config 读写时加解密 |
| **验收标准** | 1) 存入 DB 的 api_key 为加密字符串; 2) 读取后解密为原始值; 3) safeStorage 不可用时降级为明文（带警告日志）; 4) 既有模型 CRUD 测试通过; 5) 新增加解密测试 |
| **预估复杂度** | L（6-8h） |

### OPT-08: 语义搜索性能优化

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-08 |
| **优先级** | P1 |
| **状态** | pending |
| **标题** | 知识库搜索预归一化 + 批量查询优化 |
| **目标** | 嵌入存储时预归一化向量，搜索时用点积替代余弦相似度；批量操作改用 IN 查询 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/knowledge-base/embedding.ts`(修改) `src/main/knowledge-base/search.ts`(修改) `src/main/db/repos/kb-chunk.ts`(修改) |
| **输入** | 当前每次搜索全表加载 + 每次重算向量范数 |
| **输出** | 预归一化存储 + 点积相似度 + 批量 IN 查询 |
| **验收标准** | 1) 嵌入存储时归一化; 2) 搜索使用点积（无除法）; 3) batchInsert 后用 IN 查询; 4) 既有 KB 测试通过; 5) 搜索结果与优化前一致 |
| **预估复杂度** | M（4-5h） |

### OPT-09: KB Store indexing Set 响应式修复

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-09 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | 修复 KB Store 的 indexing Set 非响应式问题 |
| **目标** | 将 `ref<Set<string>>` 改为 `ref<string[]>` 或使用 `shallowRef` + `triggerRef`，确保索引状态变化触发 UI 更新 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/stores/kb.ts`(修改) |
| **输入** | 当前 `ref<Set<string>>(new Set())` 不触发响应式更新 |
| **输出** | 改为 `ref<string[]>([])` + 数组操作方法 |
| **验收标准** | 1) 索引开始时按钮变禁用; 2) 索引完成后按钮恢复可用; 3) 多个文档同时索引状态正确; 4) 类型检查通过 |
| **预估复杂度** | S（2-3h） |

### OPT-10: 主题切换冲突修复 + ModelConfig 主题适配

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-10 |
| **优先级** | P1 |
| **状态** | pending |
| **标题** | 修复主题切换冲突 + ModelConfig 硬编码颜色迁移到 CSS 变量 |
| **目标** | 统一 GeneralSettings 与 useTheme 的主题切换逻辑；将 ModelConfig 中约 30 处硬编码颜色替换为 `var(--af-*)` 变量 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/composables/use-theme.ts`(修改) `src/renderer/src/components/Settings/GeneralSettings.vue`(修改) `src/renderer/src/components/Settings/ModelConfig.vue`(修改) |
| **输入** | GeneralSettings 直接操作 classList 与 useTheme 冲突；ModelConfig 硬编码深色颜色 |
| **输出** | 移除 GeneralSettings 的独立 applyTheme，统一走 useTheme；ModelConfig 使用 CSS 变量 |
| **验收标准** | 1) 主题切换统一通过 useTheme; 2) ModelConfig 浅色主题下配色正确; 3) 深色主题无回归; 4) 类型检查通过 |
| **预估复杂度** | L（6-8h） |

### OPT-11: VoiceControlPanel Transition CSS 修复

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-11 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | 恢复 VoiceControlPanel 被注释的过渡动画 CSS |
| **目标** | 取消注释 slide-up 和 fade 过渡动画样式 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/components/VoiceControlPanel.vue`(修改) |
| **输入** | 第 311-331 行 Transition CSS 被注释 |
| **输出** | 取消注释，面板显示/隐藏有过渡动画 |
| **验收标准** | 1) 面板出现有 slide-up 动画; 2) 面板消失有 fade 动画; 3) 不影响其他功能 |
| **预估复杂度** | S（1h） |

### OPT-12: SttRecorder 超时 setTimeout 未清理修复

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-12 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | 修复 SttRecorder 超时 setTimeout 在 stop() 时未清理的问题 |
| **目标** | 保存超时 setTimeout 的 timer ID，在 stopTimers 中清理 |
| **依赖任务** | 无 |
| **涉及文件** | `src/renderer/src/utils/stt-recorder.ts`(修改) |
| **输入** | startTimers 中 setTimeout 无保存 ID，stopTimers 未清理 |
| **输出** | 保存超时 timer ID，stop 时清理 |
| **验收标准** | 1) stop() 后超时 setTimeout 不再触发; 2) 正常超时仍生效; 3) 既有测试通过 |
| **预估复杂度** | S（2-3h） |

### OPT-13: MCP Manager 错误日志 + 退出时异步清理

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-13 |
| **优先级** | P1 |
| **状态** | done |
| **标题** | MCP Manager 添加错误日志 + 退出时支持异步清理 |
| **目标** | 将空 catch {} 替换为 console.error 日志；registerCleanup 支持异步函数 |
| **依赖任务** | 无 |
| **涉及文件** | `src/main/mcp/manager.ts`(修改) `src/main/index.ts`(修改) |
| **输入** | 5+ 处空 catch 无日志；registerCleanup 仅支持同步函数 |
| **输出** | MCP 错误有日志；cleanup 支持 async 函数 |
| **验收标准** | 1) MCP 连接失败有 console.error 日志; 2) before-quit 可等待异步清理; 3) 既有测试通过 |
| **预估复杂度** | M（4-5h） |

---

## P2 - 代码质量与可维护性

### OPT-14: 提取重复工具函数到公共模块

| 字段 | 内容 |
|------|------|
| **任务 ID** | OPT-14 |
| **优先级** | P2 |
| **状态** | done |
| **标题** | 提取重复的 assertNonEmptyString / getMainWindowWebContents 到 utils |</arg_value>